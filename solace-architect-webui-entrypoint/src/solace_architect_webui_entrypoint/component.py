"""SAM Gateway Component for the Solace Architect WebUI entrypoint.

Implements the BaseGatewayComponent contract:
- ``_extract_initial_claims``      — auth claims for incoming external events
- ``_start_listener`` / ``_stop_listener`` — lifecycle (HTTP server on/off)
- ``_translate_external_input``    — HTTP request body → A2A parts
- ``_send_update_to_external``     — streaming A2A status/artifact → browser SSE
- ``_send_final_response_to_external`` — final A2A Task → browser SSE
- ``_send_error_to_external``      — JSONRPCError → browser SSE

The HTTP server uses aiohttp for native async support + Server-Sent Events.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from aiohttp import web
from solace_agent_mesh.gateway.base.component import BaseGatewayComponent
from a2a.types import (
    DataPart,
    FilePart,
    FileWithBytes,
    FileWithUri,
    JSONRPCError,
    Part as A2APart,
    Task,
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
    TextPart,
)

from solace_architect_webui_entrypoint.routes.api import API_ROUTES

log = logging.getLogger(__name__)


def _webui_static_dir() -> Path:
    """Path to the bundled static dashboard + intake assets."""
    return Path(__file__).parent / "webui"


class SolaceArchitectWebuiComponent(BaseGatewayComponent):
    """WebUI entrypoint — bridges browser/REST traffic to SAM agents over A2A."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        log.info("%s Initializing Solace Architect WebUI entrypoint…", self.log_identifier)

        ac = self.get_config("adapter_config") or {}
        self._port: int = int(ac.get("port", 8080))
        self._host: str = ac.get("host", "0.0.0.0")
        self._show_status_updates: bool = bool(ac.get("show_status_updates", True))

        # Per-session SSE queues. Key: session_id (== A2A request_context["session_id"]).
        self._sse_queues: Dict[str, asyncio.Queue] = {}

        # aiohttp web objects (set in _start_listener)
        self._app: Optional[web.Application] = None
        self._runner: Optional[web.AppRunner] = None
        self._site: Optional[web.TCPSite] = None

    # ---------- SAM-required lifecycle hooks ----------

    async def _extract_initial_claims(
        self, external_event_data: Any,
    ) -> Optional[Dict[str, Any]]:
        """Return claims for the browser user.

        Phase 1: anonymous. Phase 2 reads OIDC token from external_event_data.headers.
        """
        return {
            "id": external_event_data.get("user_id", "anonymous"),
            "name": external_event_data.get("user_name", "anonymous"),
            "source": "webui",
        }

    def _start_listener(self) -> None:
        """Start the aiohttp HTTP server on the configured port."""
        log.info("%s Starting WebUI HTTP listener on %s:%d", self.log_identifier, self._host, self._port)

        self._app = web.Application()

        # Static assets — index, dashboard SPA, intake form, CSS/JS bundles
        static_dir = _webui_static_dir()
        self._app.router.add_get("/", self._serve_index)
        self._app.router.add_get("/intake/", self._serve_intake)
        self._app.router.add_get("/intake/index.html", self._serve_intake)
        self._app.router.add_static("/assets/", static_dir / "assets", show_index=False)

        # SSE chat stream — session-scoped
        self._app.router.add_get("/api/chat/stream/{session_id}", self._sse_chat_stream)
        self._app.router.add_post("/api/chat/message", self._chat_message)

        # All other JSON API routes are wired declaratively via routes/api.py.
        # We adapt each handler to aiohttp request/response with Cache-Control: no-store.
        for method, path, handler in API_ROUTES:
            self._app.router.add_route(method, path, self._adapt_api_handler(handler))

        # Run the aiohttp server inside the existing event loop.
        loop = asyncio.get_event_loop()
        self._runner = web.AppRunner(self._app)
        loop.run_until_complete(self._runner.setup())
        self._site = web.TCPSite(self._runner, host=self._host, port=self._port)
        loop.run_until_complete(self._site.start())
        log.info("%s WebUI listening at http://%s:%d", self.log_identifier, self._host, self._port)

    def _stop_listener(self) -> None:
        """Stop the HTTP server cleanly."""
        log.info("%s Stopping WebUI HTTP listener…", self.log_identifier)
        loop = asyncio.get_event_loop()
        if self._site:
            loop.run_until_complete(self._site.stop())
        if self._runner:
            loop.run_until_complete(self._runner.cleanup())

    async def _translate_external_input(
        self, external_event: Any,
    ) -> Tuple[str, List[A2APart], Dict[str, Any]]:
        """Convert a browser POST body → (target_agent, A2A parts, request_context).

        external_event is the dict produced by the chat POST handler — it includes
        the user's text, the active engagement_id, and the SSE session_id.
        """
        text = (external_event.get("text") or "").strip()
        parts: List[A2APart] = []
        if text:
            parts.append(TextPart(text=text))

        # Files attached to the chat message (e.g., YAML intake upload)
        for f in external_event.get("files") or []:
            if "bytes" in f:
                parts.append(FilePart(file=FileWithBytes(name=f["name"],
                                                        mime_type=f.get("mime_type", "application/octet-stream"),
                                                        bytes=f["bytes"])))
            elif "uri" in f:
                parts.append(FilePart(file=FileWithUri(name=f["name"],
                                                      mime_type=f.get("mime_type", ""),
                                                      uri=f["uri"])))

        # Structured data attached (e.g., AskUserQuestion answer)
        if external_event.get("data") is not None:
            parts.append(DataPart(data=external_event["data"]))

        target_agent = external_event.get("agent") or self.get_config("default_agent_name")
        request_context = {
            "session_id": external_event["session_id"],
            "engagement_id": external_event.get("engagement_id"),
            "external_event_id": str(uuid.uuid4()),
        }
        return target_agent, parts, request_context

    async def _send_update_to_external(
        self,
        external_request_context: Dict[str, Any],
        event_data: Union[TaskStatusUpdateEvent, TaskArtifactUpdateEvent],
        is_final_chunk_of_update: bool,
    ) -> None:
        """Push a status/artifact update into the session's SSE queue."""
        if not self._show_status_updates and isinstance(event_data, TaskStatusUpdateEvent):
            return
        await self._enqueue_sse(external_request_context, {
            "type": event_data.__class__.__name__,
            "data": _serialize_event(event_data),
            "final": is_final_chunk_of_update,
        })

    async def _send_final_response_to_external(
        self, external_request_context: Dict[str, Any], task_data: Task,
    ) -> None:
        """Push the final Task into the session's SSE queue."""
        await self._enqueue_sse(external_request_context, {
            "type": "FinalResponse",
            "data": _serialize_event(task_data),
        })

    async def _send_error_to_external(
        self, external_request_context: Dict[str, Any], error_data: JSONRPCError,
    ) -> None:
        await self._enqueue_sse(external_request_context, {
            "type": "Error",
            "data": {"code": error_data.code, "message": error_data.message,
                     "data": getattr(error_data, "data", None)},
        })

    # ---------- HTTP handlers ----------

    async def _serve_index(self, request: web.Request) -> web.Response:
        return web.FileResponse(_webui_static_dir() / "index.html",
                                headers={"Cache-Control": "no-store"})

    async def _serve_intake(self, request: web.Request) -> web.Response:
        return web.FileResponse(_webui_static_dir() / "intake" / "index.html",
                                headers={"Cache-Control": "no-store"})

    def _adapt_api_handler(self, handler):
        """Wrap a coroutine ``handler(**kwargs)`` as an aiohttp route handler."""
        async def adapted(request: web.Request) -> web.Response:
            # Gather kwargs from path + query + JSON body
            kwargs: Dict[str, Any] = dict(request.match_info)
            kwargs.update(dict(request.query))
            if request.can_read_body and request.content_length:
                try:
                    body = await request.json()
                    if isinstance(body, dict):
                        kwargs.update(body)
                except (json.JSONDecodeError, ValueError):
                    pass
            try:
                result = await handler(**kwargs)
            except TypeError as e:
                return web.json_response({"error": f"bad parameters: {e}"}, status=400,
                                         headers={"Cache-Control": "no-store"})
            return web.json_response(result, headers={"Cache-Control": "no-store"},
                                     dumps=_safe_json_dumps)
        return adapted

    async def _chat_message(self, request: web.Request) -> web.Response:
        """User posts a chat message → translate + dispatch via SAM A2A."""
        body = await request.json()
        session_id = body.get("session_id") or str(uuid.uuid4())
        body["session_id"] = session_id

        # Lazy-create the SSE queue for this session
        self._sse_queues.setdefault(session_id, asyncio.Queue())

        # Translate + dispatch through the SAM gateway base class machinery.
        # BaseGatewayComponent provides the async dispatch path internally.
        await self.process_external_event(body)
        return web.json_response({"session_id": session_id, "accepted": True},
                                 headers={"Cache-Control": "no-store"})

    async def _sse_chat_stream(self, request: web.Request) -> web.StreamResponse:
        """SSE stream of agent events for a single session."""
        session_id = request.match_info["session_id"]
        queue = self._sse_queues.setdefault(session_id, asyncio.Queue())

        resp = web.StreamResponse(status=200, headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
        })
        await resp.prepare(request)
        try:
            while True:
                event = await queue.get()
                if event is None:                   # poison pill = client disconnect
                    break
                payload = _safe_json_dumps(event)
                await resp.write(f"data: {payload}\n\n".encode("utf-8"))
                if event.get("final") or event.get("type") in ("FinalResponse", "Error"):
                    await resp.write(b"event: complete\ndata: {}\n\n")
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        return resp

    # ---------- helpers ----------

    async def _enqueue_sse(self, ctx: Dict[str, Any], payload: Dict[str, Any]) -> None:
        session_id = ctx.get("session_id")
        if not session_id:
            log.warning("%s SSE event without session_id; dropping", self.log_identifier)
            return
        q = self._sse_queues.setdefault(session_id, asyncio.Queue())
        await q.put(payload)


def _serialize_event(obj: Any) -> Any:
    """Convert A2A pydantic-ish objects to plain dicts for JSON serialization."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=True)
    if hasattr(obj, "dict"):
        return obj.dict(exclude_none=True)
    return obj


def _safe_json_dumps(obj: Any) -> str:
    return json.dumps(obj, default=str)

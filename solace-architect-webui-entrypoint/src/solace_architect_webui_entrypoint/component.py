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
import os
import threading
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

from solace_architect_webui_entrypoint.auth import (
    AuthState, add_auth_routes, ensure_initialized, install_middleware,
)
from solace_architect_webui_entrypoint.auth.middleware import SESSION_COOKIE
from solace_architect_webui_entrypoint.auth.sessions import validate_session
from solace_architect_webui_entrypoint.auth.db import user_to_claims
from solace_architect_webui_entrypoint.routes.api import API_ROUTES

log = logging.getLogger(__name__)


# Module-level discovery metadata — solace-ai-connector's Flow machinery reads
# this when instantiating the component class. Matches the cli-entrypoint pattern.
info = {
    "class_name": "SolaceArchitectWebuiComponent",
    "description": (
        "HTTP-SSE entrypoint component for Solace Architect. Serves the dashboard, "
        "intake form, audience-pack reports, and REST API; bridges browser/REST "
        "traffic to the SAOrchestratorAgent over A2A."
    ),
    "config_parameters": [],
    "input_schema": {"type": "object", "properties": {}},
    "output_schema": {"type": "object", "properties": {}},
}


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

        # Anchor SA's storage to SAM's artifact_service.base_path when SA_STORAGE_ROOT
        # isn't explicitly set. Without this, solace-architect-core falls back to a
        # cwd-relative "./sa-artifacts" and SAM's artifact service falls back to
        # "/tmp/sa-artifacts" — two different places for what should be the same
        # data. Setting the env var here (process-wide) means any SA agent plugin
        # running in the same SAM process inherits the same root.
        artifact_cfg = self.get_config("artifact_service") or {}
        artifact_base = artifact_cfg.get("base_path") or ""
        if artifact_base and not os.environ.get("SA_STORAGE_ROOT"):
            os.environ["SA_STORAGE_ROOT"] = str(artifact_base)
            log.info("%s SA_STORAGE_ROOT defaulted to artifact_service.base_path=%s",
                     self.log_identifier, artifact_base)

        # Auth state — local SQLite user DB.
        # DB path is configurable via WEBUI_USERS_DB env var; defaults under
        # SA_STORAGE_ROOT/__system__/users.db.
        storage_root = Path(os.environ.get("SA_STORAGE_ROOT", "/tmp/sa-artifacts"))
        default_db = storage_root / "__system__" / "users.db"
        db_path = Path(os.environ.get("WEBUI_USERS_DB", str(default_db)))

        require_auth = (os.environ.get("WEBUI_REQUIRE_AUTH", "true").lower() != "false")
        enable_signup = (os.environ.get("WEBUI_ENABLE_SIGNUP", "true").lower() != "false")

        self._auth_state: AuthState = ensure_initialized(
            db_path,
            require_auth=require_auth,
            enable_signup=enable_signup,
            csrf_secret=os.environ.get("WEBUI_CSRF_SECRET"),
        )
        log.info(
            "%s Auth: db=%s, require_auth=%s, enable_signup=%s",
            self.log_identifier, db_path, require_auth, enable_signup,
        )

        # Per-session SSE queues. Key: session_id (== A2A request_context["session_id"]).
        # Created lazily on the HTTP loop thread; cross-thread access uses run_coroutine_threadsafe.
        self._sse_queues: Dict[str, asyncio.Queue] = {}

        # aiohttp web objects (set in _start_listener's worker thread)
        self._app: Optional[web.Application] = None
        self._runner: Optional[web.AppRunner] = None
        self._site: Optional[web.TCPSite] = None
        self._http_loop: Optional[asyncio.AbstractEventLoop] = None   # the HTTP thread's loop
        self._http_thread: Optional[threading.Thread] = None
        self._http_ready = threading.Event()                          # signals listener up

    # ---------- SAM-required lifecycle hooks ----------

    async def _extract_initial_claims(
        self, external_event_data: Any,
    ) -> Optional[Dict[str, Any]]:
        """Return claims for the browser user.

        Reads from the validated session token in the cookie. If WEBUI_REQUIRE_AUTH
        is false (dev bypass), returns anonymous.
        """
        if not self._auth_state.require_auth:
            return {"id": "anonymous", "name": "anonymous", "email": None,
                    "groups": [], "source": "webui", "is_admin": False}

        session_token = external_event_data.get("session_token") if isinstance(external_event_data, dict) else None
        if not session_token:
            # Anonymous fallback — agent will see anonymous user.
            return {"id": "anonymous", "name": "anonymous", "email": None,
                    "groups": [], "source": "webui", "is_admin": False}

        user_row = validate_session(self._auth_state, session_token)
        if not user_row:
            return {"id": "anonymous", "name": "anonymous", "email": None,
                    "groups": [], "source": "webui", "is_admin": False}
        return user_to_claims(user_row)

    def _start_listener(self) -> None:
        """Start the aiohttp HTTP server in its own thread with its own event loop.

        SAM runs its asyncio loop in a dedicated thread already (per the
        SamComponentBase logs). We can't share that loop directly without coordinated
        startup — so the HTTP server gets its own thread + loop and cross-thread
        events flow via asyncio.run_coroutine_threadsafe (see _enqueue_sse).
        """
        log.info("%s Starting WebUI HTTP listener on %s:%d",
                 self.log_identifier, self._host, self._port)

        def _run_http_server() -> None:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                self._http_loop = loop

                self._app = web.Application()

                # Static-asset no-cache during dev iteration. Static handlers
                # don't set Cache-Control by default, so browsers heuristic-cache
                # the JS/CSS aggressively and edits don't show up without a hard
                # reload. Sending no-cache on /assets/* + the index/intake HTML
                # avoids that. Once we ship fingerprinted assets we can drop this.
                @web.middleware
                async def _no_cache_static(request, handler):
                    response = await handler(request)
                    path = request.path
                    if path.startswith("/assets/") or path in {"/", "/settings"} or path.startswith("/intake"):
                        response.headers.setdefault("Cache-Control", "no-cache, must-revalidate")
                    return response

                self._app.middlewares.append(_no_cache_static)

                # Auth: middleware FIRST (applies to every request), then auth routes.
                install_middleware(self._app, self._auth_state)
                add_auth_routes(self._app, self._auth_state)

                static_dir = _webui_static_dir()
                # Static assets — the dashboard SPA shell handles routing client-side
                # for /, /projects/{id}/{view}, /intake/new, /intake/edit/{id}, etc.
                self._app.router.add_get("/", self._serve_index)
                self._app.router.add_get("/projects/{tail:.*}", self._serve_index)
                self._app.router.add_get("/settings", self._serve_index)
                self._app.router.add_get("/intake", self._serve_intake_form)
                self._app.router.add_get("/intake/{tail:.*}", self._serve_intake_form)
                self._app.router.add_static("/assets/", static_dir / "assets", show_index=False)
                # SSE chat stream + chat POST + agent discovery
                self._app.router.add_get("/api/chat/stream/{session_id}", self._sse_chat_stream)
                self._app.router.add_post("/api/chat/message", self._chat_message)
                self._app.router.add_get("/api/agents", self._agents_list)
                # Health probes (unauthenticated)
                self._app.router.add_get("/health",  self._health)
                self._app.router.add_get("/ready",   self._ready)
                # Declarative JSON API routes
                for method, path, handler in API_ROUTES:
                    self._app.router.add_route(method, path, self._adapt_api_handler(handler))

                self._runner = web.AppRunner(self._app)
                loop.run_until_complete(self._runner.setup())
                self._site = web.TCPSite(self._runner, host=self._host, port=self._port)
                loop.run_until_complete(self._site.start())

                log.info("%s WebUI listening at http://%s:%d",
                         self.log_identifier, self._host, self._port)
                self._http_ready.set()

                loop.run_forever()    # serve requests until _stop_listener triggers loop.stop
            except Exception:
                log.exception("%s HTTP server failed to start", self.log_identifier)
                self._http_ready.set()    # unblock waiters even on failure

        self._http_thread = threading.Thread(
            target=_run_http_server, name="sa-webui-http", daemon=True,
        )
        self._http_thread.start()

        # Block briefly so SAM doesn't proceed before the listener is bound (or failed).
        if not self._http_ready.wait(timeout=15):
            log.error("%s HTTP listener didn't signal readiness within 15s",
                      self.log_identifier)

    def _stop_listener(self) -> None:
        """Stop the HTTP server cleanly from SAM's main thread."""
        log.info("%s Stopping WebUI HTTP listener…", self.log_identifier)
        if not self._http_loop:
            return

        async def _shutdown() -> None:
            if self._site:
                await self._site.stop()
            if self._runner:
                await self._runner.cleanup()

        future = asyncio.run_coroutine_threadsafe(_shutdown(), self._http_loop)
        try:
            future.result(timeout=5)
        except Exception:
            log.exception("%s Error during HTTP listener shutdown", self.log_identifier)
        finally:
            self._http_loop.call_soon_threadsafe(self._http_loop.stop)
            if self._http_thread:
                self._http_thread.join(timeout=5)

    async def _translate_external_input(
        self, external_event: Any,
    ) -> Tuple[str, List[A2APart], Dict[str, Any]]:
        """Convert a browser POST body → (target_agent, A2A parts, request_context).

        external_event is the dict produced by the chat POST handler — it includes
        the user's text, the active engagement_id, and the SSE session_id.
        """
        text = (external_event.get("text") or "").strip()
        # Inject the active engagement_id into the agent's input so its tools
        # (read_artifact, record_open_item, …) have something to scope to.
        # request_context carries this for callback routing only — it doesn't
        # reach the agent prompt.
        eid = external_event.get("engagement_id")
        if eid:
            text = f"[Active engagement: engagement_id={eid}]\n\n{text}" if text else f"[Active engagement: engagement_id={eid}]"
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
        """Serve the dashboard SPA shell. Same file for /, /projects/{...}, etc."""
        return web.FileResponse(_webui_static_dir() / "index.html",
                                headers={"Cache-Control": "no-store"})

    async def _serve_intake_form(self, request: web.Request) -> web.Response:
        """Serve the intake form for /intake/new and /intake/edit/{id}."""
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

        # Inject the auth session token so _extract_initial_claims can resolve the user.
        body["session_token"] = request.cookies.get(SESSION_COOKIE)

        # Lazy-create the SSE queue for this session.
        self._sse_queues.setdefault(session_id, asyncio.Queue())

        # Resolve identity + translate browser body → (target_agent, A2A parts, ctx).
        try:
            user_identity = await self._extract_initial_claims(body)
            target_agent, parts, request_context = await self._translate_external_input(body)
        except Exception as e:
            log.exception("%s Chat translate failed", self.log_identifier)
            return web.json_response({"error": f"translate failed: {e}"}, status=400,
                                     headers={"Cache-Control": "no-store"})

        if not target_agent:
            return web.json_response(
                {"error": "no target agent — set 'agent' in body or 'default_agent_name' in config"},
                status=400, headers={"Cache-Control": "no-store"},
            )

        # Submit through BaseGatewayComponent's dispatch path. SAM publishes to
        # the agent over A2A; responses arrive on the gateway response/status
        # topics and route back into _send_*_to_external → SSE queue (we bridge
        # back from SAM's loop via run_coroutine_threadsafe in _enqueue_sse).
        # NOTE: submit_a2a_task expects to run on SAM's asyncio loop, not the
        # HTTP loop this handler is on. We cross loops with run_coroutine_threadsafe.
        try:
            sam_loop = self.get_async_loop()
            coro = self.submit_a2a_task(
                target_agent_name=target_agent,
                a2a_parts=parts,
                external_request_context=request_context,
                user_identity=user_identity,
                is_streaming=True,
            )
            if sam_loop is None or sam_loop is asyncio.get_event_loop():
                task_id = await coro
            else:
                fut = asyncio.run_coroutine_threadsafe(coro, sam_loop)
                task_id = await asyncio.wrap_future(fut)
        except Exception as e:
            log.exception("%s Chat dispatch failed", self.log_identifier)
            return web.json_response({"error": f"dispatch failed: {e}"}, status=502,
                                     headers={"Cache-Control": "no-store"})

        return web.json_response(
            {"session_id": session_id, "task_id": task_id, "accepted": True},
            headers={"Cache-Control": "no-store"},
        )

    async def _health(self, request: web.Request) -> web.Response:
        """Liveness probe — always 200 once the HTTP server is up."""
        return web.json_response({"status": "ok"}, headers={"Cache-Control": "no-store"})

    async def _ready(self, request: web.Request) -> web.Response:
        """Readiness probe — 200 only when the gateway has finished initializing."""
        ready = bool(self._http_ready and self._http_ready.is_set())
        agents = 0
        try:
            agents = len(self.agent_registry.get_agent_names() or [])
        except Exception:
            pass
        return web.json_response(
            {"status": "ready" if ready else "not_ready", "discovered_agents": agents},
            status=200 if ready else 503,
            headers={"Cache-Control": "no-store"},
        )

    async def _agents_list(self, request: web.Request) -> web.Response:
        """List agents currently discovered on the SAM mesh (for the chat picker)."""
        default_name = self.get_config("default_agent_name") or ""
        try:
            names = list(self.agent_registry.get_agent_names() or [])
        except Exception:
            names = []
        if default_name and default_name not in names:
            names.append(default_name)
        names = sorted(set(names))
        return web.json_response(
            {"agents": [{"name": n, "default": n == default_name} for n in names],
             "default": default_name},
            headers={"Cache-Control": "no-store"},
        )

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
        """Bridge an SSE event from SAM's loop thread to the HTTP loop thread."""
        session_id = ctx.get("session_id")
        if not session_id:
            log.warning("%s SSE event without session_id; dropping", self.log_identifier)
            return
        if not self._http_loop:
            log.warning("%s SSE event before HTTP loop ready; dropping", self.log_identifier)
            return

        async def _put_on_http_loop() -> None:
            q = self._sse_queues.setdefault(session_id, asyncio.Queue())
            await q.put(payload)

        # Schedule the put on the HTTP loop's thread; don't block SAM's loop on completion.
        asyncio.run_coroutine_threadsafe(_put_on_http_loop(), self._http_loop)


def _serialize_event(obj: Any) -> Any:
    """Convert A2A pydantic-ish objects to plain dicts for JSON serialization."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=True)
    if hasattr(obj, "dict"):
        return obj.dict(exclude_none=True)
    return obj


def _safe_json_dumps(obj: Any) -> str:
    return json.dumps(obj, default=str)

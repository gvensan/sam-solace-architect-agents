"""Dashboard + API route handlers.

Each route is a plain async function returning a JSON-serializable dict. The
plugin's lifecycle.py adapts them to whatever HTTP framework SAM exposes
(FastAPI, Starlette, or a custom router).

All routes apply ``Cache-Control: no-store`` per v2spec Decision 52.
"""

from __future__ import annotations

from typing import Any

from datetime import datetime, timezone

from solace_architect_core.tools import (
    artifact_tools, decision_tools, project_tools,
    dashboard_tools, intake_tools, blueprint_tools,
    telemetry_tools, lifecycle_tools,
)
from solace_architect_core._storage import (
    read_jsonl, read_yaml, safe_artifact_path, write_text, write_yaml,
)


async def _clear_step_telemetry(engagement_id: str, step: str) -> dict:
    """Drop everything that ties timing/tokens to ``step`` for this engagement.

    A clean restart needs to remove not just artifacts but the metrics that
    reference them, otherwise the Stats view keeps showing pre-restart values.
    Two stores to touch (per the lifecycle/telemetry design):

      * ``meta/session.yaml`` — ``timing_data[step]`` written by
        ``lifecycle_tools.set_step_status`` on DONE.
      * ``meta/telemetry/llm-calls.jsonl`` — append-only ledger written by
        ``record_llm_call_telemetry``. Filtered + rewritten in place.

    Returns a small summary the caller can include in its response.
    """
    cleared_timing = False
    try:
        session = read_yaml(engagement_id, "meta/session.yaml", default={}) or {}
        timing = dict(session.get("timing_data", {}) or {})
        if step in timing:
            del timing[step]
            session["timing_data"] = timing
            write_yaml(engagement_id, "meta/session.yaml", session)
            cleared_timing = True
    except Exception:
        pass

    removed_telemetry_rows = 0
    try:
        rows = read_jsonl(engagement_id, "meta/telemetry/llm-calls.jsonl")
        kept = [r for r in rows if r.get("step_id") != step]
        removed_telemetry_rows = len(rows) - len(kept)
        if removed_telemetry_rows > 0:
            # Rewrite the whole file. read_jsonl tolerates a missing file, so
            # write_text restores it cleanly if no rows remained.
            content = "\n".join(__import__("json").dumps(r, sort_keys=False) for r in kept)
            if content:
                content += "\n"
            write_text(engagement_id, "meta/telemetry/llm-calls.jsonl", content)
    except Exception:
        pass

    return {"timing_cleared": cleared_timing, "telemetry_rows_removed": removed_telemetry_rows}


_VALID_GROUP_BY_ENGAGEMENT = {"agent", "step", "model", "day"}
_VALID_GROUP_BY_USER = {"agent", "step", "model", "day", "project"}


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


# ----- Project lifecycle -----

async def list_engagements(include_archived: bool = False) -> Any:
    return (await project_tools.list_projects(include_archived=include_archived)).data


async def create_engagement(name: str, owner: str = "anonymous") -> Any:
    return (await project_tools.create_project(name=name, owner=owner)).data


async def archive_engagement(project_id: str) -> Any:
    return (await project_tools.archive_project(project_id)).data


async def update_engagement(project_id: str, name: str | None = None,
                            description: str | None = None) -> Any:
    return (await project_tools.update_project_metadata(
        project_id, name=name, description=description)).data


async def clone_engagement(source_project_id: str, new_name: str | None = None) -> Any:
    return (await project_tools.clone_project(
        source_project_id, new_name=new_name)).data


# ----- Dashboard data -----

async def dashboard_overview(engagement_id: str) -> Any:
    return (await dashboard_tools.compute_overview_stats(engagement_id)).data


async def dashboard_timeline(engagement_id: str) -> Any:
    return (await dashboard_tools.compute_timeline(engagement_id)).data


async def dashboard_stats(engagement_id: str) -> Any:
    return (await dashboard_tools.compute_stats_summary(engagement_id)).data


async def dashboard_active_step(engagement_id: str) -> Any:
    return (await dashboard_tools.compute_active_step(engagement_id)).data


async def list_decisions(engagement_id: str) -> Any:
    return (await decision_tools.read_decisions(engagement_id)).data


async def list_findings(engagement_id: str, status: str | None = None) -> Any:
    return (await decision_tools.read_findings(engagement_id, status=status)).data


async def list_open_items(engagement_id: str, status: str | None = None,
                          severity: str | None = None) -> Any:
    return (await decision_tools.read_open_items(engagement_id, status=status, severity=severity)).data


async def resolve_open_item(engagement_id: str, item_id: str, resolution_note: str | None = None) -> Any:
    return (await decision_tools.update_open_item_status(
        engagement_id, item_id=item_id, new_status="resolved",
        resolution_note=resolution_note)).data


async def get_artifact(engagement_id: str, name: str) -> Any:
    return (await artifact_tools.read_artifact(engagement_id, name)).data


async def list_engagement_artifacts(engagement_id: str, category: str | None = None) -> Any:
    return (await artifact_tools.list_artifacts(engagement_id, category=category)).data


# ----- Lifecycle / step status -----

async def get_engagement_lifecycle(engagement_id: str) -> Any:
    """Return persisted Completion Statuses per step.

    Shape: ``{"steps": {step_id: {status, updated_at, agent, note}}}``.
    Missing steps are treated as NOT_STARTED by the caller.
    """
    return (await lifecycle_tools.get_engagement_status(engagement_id)).data


async def reset_discovery(engagement_id: str) -> Any:
    """Hard-reset the discovery step.

    Removes:
      - discovery/discovery-brief.yaml
      - discovery/discovery-summary.md
      - the discovery entry in meta/engagement-status.yaml
    Marks open-items with source='discovery' as 'superseded' (we don't
    hard-delete in case a prior agent turn referenced an item id).
    """
    removed = []
    for name in ("discovery/discovery-brief.yaml", "discovery/discovery-summary.md"):
        try:
            path = safe_artifact_path(engagement_id, name)
            if path.exists():
                path.unlink()
                removed.append(name)
        except Exception:
            # Don't let one missing/locked file block the rest of the reset.
            pass

    # Clear status entry
    await lifecycle_tools.clear_step_status(engagement_id, "discovery")

    # Drop the metrics tied to this step — timing_data + per-step telemetry rows.
    # Without this, Stats keeps showing pre-restart numbers (see issue d).
    telemetry_cleared = await _clear_step_telemetry(engagement_id, "discovery")

    # Supersede discovery-sourced open-items
    items_res = await decision_tools.read_open_items(engagement_id, source="discovery")
    superseded = 0
    if items_res.ok and items_res.data:
        for item in items_res.data:
            if item.get("status") == "open":
                await decision_tools.update_open_item_status(
                    engagement_id, item_id=item["id"], new_status="superseded",
                    resolution_note="Superseded by Discovery restart",
                )
                superseded += 1

    # Cascade-wipe every downstream phase (design through provisioning) — they
    # all derive from Discovery, so re-running with stale design/review/etc
    # would leave the engagement in a contradictory state.
    cascade = await _reset_downstream(engagement_id, after_step="discovery")
    removed.extend(cascade.get("cascaded_artifacts", []))
    superseded += cascade.get("cascaded_open_items_superseded", 0)

    return {
        "removed_artifacts": removed,
        "open_items_superseded": superseded,
        "findings_cleared": cascade.get("cascaded_findings_cleared", 0),
        "cascaded_steps": cascade.get("cascaded_steps", []),
        **telemetry_cleared,
    }


# Folders SADomainAgent writes into — one per design scope.
_DESIGN_SCOPE_FOLDERS = (
    "topic-design", "broker-select", "protocol-select", "integration",
    "mesh-design", "ha-dr", "sam-design", "event-portal", "migration",
)


async def reset_design(engagement_id: str) -> Any:
    """Hard-reset the design step AND any review state derived from it.

    Removes every artifact under the nine SADomainAgent scope folders
    (topic-design/, broker-select/, ..., migration/), clears the design
    entry in meta/engagement-status.yaml, and ALSO cascades the wipe to
    Review state — because Review's findings, narratives, and step
    status are all derived from the design artifacts. Without this
    cascade, Restart Design would leave the user with stale findings
    pointing at deleted artifacts.

    Cascade includes:
      - findings.yaml: emptied (findings reference deleted artifacts).
      - reviews/*.md: per-reviewer narratives + review-summary.md unlinked.
      - review step status: cleared.
      - review-deferred open-items: superseded.

    Open-items with source='domain' are marked as superseded.

    Decisions in meta/decisions.yaml are intentionally NOT touched —
    they're an immutable audit trail; a fresh design pass should be
    aware of prior decisions and choose whether to confirm or revise.
    """
    removed = []
    # list_artifacts(engagement_id, category=<scope>) returns names like
    # "<scope>/foo.yaml"; iterate each and delete via safe_artifact_path.
    for scope in _DESIGN_SCOPE_FOLDERS:
        try:
            res = await artifact_tools.list_artifacts(engagement_id, category=scope)
            if not res.ok or not res.data:
                continue
            for name in res.data:
                try:
                    path = safe_artifact_path(engagement_id, name)
                    if path.exists():
                        path.unlink()
                        removed.append(name)
                except Exception:
                    pass
        except Exception:
            pass

    # Clear the design step status + telemetry. (Domain-sourced open-items
    # are superseded inside _reset_downstream's cascade below — keeping the
    # logic in one place.)
    await lifecycle_tools.clear_step_status(engagement_id, "design")
    telemetry_cleared = await _clear_step_telemetry(engagement_id, "design")

    # Supersede domain-sourced open-items.
    items_res = await decision_tools.read_open_items(engagement_id, source="domain")
    superseded = 0
    if items_res.ok and items_res.data:
        for item in items_res.data:
            if item.get("status") == "open":
                await decision_tools.update_open_item_status(
                    engagement_id, item_id=item["id"], new_status="superseded",
                    resolution_note="Superseded by Design restart",
                )
                superseded += 1

    # Cascade-wipe every phase downstream of design — review, validation,
    # blueprint, provisioning — since they all derive from the design
    # artifacts we just deleted. Without this, a re-run of Design would
    # leave the engagement with stale findings, validation reports, and
    # blueprint packages pointing at deleted artifacts.
    cascade = await _reset_downstream(engagement_id, after_step="design")
    removed.extend(cascade.get("cascaded_artifacts", []))
    superseded += cascade.get("cascaded_open_items_superseded", 0)

    return {
        "removed_artifacts": removed,
        "open_items_superseded": superseded,
        "findings_cleared": cascade.get("cascaded_findings_cleared", 0),
        "review_step_cleared": True,
        "cascaded_steps": cascade.get("cascaded_steps", []),
        **telemetry_cleared,
    }


async def _reset_review_state(engagement_id: str) -> dict:
    """Clear findings + reviews/*.md artifacts. Returns counts for the response.

    Called by reset_design (cascade) and reset_review (direct). Keeps the
    wipe atomic and consistent across both entry points.
    """
    # Empty findings.yaml in place (preserves user-namespacing).
    findings_cleared = 0
    try:
        existing = read_yaml(engagement_id, "meta/findings.yaml", default={"findings": []})
        findings_cleared = len((existing or {}).get("findings", []) or [])
        write_yaml(engagement_id, "meta/findings.yaml", {"findings": []})
    except Exception:
        pass

    # Unlink reviews/*.md narrative artifacts.
    removed = []
    try:
        res = await artifact_tools.list_artifacts(engagement_id, category="reviews")
        if res.ok and res.data:
            for name in res.data:
                try:
                    path = safe_artifact_path(engagement_id, name)
                    if path.exists():
                        path.unlink()
                        removed.append(name)
                except Exception:
                    pass
    except Exception:
        pass

    return {
        "findings_cleared": findings_cleared,
        "removed_review_artifacts": removed,
    }


async def _unlink_category(engagement_id: str, category: str) -> list:
    """Unlink every artifact under one folder. Returns names removed."""
    removed = []
    try:
        res = await artifact_tools.list_artifacts(engagement_id, category=category)
        if res.ok and res.data:
            for name in res.data:
                try:
                    path = safe_artifact_path(engagement_id, name)
                    if path.exists():
                        path.unlink()
                        removed.append(name)
                except Exception:
                    pass
    except Exception:
        pass
    return removed


async def _reset_downstream(engagement_id: str, *, after_step: str) -> dict:
    """Cascade-wipe every lifecycle phase strictly AFTER ``after_step``.

    Used by reset_discovery (after_step="discovery" → wipe design through
    provisioning) and reset_design (after_step="design" → wipe review
    through provisioning). Keeps lifecycle re-runs from acting on stale
    downstream state.

    Cascade order matches the lifecycle:
      discovery → design → review → validation → blueprint → provisioning

    Each step's wipe removes its artifacts, clears its step status, drops
    its telemetry, and supersedes its source-attributed open-items.
    """
    order = ("discovery", "design", "review", "validation", "blueprint", "provisioning")
    if after_step not in order:
        return {}
    start_idx = order.index(after_step) + 1
    to_wipe = order[start_idx:]

    removed = []
    findings_cleared = 0
    superseded = 0

    if "design" in to_wipe:
        for scope in _DESIGN_SCOPE_FOLDERS:
            removed.extend(await _unlink_category(engagement_id, scope))
        items_res = await decision_tools.read_open_items(engagement_id, source="domain")
        if items_res.ok and items_res.data:
            for item in items_res.data:
                if item.get("status") == "open":
                    await decision_tools.update_open_item_status(
                        engagement_id, item_id=item["id"], new_status="superseded",
                        resolution_note=f"Superseded by {after_step.capitalize()} restart (cascade)",
                    )
                    superseded += 1
        await lifecycle_tools.clear_step_status(engagement_id, "design")
        await _clear_step_telemetry(engagement_id, "design")

    if "review" in to_wipe:
        review_cleared = await _reset_review_state(engagement_id)
        removed.extend(review_cleared["removed_review_artifacts"])
        findings_cleared += review_cleared["findings_cleared"]
        items_res = await decision_tools.read_open_items(engagement_id, source="review-deferred")
        if items_res.ok and items_res.data:
            for item in items_res.data:
                if item.get("status") == "open":
                    await decision_tools.update_open_item_status(
                        engagement_id, item_id=item["id"], new_status="superseded",
                        resolution_note=f"Superseded by {after_step.capitalize()} restart (cascade)",
                    )
                    superseded += 1
        await lifecycle_tools.clear_step_status(engagement_id, "review")
        await _clear_step_telemetry(engagement_id, "review")

    if "validation" in to_wipe:
        removed.extend(await _unlink_category(engagement_id, "validation"))
        items_res = await decision_tools.read_open_items(engagement_id, source="validation")
        if items_res.ok and items_res.data:
            for item in items_res.data:
                if item.get("status") == "open":
                    await decision_tools.update_open_item_status(
                        engagement_id, item_id=item["id"], new_status="superseded",
                        resolution_note=f"Superseded by {after_step.capitalize()} restart (cascade)",
                    )
                    superseded += 1
        await lifecycle_tools.clear_step_status(engagement_id, "validation")
        await _clear_step_telemetry(engagement_id, "validation")

    if "blueprint" in to_wipe:
        removed.extend(await _unlink_category(engagement_id, "blueprint"))
        removed.extend(await _unlink_category(engagement_id, "exports"))
        await lifecycle_tools.clear_step_status(engagement_id, "blueprint")
        await _clear_step_telemetry(engagement_id, "blueprint")

    if "provisioning" in to_wipe:
        removed.extend(await _unlink_category(engagement_id, "provisioning"))
        items_res = await decision_tools.read_open_items(engagement_id, source="provisioning")
        if items_res.ok and items_res.data:
            for item in items_res.data:
                if item.get("status") == "open":
                    await decision_tools.update_open_item_status(
                        engagement_id, item_id=item["id"], new_status="superseded",
                        resolution_note=f"Superseded by {after_step.capitalize()} restart (cascade)",
                    )
                    superseded += 1
        await lifecycle_tools.clear_step_status(engagement_id, "provisioning")
        await _clear_step_telemetry(engagement_id, "provisioning")

    return {
        "cascaded_steps": list(to_wipe),
        "cascaded_artifacts": removed,
        "cascaded_findings_cleared": findings_cleared,
        "cascaded_open_items_superseded": superseded,
    }


# ----- Intake -----

async def intake_preview(**partial_intake) -> Any:
    """Body is the form-state dict; the adapter spreads keys → we re-pack here.

    Accepts both flat (V2) and nested (V1) shapes; normalizes before evaluating.
    """
    flat = _normalize_intake_shape(partial_intake)
    return (await intake_tools.compute_intake_preview(flat)).data


async def intake_download_yaml(**intake_dict) -> Any:
    import yaml
    return {"yaml": yaml.safe_dump(intake_dict, default_flow_style=False, sort_keys=False)}


async def intake_download_markdown(**intake_dict) -> Any:
    return {"markdown": (await intake_tools.render_intake_markdown(intake_dict)).data}


async def intake_autocomplete(query: str) -> Any:
    return (await intake_tools.integration_hub_autocomplete(query)).data


async def intake_parse_yaml(yaml_text: str) -> Any:
    """Parse uploaded YAML text and return the structured intake (for form hydration)."""
    import tempfile, os
    fd, path = tempfile.mkstemp(suffix=".yaml")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(yaml_text)
        r = await intake_tools.parse_intake_document(path)
        return r.data if r.ok else {"error": r.error}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


async def intake_submit(**intake) -> Any:
    """Create a project + persist the intake; agent dispatch happens via the SAM runtime.

    Persists TWO artifacts:
      - ``discovery/intake.json``  — lossless raw form payload (re-hydratable into the form)
      - ``discovery/discovery-brief.yaml`` — human-readable, agent-consumable view

    Returns: ``{engagement_id, project, open_items}``.

    Accepts both V2 flat shape (project_name, project_type, systems, requirements, …)
    and V1-style nested shape (project: {name, type}, landscape: {systems, vertical}, …).
    """
    import json, yaml

    flat = _normalize_intake_shape(intake)

    name = flat.get("project_name") or "untitled"
    p = await project_tools.create_project(name=name)
    eid = p.data["id"]

    # 1) Raw form payload — lossless, round-trippable. Use the ORIGINAL (un-normalized)
    # intake so the form can re-hydrate from it byte-perfect.
    await artifact_tools.write_artifact(
        eid, "discovery/intake.json",
        json.dumps(intake, indent=2, sort_keys=False),
    )

    # 2) Discovery brief — the normalized view that downstream agents read.
    brief_yaml = yaml.safe_dump(flat, default_flow_style=False, sort_keys=False)
    await artifact_tools.write_artifact(eid, "discovery/discovery-brief.yaml", brief_yaml)

    # Emit open-items for missing required fields (post-normalization).
    open_items = []
    for required in ("project_name", "project_type", "systems", "requirements"):
        if not flat.get(required):
            open_items.append({"severity": "blocking", "source": "intake",
                               "description": f"Required field missing: {required}"})
            await decision_tools.record_open_item(
                eid, severity="blocking", source="intake",
                description=f"Required intake field missing or unspecified: {required}",
                source_agent="WebUI-intake",
            )

    return {"engagement_id": eid, "project": p.data, "open_items": open_items}


def _normalize_intake_shape(intake: dict) -> dict:
    """Accept V1 nested {project, landscape, requirements, goals} OR V2 flat shape.

    Returns a flat dict that downstream tools (compute_intake_preview,
    get_engagement_plan, etc.) can consume directly.
    """
    if not isinstance(intake, dict):
        return {}

    # If already flat (V2 shape), nothing to do.
    if "project_name" in intake or "systems" in intake:
        return intake

    # V1 nested shape — flatten.
    flat: dict = {}
    project = intake.get("project") or {}
    flat["project_name"] = project.get("name")
    flat["project_type"] = project.get("type")

    landscape = intake.get("landscape") or {}
    flat["vertical"] = landscape.get("vertical")
    flat["systems"] = landscape.get("systems") or []
    flat["existing_messaging"] = landscape.get("existing_messaging")
    flat["protocols"] = landscape.get("protocols") or []
    flat["events"] = landscape.get("events") or []
    flat["aggregate_volumes"] = landscape.get("aggregate_volumes")
    flat["schemas"] = landscape.get("schemas")

    flat["requirements"] = intake.get("requirements") or {}
    flat["scale"] = intake.get("scale") or {}
    flat["goals"] = intake.get("goals") or {}
    flat["preferences"] = intake.get("preferences") or {}

    # Strip None values so downstream tools don't trip on them.
    return {k: v for k, v in flat.items() if v not in (None, "", [], {})}


async def intake_load(engagement_id: str) -> Any:
    """Re-hydrate a saved intake. Returns the raw JSON if present, else {}."""
    import json
    res = await artifact_tools.read_artifact(engagement_id, "discovery/intake.json")
    if not res.ok:
        return {"intake": None, "error": "no saved intake for this engagement"}
    try:
        return {"intake": json.loads(res.data)}
    except (json.JSONDecodeError, ValueError) as e:
        return {"intake": None, "error": f"intake.json malformed: {e}"}


# ----- Exports -----

async def exports_availability(engagement_id: str) -> Any:
    r = await blueprint_tools.check_diagram_availability(engagement_id)
    if not r.ok:
        return {"error": r.error or "diagram availability check failed"}
    return r.data


async def exports_render(engagement_id: str, audience: str, format: str = "html",
                          force: bool = False) -> Any:
    # ``force`` bypasses render_audience_pack's freshness cache — surfaced
    # in the UI as a per-card "Regenerate" checkbox.
    r = await blueprint_tools.render_audience_pack(
        engagement_id, audience, format, force=bool(force),
    )
    if not r.ok:
        # Surface the underlying error to the frontend instead of returning
        # null .data — the WebUI's __renderPack click handler crashes when
        # it gets null. Common errors: "no renderer registered" (plugin
        # didn't load) and "WeasyPrint not installed" (PDF format request
        # without the PDF dep).
        return {"error": r.error or "render failed", "paths": [], "urls": []}
    # Augment the renderer's response with browser-fetchable URLs. The
    # renderer returns absolute filesystem paths (under safe_artifact_path);
    # the WebUI's /exports/raw/<filename> route serves those files with the
    # correct Content-Type. Without this, window.open(filesystem-path) hits
    # 404 because the browser can't fetch arbitrary disk paths.
    data = dict(r.data or {})
    urls: list[str] = []
    for p in data.get("paths", []) or []:
        # Each path ends with "exports/<filename>" — take the filename.
        filename = p.rsplit("/exports/", 1)[-1] if "/exports/" in p else p.rsplit("/", 1)[-1]
        urls.append(f"/api/engagements/{engagement_id}/exports/raw/{filename}")
    data["urls"] = urls
    return data


async def exports_zip(engagement_id: str) -> Any:
    r = await blueprint_tools.assemble_zip(engagement_id)
    if not r.ok:
        return {"error": r.error or "zip assembly failed", "zip_url": None}
    data = dict(r.data or {})
    # Same path-to-URL translation as exports_render.
    zip_path = data.get("zip_path") or ""
    if zip_path:
        filename = zip_path.rsplit("/exports/", 1)[-1] if "/exports/" in zip_path else zip_path.rsplit("/", 1)[-1]
        data["zip_url"] = f"/api/engagements/{engagement_id}/exports/raw/{filename}"
    return data


# ----- Feedback -----

async def engagement_token_usage(engagement_id: str, group_by: str = "agent",
                                  since: str | None = None, until: str | None = None) -> Any:
    """Per-engagement token telemetry, grouped + filtered."""
    if group_by not in _VALID_GROUP_BY_ENGAGEMENT:
        return {"error": f"invalid group_by; expected one of {sorted(_VALID_GROUP_BY_ENGAGEMENT)}"}
    r = await telemetry_tools.read_token_usage(
        engagement_id,
        group_by=group_by,  # type: ignore[arg-type]
        since=_parse_iso(since),
        until=_parse_iso(until),
    )
    return r.data if r.ok else {"error": r.error}


async def user_token_usage(group_by: str = "project",
                            since: str | None = None, until: str | None = None) -> Any:
    """Cross-engagement token telemetry for the current user."""
    if group_by not in _VALID_GROUP_BY_USER:
        return {"error": f"invalid group_by; expected one of {sorted(_VALID_GROUP_BY_USER)}"}
    r = await telemetry_tools.read_user_token_usage(
        group_by=group_by,  # type: ignore[arg-type]
        since=_parse_iso(since),
        until=_parse_iso(until),
    )
    return r.data if r.ok else {"error": r.error}


async def submit_feedback(engagement_id: str, scope: str, rating: int,
                          category: str, note: str) -> Any:
    return (await decision_tools.record_feedback(
        engagement_id, scope=scope, rating=rating, category=category, note=note)).data


# Route table — consumed by lifecycle.py to register with the SAM HTTP runtime.
API_ROUTES = [
    # Project lifecycle
    ("GET",  "/api/projects",                                list_engagements),
    ("POST", "/api/projects",                                create_engagement),
    ("POST", "/api/projects/{project_id}/archive",            archive_engagement),
    ("PATCH","/api/projects/{project_id}",                    update_engagement),
    ("POST", "/api/projects/{source_project_id}/clone",       clone_engagement),
    # Dashboard data
    ("GET",  "/api/engagements/{engagement_id}/overview",     dashboard_overview),
    ("GET",  "/api/engagements/{engagement_id}/timeline",     dashboard_timeline),
    ("GET",  "/api/engagements/{engagement_id}/stats",        dashboard_stats),
    ("GET",  "/api/engagements/{engagement_id}/active-step",  dashboard_active_step),
    ("GET",  "/api/engagements/{engagement_id}/decisions",    list_decisions),
    ("GET",  "/api/engagements/{engagement_id}/findings",     list_findings),
    ("GET",  "/api/engagements/{engagement_id}/open-items",   list_open_items),
    ("POST", "/api/engagements/{engagement_id}/open-items/{item_id}/resolve", resolve_open_item),
    ("GET",  "/api/engagements/{engagement_id}/artifacts",    list_engagement_artifacts),
    ("GET",  "/api/engagements/{engagement_id}/artifacts/{name}", get_artifact),
    ("GET",  "/api/engagements/{engagement_id}/lifecycle",    get_engagement_lifecycle),
    ("DELETE","/api/engagements/{engagement_id}/discovery",   reset_discovery),
    ("DELETE","/api/engagements/{engagement_id}/design",      reset_design),
    # Intake
    ("POST", "/api/intake/preview",                           intake_preview),
    ("GET",  "/api/intake/download-yaml",                     intake_download_yaml),
    ("GET",  "/api/intake/download-markdown",                 intake_download_markdown),
    ("GET",  "/api/intake/autocomplete",                      intake_autocomplete),
    ("POST", "/api/intake/parse-yaml",                        intake_parse_yaml),
    ("POST", "/api/intake/submit",                            intake_submit),
    ("GET",  "/api/intake/load/{engagement_id}",              intake_load),
    # Exports
    ("GET",  "/api/engagements/{engagement_id}/exports/availability", exports_availability),
    ("POST", "/api/engagements/{engagement_id}/exports/render", exports_render),
    ("GET",  "/api/engagements/{engagement_id}/exports/zip",  exports_zip),
    # Feedback
    ("POST", "/api/engagements/{engagement_id}/feedback",     submit_feedback),
    # Token telemetry (Decision 84)
    ("GET",  "/api/engagements/{engagement_id}/token-usage",  engagement_token_usage),
    ("GET",  "/api/me/token-usage",                           user_token_usage),
]

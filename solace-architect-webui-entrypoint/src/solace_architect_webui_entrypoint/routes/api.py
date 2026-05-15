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
    telemetry_tools,
)


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
    return (await blueprint_tools.check_diagram_availability(engagement_id)).data


async def exports_render(engagement_id: str, audience: str, format: str = "html") -> Any:
    return (await blueprint_tools.render_audience_pack(engagement_id, audience, format)).data


async def exports_zip(engagement_id: str) -> Any:
    return (await blueprint_tools.assemble_zip(engagement_id)).data


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

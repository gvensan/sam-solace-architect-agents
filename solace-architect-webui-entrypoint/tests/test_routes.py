"""Route registration contract.

The plugin must expose the documented HTTP surface (v2spec §6.1 + §6.2).
These tests don't require a running SAM — they exercise the route table
and the underlying handlers against the file-backed storage.
"""

import pytest

from solace_architect_webui_entrypoint.routes.api import API_ROUTES


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("SA_STORAGE_ROOT", str(tmp_path / "artifacts"))


def test_api_routes_table_is_a_nonempty_list():
    assert isinstance(API_ROUTES, list)
    assert len(API_ROUTES) >= 20, f"expected ≥20 routes, got {len(API_ROUTES)}"


def test_every_route_is_well_formed():
    """Each route is (method, path, async-callable)."""
    for method, path, handler in API_ROUTES:
        assert method in ("GET", "POST", "PUT", "DELETE", "PATCH")
        assert path.startswith("/api/") or path.startswith("/reports/")
        assert callable(handler)


def test_required_dashboard_endpoints_present():
    paths = {p for _, p, _ in API_ROUTES}
    required = [
        "/api/projects",
        "/api/engagements/{engagement_id}/overview",
        "/api/engagements/{engagement_id}/timeline",
        "/api/engagements/{engagement_id}/decisions",
        "/api/engagements/{engagement_id}/open-items",
        "/api/engagements/{engagement_id}/artifacts",
        "/api/engagements/{engagement_id}/active-step",
        "/api/intake/preview",
        "/api/intake/submit",
    ]
    for r in required:
        assert r in paths, f"missing required route: {r}"


def test_method_for_known_routes():
    by_path = {(p, m) for m, p, _ in API_ROUTES}
    assert ("/api/projects", "POST") in by_path                              # create
    assert ("/api/projects", "GET") in by_path                               # list
    assert ("/api/intake/submit", "POST") in by_path
    assert ("/api/engagements/{engagement_id}/overview", "GET") in by_path


@pytest.mark.asyncio
async def test_list_projects_returns_list_even_when_empty():
    from solace_architect_webui_entrypoint.routes.api import list_engagements
    r = await list_engagements()
    assert isinstance(r, list)


@pytest.mark.asyncio
async def test_create_engagement_then_list_returns_it():
    from solace_architect_webui_entrypoint.routes.api import create_engagement, list_engagements
    p = await create_engagement(name="Pilot Test")
    assert p["id"]
    listed = await list_engagements()
    assert any(x["id"] == p["id"] for x in listed)


@pytest.mark.asyncio
async def test_intake_preview_returns_routing_decision():
    from solace_architect_webui_entrypoint.routes.api import intake_preview
    brief = {"systems": [{"name": "API"}],
             "requirements": {"topology": "single-site", "delivery_mode": "guaranteed",
                              "processing_guarantee": "at-least-once"},
             "existing_messaging": "",
             "preferences": {"provision_event_portal": False}}
    r = await intake_preview(partial_intake=brief)
    assert "included_steps" in r
    assert "skipped_steps" in r
    # provisioning is opt-out → skipped
    assert any(s["step"] == "provisioning" for s in r["skipped_steps"])


@pytest.mark.asyncio
async def test_intake_submit_creates_project_and_writes_brief():
    """intake_submit takes **kwargs (the adapter spreads body keys), so we mirror that here."""
    from solace_architect_webui_entrypoint.routes.api import intake_submit
    r = await intake_submit(
        project_name="Pilot E2E",
        project_type="new-build",
        systems=[{"name": "API"}],
        requirements={"topology": "single-site", "delivery_mode": "guaranteed"},
        preferences={"provision_event_portal": False},
    )
    assert r["engagement_id"]
    # Verify brief is on disk
    from solace_architect_core._storage import read_text
    brief = read_text(r["engagement_id"], "discovery/discovery-brief.yaml")
    assert "Pilot E2E" in brief
    # And the lossless JSON snapshot
    intake_json = read_text(r["engagement_id"], "discovery/intake.json")
    assert "Pilot E2E" in intake_json

"""Static asset bundle contract.

The plugin ships a dashboard SPA + intake form. These tests assert the
expected files are physically present in the wheel-shipped layout.
"""

from pathlib import Path


PKG_ROOT = Path(__file__).parent.parent / "src" / "solace_architect_webui_entrypoint"


def test_webui_directory_exists():
    assert (PKG_ROOT / "webui").is_dir()


def test_required_static_files_present():
    webui = PKG_ROOT / "webui"
    required = [
        webui / "index.html",
        webui / "intake" / "index.html",
        webui / "assets" / "styles.css",
        webui / "assets" / "app.js",
    ]
    for p in required:
        assert p.exists(), f"missing static asset: {p.relative_to(PKG_ROOT)}"


def test_dashboard_index_has_seven_nav_links():
    """Overview, Timeline, Decisions, Open Items, Artifacts, Stats, Export, Intake, Chat."""
    html = (PKG_ROOT / "webui" / "index.html").read_text()
    # Sidebar nav has 9 entries per v2spec §6.1 (6 dashboard views + Export + Intake + Chat).
    assert html.count('data-view="') >= 7


def test_intake_form_has_save_load_yaml_buttons():
    html = (PKG_ROOT / "webui" / "intake" / "index.html").read_text()
    assert 'id="save-yaml"' in html
    assert 'id="save-md"' in html
    assert 'id="load-yaml"' in html
    assert 'id="submit"' in html


def test_intake_form_calls_correct_apis():
    """Verify the JavaScript is wired to the real API routes."""
    html = (PKG_ROOT / "webui" / "intake" / "index.html").read_text()
    assert "/api/intake/preview" in html
    assert "/api/intake/download-yaml" in html
    assert "/api/intake/download-markdown" in html
    assert "/api/intake/parse-yaml" in html
    assert "/api/intake/submit" in html


def test_dashboard_styles_have_dark_mode_palette():
    css = (PKG_ROOT / "webui" / "assets" / "styles.css").read_text()
    assert '[data-theme="dark"]' in css
    assert "--primary:" in css and "--accent:" in css

"""Audience-pack rendering pipeline.

Phase 2: minimal HTML rendering — header + table of artifacts + their contents
inline. Phase 3 replaces this with the full ported V1 templates (sidebar TOC,
cross-reference index, Mermaid SVG embedding, ROI calculator JS for Executive).

Phase 1+ note: PDF rendering uses WeasyPrint; ROI calculator renders at default
slider values in PDF since WeasyPrint doesn't execute JS.
"""

from __future__ import annotations

import html
from importlib import resources
from pathlib import Path
from typing import Any

import yaml

from solace_architect_core._storage import read_text, safe_artifact_path
from solace_architect_core.tools.artifact_tools import ToolResult


def _load_branding(overrides: dict | None = None) -> dict:
    text = (resources.files("solace_architect_core.configs") / "branding.yaml").read_text()
    branding = yaml.safe_load(text)
    if overrides:
        # Shallow merge
        for k, v in overrides.items():
            if isinstance(branding.get(k), dict) and isinstance(v, dict):
                branding[k].update(v)
            else:
                branding[k] = v
    return branding


def _render_artifact_section(name: str, content: str) -> str:
    """Render a single artifact as a collapsible section."""
    safe_name = html.escape(name)
    anchor = "art-" + name.replace("/", "-").replace(".", "-")
    if name.endswith(".mermaid"):
        body = f'<pre class="mermaid">{html.escape(content)}</pre>'
    elif name.endswith((".yaml", ".yml")):
        body = f'<pre class="yaml"><code>{html.escape(content)}</code></pre>'
    elif name.endswith(".md"):
        # Phase 2: render as preformatted; Phase 3 adds proper markdown → HTML.
        body = f'<pre class="markdown">{html.escape(content)}</pre>'
    else:
        body = f'<pre>{html.escape(content)}</pre>'
    return f'''<section id="{anchor}" class="art-section">
  <h3>{safe_name}
    <button class="copy-btn" data-target="{anchor}-raw" title="Copy raw source">Copy</button>
  </h3>
  {body}
  <textarea id="{anchor}-raw" style="display:none">{html.escape(content)}</textarea>
</section>'''


def _stylesheet(branding: dict) -> str:
    c = branding["colors"]
    f = branding["fonts"]
    return f'''
<link href="{f['google_fonts_url']}" rel="stylesheet">
<style>
  *{{box-sizing:border-box}}
  body{{font-family:{f['body_family']};font-size:15px;line-height:1.65;color:{c['text']};background:{c['background']};margin:0}}
  a{{color:{c['primary']};text-decoration:none}}
  a:hover{{color:{c['accent']}}}
  .page-header{{background:linear-gradient(135deg,{c['primary']},#03213B);color:#fff;padding:32px 40px 24px}}
  .page-header .eyebrow{{font-family:{f['mono_family']};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:{c['accent']}}}
  .page-header h1{{font-size:32px;font-weight:700;color:#fff;margin:6px 0 8px}}
  .page-header .subtitle{{color:#8BA4B8;font-size:14px;max-width:720px}}
  .layout{{display:flex;min-height:calc(100vh - 140px)}}
  .sidebar{{width:240px;flex-shrink:0;border-right:1px solid {c['border']};padding:24px 0;position:sticky;top:0;align-self:flex-start;height:100vh;overflow-y:auto;background:{c['surface']}}}
  .sidebar .toc-title{{font-family:{f['mono_family']};font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:{c['muted']};font-weight:700;padding:0 20px;margin-bottom:12px}}
  .sidebar a{{display:block;padding:6px 20px;font-size:13px;color:{c['muted']};border-left:2px solid transparent}}
  .sidebar a:hover{{color:{c['primary']};background:#f0fdf9;border-left-color:{c['accent']}}}
  .content{{flex:1;padding:32px 40px}}
  h2{{color:{c['primary']};margin-top:32px;border-bottom:2px solid {c['border']};padding-bottom:8px}}
  h3{{color:{c['primary']};margin-top:24px;display:flex;align-items:center;gap:10px}}
  pre{{background:{c['surface']};padding:16px;border-radius:8px;overflow-x:auto;font-family:{f['mono_family']};font-size:13px;border:1px solid {c['border']}}}
  .copy-btn{{font-size:11px;font-family:{f['body_family']};padding:4px 10px;background:transparent;border:1px solid {c['border']};border-radius:4px;cursor:pointer;color:{c['muted']}}}
  .copy-btn:hover{{color:{c['primary']};border-color:{c['primary']}}}
  footer{{padding:24px 40px;color:{c['muted']};font-size:12px;border-top:1px solid {c['border']}}}
</style>
<script>
  document.addEventListener("click", function(e) {{
    if (!e.target.classList.contains("copy-btn")) return;
    var target = document.getElementById(e.target.dataset.target);
    if (!target) return;
    navigator.clipboard.writeText(target.value).then(() => {{
      e.target.textContent = "Copied";
      setTimeout(() => {{ e.target.textContent = "Copy"; }}, 1500);
    }});
  }});
</script>
'''


_PACK_LABELS = {
    "blueprint": ("Solace Blueprint", "Comprehensive engineering deliverable — full architecture, all artifacts."),
    "executive": ("Executive Team", "Business case, ROI, and recommendation in plain language."),
    "admin-ops": ("Admin & Ops", "Provisioning, monitoring, runbooks — full operational depth."),
    "security": ("Security", "Auth, ACLs, encryption, audit, PII — full security posture."),
    "developers": ("Developers", "Topics, schemas, protocols, client patterns — build correct clients."),
}


def render_audience_pack_html(*, engagement_id: str, audience: str, artifacts: list[str],
                              branding: dict, project_name: str | None = None) -> str:
    """Render the audience pack as a self-contained HTML string."""
    label, subtitle = _PACK_LABELS.get(audience, (audience.title(), ""))
    title = f"{project_name or engagement_id} — {label}"

    toc_items = []
    sections = []
    for name in artifacts:
        try:
            content = read_text(engagement_id, name)
        except (FileNotFoundError, ValueError):
            continue
        anchor = "art-" + name.replace("/", "-").replace(".", "-")
        toc_items.append(f'<a href="#{anchor}">{html.escape(name)}</a>')
        sections.append(_render_artifact_section(name, content))

    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{html.escape(title)}</title>
  {_stylesheet(branding)}
</head>
<body>
  <div class="page-header">
    <div class="eyebrow">{html.escape(label.upper())}</div>
    <h1>{html.escape(title)}</h1>
    <div class="subtitle">{html.escape(subtitle)}</div>
  </div>
  <div class="layout">
    <nav class="sidebar">
      <div class="toc-title">On this page</div>
      {''.join(toc_items)}
    </nav>
    <main class="content">
      {''.join(sections)}
    </main>
  </div>
  <footer>{html.escape(branding["brand"]["product_name"])} {html.escape(branding["brand"]["version_label"])} · engagement: {html.escape(engagement_id)}</footer>
</body>
</html>'''


def render_audience_pack_pdf(html_content: str, output_path: Path) -> Path:
    """Render HTML to PDF via WeasyPrint."""
    try:
        from weasyprint import HTML
    except ImportError:
        raise RuntimeError(
            "weasyprint not installed — `pip install weasyprint` (plus its system deps) "
            "to enable PDF rendering"
        )
    HTML(string=html_content).write_pdf(str(output_path))
    return output_path


def _extract_project_name(engagement_id: str) -> str | None:
    try:
        brief_text = read_text(engagement_id, "discovery/discovery-brief.yaml")
        brief = yaml.safe_load(brief_text) or {}
        return brief.get("project_name")
    except (FileNotFoundError, ValueError, yaml.YAMLError):
        return None


async def render(*, engagement_id: str, audience: str, format: str, artifacts: list[str],
                 branding_overrides: dict | None = None) -> ToolResult:
    """Async entry point — registered with blueprint_tools at plugin load."""
    branding = _load_branding(branding_overrides)
    project_name = _extract_project_name(engagement_id)
    html_content = render_audience_pack_html(
        engagement_id=engagement_id, audience=audience, artifacts=artifacts,
        branding=branding, project_name=project_name,
    )

    written: list[str] = []
    html_path = safe_artifact_path(engagement_id, f"exports/{audience}.html")
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(html_content, encoding="utf-8")
    written.append(str(html_path))

    if format in ("pdf", "both"):
        try:
            pdf_path = safe_artifact_path(engagement_id, f"exports/{audience}.pdf")
            render_audience_pack_pdf(html_content, pdf_path)
            written.append(str(pdf_path))
        except RuntimeError as e:
            return ToolResult(ok=False, error=str(e), data={"html_only": written})

    return ToolResult(ok=True, data={"paths": written, "audience": audience, "format": format})

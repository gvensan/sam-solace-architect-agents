"""V2 audience-pack renderer — full port of V1's HTML report generator.

Layout, sections, and visual language match V1 exactly. The Python file
assembles the HTML server-side; the resulting file is self-contained
(CSS inline from templates/report.css; JS inline from templates/report.js;
mermaid/marked loaded from CDN at view time for HTML, pre-rendered to SVG
via mmdc for PDF).

Per-pack differentiation (artifact/section/decision/finding filters)
matches solace_architect_core/configs/report-packs.yaml.

Phase 3a sections shipped here:
  - Page header with stats strip
  - Sticky top toolbar (theme/print/download)
  - Sidebar TOC (nested by phase group)
  - Scope & Inputs cards (parsed from discovery-brief.yaml)
  - Auto-narrative summary
  - Decisions / Findings / Open Items tables
  - Connected Systems table
  - Per-artifact sections with header (title/path/desc/copy) + body
    rendered as proper HTML (markdown→HTML; mermaid→SVG-or-raw; yaml→code)

Phase 3b sections (ROI Framework with interactive sliders + sensitivity
combined card) ship from the same render path; the executive pack is the
only one that includes them.
"""

from __future__ import annotations

import html as _html
import json as _json
import os
import re
import shutil
import subprocess
import tempfile
from importlib import resources
from pathlib import Path
from typing import Any, Optional

import yaml

try:
    import markdown as _markdown
except ImportError:  # pragma: no cover — declared in pyproject deps
    _markdown = None  # type: ignore[assignment]

from solace_architect_core._storage import read_text, read_yaml, safe_artifact_path
from solace_architect_core.tools.artifact_tools import ToolResult


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


# Phase grouping — maps the first path segment of an artifact filename
# (after any leading zero-prefix like "12-blueprint/") to a human-readable
# group label. Mirrors V1's GROUP_LABELS but with V2's scope names.
_GROUP_LABELS = {
    "discovery": "Discovery",
    "topic-design": "Topic Design",
    "broker-select": "Broker Selection",
    "sam-design": "SAM Design",
    "protocol-select": "Protocol Selection",
    "mesh-design": "Mesh Design",
    "ha-dr": "High Availability / Disaster Recovery",
    "integration": "Integration",
    "migration": "Migration",
    "event-portal": "Event Portal",
    "reviews": "Reviews",
    "validation": "Validation",
    "blueprint": "Technical Blueprint",
    "executive": "Business Case",
    "diagrams": "Diagrams",
    "provisioning": "Provisioning",
    "exports": "Exports",
}


# Lifecycle-step order — used to sort phase groups in the sidebar TOC.
_PHASE_ORDER = [
    "discovery", "topic-design", "broker-select", "protocol-select",
    "sam-design", "mesh-design", "ha-dr", "integration", "migration",
    "event-portal", "reviews", "validation", "blueprint", "executive",
    "provisioning", "diagrams", "exports",
]


# Map source_agent to a short label for the decisions/findings tables.
_AGENT_LABELS = {
    "SADiscoveryAgent": "discovery",
    "SADomainAgent": "design",
    "SAOrchestratorAgent": "orchestrator",
    "SAArchitectReviewerAgent": "architect-review",
    "SADeveloperReviewerAgent": "developer-review",
    "SAOpsReviewerAgent": "ops-review",
    "SASecurityReviewerAgent": "security-review",
    "SAValidationAgent": "validation",
    "SABlueprintAgent": "blueprint",
    "SAProvisioningAgent": "provisioning",
}


# Map source_agent to reviewer short-name for finding_skills filter.
_REVIEWER_SHORT = {
    "SAArchitectReviewerAgent": "architect",
    "SADeveloperReviewerAgent": "developer",
    "SAOpsReviewerAgent": "ops",
    "SASecurityReviewerAgent": "security",
}


# Pack labels (overridden by report-packs.yaml when present).
_PACK_LABELS = {
    "blueprint": ("Solace Blueprint", "Comprehensive engineering deliverable — full architecture, all artifacts."),
    "executive": ("Executive Team", "Business case, ROI, and recommendation in plain language."),
    "admin-ops": ("Admin & Ops", "Provisioning, monitoring, runbooks — full operational depth."),
    "security": ("Security", "Auth, ACLs, encryption, audit, PII — full security posture."),
    "developers": ("Developers", "Topics, schemas, protocols, client patterns — build correct clients."),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def esc(s: Any) -> str:
    """HTML-escape, treating None and non-strings as ''."""
    if s is None:
        return ""
    return _html.escape(str(s), quote=True)


def _anchor_for_artifact(name: str) -> str:
    """Stable anchor id for an artifact section. Mirrors V1's artId."""
    s = name.lower().replace("/", "-")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return "art-" + s


def _group_for_artifact(name: str) -> str:
    """First path segment → group key. Strips any leading numeric prefix."""
    first = name.split("/", 1)[0]
    return re.sub(r"^\d+-", "", first) or "diagrams"


def _group_label(key: str) -> str:
    return _GROUP_LABELS.get(key, key.replace("-", " ").title())


def _load_templates() -> tuple[str, str]:
    """Load the bundled CSS and JS as strings."""
    pkg = resources.files("solace_architect_blueprint") / "report_generator" / "templates"
    css = (pkg / "report.css").read_text(encoding="utf-8")
    js = (pkg / "report.js").read_text(encoding="utf-8")
    # Strip the outer <script>...</script> from report.js — we re-wrap below.
    js = re.sub(r"^\s*<script>\s*", "", js)
    js = re.sub(r"\s*<\\?/script>\s*$", "", js)
    return css, js


def _load_branding(overrides: dict | None = None) -> dict:
    text = (resources.files("solace_architect_core.configs") / "branding.yaml").read_text()
    branding = yaml.safe_load(text)
    if overrides:
        for k, v in overrides.items():
            if isinstance(branding.get(k), dict) and isinstance(v, dict):
                branding[k].update(v)
            else:
                branding[k] = v
    return branding


def _load_packs() -> dict:
    text = (resources.files("solace_architect_core.configs") / "report-packs.yaml").read_text()
    return yaml.safe_load(text) or {"packs": []}


def _pack_by_id(audience: str) -> dict:
    packs = _load_packs().get("packs", []) or []
    for p in packs:
        if p.get("id") == audience:
            return p
    # Fallback — empty filters = include everything (blueprint behaviour).
    return {"id": audience, "label": _PACK_LABELS.get(audience, (audience.title(), ""))[0]}


def _fmt_time(seconds: int | float | None) -> str:
    if not seconds:
        return "0s"
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m {s % 60}s"
    return f"{s // 3600}h {(s % 3600) // 60}m"


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------


def _load_decisions(engagement_id: str) -> list[dict]:
    try:
        d = read_yaml(engagement_id, "meta/decisions.yaml", default={"decisions": []})
        return list(d.get("decisions") or [])
    except Exception:
        return []


def _load_findings(engagement_id: str) -> list[dict]:
    try:
        d = read_yaml(engagement_id, "meta/findings.yaml", default={"findings": []})
        return list(d.get("findings") or [])
    except Exception:
        return []


def _load_open_items(engagement_id: str) -> list[dict]:
    try:
        d = read_yaml(engagement_id, "meta/open-items.yaml", default={"open_items": []})
        return list(d.get("open_items") or [])
    except Exception:
        return []


def _load_brief(engagement_id: str) -> dict:
    try:
        return read_yaml(engagement_id, "discovery/discovery-brief.yaml", default={}) or {}
    except Exception:
        return {}


def _load_status(engagement_id: str) -> dict:
    try:
        return read_yaml(engagement_id, "meta/engagement-status.yaml", default={"steps": {}}) or {}
    except Exception:
        return {}


def _extract_project_name(brief: dict, engagement_id: str) -> str:
    """Project display name — from brief if present, else engagement_id."""
    pn = brief.get("project_name")
    if pn:
        return str(pn)
    project = brief.get("project")
    if isinstance(project, dict):
        n = project.get("name") or project.get("display_name")
        if n:
            return str(n)
    return engagement_id


# ---------------------------------------------------------------------------
# Pack filtering
# ---------------------------------------------------------------------------


def _filter_decisions(decisions: list[dict], pack: dict) -> list[dict]:
    skills = pack.get("decision_skills")
    if skills is None:  # omitted → show all
        return decisions
    if not skills:  # empty list → hide
        return []
    return [d for d in decisions if _agent_to_skill(d.get("source_agent", "")) in set(skills)
            or d.get("source_agent", "") in set(skills)]


def _filter_findings(findings: list[dict], pack: dict) -> list[dict]:
    skills = pack.get("finding_skills")
    if skills is None:
        return findings
    if not skills:
        return []
    targets = set(skills)
    return [f for f in findings
            if _REVIEWER_SHORT.get(f.get("source_agent", ""), "") in targets
            or f.get("source_agent", "") in targets]


def _pack_includes_section(pack: dict, section: str) -> bool:
    tops = pack.get("top_sections")
    if tops is None:
        return True
    # Map V1's section names to ours for back-compat.
    aliases = {
        "summary": ("summary", "executive summary"),
        "scope": ("scope", "scope & inputs"),
        "decisions": ("decisions",),
        "findings": ("findings", "review findings"),
        "open-items": ("open-items", "open items"),
        "connected-systems": ("connected-systems", "connected systems"),
        "artifacts": ("artifacts",),
        "roi": ("roi", "roi framework"),
    }
    candidates = aliases.get(section, (section,))
    normalised_tops = [t.strip().lower() for t in tops]
    return any(c.lower() in normalised_tops for c in candidates)


def _agent_to_skill(agent: str) -> str:
    return _AGENT_LABELS.get(agent, agent)


# ---------------------------------------------------------------------------
# Discovery brief parsing
# ---------------------------------------------------------------------------


def _systems_from_brief(brief: dict) -> list[dict]:
    """Flatten the brief's systems list to [{name, role, description}]."""
    out: list[dict] = []
    systems = brief.get("systems") or brief.get("landscape", {}).get("systems") or []
    if not isinstance(systems, list):
        return out
    for s in systems:
        if not isinstance(s, dict):
            continue
        out.append({
            "name": s.get("name") or s.get("system") or "",
            "role": s.get("role") or "",
            "description": s.get("description") or s.get("desc") or "",
        })
    return [x for x in out if x["name"]]


def _inputs_from_brief(brief: dict) -> dict:
    """Pull headline inputs (messaging, protocols, event types, requirements, goals)."""
    out: dict[str, Any] = {
        "messaging": "", "protocols": "", "ref_arch": "",
        "event_types": [], "requirements": {}, "goals": {},
    }
    landscape = brief.get("landscape") or {}
    if isinstance(landscape, dict):
        out["messaging"] = landscape.get("existing_messaging") or landscape.get("messaging") or ""
        out["protocols"] = landscape.get("protocols") or ""
        out["ref_arch"] = landscape.get("reference_architecture") or landscape.get("ref_arch") or ""
        ev = landscape.get("event_types") or []
        if isinstance(ev, list):
            out["event_types"] = [str(x) for x in ev]
    reqs = brief.get("requirements") or {}
    if isinstance(reqs, dict):
        # Pretty-print common keys with title-case labels.
        labels = {
            "delivery_mode": "Delivery guarantee", "ordering": "Ordering",
            "latency_tier": "Latency target", "scale": "Scale",
            "topology": "Topology", "processing_guarantee": "Processing guarantee",
            "regulatory": "Regulatory", "data_residency": "Data residency",
            "audit": "Audit",
        }
        for k, v in reqs.items():
            label = labels.get(k, k.replace("_", " ").title())
            if v not in (None, "", [], {}):
                out["requirements"][label] = ", ".join(v) if isinstance(v, list) else str(v)
    goals = brief.get("goals") or {}
    if isinstance(goals, dict):
        labels = {
            "project_type": "Project type", "driver": "Driver",
            "timeline": "Timeline", "budget": "Budget",
            "team": "Team", "constraints": "Constraints",
        }
        for k, v in goals.items():
            label = labels.get(k, k.replace("_", " ").title())
            if v not in (None, "", [], {}):
                out["goals"][label] = ", ".join(v) if isinstance(v, list) else str(v)
    return out


def _discovery_summary(brief: dict) -> str:
    return (brief.get("summary")
            or brief.get("description")
            or brief.get("discovery_summary")
            or "")


# ---------------------------------------------------------------------------
# Mermaid pre-render
# ---------------------------------------------------------------------------


_MMDC_BIN = shutil.which("mmdc") or shutil.which("npx")


def _mermaid_to_svg(diagram: str, *, name_hint: str = "") -> Optional[str]:
    """Render a mermaid diagram to SVG via mermaid-cli. None on any failure."""
    if not _MMDC_BIN:
        return None
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        src = td_path / "diagram.mmd"
        out = td_path / "diagram.svg"
        src.write_text(diagram, encoding="utf-8")
        # mmdc: -i input -o output. If mmdc isn't directly on PATH, try `npx`.
        cmd = (
            [_MMDC_BIN, "-i", str(src), "-o", str(out), "-q"]
            if _MMDC_BIN.endswith("mmdc")
            else [_MMDC_BIN, "-y", "@mermaid-js/mermaid-cli", "-i", str(src), "-o", str(out), "-q"]
        )
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=30)
        except (subprocess.SubprocessError, OSError):
            return None
        if not out.exists():
            return None
        svg = out.read_text(encoding="utf-8")
        # Strip XML prolog so the SVG drops cleanly into HTML.
        svg = re.sub(r"^<\?xml[^>]*\?>\s*", "", svg)
        return svg


# ---------------------------------------------------------------------------
# Artifact rendering
# ---------------------------------------------------------------------------


def _markdown_to_html(text: str) -> str:
    if _markdown is None:
        return f"<pre>{esc(text)}</pre>"
    md = _markdown.Markdown(extensions=[
        "extra",          # tables, fenced code, attr_list, footnotes, ...
        "sane_lists",
        "smarty",
        "toc",
        "nl2br",
    ])
    return md.convert(text)


def _render_artifact_body(name: str, content: str) -> str:
    if name.endswith((".mermaid", ".mmd")):
        svg = _mermaid_to_svg(content, name_hint=name)
        if svg:
            return f'<div class="mermaid mermaid-rendered">{svg}</div>'
        # Fallback: raw mermaid + load mermaid.js at runtime (HTML-only).
        return f'<div class="mermaid">{esc(content)}</div>'
    if name.endswith((".yaml", ".yml")):
        return f'<pre><code class="language-yaml">{esc(content)}</code></pre>'
    if name.endswith(".json"):
        return f'<pre><code class="language-json">{esc(content)}</code></pre>'
    if name.endswith(".md"):
        return _markdown_to_html(content)
    return f"<pre>{esc(content)}</pre>"


_COPY_SEQ = 0


def _artifact_header(name: str, raw_text: str, description: str = "") -> str:
    global _COPY_SEQ
    _COPY_SEQ += 1
    copy_id = f"rpt-copy-{_COPY_SEQ}"
    title = name.rsplit("/", 1)[-1]
    return (
        '<div class="report-artifact-header">'
        '<div class="report-artifact-text">'
        f'<h4 class="report-artifact-title">{esc(title)}</h4>'
        f'<code class="report-artifact-path">{esc(name)}</code>'
        + (f'<p class="report-artifact-desc">{esc(description)}</p>' if description else "")
        + "</div>"
        f'<button class="report-copy-btn" type="button" data-copy-target="{copy_id}" title="Copy raw source to clipboard">'
        '<span class="report-copy-label">Copy</span></button>'
        f'<textarea id="{copy_id}" class="report-copy-raw" readonly aria-hidden="true">{esc(raw_text)}</textarea>'
        "</div>"
    )


# ---------------------------------------------------------------------------
# Section renderers
# ---------------------------------------------------------------------------


def _stat_row(items: list[tuple[str, str]]) -> str:
    cells = "".join(
        f'<div class="stat-item"><div class="stat-label">{esc(lbl)}</div>'
        f'<div class="stat-value">{esc(val)}</div></div>'
        for lbl, val in items if val not in (None, "")
    )
    return f'<div class="stat-row">{cells}</div>'


def _page_header(label: str, project_name: str, subtitle: str, stats: list[tuple[str, str]]) -> str:
    return (
        '<div class="page-header">'
        f'<p class="eyebrow">{esc(label)}</p>'
        f'<h1>{esc(project_name)}</h1>'
        + (f'<p class="subtitle">{esc(subtitle)}</p>' if subtitle else "")
        + _stat_row(stats)
        + "</div>"
    )


def _summary_section(stats: dict, systems_count: int, decisions_count: int,
                     findings_count: int, open_count: int) -> str:
    inner = []
    for lbl, val in [
        ("Artifacts", stats.get("artifacts")),
        ("Decisions", decisions_count),
        ("Findings", findings_count),
        ("Open items", open_count),
        ("Systems", systems_count),
    ]:
        if val:
            inner.append(
                f'<div class="stat-item"><div class="stat-label">{esc(lbl)}</div>'
                f'<div style="font-size:18px;font-weight:700;color:#093B5F">{esc(val)}</div></div>'
            )
    return (
        '<h2 id="exec-summary">Summary</h2>'
        + (f'<p>{esc(stats.get("subtitle", ""))}</p>' if stats.get("subtitle") else "")
        + f'<div class="stat-row" style="margin-bottom:24px">{"".join(inner)}</div>'
    )


def _role_class(role: str) -> str:
    r = role.lower()
    if "both" in r or ("producer" in r and "consumer" in r):
        return "role-both"
    if "producer" in r:
        return "role-producer"
    return "role-consumer"


def _scope_section(systems: list[dict], inputs: dict) -> str:
    if not systems and not (inputs.get("messaging") or inputs.get("protocols") or inputs["event_types"]
                            or inputs["requirements"] or inputs["goals"]):
        return ""
    cards: list[str] = []

    # Systems card (wide)
    if systems:
        items = "".join(
            '<div class="scope-system">'
            f'<span class="scope-sys-name">{esc(s["name"])}</span>'
            + (f'<span class="scope-sys-role {_role_class(s["role"])}">{esc(s["role"])}</span>' if s["role"] else "")
            + "</div>"
            for s in systems
        )
        cards.append(
            '<div class="scope-card scope-card-wide">'
            '<div class="scope-card-header"><span class="scope-icon">&#9881;</span>Connected Systems'
            f'<span class="scope-count">{len(systems)} systems</span></div>'
            f'<div class="scope-card-body"><div class="scope-systems-grid">{items}</div></div>'
            "</div>"
        )

    # Current landscape card
    if inputs["messaging"] or inputs["protocols"] or inputs["ref_arch"]:
        body = ""
        if inputs["messaging"]:
            body += f'<div class="scope-field"><span class="scope-field-label">Existing messaging</span><span class="scope-field-value">{esc(inputs["messaging"])}</span></div>'
        if inputs["protocols"]:
            body += f'<div class="scope-field"><span class="scope-field-label">Protocols</span><span class="scope-field-value">{esc(inputs["protocols"])}</span></div>'
        if inputs["ref_arch"]:
            body += f'<div class="scope-field"><span class="scope-field-label">Reference architecture</span><span class="scope-field-value">{esc(inputs["ref_arch"])}</span></div>'
        cards.append(
            '<div class="scope-card scope-landscape">'
            '<div class="scope-card-header"><span class="scope-icon">&#9783;</span>Current Landscape</div>'
            f'<div class="scope-card-body">{body}</div></div>'
        )

    # Event types card
    if inputs["event_types"]:
        items = "".join(
            f'<div class="scope-event"><span class="scope-event-name">{esc(e)}</span></div>'
            for e in inputs["event_types"]
        )
        cards.append(
            '<div class="scope-card scope-events">'
            '<div class="scope-card-header"><span class="scope-icon">&#9889;</span>Event Types'
            f'<span class="scope-count">{len(inputs["event_types"])} types</span></div>'
            f'<div class="scope-card-body"><div class="scope-events-grid">{items}</div></div>'
            "</div>"
        )

    # Requirements
    if inputs["requirements"]:
        body = "".join(
            f'<div class="scope-field"><span class="scope-field-label">{esc(k)}</span>'
            f'<span class="scope-field-value">{esc(v)}</span></div>'
            for k, v in inputs["requirements"].items()
        )
        cards.append(
            '<div class="scope-card scope-requirements">'
            '<div class="scope-card-header"><span class="scope-icon">&#9745;</span>Requirements</div>'
            f'<div class="scope-card-body">{body}</div></div>'
        )

    # Goals / constraints
    if inputs["goals"]:
        body = "".join(
            f'<div class="scope-field"><span class="scope-field-label">{esc(k)}</span>'
            f'<span class="scope-field-value">{esc(v)}</span></div>'
            for k, v in inputs["goals"].items()
        )
        cards.append(
            '<div class="scope-card scope-goals">'
            '<div class="scope-card-header"><span class="scope-icon">&#9873;</span>Goals &amp; Constraints</div>'
            f'<div class="scope-card-body">{body}</div></div>'
        )

    return (
        '<h2 id="scope-inputs" style="margin-top:28px">Scope &amp; Inputs</h2>'
        '<p style="color:#5A7A94;font-size:13px;margin-bottom:12px">'
        'Key inputs from discovery that drive downstream architecture decisions.</p>'
        + f'<div class="scope-grid">{"".join(cards)}</div>'
    )


def _decisions_section(decisions: list[dict]) -> str:
    if not decisions:
        rows = '<tr><td colspan="4" style="color:#9ca3af;text-align:center">No decisions recorded</td></tr>'
    else:
        rows = "".join(
            "<tr>"
            f'<td>{esc(d.get("id"))}</td>'
            f'<td>{esc(_agent_to_skill(d.get("source_agent", "")))}</td>'
            f'<td>{esc(d.get("selected") or d.get("recommendation") or "")}</td>'
            f'<td>{esc(d.get("rationale") or d.get("context") or "")}</td>'
            "</tr>"
            for d in decisions
        )
    return (
        '<h2 id="decisions">Decisions</h2>'
        '<table><thead><tr><th>ID</th><th>Source</th><th>Selected</th><th>Rationale</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
    )


def _findings_section(findings: list[dict]) -> str:
    if not findings:
        return ""
    rows = "".join(
        "<tr>"
        f'<td>{esc(f.get("id"))}</td>'
        f'<td><span class="badge badge-{esc(f.get("severity", "advisory"))}">{esc(f.get("severity", "advisory"))}</span></td>'
        f'<td>{esc(_REVIEWER_SHORT.get(f.get("source_agent", ""), f.get("source_agent", "")))}</td>'
        f'<td>{esc(f.get("description", ""))}</td>'
        f'<td>{esc(f.get("affected_artifact", ""))}</td>'
        f'<td><span class="badge badge-{esc(f.get("status", "pending"))}">{esc(f.get("status", "pending"))}</span></td>'
        "</tr>"
        for f in findings
    )
    return (
        '<h2 id="findings">Review Findings</h2>'
        '<table><thead><tr><th>ID</th><th>Severity</th><th>Source</th><th>Description</th><th>Affected</th><th>Status</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
    )


def _open_items_section(items: list[dict]) -> str:
    if not items:
        return ""
    sev_color = {"blocking": "#DC2626", "advisory": "#00C895"}
    by_sev: dict[str, int] = {}
    for i in items:
        s = (i.get("severity") or "advisory").lower()
        by_sev[s] = by_sev.get(s, 0) + 1
    sev_badges = "".join(
        f'<span style="display:inline-block;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700;'
        f'font-family:\'Space Mono\',monospace;text-transform:uppercase;'
        f'background:{sev_color.get(s, "#5A7A94")}15;color:{sev_color.get(s, "#5A7A94")};'
        f'border:1px solid {sev_color.get(s, "#5A7A94")}30">{by_sev[s]} {s}</span>'
        for s in ("blocking", "advisory") if by_sev.get(s)
    )
    open_count = sum(1 for i in items if (i.get("status") or "open").lower() == "open")
    rows = "".join(
        '<tr>'
        f'<td style="font-weight:700;color:#093B5F;white-space:nowrap">{esc(i.get("id"))}</td>'
        f'<td><span class="badge badge-{esc((i.get("severity") or "advisory").lower())}">'
        f'{esc((i.get("severity") or "advisory").lower())}</span></td>'
        f'<td>{esc(i.get("description"))}</td>'
        f'<td style="font-size:12px">{esc(i.get("source"))}</td>'
        f'<td style="font-size:12px;color:#4B5563">{esc(i.get("resolution_note") or "")}</td>'
        f'<td><span class="badge badge-{esc((i.get("status") or "open").lower())}">'
        f'{esc((i.get("status") or "open").lower())}</span></td>'
        "</tr>"
        for i in items
    )
    return (
        '<h2 id="open-items">Open Items</h2>'
        f'<p style="margin-bottom:16px">{open_count} of {len(items)} items remain open.</p>'
        f'<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">{sev_badges}</div>'
        '<table><thead><tr><th style="width:60px">ID</th><th style="width:80px">Severity</th>'
        '<th>Description</th><th style="width:120px">Source</th>'
        '<th>Resolution</th><th style="width:80px">Status</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
    )


def _connected_systems_section(systems: list[dict]) -> str:
    if not systems:
        return ""
    rows = "".join(
        "<tr>"
        f'<td style="font-weight:600;color:#093B5F;white-space:nowrap">{esc(s["name"])}</td>'
        f'<td style="font-size:12px;font-family:\'Space Mono\',monospace;color:#5A7A94">{esc(s["role"])}</td>'
        f'<td style="font-size:13px">{esc(s["description"])}</td>'
        "</tr>"
        for s in systems
    )
    return (
        f'<h2 id="connected-systems">Connected Systems ({len(systems)})</h2>'
        '<table class="systems-table">'
        '<thead><tr><th>System</th><th>Role</th><th>Description</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
    )


# ---------------------------------------------------------------------------
# Artifacts section + TOC
# ---------------------------------------------------------------------------


def _sort_artifacts_by_phase(artifacts: list[str]) -> list[str]:
    def _key(name: str) -> tuple[int, str]:
        grp = _group_for_artifact(name)
        try:
            idx = _PHASE_ORDER.index(grp)
        except ValueError:
            idx = len(_PHASE_ORDER)
        return (idx, name)
    return sorted(artifacts, key=_key)


def _build_toc(pack: dict, sections_meta: dict, artifacts_grouped: dict[str, list[str]]) -> str:
    """Sidebar TOC: top-level sections + nested artifact groups."""
    lines: list[str] = []
    if sections_meta.get("summary"):
        lines.append('<a href="#exec-summary">Summary</a>')
    if sections_meta.get("scope"):
        lines.append('<a href="#scope-inputs">Scope &amp; Inputs</a>')
    if sections_meta.get("decisions"):
        lines.append('<a href="#decisions">Decisions</a>')
    if sections_meta.get("findings"):
        lines.append('<a href="#findings">Findings</a>')
    if sections_meta.get("open_items"):
        lines.append('<a href="#open-items">Open Items</a>')
    if sections_meta.get("connected_systems"):
        lines.append('<a href="#connected-systems">Connected Systems</a>')
    if sections_meta.get("roi"):
        lines.append('<a href="#roi-framework">ROI Framework</a>')
    if artifacts_grouped:
        lines.append('<div class="toc-phase">Artifacts</div>')
        for grp_key, files in artifacts_grouped.items():
            lines.append(f'<div class="toc-phase" style="margin-top:14px;padding-left:8px">'
                          f'<a href="#grp-{grp_key}">{esc(_group_label(grp_key))}</a></div>')
            for f in files:
                lines.append(f'<a href="#{_anchor_for_artifact(f)}" style="padding-left:24px;font-size:12px">'
                              f'{esc(f.rsplit("/", 1)[-1])}</a>')
    return "\n".join(lines)


def _artifact_descriptions(brief: dict, status: dict) -> dict[str, str]:
    """Best-effort: pick up artifact descriptions if the brief/lifecycle annotated them."""
    # V2 doesn't currently track per-artifact descriptions in a single file.
    # Future: pull from per-scope yaml artifacts. For now, empty.
    return {}


def _render_artifacts_block(engagement_id: str, artifacts: list[str],
                            descriptions: dict[str, str]) -> tuple[str, dict[str, list[str]]]:
    """Render the per-artifact sections + return the phase-grouped map for TOC."""
    if not artifacts:
        return "", {}
    sorted_arts = _sort_artifacts_by_phase(artifacts)
    grouped: dict[str, list[str]] = {}
    for f in sorted_arts:
        grouped.setdefault(_group_for_artifact(f), []).append(f)

    chunks: list[str] = []
    for grp_key, files in grouped.items():
        chunks.append(
            f'<div class="grp-section" id="grp-{grp_key}">'
            f'<div class="grp-marker">{esc(_group_label(grp_key))}</div>'
        )
        for f in files:
            try:
                content = read_text(engagement_id, f)
            except (FileNotFoundError, ValueError):
                continue
            anchor = _anchor_for_artifact(f)
            header = _artifact_header(f, content, descriptions.get(f, ""))
            body = _render_artifact_body(f, content)
            chunks.append(f'<div id="{anchor}" class="art-section">{header}{body}</div>')
        chunks.append("</div>")
    return "<h2>Artifacts</h2>" + "".join(chunks), grouped


# ---------------------------------------------------------------------------
# ROI Framework — Phase 3b (Executive pack only)
# ---------------------------------------------------------------------------


def _roi_section(engagement_id: str, artifacts: list[str]) -> str:
    """Look for a `*roi-framework.md` artifact; if present, the V1 ROI JS in
    templates/report.js handles interactivity. We just emit the structural
    HTML the JS hooks into. If no ROI artifact, render a placeholder.
    """
    roi_md = next((a for a in artifacts if a.endswith("roi-framework.md")), None)
    if not roi_md:
        return (
            '<h2 id="roi-framework">ROI Framework</h2>'
            '<p class="roi-intro">No ROI framework artifact found for this engagement. '
            'The Executive pack normally includes an interactive ROI calculator driven by '
            '<code>executive/roi-framework.md</code> — once that artifact is produced by the '
            'Executive Summary pass, it will render here with editable inputs and sensitivity '
            'scenarios.</p>'
        )
    # Render the markdown; the V1 ROI JS will look for tables with C1/P1/V1
    # row IDs and wire up the sliders.
    try:
        roi_text = read_text(engagement_id, roi_md)
    except (FileNotFoundError, ValueError):
        return ""
    return (
        '<h2 id="roi-framework">ROI Framework</h2>'
        + _markdown_to_html(roi_text)
    )


# ---------------------------------------------------------------------------
# Top toolbar
# ---------------------------------------------------------------------------


def _toolbar(pack_label: str) -> str:
    return (
        '<div class="dl-bar">'
        f'<a href="#" class="dl-title" onclick="window.scrollTo({{top:0,behavior:\'smooth\'}});return false">{esc(pack_label)}</a>'
        '<div class="dl-actions">'
        '<button class="dl-theme-toggle" id="themeToggle" title="Toggle dark/light theme">&#9790;</button>'
        '<button class="dl-print" onclick="window.print()">Print / PDF</button>'
        '<button class="dl-btn" id="dlBtn">Download HTML</button>'
        '</div></div>'
        '<div class="float-nav">'
        '<button class="float-btn" onclick="window.scrollTo({top:0,behavior:\'smooth\'})" title="Go to top">&#x25B2;</button>'
        '<button class="float-btn" onclick="window.scrollTo({top:document.body.scrollHeight,behavior:\'smooth\'})" title="Go to bottom">&#x25BC;</button>'
        '</div>'
    )


# ---------------------------------------------------------------------------
# Main HTML renderer
# ---------------------------------------------------------------------------


def render_audience_pack_html(*, engagement_id: str, audience: str, artifacts: list[str],
                              branding: dict, project_name: str | None = None) -> str:
    """Render the audience pack as a self-contained HTML string."""
    pack = _pack_by_id(audience)
    pack_label = pack.get("label") or _PACK_LABELS.get(audience, (audience.title(),))[0]
    pack_subtitle = pack.get("description") or _PACK_LABELS.get(audience, ("", ""))[1]

    decisions = _filter_decisions(_load_decisions(engagement_id), pack)
    findings = _filter_findings(_load_findings(engagement_id), pack)
    open_items = _load_open_items(engagement_id)
    brief = _load_brief(engagement_id)
    status = _load_status(engagement_id)
    project = project_name or _extract_project_name(brief, engagement_id)

    systems = _systems_from_brief(brief)
    inputs = _inputs_from_brief(brief)
    discovery_summary = _discovery_summary(brief)

    # Compute per-step timings from engagement-status.
    total_exec = 0
    for step in (status.get("steps") or {}).values():
        # In the future, set_step_status will populate timing fields.
        # For now, fall back to 0.
        if isinstance(step, dict):
            total_exec += int(step.get("timing", {}).get("execution_sec") or 0)

    stats_row: list[tuple[str, str]] = [
        ("Pack", pack_label),
        ("Artifacts", str(len(artifacts))),
        ("Decisions", str(len(decisions))),
        ("Findings", str(len(findings))),
        ("Open items", str(sum(1 for i in open_items if (i.get("status") or "open").lower() == "open"))),
        ("Execution", _fmt_time(total_exec)),
    ]

    page_header = _page_header(pack_label.upper(), project, discovery_summary, stats_row)

    # Section flags drive both rendering and the TOC.
    sections_meta = {
        "summary": _pack_includes_section(pack, "summary"),
        "scope": _pack_includes_section(pack, "scope") and (bool(systems) or bool(inputs["goals"]) or bool(inputs["requirements"])),
        "decisions": _pack_includes_section(pack, "decisions") and bool(decisions),
        "findings": _pack_includes_section(pack, "findings") and bool(findings),
        "open_items": _pack_includes_section(pack, "open-items") and bool(open_items),
        "connected_systems": _pack_includes_section(pack, "connected-systems") and bool(systems),
        "roi": pack.get("include_roi_calculator") or _pack_includes_section(pack, "roi"),
        "artifacts": _pack_includes_section(pack, "artifacts"),
    }

    body_parts: list[str] = []
    if sections_meta["summary"]:
        body_parts.append(_summary_section(
            {"artifacts": len(artifacts), "subtitle": discovery_summary},
            len(systems), len(decisions), len(findings),
            sum(1 for i in open_items if (i.get("status") or "open").lower() == "open"),
        ))
    if sections_meta["scope"]:
        body_parts.append(_scope_section(systems, inputs))
    if sections_meta["decisions"]:
        body_parts.append(_decisions_section(decisions))
    if sections_meta["findings"]:
        body_parts.append(_findings_section(findings))
    if sections_meta["open_items"]:
        body_parts.append(_open_items_section(open_items))
    if sections_meta["connected_systems"]:
        body_parts.append(_connected_systems_section(systems))
    if sections_meta["roi"]:
        body_parts.append(_roi_section(engagement_id, artifacts))

    artifacts_html = ""
    artifacts_grouped: dict[str, list[str]] = {}
    if sections_meta["artifacts"]:
        artifacts_html, artifacts_grouped = _render_artifacts_block(
            engagement_id, artifacts, _artifact_descriptions(brief, status),
        )

    toc_html = _build_toc(pack, sections_meta, artifacts_grouped)
    css, js = _load_templates()

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{esc(project)} — {esc(pack_label)}</title>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>{css}</style>
</head>
<body style="padding-top:48px" data-engagement="{esc(engagement_id)}" data-pack="{esc(audience)}">
{_toolbar(pack_label)}
{page_header}
<div class="layout">
  <nav class="sidebar">
    <div class="toc-title">On this page</div>
    {toc_html}
  </nav>
  <article class="content">
    {''.join(body_parts)}
    {artifacts_html}
  </article>
</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>{js}</script>
<script>
  // Theme persistence — localStorage-backed; defaults to light.
  (function(){{
    var key='solace-architect-report-theme';
    try{{
      var saved=localStorage.getItem(key);
      if(saved==='dark')document.body.classList.add('dark');
    }}catch(e){{}}
    var btn=document.getElementById('themeToggle');
    if(btn){{
      btn.textContent=document.body.classList.contains('dark')?'\\u2600':'\\u263E';
      btn.addEventListener('click',function(){{
        document.body.classList.toggle('dark');
        var dark=document.body.classList.contains('dark');
        btn.textContent=dark?'\\u2600':'\\u263E';
        try{{localStorage.setItem(key,dark?'dark':'light');}}catch(e){{}}
      }});
    }}
    // Copy-to-clipboard for per-artifact headers.
    document.body.addEventListener('click',function(e){{
      var b=e.target.closest('.report-copy-btn');
      if(!b)return;
      var id=b.getAttribute('data-copy-target');
      var ta=document.getElementById(id);
      if(!ta)return;
      ta.select();
      try{{document.execCommand('copy');}}catch(e){{}}
      b.classList.add('is-copied');
      var lbl=b.querySelector('.report-copy-label');
      var prev=lbl.textContent;
      lbl.textContent='Copied';
      setTimeout(function(){{b.classList.remove('is-copied');lbl.textContent=prev;}},1500);
    }});
    // Download-HTML button — clones the current document and triggers a save.
    var dl=document.getElementById('dlBtn');
    if(dl){{
      dl.addEventListener('click',function(){{
        var blob=new Blob(['<!doctype html>'+document.documentElement.outerHTML],{{type:'text/html'}});
        var a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download='{esc(audience)}-report.html';
        document.body.appendChild(a);a.click();a.remove();
      }});
    }}
  }})();
</script>
</body>
</html>"""


def render_audience_pack_pdf(html_content: str, output_path: Path) -> Path:
    """Render HTML to PDF via WeasyPrint with print-optimized CSS."""
    try:
        from weasyprint import HTML
    except ImportError:
        raise RuntimeError(
            "weasyprint not installed — `pip install weasyprint` (plus its system deps) "
            "to enable PDF rendering"
        )
    HTML(string=html_content).write_pdf(str(output_path))
    return output_path


async def render(*, engagement_id: str, audience: str, format: str, artifacts: list[str],
                 branding_overrides: dict | None = None) -> ToolResult:
    """Async entry point — registered with blueprint_tools at plugin load."""
    branding = _load_branding(branding_overrides)
    brief = _load_brief(engagement_id)
    project_name = _extract_project_name(brief, engagement_id)

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

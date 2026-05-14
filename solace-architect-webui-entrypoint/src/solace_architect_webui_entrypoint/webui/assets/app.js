/* Solace Architect — dashboard SPA (Phase 4 scaffold).
 *
 * Implements: theme toggle (with Mermaid re-init hook), project switcher,
 * status bar 2s poll, view routing, copy-to-clipboard buttons.
 *
 * Per-view rendering: each view function is a starting point — the Phase-4
 * implementer fills in chart rendering, table interactions, and filters using
 * the data each /api endpoint returns.
 */

(function () {
  "use strict";

  // ---------- Theme toggle (with Mermaid re-init) ----------
  const themeBtn = document.getElementById("theme-toggle");
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("solace-architect-theme", theme);
    themeBtn.textContent = theme === "dark" ? "☀" : "☾";
    if (window.mermaid) {
      window.mermaid.initialize({ theme: theme === "dark" ? "dark" : "default" });
      document.querySelectorAll(".mermaid").forEach(el => {
        // Re-render existing diagrams with the new theme
        el.removeAttribute("data-processed");
      });
      window.mermaid.run();
    }
  }
  themeBtn.addEventListener("click", () => {
    const next = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
  applyTheme(localStorage.getItem("solace-architect-theme") || "light");

  // ---------- Active project ----------
  let activeProject = localStorage.getItem("solace-architect-active-project") || "";
  const projectSelect = document.getElementById("project-select");

  async function loadProjects() {
    const r = await fetch("/api/projects");
    const projects = await r.json();
    projectSelect.innerHTML = '<option value="">— pick a project —</option>' +
      projects.map(p => `<option value="${p.id}" ${p.id === activeProject ? "selected" : ""}>${p.name}</option>`).join("");
  }
  projectSelect.addEventListener("change", () => {
    activeProject = projectSelect.value;
    localStorage.setItem("solace-architect-active-project", activeProject);
    renderCurrentView();
  });
  document.getElementById("new-project").addEventListener("click", async () => {
    const name = prompt("Project name?");
    if (!name) return;
    const r = await fetch("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const p = await r.json();
    activeProject = p.id;
    localStorage.setItem("solace-architect-active-project", activeProject);
    await loadProjects();
    renderCurrentView();
  });

  // ---------- View routing ----------
  function currentView() {
    return (window.location.hash || "#overview").slice(1);
  }
  function renderCurrentView() {
    const view = currentView();
    document.querySelectorAll(".nav-links a").forEach(a => {
      a.classList.toggle("active", a.dataset.view === view);
    });
    const content = document.getElementById("content");
    if (!activeProject && view !== "intake") {
      content.innerHTML = '<div class="welcome"><h1>No active project</h1><p>Pick or create a project to view this surface.</p></div>';
      return;
    }
    const fn = VIEWS[view] || VIEWS.overview;
    fn(content, activeProject);
  }
  window.addEventListener("hashchange", renderCurrentView);

  // ---------- Per-view scaffolds ----------
  const VIEWS = {
    overview: async (root, eid) => {
      const r = await fetch(`/api/engagements/${eid}/overview`);
      const d = await r.json();
      root.innerHTML = `
        <h1>Overview</h1>
        <div class="tile-row">
          <div class="stat-tile"><div class="stat-tile-label">Skills</div><div class="stat-tile-value">${d.skills_completed}/${d.skills_total}</div><div class="stat-tile-meta">${d.skills_skipped} skipped</div></div>
          <div class="stat-tile"><div class="stat-tile-label">Systems</div><div class="stat-tile-value">${d.connected_systems}</div><div class="stat-tile-meta">${d.producers} prod · ${d.consumers} cons</div></div>
          <div class="stat-tile"><div class="stat-tile-label">Artifacts</div><div class="stat-tile-value">${d.artifacts_count}</div></div>
          <div class="stat-tile"><div class="stat-tile-label">Decisions</div><div class="stat-tile-value">${d.decisions_count}</div></div>
          <div class="stat-tile"><div class="stat-tile-label">Open items</div><div class="stat-tile-value">${d.open_items_blocking}/${d.open_items_advisory}</div><div class="stat-tile-meta">blocking/advisory</div></div>
          <div class="stat-tile"><div class="stat-tile-label">EP Prov</div><div class="stat-tile-value">${d.ep_provisioning_status}</div></div>
        </div>
        <h2>Skip reasons</h2>
        <table><thead><tr><th>Step</th><th>Reason</th></tr></thead><tbody>
        ${(d.skip_reasons || []).map(s => `<tr><td>${s.step}</td><td>${s.reason}</td></tr>`).join("") || '<tr><td colspan="2">—</td></tr>'}
        </tbody></table>`;
    },
    timeline: async (root, eid) => {
      const r = await fetch(`/api/engagements/${eid}/timeline`);
      const entries = await r.json();
      root.innerHTML = `<h1>Timeline</h1>` +
        (entries.length === 0 ? "<p>No timing data yet.</p>" :
          `<table><thead><tr><th>Skill</th><th>Execution</th><th>User wait</th><th>Wall</th></tr></thead><tbody>` +
          entries.map(e => `<tr><td>${e.skill}</td><td>${e.execution_seconds}s</td><td>${e.user_wait_seconds}s</td><td>${e.wall_seconds}s</td></tr>`).join("") +
          `</tbody></table>`);
    },
    decisions: async (root, eid) => {
      const r = await fetch(`/api/engagements/${eid}/decisions`);
      const items = await r.json();
      root.innerHTML = `<h1>Decisions</h1>` +
        `<table><thead><tr><th>ID</th><th>Context</th><th>Selected</th><th>Rationale</th></tr></thead><tbody>` +
        items.map(d => `<tr><td>${d.id}</td><td>${d.context}</td><td>${d.selected}</td><td>${d.rationale}</td></tr>`).join("") +
        `</tbody></table>`;
    },
    "open-items": async (root, eid) => {
      const r = await fetch(`/api/engagements/${eid}/open-items?status=open`);
      const items = await r.json();
      root.innerHTML = `<h1>Open Items</h1>` +
        `<table><thead><tr><th>ID</th><th>Severity</th><th>Source</th><th>Description</th><th></th></tr></thead><tbody>` +
        items.map(q => `<tr><td>${q.id}</td><td>${q.severity}</td><td>${q.source}</td><td>${q.description}</td><td><button class="copy-btn" onclick="resolveItem('${eid}','${q.id}')">Resolve</button></td></tr>`).join("") +
        `</tbody></table>`;
    },
    artifacts: async (root, eid) => {
      const r = await fetch(`/api/engagements/${eid}/artifacts`);
      const names = await r.json();
      root.innerHTML = `<h1>Artifacts</h1><ul>${names.map(n => `<li><a href="#" data-art="${n}">${n}</a></li>`).join("")}</ul><div id="art-view"></div>`;
      root.querySelectorAll("a[data-art]").forEach(a => {
        a.addEventListener("click", async (e) => {
          e.preventDefault();
          const ar = await fetch(`/api/engagements/${eid}/artifacts/${encodeURIComponent(a.dataset.art)}`);
          const c = await ar.text();
          document.getElementById("art-view").innerHTML = `<h2>${a.dataset.art}</h2><pre>${c.replace(/</g,"&lt;")}</pre>`;
        });
      });
    },
    stats: async (root, eid) => {
      const r = await fetch(`/api/engagements/${eid}/stats`);
      const d = await r.json();
      root.innerHTML = `<h1>Stats</h1>
        <p>Wall: ${d.wall_time_seconds}s · Execution: ${d.execution_seconds}s · User wait: ${d.user_wait_seconds}s · Steps: ${d.steps_executed}</p>`;
    },
    export: async (root, eid) => {
      root.innerHTML = `<h1>Export</h1>
        <p>Generate audience-specific reports:</p>
        <div class="tile-row">
          ${["blueprint","executive","admin-ops","security","developers"].map(a =>
            `<div class="stat-tile"><div class="stat-tile-label">${a}</div><button class="copy-btn" onclick="renderPack('${eid}','${a}')">Render HTML</button></div>`
          ).join("")}
        </div>
        <h2>Full archive</h2>
        <button class="copy-btn" onclick="downloadZip('${eid}')">Download zip</button>`;
    },
    intake: async (root) => {
      root.innerHTML = '<iframe src="/intake/" style="width:100%;height:90vh;border:0"></iframe>';
    },
    chat: async (root) => {
      root.innerHTML = '<h1>Chat</h1><p>Conversational chat is served by the SAM HTTP-SSE runtime. Phase 4 implementer wires this into the SAM agent A2A streams.</p>';
    },
  };

  window.resolveItem = async (eid, itemId) => {
    const note = prompt("Resolution note?") || "";
    await fetch(`/api/engagements/${eid}/open-items/${itemId}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolution_note: note })
    });
    renderCurrentView();
  };
  window.renderPack = async (eid, audience) => {
    const r = await fetch(`/api/engagements/${eid}/exports/render`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience, format: "html" })
    });
    const d = await r.json();
    if (d.paths && d.paths[0]) window.open(d.paths[0], "_blank");
  };
  window.downloadZip = async (eid) => {
    const r = await fetch(`/api/engagements/${eid}/exports/zip`);
    const d = await r.json();
    if (d.zip_path) window.open(d.zip_path, "_blank");
  };

  // ---------- Live status bar (2s poll) ----------
  async function pollActiveStep() {
    if (!activeProject) {
      document.getElementById("status-bar").textContent = "Idle";
      return;
    }
    try {
      const r = await fetch(`/api/engagements/${activeProject}/active-step`);
      const d = await r.json();
      const bar = document.getElementById("status-bar");
      if (d.active_agent) {
        bar.textContent = `${d.active_agent}${d.active_scope ? "/" + d.active_scope : ""} · ${d.elapsed_seconds || 0}s`;
        bar.className = "status-bar " + (d.user_waiting ? "waiting" : "busy");
      } else {
        bar.textContent = "Idle";
        bar.className = "status-bar";
      }
    } catch (e) { /* ignore */ }
  }
  setInterval(pollActiveStep, 2000);

  // ---------- Boot ----------
  loadProjects().then(renderCurrentView);
})();

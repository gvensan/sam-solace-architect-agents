/* Solace Architect — dashboard SPA.
 *
 * Three-pane layout:
 *   - left sidebar (collapsible)
 *   - main content (route-based: /, /projects/:id/:view)
 *   - right chat panel (toggleable, resizable)
 *
 * Persistence (localStorage):
 *   - solace-architect-theme: "light" | "dark"
 *   - solace-architect-sidebar: "open" | "closed"
 *   - solace-architect-chat: "open" | "closed"
 *   - solace-architect-chat-width: pixels (number)
 */

(function () {
  "use strict";

  // ============================================================================
  // Persisted state — read once on boot, write on every change
  // ============================================================================
  const STORE = {
    theme:        () => localStorage.getItem("solace-architect-theme") || "light",
    sidebar:      () => localStorage.getItem("solace-architect-sidebar") || "open",
    chat:         () => localStorage.getItem("solace-architect-chat") || "closed",
    chatWidth:    () => parseInt(localStorage.getItem("solace-architect-chat-width") || "360", 10),
    setTheme:     v => localStorage.setItem("solace-architect-theme", v),
    setSidebar:   v => localStorage.setItem("solace-architect-sidebar", v),
    setChat:      v => localStorage.setItem("solace-architect-chat", v),
    setChatWidth: v => localStorage.setItem("solace-architect-chat-width", String(v)),
  };

  // ============================================================================
  // Theme toggle (with Mermaid re-init)
  // ============================================================================
  const themeBtn = document.getElementById("theme-toggle");
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    STORE.setTheme(theme);
    themeBtn.textContent = theme === "dark" ? "☀" : "☾";
    if (window.mermaid) {
      window.mermaid.initialize({ theme: theme === "dark" ? "dark" : "default" });
      document.querySelectorAll(".mermaid").forEach(el => el.removeAttribute("data-processed"));
      window.mermaid.run && window.mermaid.run();
    }
  }
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
  applyTheme(STORE.theme());

  // ============================================================================
  // Sidebar toggle
  // ============================================================================
  const sidebarBtn = document.getElementById("sidebar-toggle");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  function applySidebar(state) {
    document.body.setAttribute("data-sidebar", state);
    STORE.setSidebar(state);
  }
  sidebarBtn.addEventListener("click", () => {
    const next = document.body.getAttribute("data-sidebar") === "open" ? "closed" : "open";
    applySidebar(next);
  });
  sidebarBackdrop.addEventListener("click", () => applySidebar("closed"));
  applySidebar(STORE.sidebar());

  // Rail icons (visible when sidebar is collapsed) — both expand the sidebar.
  // The "+ New project" rail icon is an <a href="/intake/new">, so navigation
  // continues naturally; we just flip the persisted state so users return to
  // an expanded sidebar.
  const railActiveProject = document.getElementById("rail-active-project");
  const railNewProject = document.getElementById("rail-new-project");
  railActiveProject?.addEventListener("click", (e) => {
    e.preventDefault();
    applySidebar("open");
  });
  railNewProject?.addEventListener("click", () => applySidebar("open"));

  // ============================================================================
  // Chat panel toggle
  // ============================================================================
  const chatBtn = document.getElementById("chat-toggle");
  const chatClose = document.getElementById("chat-close");
  function applyChat(state) {
    document.body.setAttribute("data-chat", state);
    STORE.setChat(state);
  }
  chatBtn.addEventListener("click", () => {
    const next = document.body.getAttribute("data-chat") === "open" ? "closed" : "open";
    applyChat(next);
  });
  chatClose.addEventListener("click", () => applyChat("closed"));
  applyChat(STORE.chat());

  // Apply persisted chat width
  function applyChatWidth(px) {
    const clamped = Math.max(280, Math.min(720, px));
    document.documentElement.style.setProperty("--chat-width", clamped + "px");
    STORE.setChatWidth(clamped);
  }
  applyChatWidth(STORE.chatWidth());

  // ============================================================================
  // Resize handle (drag between main and chat)
  // ============================================================================
  const resizeHandle = document.getElementById("chat-resize-handle");
  let dragState = null;

  resizeHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragState = { startX: e.clientX, startWidth: STORE.chatWidth() };
    resizeHandle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const delta = dragState.startX - e.clientX;       // dragging left → grow chat
    applyChatWidth(dragState.startWidth + delta);
  });
  document.addEventListener("mouseup", () => {
    if (!dragState) return;
    dragState = null;
    resizeHandle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // ============================================================================
  // Keyboard: Esc closes the chat panel when focused inside it
  // ============================================================================
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.getAttribute("data-chat") === "open") {
      // Only close if focus is inside the chat panel (avoid surprising the user)
      const chatPanel = document.getElementById("chat-panel");
      if (chatPanel && chatPanel.contains(document.activeElement)) {
        applyChat("closed");
      }
    }
  });

  // ============================================================================
  // Current user — populate header chip + redirect to /login if anon and required
  // ============================================================================
  async function loadCurrentUser() {
    try {
      const r = await fetch("/api/auth/me");
      const d = await r.json();
      const chip = document.getElementById("user-chip");
      if (d.authenticated) {
        chip.textContent = d.user.name + (d.user.is_admin ? " (admin)" : "");
        chip.title = d.user.email || "";
        chip.classList.add("authenticated");
      } else if (d.require_auth) {
        window.location.href = "/login";
        return null;
      } else {
        chip.textContent = "anonymous (dev)";
      }
      return d;
    } catch (e) {
      console.error("Failed to load /api/auth/me", e);
      return null;
    }
  }

  // ============================================================================
  // Project list
  // ============================================================================
  let projects = [];
  async function loadProjects() {
    const r = await fetch("/api/projects");
    projects = await r.json();
    renderSidebarProjects();
  }
  function renderSidebarProjects() {
    const list = document.getElementById("project-list");
    if (!projects.length) {
      list.innerHTML = '<div class="empty-hint">No projects yet.</div>';
    } else {
      const active = currentProjectId();
      list.innerHTML = projects.map(p =>
        `<a href="/projects/${encodeURIComponent(p.id)}/overview"
            class="project-link${p.id === active ? " active" : ""}"
            data-route>${escapeHtml(p.name)}</a>`
      ).join("");
    }
    renderSidebarRail();
  }

  function renderSidebarRail() {
    const railProj = document.getElementById("rail-active-project");
    if (!railProj) return;
    const activeId = currentProjectId();
    const activeProject = activeId ? projects.find(p => p.id === activeId) : null;
    if (activeProject) {
      const initial = (activeProject.name || "?").trim().charAt(0).toUpperCase() || "?";
      railProj.querySelector(".rail-letter").textContent = initial;
      railProj.title = `${activeProject.name} — click to expand sidebar`;
      railProj.classList.remove("hidden");
    } else {
      railProj.classList.add("hidden");
    }
  }

  // ============================================================================
  // Router — pushState for SPA paths only; /intake/* falls through to browser
  // ============================================================================
  function isSpaPath(href) {
    return href === "/" || href.startsWith("/projects/");
  }
  function navigate(path, push = true) {
    if (push) window.history.pushState({}, "", path);
    render();
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#")) return;
    if (!isSpaPath(href)) return;     // browser handles /intake/*, /login, etc.
    e.preventDefault();
    navigate(href);
  });
  window.addEventListener("popstate", () => render(false));

  function currentPath() { return window.location.pathname; }
  function currentProjectId() {
    const m = currentPath().match(/^\/projects\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function currentView() {
    const m = currentPath().match(/^\/projects\/[^/]+\/([^/]+)/);
    return m ? m[1] : "overview";
  }

  // ============================================================================
  // Render dispatch
  // ============================================================================
  async function render() {
    const path = currentPath();
    const content = document.getElementById("content");
    const projectNav = document.getElementById("project-nav");

    renderSidebarProjects();

    const eid = currentProjectId();
    if (eid) {
      projectNav.classList.remove("hidden");
      projectNav.querySelectorAll(".nav-link").forEach(a => {
        const view = a.dataset.view;
        a.href = `/projects/${encodeURIComponent(eid)}/${view}`;
        a.classList.toggle("active", view === currentView());
      });
    } else {
      projectNav.classList.add("hidden");
    }

    // Chat is no longer project-gated — it targets any agent on the SAM mesh.
    // If a project is active, its id is sent as engagement_id metadata so the
    // agent can scope its work; otherwise the chat is project-free.
    const chatInput = document.getElementById("chat-input");
    const chatSend = document.getElementById("chat-send-btn");
    chatInput.disabled = false;
    if (chatSend) chatSend.disabled = false;
    const agentSelect = document.getElementById("chat-agent-select");
    const agentName = agentSelect?.value || "the selected agent";
    chatInput.placeholder = eid
      ? `Message ${agentName} about ${eid}…`
      : `Message ${agentName}…`;

    if (path === "/" || path === "") return renderHome(content);

    if (eid) {
      const view = currentView();
      const fn = VIEWS[view] || VIEWS.overview;
      return fn(content, eid);
    }

    content.innerHTML = `<div class="welcome"><h1>Not found</h1>
      <p>Path <code>${escapeHtml(path)}</code> doesn't match any route.</p>
      <p><a href="/">← back to projects</a></p></div>`;
  }

  async function renderHome(root) {
    if (!projects.length) {
      root.innerHTML = `
        <div class="empty-state">
          <h1>Welcome to Solace Architect</h1>
          <p>You don't have any projects yet. Start by creating one — the intake form
             walks you through discovery, scopes the design work, and shows you
             which agents will run.</p>
          <a href="/intake/new" class="cta-btn">Create your first project →</a>
        </div>`;
      return;
    }
    root.innerHTML = `
      <div class="project-cards-wrap">
        <div class="project-cards-header">
          <h1>Projects</h1>
          <a href="/intake/new" class="cta-btn">+ New project</a>
        </div>
        <div class="project-cards">
          ${projects.map(p => `
            <a class="project-card" href="/projects/${encodeURIComponent(p.id)}/overview" data-route>
              <div class="project-card-name">${escapeHtml(p.name)}</div>
              <div class="project-card-meta">
                <span class="project-card-owner">${escapeHtml(p.owner || "—")}</span>
                <span class="project-card-status status-${p.status || "active"}">${escapeHtml(p.status || "active")}</span>
              </div>
              <div class="project-card-date">Last active ${formatDate(p.last_active_at)}</div>
            </a>
          `).join("")}
        </div>
      </div>`;
  }

  // ============================================================================
  // Per-view renderers
  // ============================================================================
  const VIEWS = {
    overview: async (root, eid) => {
      try {
        const [stats, intakeRes] = await Promise.all([
          fetch(`/api/engagements/${encodeURIComponent(eid)}/overview`).then(r => r.json()),
          fetch(`/api/intake/load/${encodeURIComponent(eid)}`).then(r => r.json()),
        ]);
        const intake = (intakeRes && intakeRes.intake) || {};
        const activeProject = projects.find(p => p.id === eid);
        const statusValue = activeProject?.status || "active";
        root.innerHTML = `
          <h1>Overview</h1>

          <!-- Compact engagement-state tiles. Status is the first tile (Overview only);
               Activities lives on Decisions. -->
          ${renderHeroTiles(stats, { statusValue, includeActivities: false })}

          ${renderIntakeBrief(intake)}
        `;
      } catch (e) {
        root.innerHTML = `<div class="welcome"><h1>Overview unavailable</h1><p>${escapeHtml(e.message || e)}</p></div>`;
      }
    },

    timeline: async (root, eid) => {
      const entries = await fetch(`/api/engagements/${encodeURIComponent(eid)}/timeline`).then(r => r.json());
      root.innerHTML = `<h1>Timeline</h1>` +
        (entries.length === 0 ? "<p>No timing data yet.</p>" :
          `<table><thead><tr><th>Skill</th><th>Execution</th><th>User wait</th><th>Wall</th></tr></thead><tbody>` +
          entries.map(e => `<tr><td>${escapeHtml(e.skill)}</td><td>${e.execution_seconds}s</td><td>${e.user_wait_seconds}s</td><td>${e.wall_seconds}s</td></tr>`).join("") +
          `</tbody></table>`);
    },

    decisions: async (root, eid) => {
      const [items, stats] = await Promise.all([
        fetch(`/api/engagements/${encodeURIComponent(eid)}/decisions`).then(r => r.json()),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/overview`).then(r => r.json()),
      ]);
      const skipReasons = stats.skip_reasons || [];

      const decisionsSection = items.length === 0
        ? `<p class="muted">No decisions recorded yet. Decisions are appended by agents as the engagement progresses.</p>`
        : `<table><thead><tr><th>ID</th><th>Context</th><th>Selected</th><th>Rationale</th><th>Source</th></tr></thead><tbody>` +
            items.map(d => `<tr>
              <td><code>${escapeHtml(d.id)}</code></td>
              <td>${escapeHtml(d.context)}</td>
              <td><strong>${escapeHtml(d.selected)}</strong></td>
              <td>${escapeHtml(d.rationale)}</td>
              <td class="muted">${escapeHtml(d.source_agent || "—")}</td>
            </tr>`).join("") +
          `</tbody></table>`;

      const routingSection = skipReasons.length === 0
        ? `<p class="muted">No activities were skipped — every step in <code>skill-routing.yaml</code> applied to this engagement.</p>`
        : `<table><thead><tr><th>Activity</th><th>Skip reason</th></tr></thead><tbody>` +
            skipReasons.map(s => `<tr>
              <td><code>${escapeHtml(s.step)}</code></td>
              <td>${escapeHtml(s.reason)}</td>
            </tr>`).join("") +
          `</tbody></table>`;

      root.innerHTML = `
        <h1>Decisions</h1>

        <!-- Hero tiles: includes the Activities tile (Decisions is the home for execution state) -->
        ${renderHeroTiles(stats, { includeActivities: true })}

        <section class="brief-section">
          <h2>Recorded decisions</h2>
          <p class="brief-section-hint">Architectural choices the agents committed to during the engagement (append-only audit trail).</p>
          ${decisionsSection}
        </section>

        <section class="brief-section">
          <h2>Routing decisions</h2>
          <p class="brief-section-hint">Activities that <code>skill-routing.yaml</code> determined were not applicable to this engagement, based on the intake.</p>
          ${routingSection}
        </section>
      `;
    },

    "open-items": async (root, eid) => {
      const items = await fetch(`/api/engagements/${encodeURIComponent(eid)}/open-items?status=open`).then(r => r.json());
      root.innerHTML = `<h1>Open Items</h1>` +
        (items.length === 0 ? "<p>No open items.</p>" :
          `<table><thead><tr><th>ID</th><th>Severity</th><th>Source</th><th>Description</th><th></th></tr></thead><tbody>` +
          items.map(q => `<tr><td>${escapeHtml(q.id)}</td><td>${escapeHtml(q.severity)}</td><td>${escapeHtml(q.source)}</td><td>${escapeHtml(q.description)}</td><td><button class="copy-btn" onclick="window.__resolveItem('${eid}','${q.id}')">Resolve</button></td></tr>`).join("") +
          `</tbody></table>`);
    },

    artifacts: async (root, eid) => {
      const names = await fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts`).then(r => r.json());
      root.innerHTML = `<h1>Artifacts</h1>${names.length === 0 ? "<p>No artifacts yet.</p>" :
        `<ul>${names.map(n => `<li><a href="#" data-art="${escapeHtml(n)}">${escapeHtml(n)}</a></li>`).join("")}</ul>
         <div id="art-view"></div>`}`;
      root.querySelectorAll("a[data-art]").forEach(a => {
        a.addEventListener("click", async (e) => {
          e.preventDefault();
          const r = await fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts/${encodeURIComponent(a.dataset.art)}`);
          const c = await r.text();
          document.getElementById("art-view").innerHTML = `<h2>${escapeHtml(a.dataset.art)}</h2><pre>${escapeHtml(c)}</pre>`;
        });
      });
    },

    stats: async (root, eid) => {
      const d = await fetch(`/api/engagements/${encodeURIComponent(eid)}/stats`).then(r => r.json());
      root.innerHTML = `<h1>Stats</h1>
        <p>Wall: ${d.wall_time_seconds}s · Execution: ${d.execution_seconds}s · User wait: ${d.user_wait_seconds}s · Steps: ${d.steps_executed}</p>`;
    },

    export: async (root, eid) => {
      root.innerHTML = `<h1>Export</h1>
        <p>Render audience-specific reports for this project:</p>
        <div class="tile-row">
          ${["blueprint","executive","admin-ops","security","developers"].map(a =>
            `<div class="stat-tile">
               <div class="stat-tile-label">${a}</div>
               <button class="copy-btn" onclick="window.__renderPack('${eid}','${a}')">Render HTML</button>
             </div>`
          ).join("")}
        </div>
        <h2>Full archive</h2>
        <button class="copy-btn" onclick="window.__downloadZip('${eid}')">Download zip</button>`;
    },
  };

  // ============================================================================
  // Chat panel — wired to /api/chat/{message,stream/{session_id}}
  // ============================================================================
  let chatSessionId = null;
  let chatEventSource = null;
  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");

  function appendChatMessage(role, text) {
    const empty = chatLog.querySelector(".chat-empty");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = `chat-msg ${role}`;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function openSseStream(sessionId) {
    if (chatEventSource) chatEventSource.close();
    chatEventSource = new EventSource(`/api/chat/stream/${encodeURIComponent(sessionId)}`);
    chatEventSource.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "FinalResponse" || ev.type === "TaskStatusUpdateEvent") {
          const text = JSON.stringify(ev.data).slice(0, 300);
          appendChatMessage("agent", text);
        }
      } catch (err) { /* ignore malformed */ }
    };
    chatEventSource.addEventListener("complete", () => chatEventSource.close());
  }

  const chatAgentSelect = document.getElementById("chat-agent-select");

  async function loadAgents() {
    if (!chatAgentSelect) return;
    try {
      const r = await fetch("/api/agents");
      const d = await r.json();
      const agents = d.agents || [];
      const defaultName = d.default || "";
      if (!agents.length) {
        chatAgentSelect.innerHTML = `<option value="">${escapeHtml(defaultName || "(no agents discovered)")}</option>`;
        return;
      }
      chatAgentSelect.innerHTML = agents.map(a =>
        `<option value="${escapeHtml(a.name)}"${a.default ? " selected" : ""}>${escapeHtml(a.name)}</option>`
      ).join("");
      if (!chatAgentSelect.value && defaultName) chatAgentSelect.value = defaultName;
    } catch (err) {
      chatAgentSelect.innerHTML = `<option value="">(agent discovery failed)</option>`;
    }
  }
  chatAgentSelect?.addEventListener("change", () => {
    // refresh the placeholder to reflect the new agent target
    render();
  });
  // Re-poll periodically so newly-joined agents on the mesh appear in the picker
  setInterval(loadAgents, 15000);

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    const eid = currentProjectId();
    const agent = chatAgentSelect?.value || "";

    appendChatMessage("user", text);
    chatInput.value = "";

    if (!chatSessionId) {
      chatSessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      openSseStream(chatSessionId);
    }

    const body = { text, session_id: chatSessionId };
    if (agent) body.agent = agent;
    if (eid) body.engagement_id = eid;

    try {
      await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      appendChatMessage("agent", "[error] could not dispatch: " + err.message);
    }
  });

  // ============================================================================
  // Action handlers (inline onclick)
  // ============================================================================
  window.__resolveItem = async (eid, itemId) => {
    const note = prompt("Resolution note?") || "";
    await fetch(`/api/engagements/${encodeURIComponent(eid)}/open-items/${encodeURIComponent(itemId)}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution_note: note }),
    });
    render();
  };
  window.__renderPack = async (eid, audience) => {
    const r = await fetch(`/api/engagements/${encodeURIComponent(eid)}/exports/render`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience, format: "html" }),
    });
    const d = await r.json();
    if (d.paths && d.paths[0]) window.open(d.paths[0], "_blank");
  };
  window.__downloadZip = async (eid) => {
    const r = await fetch(`/api/engagements/${encodeURIComponent(eid)}/exports/zip`);
    const d = await r.json();
    if (d.zip_path) window.open(d.zip_path, "_blank");
  };
  window.__logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  // ============================================================================
  // Live status bar (2s poll)
  // ============================================================================
  async function pollActiveStep() {
    const eid = currentProjectId();
    const bar = document.getElementById("status-bar");
    if (!eid) {
      bar.textContent = "Idle";
      bar.className = "status-bar";
      return;
    }
    try {
      const d = await fetch(`/api/engagements/${encodeURIComponent(eid)}/active-step`).then(r => r.json());
      if (d.active_agent) {
        bar.textContent = `${d.active_agent}${d.active_scope ? "/" + d.active_scope : ""} · ${d.elapsed_seconds || 0}s`;
        bar.className = "status-bar " + (d.user_waiting ? "waiting" : "busy");
      } else {
        bar.textContent = "Idle";
        bar.className = "status-bar";
      }
    } catch (e) { /* swallow */ }
  }
  setInterval(pollActiveStep, 2000);

  // ============================================================================
  // Helpers
  // ============================================================================
  // ============================================================================
  // Hero tile row — shared by Overview (without Activities) and Decisions (with it)
  //
  // "Activities" is the V2 name for what was called "Skills" in V1 — each entry
  // in skill-routing.yaml is an engagement activity. SAM's Agent Card still uses
  // the word "skills" for agent-advertised capabilities, but that's a separate
  // concept and stays on the SAM side.
  // ============================================================================
  function renderHeroTiles(stats, opts = {}) {
    const tiles = [];

    if (opts.statusValue) {
      const status = String(opts.statusValue).toLowerCase();
      tiles.push(`<div class="stat-tile stat-tile-status status-tile-${escapeHtml(status)}">
        <div class="stat-tile-label">Status</div>
        <div class="stat-tile-value">${escapeHtml(status)}</div>
      </div>`);
    }

    if (opts.includeActivities) {
      tiles.push(`<div class="stat-tile">
        <div class="stat-tile-label">Activities</div>
        <div class="stat-tile-value">${stats.skills_completed}/${stats.skills_total}</div>
        <div class="stat-tile-meta">${stats.skills_skipped} skipped</div>
      </div>`);
    }
    tiles.push(`<div class="stat-tile">
      <div class="stat-tile-label">Systems</div>
      <div class="stat-tile-value">${stats.connected_systems}</div>
      <div class="stat-tile-meta">${stats.producers} prod · ${stats.consumers} cons</div>
    </div>`);
    tiles.push(`<div class="stat-tile">
      <div class="stat-tile-label">Artifacts</div>
      <div class="stat-tile-value">${stats.artifacts_count}</div>
    </div>`);
    tiles.push(`<div class="stat-tile">
      <div class="stat-tile-label">Decisions</div>
      <div class="stat-tile-value">${stats.decisions_count}</div>
    </div>`);
    tiles.push(`<div class="stat-tile">
      <div class="stat-tile-label">Open items</div>
      <div class="stat-tile-value">${stats.open_items_blocking}/${stats.open_items_advisory}</div>
      <div class="stat-tile-meta">blocking/advisory</div>
    </div>`);
    tiles.push(`<div class="stat-tile">
      <div class="stat-tile-label">EP Prov</div>
      <div class="stat-tile-value">${stats.ep_provisioning_status}</div>
    </div>`);

    return `<div class="tile-row">${tiles.join("")}</div>`;
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]
    ));
  }
  function formatDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  // ============================================================================
  // Intake → readable brief renderer
  //
  // Accepts the intake JSON (V1 nested shape OR V2 flat shape) and renders
  // sections matching the intake form's structure. Skip fields that are empty
  // so the layout doesn't show noise.
  // ============================================================================
  function renderIntakeBrief(intake) {
    if (!intake || typeof intake !== "object" || Object.keys(intake).length === 0) {
      return `<div class="brief-empty">
        <p class="muted">No intake recorded for this engagement yet.</p>
        <p class="muted">Was this project created before intake submission was wired? You can
        <a href="/intake/new">start a new project</a> to capture the design requirements.</p>
      </div>`;
    }

    // Normalize: pull V1-nested OR V2-flat shape into a uniform view object
    const project = intake.project || {
      name: intake.project_name, type: intake.project_type,
    };
    const landscape = intake.landscape || {
      vertical: intake.vertical, systems: intake.systems,
      existing_messaging: intake.existing_messaging,
      protocols: intake.protocols, events: intake.events,
      aggregate_volumes: intake.aggregate_volumes, schemas: intake.schemas,
    };
    const requirements = intake.requirements || {};
    const scale = intake.scale || {};
    const goals = intake.goals || {};
    const preferences = intake.preferences || {};

    return [
      _briefHeader(project, landscape),
      _briefProject(project, landscape),
      _briefSystems(landscape),
      _briefEvents(landscape),
      _briefRequirements(requirements),
      _briefScale(scale, landscape),
      _briefGoals(goals),
      _briefPreferences(preferences),
    ].filter(Boolean).join("\n");
  }

  function _isEmpty(v) {
    return v == null || v === "" ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
  }

  function _kv(label, value) {
    if (_isEmpty(value)) return "";
    return `<div class="brief-kv"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }

  function _briefHeader(project, landscape) {
    if (_isEmpty(project) && _isEmpty(landscape)) return "";
    const name = project.name || "Untitled project";
    const type = project.type || "—";
    const vertical = landscape.vertical;
    return `
      <div class="brief-banner">
        <div>
          <div class="brief-banner-eyebrow">Engagement brief</div>
          <h2 class="brief-banner-title">${escapeHtml(name)}</h2>
        </div>
        <div class="brief-banner-meta">
          <span class="brief-chip">${escapeHtml(type)}</span>
          ${vertical ? `<span class="brief-chip brief-chip-muted">${escapeHtml(vertical)}</span>` : ""}
        </div>
      </div>`;
  }

  function _briefProject(project, landscape) {
    const rows = [
      _kv("Project type", project.type),
      _kv("Industry vertical", landscape.vertical),
    ].filter(Boolean).join("");
    if (!rows) return "";
    return `
      <section class="brief-section">
        <h3>Project</h3>
        <dl class="brief-list">${rows}</dl>
      </section>`;
  }

  function _briefSystems(landscape) {
    const systems = landscape.systems || [];
    const existing = landscape.existing_messaging;
    if (systems.length === 0 && !existing) return "";

    const tableRows = systems.length === 0
      ? `<tr><td colspan="4" class="muted">No systems listed.</td></tr>`
      : systems.map(s => `<tr>
          <td>${escapeHtml(s.name || "—")}</td>
          <td>${escapeHtml(s.role || "—")}</td>
          <td>${escapeHtml(s.protocol || s.owner || "—")}</td>
          <td class="muted">${escapeHtml(s.notes || s.owner || "")}</td>
        </tr>`).join("");

    return `
      <section class="brief-section">
        <h3>System landscape</h3>
        ${systems.length ? `<table class="brief-table">
          <thead><tr><th>Name</th><th>Role</th><th>Protocol</th><th>Notes / Owner</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>` : ""}
        ${existing ? `<dl class="brief-list">${_kv("Existing messaging", existing)}</dl>` : ""}
        ${landscape.protocols && landscape.protocols.length ? `
          <dl class="brief-list">${_kv("Protocols in use", (landscape.protocols || []).join(", "))}</dl>` : ""}
      </section>`;
  }

  function _briefEvents(landscape) {
    const events = landscape.events || [];
    const volumes = landscape.aggregate_volumes;
    const schemas = landscape.schemas;
    if (events.length === 0 && !volumes && !schemas) return "";

    const tableRows = events.map(e => `<tr>
      <td>${escapeHtml(e.name || "—")}</td>
      <td>${escapeHtml(e.rate || "—")}</td>
      <td>${escapeHtml(e.delivery || "—")}</td>
      <td>${escapeHtml(e.payload_format || "—")}</td>
      <td class="muted">${escapeHtml(e.payload_size || "")}</td>
    </tr>`).join("");

    return `
      <section class="brief-section">
        <h3>Events</h3>
        ${events.length ? `<table class="brief-table">
          <thead><tr><th>Name</th><th>Rate</th><th>Delivery</th><th>Payload format</th><th>Payload size</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>` : ""}
        <dl class="brief-list">
          ${_kv("Aggregate volumes", volumes)}
          ${_kv("Existing schemas / AsyncAPI", schemas)}
        </dl>
      </section>`;
  }

  function _briefRequirements(req) {
    if (_isEmpty(req)) return "";
    const fields = [
      ["Delivery mode", req.delivery_mode],
      ["Ordering", req.ordering],
      ["Processing guarantee", req.processing_guarantee],
      ["Latency tier", req.latency_tier],
      ["Topology", req.topology],
    ];
    const rows = fields.map(([l, v]) => _kv(l, v)).filter(Boolean).join("");
    if (!rows) return "";
    return `
      <section class="brief-section">
        <h3>Requirements</h3>
        <dl class="brief-list brief-list-grid">${rows}</dl>
      </section>`;
  }

  function _briefScale(scale, landscape) {
    const fields = [
      ["Sites / regions",          scale.sites_regions],
      ["IT/OT boundary",           scale.it_ot_boundary],
      ["Growth expectations",      scale.growth_expectations],
      ["Data residency",           scale.data_residency],
      ["Operations team",          scale.operations_team],
      ["Solace / EDA experience",  scale.solace_eda_experience],
      ["Observability",            scale.observability],
      ["CI/CD",                    scale.ci_cd],
    ];
    const rows = fields.map(([l, v]) => _kv(l, v)).filter(Boolean).join("");
    if (!rows) return "";
    return `
      <section class="brief-section">
        <h3>Scale &amp; operations</h3>
        <dl class="brief-list">${rows}</dl>
      </section>`;
  }

  function _briefGoals(goals) {
    if (_isEmpty(goals)) return "";
    const fields = [
      ["Driver",                  goals.driver],
      ["Timeline",                goals.timeline],
      ["Budget constraints",      goals.budget],
      ["Team size",               goals.team_size],
      ["Organizational constraints", goals.organizational_constraints],
    ];
    const rows = fields.map(([l, v]) => _kv(l, v)).filter(Boolean).join("");
    if (!rows) return "";
    return `
      <section class="brief-section">
        <h3>Goals &amp; constraints</h3>
        <dl class="brief-list">${rows}</dl>
      </section>`;
  }

  function _briefPreferences(prefs) {
    if (_isEmpty(prefs)) return "";
    const epProvision = prefs.provision_event_portal === true || prefs.provision_event_portal === "true"
      ? "Yes — provision into the live tenant"
      : "No — design only";
    const executionMode = prefs.execution_mode || "auto";
    return `
      <section class="brief-section">
        <h3>Preferences</h3>
        <dl class="brief-list">
          ${_kv("Execution mode", executionMode)}
          ${_kv("Provision Event Portal", epProvision)}
        </dl>
      </section>`;
  }

  // ============================================================================
  // Boot
  // ============================================================================
  (async function boot() {
    const me = await loadCurrentUser();
    if (me === null) return;        // redirected to /login
    await Promise.all([loadProjects(), loadAgents()]);
    await render();
  })();
})();

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
  let currentUser = null;
  async function loadCurrentUser() {
    try {
      const r = await fetch("/api/auth/me");
      const d = await r.json();
      const chip = document.getElementById("user-chip");
      const logoutBtn = document.getElementById("logout-btn");
      const settingsLink = document.getElementById("settings-link");
      if (d.authenticated) {
        chip.textContent = d.user.name + (d.user.is_admin ? " (admin)" : "");
        chip.title = d.user.email || "";
        chip.classList.add("authenticated");
        logoutBtn?.classList.remove("hidden");
        settingsLink?.classList.remove("hidden");
      } else if (d.require_auth) {
        window.location.href = "/login";
        return null;
      } else {
        chip.textContent = "anonymous (dev)";
        logoutBtn?.classList.add("hidden");
        settingsLink?.classList.remove("hidden");
      }
      currentUser = d;
      return d;
    } catch (e) {
      console.error("Failed to load /api/auth/me", e);
      return null;
    }
  }

  // Logout button — calls window.__logout (defined later) on click
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    if (window.__logout) await window.__logout();
  });

  // ============================================================================
  // Project list
  // ============================================================================
  let projects = [];
  let projectSearchTerm = "";
  async function loadProjects() {
    const r = await fetch("/api/projects");
    projects = await r.json();
    renderSidebarProjects();
  }
  function renderSidebarProjects() {
    const list = document.getElementById("project-list");
    const filter = projectSearchTerm.trim().toLowerCase();
    const filtered = filter
      ? projects.filter(p => (p.name || "").toLowerCase().includes(filter))
      : projects;
    if (!projects.length) {
      list.innerHTML = '<div class="empty-hint">No projects yet.</div>';
    } else if (!filtered.length) {
      list.innerHTML = '<div class="empty-hint">No projects match.</div>';
    } else {
      const active = currentProjectId();
      list.innerHTML = filtered.map(p =>
        `<div class="project-link-row">
           <a href="/projects/${encodeURIComponent(p.id)}/overview"
              class="project-link${p.id === active ? " active" : ""}"
              data-route>${escapeHtml(p.name)}</a>
           <button class="project-action-btn" title="Project actions"
                   data-project-actions="${escapeHtml(p.id)}" aria-label="Project actions">⋯</button>
         </div>`
      ).join("");
    }
    renderSidebarRail();
  }

  // Wire sidebar search filter
  document.getElementById("project-search")?.addEventListener("input", (e) => {
    projectSearchTerm = e.target.value || "";
    renderSidebarProjects();
  });

  // Delegated handler for the kebab menu (rename / clone / archive)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-project-actions]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const pid = btn.getAttribute("data-project-actions");
    const proj = projects.find(p => p.id === pid);
    if (!proj) return;
    openProjectActionsModal(proj);
  });

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
    return href === "/" || href.startsWith("/projects/") || href === "/settings";
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

    // Re-anchor the chat session to the current project context.
    if (typeof syncChatProjectContext === "function") syncChatProjectContext();

    if (path === "/" || path === "") return renderHome(content);
    if (path === "/settings") return renderSettingsView(content);

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
        const [stats, intakeRes, artifacts, lifecycle] = await Promise.all([
          fetch(`/api/engagements/${encodeURIComponent(eid)}/overview`).then(r => r.json()),
          fetch(`/api/intake/load/${encodeURIComponent(eid)}`).then(r => r.json()),
          fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts`).then(r => r.json()).catch(() => []),
          fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`).then(r => r.json()).catch(() => ({ steps: {} })),
        ]);
        const intake = (intakeRes && intakeRes.intake) || {};
        const activeProject = projects.find(p => p.id === eid);
        const statusValue = activeProject?.status || "active";
        const hasIntake = artifacts.some(a => a === "discovery/intake.json");
        const hasDiscoveryBrief = artifacts.some(a => a === "discovery/discovery-brief.yaml");
        const hasDiscoverySummary = artifacts.some(a => a === "discovery/discovery-summary.md");
        const openItemsCount = (stats.open_items_blocking || 0) + (stats.open_items_advisory || 0);

        // Authoritative source: meta/engagement-status.yaml written by the
        // agent at end-of-turn (set_step_status). File-existence alone is
        // too fragile — an empty summary made Discovery look done when the
        // brief was unusable.
        const discoveryStatus = lifecycle?.steps?.discovery?.status || "NOT_STARTED";
        const discoveryNote = lifecycle?.steps?.discovery?.note || "";
        const discoveryDone = discoveryStatus === "DONE" || discoveryStatus === "DONE_WITH_CONCERNS";
        const discoveryInProgress = !discoveryDone && (hasDiscoveryBrief || openItemsCount > 0 || hasDiscoverySummary);

        // Active step on the lifecycle banner.
        const activeStepId = discoveryDone ? "design"
          : (discoveryInProgress || hasIntake) ? "discovery"
          : "intake";
        const completedSteps = new Set();
        if (hasIntake) completedSteps.add("intake");
        if (discoveryDone) completedSteps.add("discovery");

        // One contextual CTA, always shown — content depends on lifecycle state.
        const cta = renderProgressCta({
          eid, hasIntake, discoveryStatus, discoveryNote,
          discoveryInProgress, openItemsCount,
        });

        root.innerHTML = `
          <h1>Progress</h1>
          ${renderProgressBanner({ active: activeStepId, completed: completedSteps })}
          ${cta}

          <!-- Compact engagement-state tiles. Status is the first tile (Progress only);
               Activities lives on Decisions. -->
          ${renderHeroTiles(stats, { statusValue, includeActivities: false })}
        `;
        wireProgressCtaActions(root, eid);
      } catch (e) {
        root.innerHTML = `<div class="welcome"><h1>Overview unavailable</h1><p>${escapeHtml(e.message || e)}</p></div>`;
      }
    },

    // Requirements view — the intake-derived content (project metadata,
    // landscape, requirements, goals) that used to be tacked onto the
    // bottom of Overview. Lives under its own sidebar entry so Progress
    // stays focused on engagement state.
    requirements: async (root, eid) => {
      try {
        const intakeRes = await fetch(`/api/intake/load/${encodeURIComponent(eid)}`).then(r => r.json());
        const intake = (intakeRes && intakeRes.intake) || {};
        root.innerHTML = `
          <h1>Requirements</h1>
          <p class="muted" style="margin-top:-4px;margin-bottom:18px;font-size:13px;">
            Submitted intake for this engagement. SADiscoveryAgent enriches this into
            <code>discovery/discovery-brief.yaml</code> as discovery progresses.
          </p>
          ${renderIntakeBrief(intake)}
        `;
      } catch (e) {
        root.innerHTML = `<div class="welcome"><h1>Requirements unavailable</h1><p>${escapeHtml(e.message || e)}</p></div>`;
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
          items.map(q => `<tr>
            <td>${escapeHtml(q.id)}</td>
            <td>${escapeHtml(q.severity)}</td>
            <td>${escapeHtml(q.source)}</td>
            <td>${escapeHtml(q.description)}</td>
            <td><button class="copy-btn" data-resolve-item="${escapeHtml(q.id)}" data-desc="${escapeHtml(q.description || "")}">Resolve</button></td>
          </tr>`).join("") +
          `</tbody></table>`);
      root.querySelectorAll("[data-resolve-item]").forEach(btn => {
        btn.addEventListener("click", () =>
          openResolveItemModal(eid, btn.dataset.resolveItem, btn.dataset.desc));
      });
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

  // Per-step illustration banners shown above the engagement stat tiles.
  // Each step gets a hand-rolled inline SVG so we don't depend on any
  // external icon set. State drives the styling: completed = checkmark
  // tint, active = accent border + glow, pending = muted.
  function renderProgressBanner({ active, completed }) {
    const steps = [
      { id: "intake",       label: "Intake",       svg: "M3 4h18v4H3zM3 12h18v4H3zM3 20h18" },
      { id: "discovery",    label: "Discovery",    svg: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm10 2-5-5" },
      { id: "design",       label: "Design",       svg: "M3 3l6 6v12l6-6V3zM3 3l6 6 6-6" },
      { id: "review",       label: "Review",       svg: "M4 4h16v12H4zM4 4l8 6 8-6M8 20h8" },
      { id: "validation",   label: "Validation",   svg: "M5 12l5 5L20 7" },
      { id: "blueprint",    label: "Blueprint",    svg: "M4 4h16v16H4zM4 9h16M9 4v16" },
      { id: "provisioning", label: "Provisioning", svg: "M12 2v6M12 22v-6M2 12h6M22 12h-6M5 5l4 4M19 19l-4-4M19 5l-4 4M5 19l4-4" },
    ];
    return `
      <div class="progress-banner" role="navigation" aria-label="Engagement lifecycle">
        ${steps.map(s => {
          const isActive = s.id === active;
          const isDone = completed.has(s.id);
          const cls = "progress-step "
            + (isActive ? "active " : "")
            + (isDone ? "done " : "")
            + ((!isActive && !isDone) ? "pending " : "");
          return `
            <div class="${cls.trim()}" data-step="${s.id}">
              <div class="progress-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="${s.svg}"/>
                </svg>
                ${isDone ? `<span class="progress-check" aria-hidden="true">✓</span>` : ""}
              </div>
              <div class="progress-label">${s.label}</div>
            </div>`;
        }).join("")}
      </div>`;
  }

  // One contextual CTA on the Progress page, always present, tells the
  // user what to do next based on lifecycle state. Resolves the previous
  // confusion ("I see the banner but what should I do") by giving a
  // single primary action keyed to the current step + status.
  //
  // States covered:
  //   - no intake             → link to /intake (defensive — overview only
  //                              renders for projects with intake)
  //   - intake, not started   → Start Discovery (primes chat)
  //   - in progress           → Continue in chat (status, opens panel)
  //   - DONE / DONE_WITH_CONCERNS → View brief + Restart Discovery
  function renderProgressCta({
    eid, hasIntake, discoveryStatus, discoveryNote, discoveryInProgress, openItemsCount,
  }) {
    if (!hasIntake) {
      return `
        <div class="progress-cta" role="region" aria-label="Intake required">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Get started</div>
            <h2>Submit your intake</h2>
            <p>Discovery can't run without an intake form. Tell us what you're building
            and we'll start asking the right follow-ups.</p>
          </div>
          <div class="progress-cta-actions">
            <a class="cta-btn" href="/intake/edit/${encodeURIComponent(eid)}">Open intake form →</a>
          </div>
        </div>`;
    }

    const done = discoveryStatus === "DONE" || discoveryStatus === "DONE_WITH_CONCERNS";

    if (done) {
      const badge = discoveryStatus === "DONE_WITH_CONCERNS"
        ? `<span class="status-badge advisory">Done with concerns</span>`
        : `<span class="status-badge done">Done</span>`;
      return `
        <div class="progress-cta done" role="region" aria-label="Discovery complete">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Discovery</div>
            <h2>Discovery is complete ${badge}</h2>
            ${discoveryNote ? `<p>${escapeHtml(discoveryNote)}</p>` : ""}
            <p>You can review the brief on the Artifacts tab, or restart Discovery
            from scratch if you want to re-run the questions with different inputs.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View brief →</a>
            <button id="restart-discovery-btn" class="cta-btn cta-btn-danger">Restart Discovery…</button>
          </div>
        </div>`;
    }

    if (discoveryInProgress) {
      return `
        <div class="progress-cta in-progress" role="region" aria-label="Discovery in progress">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Discovery in progress</div>
            <h2>Continue in chat</h2>
            <p>SADiscoveryAgent is working through the gaps in your intake.
            ${openItemsCount ? `<strong>${openItemsCount}</strong> open item${openItemsCount === 1 ? "" : "s"} recorded so far. ` : ""}
            Open the chat panel to answer the next question — the brief appears
            here once the agent finishes its pass.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
            <button id="restart-discovery-btn" class="cta-btn cta-btn-danger">Restart Discovery…</button>
          </div>
        </div>`;
    }

    // Intake exists, discovery hasn't started.
    return `
      <div class="progress-cta" role="region" aria-label="Discovery not yet run">
        <div class="progress-cta-body">
          <div class="progress-cta-eyebrow">Next step</div>
          <h2>Discovery hasn't run yet</h2>
          <p>SADiscoveryAgent will read your intake, pattern-match against the
          reference architectures, and ask only about the gaps. Each question
          comes as an interactive card you click to answer.</p>
        </div>
        <div class="progress-cta-actions">
          <button id="start-discovery-btn" class="cta-btn">Start Discovery →</button>
        </div>
      </div>`;
  }

  // Wire click handlers on whichever progress-CTA buttons exist this render.
  function wireProgressCtaActions(root, eid) {
    const openChatWith = (text) => {
      applyChat("open");
      const ci = document.getElementById("chat-input");
      if (ci) {
        if (text) ci.value = text;
        ci.focus();
      }
    };
    root.querySelector("#start-discovery-btn")?.addEventListener("click", () =>
      openChatWith("Let's start discovery — please review the intake and ask your first follow-up."));
    root.querySelector("#continue-in-chat-btn")?.addEventListener("click", () =>
      openChatWith(""));
    root.querySelector("#restart-discovery-btn")?.addEventListener("click", () =>
      openRestartDiscoveryModal(eid));
  }

  // Restart Discovery — destructive action; uses a typed-id confirmation
  // modal so a stray click can't wipe state.
  function openRestartDiscoveryModal(eid) {
    openModal(`
      <div class="modal-section">
        <h2>Restart Discovery for <code>${escapeHtml(eid)}</code>?</h2>
        <p>This will:</p>
        <ul style="margin: 6px 0 12px 18px; font-size: 13px; line-height: 1.6;">
          <li>delete <code>discovery/discovery-brief.yaml</code> and
              <code>discovery/discovery-summary.md</code></li>
          <li>mark any open-items recorded by Discovery as <code>superseded</code></li>
          <li>clear the Discovery entry in <code>meta/engagement-status.yaml</code></li>
        </ul>
        <p>Your intake form is <strong>not</strong> touched. Decisions and findings
        recorded by other agents are <strong>not</strong> touched.</p>
        <p style="margin-top: 12px;">Type the project id <code>${escapeHtml(eid)}</code>
        to confirm:</p>
        <input id="restart-confirm-input" type="text" autocomplete="off"
               style="width: 100%; padding: 8px 10px; font-family: 'Space Mono', monospace;
                      font-size: 13px; border: 1px solid var(--border); border-radius: 4px;
                      margin-top: 6px;">
        <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;">
          <button class="cta-btn cta-btn-secondary" data-modal-close>Cancel</button>
          <button id="restart-confirm-btn" class="cta-btn cta-btn-danger" disabled>Restart Discovery</button>
        </div>
      </div>`, { focus: "#restart-confirm-input" });

    const input = document.getElementById("restart-confirm-input");
    const btn = document.getElementById("restart-confirm-btn");
    input?.addEventListener("input", () => {
      btn.disabled = input.value.trim() !== eid;
    });
    btn?.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Restarting…";
      try {
        const res = await fetch(`/api/engagements/${encodeURIComponent(eid)}/discovery`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        closeModal();
        // Refresh the view so the CTA flips back to "Start Discovery".
        render();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Restart Discovery";
        alert(`Restart failed: ${err.message}`);
      }
    });
  }

  // ============================================================================
  // Modal helpers — single shared #modal-root, used for confirm/forms/etc.
  // ============================================================================
  const modalRoot = document.getElementById("modal-root");
  const modalCard = document.getElementById("modal-card");

  function openModal(innerHtml, opts = {}) {
    modalCard.innerHTML = innerHtml;
    modalRoot.classList.remove("hidden");
    modalRoot.setAttribute("aria-hidden", "false");
    if (opts.focus) {
      const target = modalCard.querySelector(opts.focus);
      target?.focus();
    }
  }
  function closeModal() {
    modalRoot.classList.add("hidden");
    modalRoot.setAttribute("aria-hidden", "true");
    modalCard.innerHTML = "";
  }
  modalRoot.addEventListener("click", (e) => {
    if (e.target.closest("[data-modal-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalRoot.classList.contains("hidden")) closeModal();
  });

  function openProjectActionsModal(project) {
    openModal(`
      <h2>Project: ${escapeHtml(project.name)}</h2>
      <div class="modal-body">
        <div class="modal-field">
          <label for="proj-rename-name">Rename</label>
          <input id="proj-rename-name" type="text" value="${escapeHtml(project.name)}">
        </div>
        <div class="modal-field">
          <label for="proj-rename-desc">Description (optional)</label>
          <textarea id="proj-rename-desc" rows="2">${escapeHtml(project.description || "")}</textarea>
        </div>
        <div id="proj-action-msg"></div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-secondary" data-action="clone">Clone…</button>
        <button class="modal-btn modal-btn-secondary" data-action="archive">${project.status === "archived" ? "(archived)" : "Archive"}</button>
        <button class="modal-btn modal-btn-secondary" data-modal-close>Cancel</button>
        <button class="modal-btn modal-btn-primary" data-action="rename">Save</button>
      </div>
    `, { focus: "#proj-rename-name" });

    modalCard.querySelector('[data-action="rename"]').addEventListener("click", async () => {
      const name = modalCard.querySelector("#proj-rename-name").value.trim();
      const description = modalCard.querySelector("#proj-rename-desc").value.trim();
      const msg = modalCard.querySelector("#proj-action-msg");
      if (!name) { msg.innerHTML = `<div class="modal-error">Name is required.</div>`; return; }
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        });
        if (!r.ok) throw new Error(await r.text());
        await loadProjects();
        closeModal();
      } catch (err) {
        msg.innerHTML = `<div class="modal-error">${escapeHtml(String(err.message || err))}</div>`;
      }
    });

    modalCard.querySelector('[data-action="clone"]').addEventListener("click", () => {
      openCloneProjectModal(project);
    });

    modalCard.querySelector('[data-action="archive"]').addEventListener("click", async () => {
      if (project.status === "archived") return;
      if (!confirm(`Archive "${project.name}"? You can still view it but no new activity will run.`)) return;
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(project.id)}/archive`, { method: "POST" });
        if (!r.ok) throw new Error(await r.text());
        await loadProjects();
        closeModal();
        if (currentProjectId() === project.id) navigate("/");
      } catch (err) {
        modalCard.querySelector("#proj-action-msg").innerHTML =
          `<div class="modal-error">${escapeHtml(String(err.message || err))}</div>`;
      }
    });
  }

  function openCloneProjectModal(source) {
    openModal(`
      <h2>Clone "${escapeHtml(source.name)}"</h2>
      <div class="modal-body">
        <p class="muted">A new project is seeded with the source's intake/brief. Decisions and artifacts don't carry over.</p>
        <div class="modal-field">
          <label for="proj-clone-name">New project name</label>
          <input id="proj-clone-name" type="text" value="${escapeHtml(source.name + " (copy)")}">
        </div>
        <div id="proj-clone-msg"></div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-secondary" data-modal-close>Cancel</button>
        <button class="modal-btn modal-btn-primary" data-action="clone-go">Clone</button>
      </div>
    `, { focus: "#proj-clone-name" });

    modalCard.querySelector('[data-action="clone-go"]').addEventListener("click", async () => {
      const new_name = modalCard.querySelector("#proj-clone-name").value.trim();
      const msg = modalCard.querySelector("#proj-clone-msg");
      if (!new_name) { msg.innerHTML = `<div class="modal-error">Name is required.</div>`; return; }
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(source.id)}/clone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_name }),
        });
        if (!r.ok) throw new Error(await r.text());
        const created = await r.json();
        await loadProjects();
        closeModal();
        if (created?.id) navigate(`/projects/${encodeURIComponent(created.id)}/overview`);
      } catch (err) {
        msg.innerHTML = `<div class="modal-error">${escapeHtml(String(err.message || err))}</div>`;
      }
    });
  }

  function openResolveItemModal(eid, itemId, description) {
    openModal(`
      <h2>Resolve open item</h2>
      <div class="modal-body">
        <p class="muted">${escapeHtml(description || itemId)}</p>
        <div class="modal-field">
          <label for="resolve-note">Resolution note</label>
          <textarea id="resolve-note" rows="3" placeholder="What's the resolution?"></textarea>
        </div>
        <div id="resolve-msg"></div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-secondary" data-modal-close>Cancel</button>
        <button class="modal-btn modal-btn-primary" data-action="resolve-go">Resolve</button>
      </div>
    `, { focus: "#resolve-note" });

    modalCard.querySelector('[data-action="resolve-go"]').addEventListener("click", async () => {
      const note = modalCard.querySelector("#resolve-note").value.trim();
      try {
        const r = await fetch(`/api/engagements/${encodeURIComponent(eid)}/open-items/${encodeURIComponent(itemId)}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution_note: note }),
        });
        if (!r.ok) throw new Error(await r.text());
        closeModal();
        render();
      } catch (err) {
        modalCard.querySelector("#resolve-msg").innerHTML =
          `<div class="modal-error">${escapeHtml(String(err.message || err))}</div>`;
      }
    });
  }

  // ============================================================================
  // Settings page (SPA route /settings) — two-pane: inner sidebar + content
  // ============================================================================
  const SETTINGS_SECTIONS = [
    { id: "settings", label: "Settings", group: "Sections" },
    { id: "usage",    label: "Usage",    group: "Sections" },
  ];

  function _settingsSectionFromHash() {
    const h = (window.location.hash || "").replace(/^#/, "");
    return SETTINGS_SECTIONS.find(s => s.id === h)?.id || "settings";
  }

  async function renderSettingsView(root) {
    const active = _settingsSectionFromHash();
    root.innerHTML = `
      <div class="settings-page">
        <nav class="settings-nav" aria-label="Settings sections">
          <div class="settings-nav-group">
            <div class="settings-nav-label">Sections</div>
            ${SETTINGS_SECTIONS.map(s => `
              <a class="settings-nav-item ${s.id === active ? "active" : ""}"
                 href="#${s.id}" data-section="${s.id}">${escapeHtml(s.label)}</a>
            `).join("")}
          </div>
        </nav>
        <div class="settings-content" id="settings-content"></div>
      </div>
    `;
    const content = root.querySelector("#settings-content");
    _renderSettingsSection(content, active);

    // Inner-sidebar nav: intercept clicks so we don't reload the page,
    // update the hash, and re-render the right pane.
    root.querySelectorAll(".settings-nav-item").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const id = a.dataset.section;
        if (!id) return;
        history.replaceState({}, "", `/settings#${id}`);
        root.querySelectorAll(".settings-nav-item").forEach(x =>
          x.classList.toggle("active", x.dataset.section === id));
        _renderSettingsSection(content, id);
      });
    });
  }

  function _renderSettingsSection(content, section) {
    if (section === "usage") return _renderUsageSection(content);
    return _renderAccountSection(content);
  }

  function _renderAccountSection(root) {
    const me = currentUser?.user || null;
    const flags = currentUser || {};
    root.innerHTML = `
      <div class="settings-eyebrow">Account</div>
      <h1>Settings</h1>

      <section class="settings-section">
        <h2>Account</h2>
        ${me ? `
          <div class="settings-flag-row"><span class="flag-name">Username</span><span class="flag-value">${escapeHtml(me.username || me.name)}</span></div>
          <div class="settings-flag-row"><span class="flag-name">Email</span><span class="flag-value">${escapeHtml(me.email || "—")}</span></div>
          <div class="settings-flag-row"><span class="flag-name">Role</span><span class="flag-value">${me.is_admin ? "admin" : "user"}</span></div>
          <p style="margin-top:14px"><button id="open-pw-change" class="modal-btn modal-btn-primary">Change password…</button></p>
        ` : `<p class="muted">Not signed in.</p>`}
      </section>

      <section class="settings-section">
        <h2>Server flags</h2>
        <p class="muted" style="font-size:12px;margin-bottom:8px">Read-only — controlled by environment variables on the server.</p>
        <div class="settings-flag-row">
          <span class="flag-name">WEBUI_REQUIRE_AUTH</span>
          <span class="flag-value ${flags.require_auth ? "on" : "off"}">${flags.require_auth ? "true" : "false"}</span>
        </div>
        <div class="settings-flag-row">
          <span class="flag-name">WEBUI_ENABLE_SIGNUP</span>
          <span class="flag-value ${flags.enable_signup ? "on" : "off"}">${flags.enable_signup ? "true" : "false"}</span>
        </div>
      </section>
    `;
    root.querySelector("#open-pw-change")?.addEventListener("click", openPasswordChangeModal);
  }

  // ---- Usage section -------------------------------------------------------
  // Pulls /api/me/token-usage and renders summary cards + a grouped breakdown.

  const USAGE_RANGES = [
    { id: "7d",  label: "Last 7 days",  days: 7  },
    { id: "30d", label: "Last 30 days", days: 30 },
    { id: "90d", label: "Last 90 days", days: 90 },
    { id: "all", label: "All time",     days: null },
  ];
  const USAGE_GROUPINGS = [
    { id: "project", label: "Project" },
    { id: "agent",   label: "Agent" },
    { id: "model",   label: "Model" },
    { id: "day",     label: "Day" },
    { id: "step",    label: "Step" },
  ];
  let _usageState = { range: "30d", groupBy: "project" };

  function _renderUsageSection(root) {
    root.innerHTML = `
      <div class="settings-eyebrow">Telemetry</div>
      <h1>Usage</h1>
      <p class="muted" style="font-size:13px;margin-bottom:4px">
        LLM token usage across your projects, captured per agent on every model call.
      </p>

      <div class="usage-controls">
        <label>Range
          <select id="usage-range">
            ${USAGE_RANGES.map(r => `<option value="${r.id}" ${r.id === _usageState.range ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}
          </select>
        </label>
        <label>Group by
          <select id="usage-group">
            ${USAGE_GROUPINGS.map(g => `<option value="${g.id}" ${g.id === _usageState.groupBy ? "selected" : ""}>${escapeHtml(g.label)}</option>`).join("")}
          </select>
        </label>
      </div>

      <div id="usage-body"><p class="usage-empty">Loading…</p></div>
    `;
    const rangeSel = root.querySelector("#usage-range");
    const groupSel = root.querySelector("#usage-group");
    rangeSel.addEventListener("change", () => { _usageState.range = rangeSel.value; _loadUsage(root); });
    groupSel.addEventListener("change", () => { _usageState.groupBy = groupSel.value; _loadUsage(root); });
    _loadUsage(root);
  }

  async function _loadUsage(root) {
    const body = root.querySelector("#usage-body");
    const range = USAGE_RANGES.find(r => r.id === _usageState.range) || USAGE_RANGES[1];
    const since = range.days == null ? null
      : new Date(Date.now() - range.days * 86400 * 1000).toISOString();
    const params = new URLSearchParams({ group_by: _usageState.groupBy });
    if (since) params.set("since", since);
    try {
      const r = await fetch(`/api/me/token-usage?${params}`, { headers: { "Accept": "application/json" } });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      _renderUsageBody(body, data);
    } catch (err) {
      body.innerHTML = `<div class="usage-error">Could not load usage — ${escapeHtml(String(err.message || err))}</div>`;
    }
  }

  function _formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
    return String(n);
  }

  function _renderUsageBody(body, data) {
    const totals = data?.totals || { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, total_tokens: 0, calls: 0 };
    const rows = data?.rows || [];
    const projectCount = data?.project_count ?? null;

    const summaryHtml = `
      <div class="usage-summary">
        <div class="usage-card">
          <div class="label">Total tokens</div>
          <div class="value">${_formatTokens(totals.total_tokens)}</div>
          <div class="sub">${totals.calls.toLocaleString()} LLM calls${projectCount !== null ? ` · ${projectCount} project${projectCount === 1 ? "" : "s"}` : ""}</div>
        </div>
        <div class="usage-card">
          <div class="label">Input</div>
          <div class="value">${_formatTokens(totals.input_tokens)}</div>
          <div class="sub">${totals.cached_input_tokens > 0 ? `cached ${_formatTokens(totals.cached_input_tokens)}` : "no cached hits"}</div>
        </div>
        <div class="usage-card">
          <div class="label">Output</div>
          <div class="value">${_formatTokens(totals.output_tokens)}</div>
          <div class="sub">&nbsp;</div>
        </div>
      </div>
    `;

    if (!rows.length) {
      body.innerHTML = `
        ${summaryHtml}
        <div class="usage-breakdown">
          <div class="usage-empty">No telemetry recorded yet for the selected range.</div>
        </div>
      `;
      return;
    }

    const maxTotal = Math.max(1, ...rows.map(r => r.total_tokens));
    const breakdownHtml = `
      <div class="usage-breakdown">
        <h3>By ${escapeHtml(USAGE_GROUPINGS.find(g => g.id === _usageState.groupBy)?.label || _usageState.groupBy)}</h3>
        ${rows.map(r => {
          const pct = Math.max(2, Math.round(r.total_tokens / maxTotal * 100));
          const display = r.label ? r.label : r.key;
          return `
            <div class="usage-row">
              <div class="key" title="${escapeHtml(r.key)}">${escapeHtml(display)}</div>
              <div class="bar-wrap"><div class="bar" style="width: ${pct}%"></div></div>
              <div class="total">${_formatTokens(r.total_tokens)}<span class="calls">· ${r.calls}</span></div>
            </div>
          `;
        }).join("")}
      </div>
    `;
    body.innerHTML = summaryHtml + breakdownHtml;
  }

  function openPasswordChangeModal() {
    openModal(`
      <h2>Change password</h2>
      <div class="modal-body">
        <div class="modal-field">
          <label for="pw-old">Current password</label>
          <input id="pw-old" type="password" autocomplete="current-password">
        </div>
        <div class="modal-field">
          <label for="pw-new">New password</label>
          <input id="pw-new" type="password" autocomplete="new-password">
        </div>
        <div class="modal-field">
          <label for="pw-new2">Confirm new password</label>
          <input id="pw-new2" type="password" autocomplete="new-password">
        </div>
        <div id="pw-msg"></div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-secondary" data-modal-close>Cancel</button>
        <button class="modal-btn modal-btn-primary" data-action="pw-go">Change password</button>
      </div>
    `, { focus: "#pw-old" });

    modalCard.querySelector('[data-action="pw-go"]').addEventListener("click", async () => {
      const old_password = modalCard.querySelector("#pw-old").value;
      const new_password = modalCard.querySelector("#pw-new").value;
      const confirm_pw = modalCard.querySelector("#pw-new2").value;
      const msg = modalCard.querySelector("#pw-msg");
      if (!old_password || !new_password) { msg.innerHTML = `<div class="modal-error">Both fields required.</div>`; return; }
      if (new_password !== confirm_pw) { msg.innerHTML = `<div class="modal-error">New passwords don't match.</div>`; return; }
      try {
        const r = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ old_password, new_password }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
        msg.innerHTML = `<div class="modal-success">Password updated — signing you out.</div>`;
        setTimeout(() => window.location.href = d.redirect || "/login", 800);
      } catch (err) {
        msg.innerHTML = `<div class="modal-error">${escapeHtml(String(err.message || err))}</div>`;
      }
    });
  }

  // ============================================================================
  // Chat panel — wired to /api/chat/{message,stream/{session_id}}
  // ============================================================================
  let chatSessionId = null;
  let chatEventSource = null;
  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");

  // Chat history is persisted per project in localStorage. The session id is
  // derived deterministically from the active project — `chat-<engagement_id>`
  // for a project context, `chat-global` when no project is active. Each
  // project's log lives at `solace-architect-chat-log:chat-<eid>`; loading is
  // explicit (user clicks "Load history") so visiting a project doesn't dump
  // stale conversation in the user's face.
  const CHAT_HISTORY_KEY = (sid) => `solace-architect-chat-log:${sid}`;
  function deriveChatSessionId() {
    return "chat-" + (currentProjectId() || "global");
  }
  function loadChatHistory(sid) {
    try { return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY(sid)) || "[]"); }
    catch { return []; }
  }
  function saveChatHistory(sid, messages) {
    try { localStorage.setItem(CHAT_HISTORY_KEY(sid), JSON.stringify(messages.slice(-500))); }
    catch { /* quota / private mode — silently skip */ }
  }
  function hasChatHistory(sid) {
    return loadChatHistory(sid).length > 0;
  }

  // Render agent text as sanitized HTML (markdown parsed by marked,
  // sanitized by DOMPurify). User text stays as textContent — we have
  // no reason to render markdown of the user's own input, and it
  // sidesteps any HTML they might paste.
  function renderAgentMarkdown(el, text) {
    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      // Libraries didn't load (offline, blocked CDN, etc.) — degrade
      // gracefully to plain text.
      el.textContent = text;
      return;
    }
    try {
      const html = marked.parse(text, { breaks: true, gfm: true });
      el.innerHTML = DOMPurify.sanitize(html);
    } catch (err) {
      el.textContent = text;
    }
  }

  function appendChatMessage(role, text, opts = {}) {
    const empty = chatLog.querySelector(".chat-empty");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = `chat-msg ${role}`;
    if (role === "agent") {
      renderAgentMarkdown(div, text);
    } else {
      div.textContent = text;
    }
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
    if (!opts.skipPersist && chatSessionId) {
      const log = loadChatHistory(chatSessionId);
      log.push({ role, text, ts: Date.now() });
      saveChatHistory(chatSessionId, log);
      updateLoadHistoryButton?.();
    }
  }

  // Switch the chat panel to the project context derived from the current URL.
  // No auto-rehydrate; the user clicks "Load history" if they want the
  // previous conversation for this project back.
  let chatProjectContext = null;
  function syncChatProjectContext() {
    const nextSid = deriveChatSessionId();
    if (chatSessionId === nextSid) {
      updateLoadHistoryButton();
      return;
    }
    if (chatEventSource) { chatEventSource.close(); chatEventSource = null; }
    chatSessionId = nextSid;
    chatProjectContext = currentProjectId() || null;
    chatLog.innerHTML = `
      <div class="chat-empty">
        <p>Conversational interaction with any agent on the SAM mesh.</p>
        <p class="muted">${chatProjectContext
          ? `Chat is scoped to <code>${escapeHtml(chatProjectContext)}</code>. ` +
            `Click <strong>Load history</strong> above to restore previous messages, or just type to start a fresh thread.`
          : `No project active — pick one from the sidebar to scope the chat, or talk to any mesh agent directly.`}
        </p>
      </div>`;
    updateLoadHistoryButton();
  }

  function updateLoadHistoryButton() {
    const btn = document.getElementById("chat-load-history");
    if (!btn) return;
    btn.disabled = !hasChatHistory(chatSessionId);
    btn.title = btn.disabled
      ? "No saved conversation for this context yet."
      : "Load previous conversation for this project";
  }

  function loadHistoryForCurrentContext() {
    if (!chatSessionId) return;
    chatLog.querySelector(".chat-empty")?.remove();
    const log = loadChatHistory(chatSessionId);
    log.forEach(m => appendChatMessage(m.role, m.text, { skipPersist: true }));
    if (!chatEventSource) openSseStream(chatSessionId);
  }
  document.getElementById("chat-load-history")?.addEventListener("click", loadHistoryForCurrentContext);

  // Pull user-visible text out of an A2A event. Walks status.message.parts
  // and any Task-level artifacts; ignores non-text parts (DataPart/FilePart
  // are tool-call internals, not chat content).
  function extractAgentText(ev) {
    const data = ev?.data || {};
    const parts = [];
    const msgParts = data.status?.message?.parts;
    if (Array.isArray(msgParts)) parts.push(...msgParts);
    if (Array.isArray(data.artifacts)) {
      for (const a of data.artifacts) {
        if (Array.isArray(a.parts)) parts.push(...a.parts);
      }
    }
    return parts
      .filter(p => p && (p.kind === "text" || p.type === "text") && (p.text || ""))
      .map(p => p.text)
      .join("\n")
      .trim();
  }

  // While the agent is "thinking", we paint a single live message bubble and
  // update its text as each TaskStatusUpdateEvent arrives. When the
  // FinalResponse lands we finalize it (and persist to localStorage).
  let pendingAgentMsg = null;     // { el, lastText }

  // While streaming, hide the raw ```question JSON block behind a
  // "preparing form…" placeholder. We can't safely partial-parse the
  // JSON yet; the form materializes on finalizeAgentBubble.
  function maskQuestionBlockDuringStream(text) {
    const idx = text.indexOf("```question");
    if (idx === -1) return text;
    const preamble = text.slice(0, idx).trimEnd();
    return preamble + (preamble ? "\n\n" : "") + "📝 Preparing question…";
  }

  function startOrUpdateAgentBubble(text) {
    if (!text) return;
    chatLog.querySelector(".chat-empty")?.remove();
    const display = maskQuestionBlockDuringStream(text);
    if (!pendingAgentMsg) {
      const div = document.createElement("div");
      div.className = "chat-msg agent agent-thinking";
      renderAgentMarkdown(div, display);
      chatLog.appendChild(div);
      pendingAgentMsg = { el: div, lastText: text };
    } else if (text !== pendingAgentMsg.lastText) {
      renderAgentMarkdown(pendingAgentMsg.el, display);
      pendingAgentMsg.lastText = text;
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // Extract ```question { ... } ``` blocks from an agent message; return the
  // text with those blocks stripped, plus the parsed schemas. See
  // solace_architect_core.tools.interaction_tools.ask_user_question — the
  // agent echoes that tool's schema as a fenced block, the frontend renders
  // it as an interactive form card.
  function parseQuestionBlocks(text) {
    if (!text || text.indexOf("```question") === -1) {
      return { cleanText: text, blocks: [] };
    }
    const re = /```question\s*\n([\s\S]*?)\n```/g;
    const blocks = [];
    let cleanText = text;
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const schema = JSON.parse(m[1]);
        if (schema && typeof schema === "object" && schema.id && schema.kind) {
          blocks.push(schema);
          cleanText = cleanText.replace(m[0], "").trim();
        }
      } catch (err) {
        // Malformed JSON inside the block — leave it visible so the user sees the error.
      }
    }
    return { cleanText, blocks };
  }

  function finalizeAgentBubble(finalText) {
    const text = (finalText || pendingAgentMsg?.lastText || "").trim();
    const { cleanText, blocks } = parseQuestionBlocks(text);

    if (pendingAgentMsg) {
      pendingAgentMsg.el.classList.remove("agent-thinking");
      if (cleanText) renderAgentMarkdown(pendingAgentMsg.el, cleanText);
      else pendingAgentMsg.el.remove();
      pendingAgentMsg = null;
    } else if (cleanText) {
      // No bubble was opened (no status updates seen) — render the final reply.
      appendChatMessage("agent", cleanText);
    }

    // Render each question schema as an interactive form card after the text.
    for (const schema of blocks) {
      const card = renderQuestionCard(schema);
      chatLog.appendChild(card);
    }
    if (blocks.length) chatLog.scrollTop = chatLog.scrollHeight;

    // Persist the final text to history (forms are not persisted — on reload
    // the user sees the cleanText only, which is intentional: the form is
    // single-use; the answer they gave appears as their own message).
    if (text && chatSessionId) {
      const log = loadChatHistory(chatSessionId);
      log.push({ role: "agent", text: cleanText || "[question card]", ts: Date.now() });
      saveChatHistory(chatSessionId, log);
      updateLoadHistoryButton?.();
    }
  }

  // Build an interactive form card for one question schema. Submits the
  // user's answer via the same /api/chat/message endpoint as plain text,
  // but with a `data` payload (DataPart) so the agent receives a
  // machine-readable reply.
  function renderQuestionCard(schema) {
    const card = document.createElement("div");
    card.className = `chat-msg agent question-card severity-${schema.severity || "blocking"}`;
    card.dataset.questionId = schema.id;

    // Header: severity badge + optional counter
    const header = document.createElement("div");
    header.className = "question-header";
    const badge = document.createElement("span");
    badge.className = `question-badge ${schema.severity || "blocking"}`;
    badge.textContent = (schema.severity || "blocking").toUpperCase();
    header.appendChild(badge);
    if (schema.counter) {
      const counter = document.createElement("span");
      counter.className = "question-counter";
      counter.textContent = schema.counter;
      header.appendChild(counter);
    }
    card.appendChild(header);

    // Question
    const qEl = document.createElement("div");
    qEl.className = "question-text";
    qEl.textContent = schema.question;
    card.appendChild(qEl);

    // Context (1-2 sentence "why this matters")
    if (schema.context) {
      const ctx = document.createElement("div");
      ctx.className = "question-context";
      ctx.textContent = schema.context;
      card.appendChild(ctx);
    }

    // Recommended callout (single_choice only)
    if (schema.recommended && schema.kind === "single_choice") {
      const rec = (schema.options || []).find(o => o.id === schema.recommended);
      if (rec) {
        const callout = document.createElement("div");
        callout.className = "question-recommended";
        callout.innerHTML = `<strong>★ Recommended:</strong> ${esc(rec.label)}`;
        card.appendChild(callout);
      }
    }

    // Widget per kind
    const form = document.createElement("form");
    form.className = "question-form";
    let getAnswer = () => null;

    // getNote() returns the user-typed caveat string (or null). Defaulted
    // here; renderNoteSection() (below) sets it for kinds that include a
    // note toggle. The note is sent on the DataPart reply alongside the
    // structured answer so the agent can capture caveats verbatim.
    let getNote = () => null;

    if (schema.kind === "yes_no") {
      const wrap = document.createElement("div");
      wrap.className = "question-yesno";
      ["yes", "no"].forEach(v => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "question-yesno-btn";
        btn.dataset.value = v;
        btn.textContent = v === "yes" ? "Yes" : "No";
        btn.addEventListener("click", () => {
          const note = getNote();
          const display = note ? `${btn.textContent} — ${note}` : btn.textContent;
          submitAnswer(schema, v, display, card, note);
        });
        wrap.appendChild(btn);
      });
      form.appendChild(wrap);
    } else if (schema.kind === "single_choice") {
      // Pre-select the recommended option (or the first option if none
      // is recommended). Pre-selecting *something* is better than leaving
      // the form un-submittable, but using the recommended id means a
      // Submit-without-change matches the agent's recommendation rather
      // than always option A.
      const defaultId = schema.recommended || (schema.options?.[0]?.id ?? null);
      (schema.options || []).forEach(opt => {
        const row = document.createElement("label");
        row.className = "question-opt-row";
        if (opt.id === schema.recommended) row.classList.add("recommended");
        const checked = opt.id === defaultId ? "checked" : "";
        row.innerHTML = `
          <input type="radio" name="opt-${schema.id}" value="${esc(opt.id)}" ${checked}>
          <div class="question-opt-body">
            <div class="question-opt-label">${opt.id === schema.recommended ? "★ " : ""}<strong>${esc(opt.label)}</strong></div>
            ${opt.pros ? `<div class="question-opt-pros"><em>Pros:</em> ${esc(opt.pros)}</div>` : ""}
            ${opt.cons ? `<div class="question-opt-cons"><em>Cons:</em> ${esc(opt.cons)}</div>` : ""}
          </div>`;
        form.appendChild(row);
      });
      getAnswer = () => {
        const checked = form.querySelector(`input[name="opt-${schema.id}"]:checked`);
        if (!checked) return null;
        const opt = (schema.options || []).find(o => o.id === checked.value);
        return { id: checked.value, label: opt ? opt.label : checked.value };
      };
    } else if (schema.kind === "multi_choice") {
      (schema.options || []).forEach(opt => {
        const row = document.createElement("label");
        row.className = "question-opt-row";
        row.innerHTML = `
          <input type="checkbox" name="opt-${schema.id}" value="${esc(opt.id)}">
          <div class="question-opt-body"><strong>${esc(opt.label)}</strong></div>`;
        form.appendChild(row);
      });
      getAnswer = () => {
        const checked = Array.from(form.querySelectorAll(`input[name="opt-${schema.id}"]:checked`));
        if (!checked.length) return null;
        const ids = checked.map(c => c.value);
        const labels = ids.map(id => {
          const opt = (schema.options || []).find(o => o.id === id);
          return opt ? opt.label : id;
        });
        return { ids, labels };
      };
    } else if (schema.kind === "free_text") {
      const input = document.createElement("textarea");
      input.className = "question-free-input";
      input.rows = 3;
      if (schema.placeholder) input.placeholder = schema.placeholder;
      form.appendChild(input);
      if (schema.example) {
        const ex = document.createElement("div");
        ex.className = "question-example";
        ex.innerHTML = `<em>Example:</em> <code>${esc(schema.example)}</code>`;
        form.appendChild(ex);
      }
      getAnswer = () => {
        const v = input.value.trim();
        return v ? { text: v } : null;
      };
    }

    // Optional note ("+ Add a note") — applies to all kinds except
    // free_text (where the input itself is already a textarea, so a
    // second note field would be redundant). Hidden behind a toggle so
    // the card stays uncluttered for the common case where the user
    // just picks an option.
    if (schema.kind !== "free_text") {
      getNote = renderNoteSection(form);
    }

    // Submit row (free_text + radio/checkbox need an explicit submit;
    // yes_no submits on click).
    if (schema.kind !== "yes_no") {
      const submitRow = document.createElement("div");
      submitRow.className = "question-submit-row";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "cta-btn question-submit";
      submit.textContent = "Submit answer";
      submitRow.appendChild(submit);
      form.appendChild(submitRow);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const answer = getAnswer();
        if (answer === null) return;  // nothing selected
        const note = getNote();
        const baseDisplay = formatAnswerForDisplay(schema, answer);
        const display = note ? `${baseDisplay} — ${note}` : baseDisplay;
        submitAnswer(schema, answer, display, card, note);
      });
    }

    card.appendChild(form);

    // "…or type a custom answer" escape hatch — collapses the form,
    // re-enables the chat input for free-text reply. The chatForm
    // submit handler picks up `pendingDeferredQuestion` and attaches
    // the question_id to the outgoing message so the agent knows which
    // question the free-text answer refers to.
    //
    // Skip for free_text: the textarea IS already a free-text input,
    // so adding a "type a custom answer" link is redundant and confusing.
    if (schema.allow_custom !== false && schema.kind !== "free_text") {
      const custom = document.createElement("button");
      custom.type = "button";
      custom.className = "question-custom-link";
      custom.textContent = "…or type a custom answer";
      custom.addEventListener("click", () => {
        card.classList.add("question-deferred");
        Array.from(card.querySelectorAll("input, button, textarea")).forEach(el => el.disabled = true);
        pendingDeferredQuestion = { id: schema.id, kind: schema.kind, cardEl: card };
        chatInput?.focus();
        if (chatInput) chatInput.placeholder = `Custom reply to "${schema.id}"…`;
      });
      card.appendChild(custom);
    }

    return card;
  }

  // Set when the user clicks "…or type a custom answer" on a form
  // card. The next chatForm submit attaches this as DataPart so the
  // agent receives the free-text answer correlated to the right
  // question. Cleared after one submission.
  let pendingDeferredQuestion = null;

  // Append a "+ Add a note" toggle + collapsed textarea to the form.
  // Returns a getter that reads the textarea value (trimmed, or null if
  // empty / never expanded). Used by single_choice, yes_no, multi_choice
  // — free_text skips this since its own input already accepts free prose.
  function renderNoteSection(form) {
    const wrap = document.createElement("div");
    wrap.className = "question-note-wrap";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "question-note-toggle";
    toggle.textContent = "+ Add a note (optional)";

    const ta = document.createElement("textarea");
    ta.className = "question-note-input";
    ta.rows = 2;
    ta.placeholder = "Add caveats, edge cases, or rationale the agent should record alongside your answer…";
    ta.style.display = "none";

    toggle.addEventListener("click", () => {
      const isOpen = ta.style.display !== "none";
      ta.style.display = isOpen ? "none" : "";
      toggle.textContent = isOpen ? "+ Add a note (optional)" : "– Hide note";
      if (!isOpen) ta.focus();
    });

    wrap.appendChild(toggle);
    wrap.appendChild(ta);
    form.appendChild(wrap);

    return () => {
      const v = ta.value.trim();
      return v || null;
    };
  }

  function formatAnswerForDisplay(schema, answer) {
    if (schema.kind === "yes_no") return answer === "yes" ? "Yes" : "No";
    if (schema.kind === "single_choice") return answer?.label || answer?.id || "(answer)";
    if (schema.kind === "multi_choice") return (answer?.labels || []).join(", ") || "(none)";
    if (schema.kind === "free_text") return answer?.text || "(empty)";
    return String(answer);
  }

  async function submitAnswer(schema, rawAnswer, displayText, cardEl, note = null) {
    if (!chatSessionId) chatSessionId = deriveChatSessionId();
    if (!chatEventSource) openSseStream(chatSessionId);

    // Lock the card so it can't be submitted twice. We unlock on failure
    // below so the user can retry rather than being stranded.
    const lockedInputs = Array.from(cardEl.querySelectorAll("input, button, textarea"));
    cardEl.classList.add("question-answered");
    lockedInputs.forEach(el => el.disabled = true);

    // Show the chosen answer as a user message.
    appendChatMessage("user", displayText);

    const eid = currentProjectId();
    const agent = chatAgentSelect?.value || "";
    const data = { question_id: schema.id, kind: schema.kind, answer: rawAnswer };
    if (note) data.note = note;
    const body = {
      text: displayText,
      data,
      session_id: chatSessionId,
    };
    if (agent) body.agent = agent;
    if (eid) body.engagement_id = eid;

    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      appendChatMessage("agent", "[error] could not submit answer: " + err.message + " — please retry");
      // Re-enable so the user can retry; previous user-bubble stays in
      // history but a fresh click POSTs again with the same payload.
      cardEl.classList.remove("question-answered");
      lockedInputs.forEach(el => el.disabled = false);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function openSseStream(sessionId) {
    if (chatEventSource) chatEventSource.close();
    chatEventSource = new EventSource(`/api/chat/stream/${encodeURIComponent(sessionId)}`);
    chatEventSource.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "TaskStatusUpdateEvent") {
          const text = extractAgentText(ev);
          if (text) startOrUpdateAgentBubble(text);
        } else if (ev.type === "FinalResponse" || ev.type === "Task") {
          finalizeAgentBubble(extractAgentText(ev));
        } else if (ev.type === "Error") {
          const msg = ev.data?.message || ev.data?.error || "(error)";
          if (pendingAgentMsg) {
            pendingAgentMsg.el.classList.remove("agent-thinking");
            pendingAgentMsg.el.classList.add("agent-error");
            pendingAgentMsg.el.textContent = `[error] ${msg}`;
            pendingAgentMsg = null;
          } else {
            appendChatMessage("agent", `[error] ${msg}`);
          }
        }
      } catch (err) { /* ignore malformed */ }
    };
    chatEventSource.addEventListener("complete", () => chatEventSource.close());
  }

  const chatAgentSelect = document.getElementById("chat-agent-select");

  async function loadAgents() {
    if (!chatAgentSelect) return;
    // Preserve whatever the user picked so the 15s re-poll doesn't snap the
    // selection back to the configured default.
    const previousChoice = chatAgentSelect.value || "";
    try {
      const r = await fetch("/api/agents");
      const d = await r.json();
      const agents = d.agents || [];
      const defaultName = d.default || "";
      if (!agents.length) {
        chatAgentSelect.innerHTML = `<option value="">${escapeHtml(defaultName || "(no agents discovered)")}</option>`;
        return;
      }
      const names = new Set(agents.map(a => a.name));
      // Resolve which agent should end up selected: user's prior pick wins if
      // still on the mesh; otherwise fall back to the configured default.
      const desired = (previousChoice && names.has(previousChoice))
        ? previousChoice
        : defaultName;
      chatAgentSelect.innerHTML = agents.map(a =>
        `<option value="${escapeHtml(a.name)}"${a.name === desired ? " selected" : ""}>${escapeHtml(a.name)}</option>`
      ).join("");
      if (desired) chatAgentSelect.value = desired;
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

  // Enter submits, Shift+Enter inserts a newline (chat-app convention).
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (typeof chatForm.requestSubmit === "function") chatForm.requestSubmit();
      else chatForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    const eid = currentProjectId();
    const agent = chatAgentSelect?.value || "";

    // Ensure the per-project sessionId is current and the SSE stream is live.
    if (!chatSessionId) chatSessionId = deriveChatSessionId();
    if (!chatEventSource) openSseStream(chatSessionId);

    appendChatMessage("user", text);
    chatInput.value = "";

    const body = { text, session_id: chatSessionId };
    if (agent) body.agent = agent;
    if (eid) body.engagement_id = eid;
    // If the user deferred a question via "…type a custom answer", tag
    // this message so the agent can correlate the free-text reply to
    // the question that asked it.
    if (pendingDeferredQuestion) {
      body.data = {
        question_id: pendingDeferredQuestion.id,
        kind: pendingDeferredQuestion.kind,
        answer: { text, custom: true },
      };
      pendingDeferredQuestion = null;
      if (chatInput) chatInput.placeholder = "";
    }

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
  window.__resolveItem = (eid, itemId, desc) => openResolveItemModal(eid, itemId, desc || "");
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
    await render();        // render() calls syncChatProjectContext()
  })();
})();

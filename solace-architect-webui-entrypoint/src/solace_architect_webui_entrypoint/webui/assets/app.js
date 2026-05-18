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

  // Auto-refresh timer for the Progress view. Cleared on every render()
  // and re-armed by VIEWS.overview at the end of its render. Pauses
  // when the tab is hidden so we don't burn cycles in background tabs.
  let progressRefreshTimer = null;
  const PROGRESS_REFRESH_MS = 10000;

  function clearProgressAutoRefresh() {
    if (progressRefreshTimer) {
      clearInterval(progressRefreshTimer);
      progressRefreshTimer = null;
    }
  }

  function armProgressAutoRefresh(eid) {
    clearProgressAutoRefresh();
    progressRefreshTimer = setInterval(() => {
      // Skip the tick while tab is hidden — picks up on visibility return.
      if (document.hidden) return;
      // Skip if we navigated away while the timer was queued.
      if (currentView() !== "overview" || currentProjectId() !== eid) {
        clearProgressAutoRefresh();
        return;
      }
      // Silent re-render — same VIEWS.overview, fetches fresh data.
      const content = document.getElementById("content");
      if (content) VIEWS.overview(content, eid);
      // Also refresh the sticky chat lifecycle bar so it tracks state.
      refreshLifecycleBar();
    }, PROGRESS_REFRESH_MS);
  }

  // Separate lighter-weight refresh timer for the chat lifecycle bar
  // that runs on ANY view (not just Progress) so the bar stays current
  // while the user is on Requirements, Decisions, etc. Slower cadence
  // since it's just one indicator strip.
  let lifecycleBarTimer = null;
  function armLifecycleBarRefresh() {
    if (lifecycleBarTimer) clearInterval(lifecycleBarTimer);
    lifecycleBarTimer = setInterval(() => {
      if (document.hidden) return;
      if (!currentProjectId()) return;
      // Skip if Progress is already polling — its tick covers the bar.
      if (currentView() === "overview" && progressRefreshTimer) return;
      refreshLifecycleBar();
    }, 15000);
  }

  // Catch visibility-return so the user sees fresh state the moment
  // they switch back to the tab, not 10s later.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && progressRefreshTimer) {
      const content = document.getElementById("content");
      const eid = currentProjectId();
      if (content && eid && currentView() === "overview") VIEWS.overview(content, eid);
    }
  });

  async function render() {
    clearProgressAutoRefresh();  // any navigation cancels the timer
    const path = currentPath();
    const content = document.getElementById("content");
    const projectNav = document.getElementById("project-nav");

    renderSidebarProjects();
    // Lifecycle bar reflects current path's project on every render.
    refreshLifecycleBar();
    if (!lifecycleBarTimer) armLifecycleBarRefresh();

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

        // Same for Design — driven by SADomainAgent's set_step_status calls.
        const designStatus = lifecycle?.steps?.design?.status || "NOT_STARTED";
        const designNote = lifecycle?.steps?.design?.note || "";
        const designDone = designStatus === "DONE" || designStatus === "DONE_WITH_CONCERNS";
        // Any artifact under a Domain scope folder means design is mid-flow.
        const designScopes = ["topic-design","broker-select","protocol-select","integration","mesh-design","ha-dr","sam-design","event-portal","migration"];
        const hasDesignArtifact = artifacts.some(a => designScopes.some(s => a.startsWith(s + "/")));
        const designInProgress = !designDone && (hasDesignArtifact || designStatus === "NEEDS_CONTEXT");

        // Active step on the lifecycle banner.
        const activeStepId = designDone ? "review"
          : (designInProgress || discoveryDone) ? "design"
          : (discoveryInProgress || hasIntake) ? "discovery"
          : "intake";
        const completedSteps = new Set();
        if (hasIntake) completedSteps.add("intake");
        if (discoveryDone) completedSteps.add("discovery");
        if (designDone) completedSteps.add("design");

        // One contextual CTA, always shown — content depends on lifecycle state.
        const cta = renderProgressCta({
          eid, hasIntake, discoveryStatus, discoveryNote,
          discoveryInProgress, openItemsCount,
          designStatus, designNote, designDone, designInProgress,
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
        // Self-refresh every PROGRESS_REFRESH_MS so the banner / CTA /
        // tiles update without a manual reload while the user watches
        // discovery / design / etc complete in chat.
        armProgressAutoRefresh(eid);
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

      if (!names.length) {
        root.innerHTML = `<div class="welcome"><h1>Artifacts</h1><p>No artifacts yet. They'll appear here as agents complete their steps.</p></div>`;
        return;
      }

      // Group files by their top-level folder (discovery / meta / design /
      // …). Files with no folder go under "other".
      const groups = {};
      for (const n of names) {
        const slash = n.indexOf("/");
        const cat = slash > 0 ? n.slice(0, slash) : "other";
        (groups[cat] ||= []).push(n);
      }
      const cats = Object.keys(groups).sort();
      const total = names.length;

      // By-category counts for the summary bar chart. Find the max so we
      // can normalise bar widths.
      const counts = cats.map(c => ({ cat: c, n: groups[c].length }));
      const maxN = Math.max(...counts.map(c => c.n));

      root.innerHTML = `
        <div class="artifacts-page">
          <div class="artifacts-main">
            <div class="artifacts-eyebrow">${total} FILE${total === 1 ? "" : "S"}</div>
            <h1>Artifacts</h1>

            <div class="artifacts-summary">
              <div class="artifacts-summary-row">
                <div class="artifacts-count-tile">
                  <div class="artifacts-count-eyebrow">TOTAL</div>
                  <div class="artifacts-count-number">${total}</div>
                  <div class="artifacts-count-label">file${total === 1 ? "" : "s"}</div>
                </div>
                <div class="artifacts-bars">
                  <div class="artifacts-bars-title">By category</div>
                  ${counts.map(c => `
                    <div class="artifacts-bar-row">
                      <div class="artifacts-bar-label">${escapeHtml(c.cat)}</div>
                      <div class="artifacts-bar-track">
                        <div class="artifacts-bar-fill" style="width: ${(c.n / maxN * 100).toFixed(1)}%"></div>
                      </div>
                      <div class="artifacts-bar-count">${c.n}</div>
                    </div>
                  `).join("")}
                </div>
              </div>
            </div>

            <div id="art-view" class="artifacts-viewer">
              <p class="artifacts-viewer-hint">Select a file from the sidebar to view its contents.</p>
            </div>
          </div>

          <aside class="artifacts-rail">
            <div class="artifacts-rail-title">FILES</div>
            ${cats.map(c => `
              <div class="artifacts-rail-group">
                <div class="artifacts-rail-group-title">${escapeHtml(c.toUpperCase())}</div>
                ${groups[c].map(n => {
                  const fname = n.slice(n.indexOf("/") + 1);
                  return `<a href="#" data-art="${escapeHtml(n)}" class="artifacts-rail-link">${escapeHtml(fname)}</a>`;
                }).join("")}
              </div>
            `).join("")}
          </aside>
        </div>
      `;

      root.querySelectorAll("a[data-art]").forEach(a => {
        a.addEventListener("click", async (e) => {
          e.preventDefault();
          // Highlight the active file in the rail.
          root.querySelectorAll(".artifacts-rail-link").forEach(l => l.classList.remove("active"));
          a.classList.add("active");
          const name = a.dataset.art;
          const view = document.getElementById("art-view");
          view.innerHTML = `<p class="artifacts-viewer-hint">Loading ${escapeHtml(name)}…</p>`;
          try {
            const r = await fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts/${encodeURIComponent(name)}`);
            const c = await r.text();
            view.innerHTML = renderArtifactContent(name, c);
          } catch (err) {
            view.innerHTML = `<p class="artifacts-viewer-hint">Could not load: ${escapeHtml(err.message || err)}</p>`;
          }
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

  // Smart per-format renderer for an artifact's content. Used by the
  // Artifacts page viewer.
  //   .md       → marked.js rendered HTML (sanitised via DOMPurify)
  //   .yaml/.yml/.json → monospace block with light syntax coloring (no external lib)
  //   anything else    → preformatted plain text
  function renderArtifactContent(filename, content) {
    const lower = filename.toLowerCase();
    const head = `<h2 class="artifacts-viewer-title">${escapeHtml(filename)}</h2>`;
    let body;
    if (lower.endsWith(".md") && typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
      try {
        const html = marked.parse(content, { breaks: true, gfm: true });
        body = `<div class="artifacts-viewer-md">${DOMPurify.sanitize(html)}</div>`;
      } catch {
        body = `<pre class="artifacts-viewer-pre">${escapeHtml(content)}</pre>`;
      }
    } else if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
      body = `<pre class="artifacts-viewer-pre artifacts-viewer-yaml">${highlightYaml(content)}</pre>`;
    } else if (lower.endsWith(".json")) {
      // Pretty-print if it parses; otherwise show raw.
      let display = content;
      try { display = JSON.stringify(JSON.parse(content), null, 2); } catch {}
      body = `<pre class="artifacts-viewer-pre artifacts-viewer-json">${highlightJson(display)}</pre>`;
    } else {
      body = `<pre class="artifacts-viewer-pre">${escapeHtml(content)}</pre>`;
    }
    return head + body;
  }

  // Minimal YAML tint — keys get accent color, strings stay default,
  // numbers/booleans get a contrast color, comments dim. No tokeniser
  // — just regex over the escaped output, line by line.
  function highlightYaml(content) {
    return content.split("\n").map(line => {
      const esc = escapeHtml(line);
      // Comment lines (whole line)
      if (/^\s*#/.test(esc)) return `<span class="art-yaml-comment">${esc}</span>`;
      // List item marker + key/value
      return esc
        .replace(/(^\s*-?\s*)([A-Za-z_][A-Za-z0-9_-]*)(:)(\s|$)/, (_m, pfx, key, colon, after) =>
          `${pfx}<span class="art-yaml-key">${key}</span><span class="art-yaml-punct">${colon}</span>${after}`)
        .replace(/\b(true|false|null|yes|no)\b/gi, `<span class="art-yaml-bool">$1</span>`)
        .replace(/\b(\d+(?:\.\d+)?)\b/g, `<span class="art-yaml-num">$1</span>`);
    }).join("\n");
  }

  function highlightJson(content) {
    return escapeHtml(content)
      .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, `<span class="art-json-key">$1</span>$2`)
      .replace(/:\s*(&quot;[^&]*?&quot;)/g, `: <span class="art-json-string">$1</span>`)
      .replace(/\b(true|false|null)\b/g, `<span class="art-json-bool">$1</span>`)
      .replace(/:\s*(-?\d+(?:\.\d+)?)/g, `: <span class="art-json-num">$1</span>`);
  }

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
  // States covered (in order — the first matching branch wins):
  //   - no intake               → link to /intake
  //   - Design DONE             → Restart Design (Review CTA placeholder)
  //   - Design in progress      → Continue Design in chat
  //   - Discovery DONE          → Start Design (the canonical handoff)
  //   - Discovery in progress   → Continue Discovery in chat
  //   - Intake exists, idle     → Start Discovery
  function renderProgressCta({
    eid, hasIntake, discoveryStatus, discoveryNote, discoveryInProgress, openItemsCount,
    designStatus, designNote, designDone, designInProgress,
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

    const discoveryDone = discoveryStatus === "DONE" || discoveryStatus === "DONE_WITH_CONCERNS";

    // Design DONE — Review will come next when that agent lands.
    if (designDone) {
      const badge = designStatus === "DONE_WITH_CONCERNS"
        ? `<span class="status-badge advisory">Done with concerns</span>`
        : `<span class="status-badge done">Done</span>`;
      return `
        <div class="progress-cta done" role="region" aria-label="Design complete">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Design → Review</div>
            <h2>Design is complete ${badge}</h2>
            ${designNote ? `<p>${escapeHtml(designNote)}</p>` : ""}
            <p>Next step: <strong>Review</strong>. The reviewer agents
            (architect, developer, ops, security) will audit your design
            artifacts. Review agent isn't wired up yet — for now you can
            inspect the design output on the Artifacts tab.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View design →</a>
            <button id="restart-design-btn" class="cta-btn cta-btn-danger">Restart Design…</button>
          </div>
        </div>`;
    }

    // Design in progress — agent is mid-flow through scopes.
    if (designInProgress) {
      return `
        <div class="progress-cta in-progress" role="region" aria-label="Design in progress">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Design in progress</div>
            <h2>Continue Design in chat</h2>
            <p>SADomainAgent is working through the design scopes.
            ${designNote ? `<em>${escapeHtml(designNote)}</em> ` : ""}
            Open the chat panel and answer the next form — each scope's
            artifact appears on the Artifacts tab as the agent finishes.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
            <button id="restart-design-btn" class="cta-btn cta-btn-danger">Restart Design…</button>
          </div>
        </div>`;
    }

    if (discoveryDone) {
      const badge = discoveryStatus === "DONE_WITH_CONCERNS"
        ? `<span class="status-badge advisory">Done with concerns</span>`
        : `<span class="status-badge done">Done</span>`;
      return `
        <div class="progress-cta done" role="region" aria-label="Discovery complete">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Discovery → Design</div>
            <h2>Discovery is complete ${badge}</h2>
            ${discoveryNote ? `<p>${escapeHtml(discoveryNote)}</p>` : ""}
            <p>Next step: <strong>Design</strong>. SADomainAgent will walk you
            through the nine design scopes (topic taxonomy, broker selection,
            protocols, integration, mesh, HA/DR, SAM, event-portal, migration),
            confirming each decision with you as an interactive form.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="start-design-btn" class="cta-btn">Start Design →</button>
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
    const openChatWith = (text, agent) => {
      applyChat("open");
      // Flip the chat agent selector before priming so the message
      // dispatches to the right agent (Discovery → Domain on handoff).
      if (agent) {
        const sel = document.getElementById("chat-agent-select");
        if (sel) {
          const opt = Array.from(sel.options).find(o => o.value === agent);
          if (opt) sel.value = agent;
        }
      }
      const ci = document.getElementById("chat-input");
      if (ci) {
        if (text) ci.value = text;
        ci.focus();
        if (text) chatForm.requestSubmit?.();
      }
    };
    root.querySelector("#start-discovery-btn")?.addEventListener("click", () =>
      openChatWith(
        "Let's start discovery — please review the intake and ask your first follow-up.",
        "SADiscoveryAgent"));
    root.querySelector("#continue-in-chat-btn")?.addEventListener("click", () =>
      openChatWith("", null));
    root.querySelector("#start-design-btn")?.addEventListener("click", () =>
      openChatWith(
        "Discovery is complete. Read the discovery brief and walk me through the first design scope (topic taxonomy by default, or ask me which scope to start with).",
        "SADomainAgent"));
    root.querySelector("#restart-discovery-btn")?.addEventListener("click", () =>
      openRestartDiscoveryModal(eid));
    root.querySelector("#restart-design-btn")?.addEventListener("click", () =>
      openRestartDesignModal(eid));
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

  // Restart Design — mirrors Restart Discovery. Wipes every artifact
  // under the nine SADomainAgent scope folders, supersedes any
  // domain-source open-items, and clears the design entry in
  // engagement-status.yaml. Decisions are intentionally preserved
  // (immutable audit trail).
  function openRestartDesignModal(eid) {
    openModal(`
      <div class="modal-section">
        <h2>Restart Design for <code>${escapeHtml(eid)}</code>?</h2>
        <p>This will:</p>
        <ul style="margin: 6px 0 12px 18px; font-size: 13px; line-height: 1.6;">
          <li>delete every artifact under <code>topic-design/</code>,
              <code>broker-select/</code>, <code>protocol-select/</code>,
              <code>integration/</code>, <code>mesh-design/</code>,
              <code>ha-dr/</code>, <code>sam-design/</code>,
              <code>event-portal/</code>, and <code>migration/</code></li>
          <li>mark any open-items recorded by Domain as <code>superseded</code></li>
          <li>clear the Design entry in <code>meta/engagement-status.yaml</code></li>
        </ul>
        <p>Your discovery brief is <strong>not</strong> touched. Recorded
        decisions in <code>meta/decisions.yaml</code> are <strong>preserved</strong>
        as an audit trail — your next design pass can revisit or override them.</p>
        <p style="margin-top: 12px;">Type the project id <code>${escapeHtml(eid)}</code>
        to confirm:</p>
        <input id="restart-design-confirm-input" type="text" autocomplete="off"
               style="width: 100%; padding: 8px 10px; font-family: 'Space Mono', monospace;
                      font-size: 13px; border: 1px solid var(--border); border-radius: 4px;
                      margin-top: 6px;">
        <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;">
          <button class="cta-btn cta-btn-secondary" data-modal-close>Cancel</button>
          <button id="restart-design-confirm-btn" class="cta-btn cta-btn-danger" disabled>Restart Design</button>
        </div>
      </div>`, { focus: "#restart-design-confirm-input" });

    const input = document.getElementById("restart-design-confirm-input");
    const btn = document.getElementById("restart-design-confirm-btn");
    input?.addEventListener("input", () => {
      btn.disabled = input.value.trim() !== eid;
    });
    btn?.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Restarting…";
      try {
        const res = await fetch(`/api/engagements/${encodeURIComponent(eid)}/design`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        closeModal();
        render();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Restart Design";
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
    // Default placeholder while the welcome-card fetch is in flight.
    chatLog.innerHTML = `
      <div class="chat-empty">
        <p>Conversational interaction with any agent on the SAM mesh.</p>
        <p class="muted">${chatProjectContext
          ? `Chat is scoped to <code>${escapeHtml(chatProjectContext)}</code>. Loading state…`
          : `No project active — pick one from the sidebar to scope the chat, or talk to any mesh agent directly.`}
        </p>
      </div>`;
    updateLoadHistoryButton();
    // Project active → fetch state and replace the placeholder with the
    // contextual welcome card. Skipped when there's existing chat history
    // (the user will hit Load history themselves if they want the thread).
    if (chatProjectContext && !hasChatHistory(chatSessionId)) {
      hydrateChatWelcomeCard(chatProjectContext, chatSessionId);
    }
  }

  // Replace the chat-empty placeholder with a state-aware welcome card
  // for the active project. Fetches /lifecycle and /overview to figure
  // out the current step + recommended next action, renders a card with
  // a quick-action button, and primes the chat input on click.
  async function hydrateChatWelcomeCard(eid, sid) {
    let lifecycle = { steps: {} };
    let stats = {};
    let artifacts = [];
    try {
      [lifecycle, stats, artifacts] = await Promise.all([
        fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`).then(r => r.json()).catch(() => ({ steps: {} })),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/overview`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts`).then(r => r.json()).catch(() => []),
      ]);
    } catch { /* fall through to defaults */ }

    // If the user has navigated/typed/loaded history while the fetch was
    // in flight, don't clobber what they're doing.
    if (chatSessionId !== sid) return;
    if (!chatLog.querySelector(".chat-empty")) return;

    const hasIntake = artifacts.includes("discovery/intake.json");
    const discoveryStatus = lifecycle?.steps?.discovery?.status || "NOT_STARTED";
    const discoveryNote = lifecycle?.steps?.discovery?.note || "";
    const discoveryDone = discoveryStatus === "DONE" || discoveryStatus === "DONE_WITH_CONCERNS";
    const hasDiscoveryBrief = artifacts.includes("discovery/discovery-brief.yaml");
    const openItemsCount = (stats.open_items_blocking || 0) + (stats.open_items_advisory || 0);
    const discoveryInProgress = !discoveryDone && (hasDiscoveryBrief || openItemsCount > 0);
    const designStatus = lifecycle?.steps?.design?.status || "NOT_STARTED";
    const designDone = designStatus === "DONE" || designStatus === "DONE_WITH_CONCERNS";

    // Lifecycle steps in order — used to find current + next.
    const steps = [
      { id: "intake",     label: "Intake",        done: hasIntake },
      { id: "discovery",  label: "Discovery",     done: discoveryDone },
      { id: "design",     label: "Design",        done: designDone },
      { id: "review",     label: "Review",        done: false },
      { id: "validation", label: "Validation",    done: false },
      { id: "blueprint",  label: "Blueprint",     done: false },
    ];
    const firstUnfinished = steps.find(s => !s.done);
    const lastDone = [...steps].reverse().find(s => s.done);
    const currentLabel = firstUnfinished ? firstUnfinished.label : "Complete";

    // Decide the primary action button per state. `agent` field tells
    // the click handler which agent to switch the chat dropdown to
    // before priming the message — important on the Discovery → Design
    // handoff so the user doesn't have to flip the dropdown manually.
    let action = null;
    if (!hasIntake) {
      action = { label: "Open intake form →", href: `/intake/edit/${encodeURIComponent(eid)}` };
    } else if (!discoveryDone && !discoveryInProgress) {
      action = {
        label: "Start Discovery →",
        agent: "SADiscoveryAgent",
        prime: "Let's start discovery — please review the intake and ask your first follow-up.",
      };
    } else if (discoveryInProgress) {
      action = { label: "Continue Discovery →", agent: "SADiscoveryAgent", prime: "" };
    } else if (discoveryDone) {
      // Discovery done → next step is Design. Switch to SADomainAgent
      // and prime a kickoff message that asks it to read the brief and
      // walk through the first scope.
      action = {
        label: "Start Design →",
        agent: "SADomainAgent",
        prime: "Discovery is complete. Read the discovery brief and walk me through the first design scope (topic taxonomy by default, or ask me which scope to start with).",
      };
    }

    const noteLine = discoveryNote ? `<p class="welcome-note">${escapeHtml(discoveryNote)}</p>` : "";

    chatLog.innerHTML = `
      <div class="chat-msg agent welcome-card">
        <div class="welcome-eyebrow">${escapeHtml(eid)}</div>
        <div class="welcome-title">Where you are</div>
        <div class="welcome-state-row">
          <div>
            <div class="welcome-state-label">Current step</div>
            <div class="welcome-state-value">${escapeHtml(currentLabel)}</div>
          </div>
          ${lastDone ? `<div>
            <div class="welcome-state-label">Last completed</div>
            <div class="welcome-state-value">${escapeHtml(lastDone.label)}</div>
          </div>` : ""}
          <div>
            <div class="welcome-state-label">Open items</div>
            <div class="welcome-state-value">${(stats.open_items_blocking || 0)} blocking · ${(stats.open_items_advisory || 0)} advisory</div>
          </div>
        </div>
        ${noteLine}
        ${action ? `<div class="welcome-actions">
          ${action.href
            ? `<a class="cta-btn welcome-action" href="${action.href}">${escapeHtml(action.label)}</a>`
            : `<button class="cta-btn welcome-action"
                       data-prime="${escapeHtml(action.prime || "")}"
                       data-agent="${escapeHtml(action.agent || "")}">${escapeHtml(action.label)}</button>`}
        </div>` : ""}
        <p class="welcome-hint">Or just type your question below — the agent has full project context.</p>
      </div>`;

    chatLog.querySelectorAll(".welcome-action[data-prime]").forEach(btn => {
      btn.addEventListener("click", () => {
        const prime = btn.getAttribute("data-prime") || "";
        const agent = btn.getAttribute("data-agent") || "";
        applyChat("open");
        // Switch the chat agent dropdown before priming so the message
        // is dispatched to the right agent (e.g. Discovery → Domain
        // handoff when Discovery is DONE).
        if (agent) {
          const sel = document.getElementById("chat-agent-select");
          if (sel) {
            const opt = Array.from(sel.options).find(o => o.value === agent);
            if (opt) sel.value = agent;
            // If the option doesn't exist yet (agent discovery still
            // catching up), fall back: the chat POST handler accepts
            // an agent name even if the dropdown doesn't list it yet,
            // so we still send the agent param via the form body.
          }
        }
        if (chatInput) {
          chatInput.value = prime;
          chatInput.focus();
          if (prime) {
            // Auto-submit primed messages so the user doesn't have to
            // hit Send themselves — this is the "Start Discovery" /
            // "Start Design" handoff flow.
            chatForm.requestSubmit?.();
          }
        }
      });
    });

    // Side-effect: also refresh the sticky lifecycle bar with the data
    // we just fetched (so we don't double-fetch).
    updateLifecycleBar({
      eid, lifecycle, hasIntake, discoveryDone, discoveryInProgress,
      currentLabel, lastDoneLabel: lastDone?.label,
    });
  }

  // Sticky one-line lifecycle indicator above the chat log. Always
  // visible when a project is active; reflects "Step: <current> · Next:
  // <next>". Refreshed by syncChatProjectContext on project change AND
  // by the Progress page's 10s auto-refresh tick.
  function updateLifecycleBar(state) {
    const bar = document.getElementById("chat-lifecycle-bar");
    if (!bar) return;
    if (!state || !state.eid) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      bar.setAttribute("aria-hidden", "true");
      return;
    }
    const { hasIntake, discoveryDone, discoveryInProgress, currentLabel, lastDoneLabel } = state;
    const stepClass = discoveryDone ? "done"
      : discoveryInProgress ? "in-progress"
      : hasIntake ? "ready"
      : "waiting";
    bar.classList.remove("hidden");
    bar.setAttribute("aria-hidden", "false");
    bar.innerHTML = `
      <span class="chat-lifecycle-dot ${stepClass}" aria-hidden="true"></span>
      <span class="chat-lifecycle-text">
        <strong>${escapeHtml(currentLabel || "Idle")}</strong>${
          lastDoneLabel ? ` · last: ${escapeHtml(lastDoneLabel)}` : ""
        }
      </span>`;
  }

  // Refresh the lifecycle bar from the network. Called by the Progress
  // page's auto-refresh tick so the bar reflects state changes the user
  // wouldn't otherwise see (e.g. while sitting on Requirements / chat).
  async function refreshLifecycleBar() {
    const eid = currentProjectId();
    if (!eid) { updateLifecycleBar(null); return; }
    try {
      const [lifecycle, stats, artifacts] = await Promise.all([
        fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`).then(r => r.json()).catch(() => ({ steps: {} })),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/overview`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts`).then(r => r.json()).catch(() => []),
      ]);
      const hasIntake = artifacts.includes("discovery/intake.json");
      const discoveryStatus = lifecycle?.steps?.discovery?.status || "NOT_STARTED";
      const discoveryDone = discoveryStatus === "DONE" || discoveryStatus === "DONE_WITH_CONCERNS";
      const openItemsCount = (stats.open_items_blocking || 0) + (stats.open_items_advisory || 0);
      const hasDiscoveryBrief = artifacts.includes("discovery/discovery-brief.yaml");
      const discoveryInProgress = !discoveryDone && (hasDiscoveryBrief || openItemsCount > 0);
      const designStatus = lifecycle?.steps?.design?.status || "NOT_STARTED";
      const designDone = designStatus === "DONE" || designStatus === "DONE_WITH_CONCERNS";
      const designScopes = ["topic-design","broker-select","protocol-select","integration","mesh-design","ha-dr","sam-design","event-portal","migration"];
      const hasDesignArtifact = artifacts.some(a => designScopes.some(s => a.startsWith(s + "/")));
      const designInProgress = !designDone && (hasDesignArtifact || designStatus === "NEEDS_CONTEXT");
      const steps = [
        { id: "intake", label: "Intake", done: hasIntake },
        { id: "discovery", label: "Discovery", done: discoveryDone },
        { id: "design", label: "Design", done: designDone },
        { id: "review", label: "Review", done: false },
      ];
      const firstUnfinished = steps.find(s => !s.done);
      const lastDone = [...steps].reverse().find(s => s.done);
      // Pass overall "in progress" so the dot animates while any step's mid-flow.
      const anyInProgress = discoveryInProgress || designInProgress;
      updateLifecycleBar({
        eid, hasIntake,
        discoveryDone: discoveryDone || designDone,  // shows "done" tint past discovery
        discoveryInProgress: anyInProgress,
        currentLabel: firstUnfinished?.label || "Complete",
        lastDoneLabel: lastDone?.label,
      });
    } catch { /* swallow; next tick retries */ }
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

  // While the agent is "thinking", we paint:
  //   (a) an "activity stream" — accumulating pills, one per distinct
  //       short status update emitted by the agent ("Loading discovery
  //       framework…", "Checking integration hub…"). Latest pill is
  //       in-progress, earlier ones get a ✓.
  //   (b) a "live bubble" below the pills — only used for long-form
  //       text chunks that are clearly the streaming final answer
  //       (e.g. multi-line markdown the LLM is composing).
  // On FinalResponse, the pills lock in (all ✓), the live bubble is
  // replaced with the final markdown answer, and we persist.
  let pendingAgentMsg = null;     // { el, lastText, pillsContainer, pills: [{el, text}] }

  // While streaming, hide the raw ```question JSON block behind a
  // "preparing form…" placeholder. We can't safely partial-parse the
  // JSON yet; the form materializes on finalizeAgentBubble.
  function maskQuestionBlockDuringStream(text) {
    const idx = text.indexOf("```question");
    if (idx === -1) return text;
    const preamble = text.slice(0, idx).trimEnd();
    return preamble + (preamble ? "\n\n" : "") + "📝 Preparing question…";
  }

  // Classify a streaming text as either a "status pill" (short, single-
  // line, agent-narrating-what-it's-doing) or "live bubble content" (long
  // or multi-line — the actual answer streaming in).
  function isStatusPill(text) {
    if (!text) return false;
    const t = text.trim();
    if (!t) return false;
    if (t.length > 120) return false;
    if (t.includes("\n")) return false;
    return true;
  }

  function appendActivityPill(text) {
    if (!pendingAgentMsg) return;
    // Mark previous pill as done.
    const prev = pendingAgentMsg.pills[pendingAgentMsg.pills.length - 1];
    if (prev) {
      prev.el.classList.remove("in-progress");
      prev.el.classList.add("done");
      const icon = prev.el.querySelector(".activity-pill-icon");
      if (icon) icon.textContent = "✓";
    }
    const pill = document.createElement("div");
    pill.className = "activity-pill in-progress";
    pill.innerHTML = `<span class="activity-pill-icon">⏳</span><span class="activity-pill-text"></span>`;
    pill.querySelector(".activity-pill-text").textContent = text;
    pendingAgentMsg.pillsContainer.appendChild(pill);
    pendingAgentMsg.pills.push({ el: pill, text });
  }

  function startOrUpdateAgentBubble(text) {
    if (!text) return;
    chatLog.querySelector(".chat-empty")?.remove();
    chatLog.querySelector(".welcome-card")?.remove();
    const display = maskQuestionBlockDuringStream(text);
    const isPill = isStatusPill(text);

    if (!pendingAgentMsg) {
      // Open a new agent-turn container with: pills section + live bubble.
      const wrap = document.createElement("div");
      wrap.className = "chat-msg agent agent-thinking agent-turn";
      const pillsContainer = document.createElement("div");
      pillsContainer.className = "activity-pills";
      const bubble = document.createElement("div");
      bubble.className = "agent-turn-text";
      wrap.appendChild(pillsContainer);
      wrap.appendChild(bubble);
      chatLog.appendChild(wrap);
      pendingAgentMsg = { el: wrap, lastText: text, pillsContainer, bubbleEl: bubble, pills: [] };
      if (isPill) {
        appendActivityPill(text);
      } else {
        renderAgentMarkdown(bubble, display);
      }
    } else if (text !== pendingAgentMsg.lastText) {
      pendingAgentMsg.lastText = text;
      if (isPill) {
        // New short status — only add a pill if the text differs from
        // the most recent pill (avoid duplicates).
        const last = pendingAgentMsg.pills[pendingAgentMsg.pills.length - 1];
        if (!last || last.text !== text) appendActivityPill(text);
      } else {
        // Long / multi-line content — stream into the bubble.
        renderAgentMarkdown(pendingAgentMsg.bubbleEl, display);
      }
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
      // Lock all pills as done (last one still in-progress at this point).
      const lastPill = pendingAgentMsg.pills[pendingAgentMsg.pills.length - 1];
      if (lastPill) {
        lastPill.el.classList.remove("in-progress");
        lastPill.el.classList.add("done");
        const icon = lastPill.el.querySelector(".activity-pill-icon");
        if (icon) icon.textContent = "✓";
      }
      // Collapse the pills container to a one-liner summary if there
      // were any — keeps the chat tidy after the turn finishes.
      if (pendingAgentMsg.pills.length) {
        const n = pendingAgentMsg.pills.length;
        const summary = document.createElement("div");
        summary.className = "activity-pills-summary";
        summary.innerHTML = `<span class="activity-pill-icon">✓</span><span>${n} step${n === 1 ? "" : "s"} (click to expand)</span>`;
        summary.addEventListener("click", () => {
          pendingAgentMsg?.pillsContainer?.classList.toggle("expanded");
          summary.classList.toggle("expanded");
        });
        pendingAgentMsg.pillsContainer.classList.add("collapsed");
        pendingAgentMsg.pillsContainer.parentNode.insertBefore(summary, pendingAgentMsg.pillsContainer);
      }
      // Render the final answer in the bubble (or remove the whole turn
      // if there's nothing left to show after stripping question blocks).
      if (cleanText) {
        renderAgentMarkdown(pendingAgentMsg.bubbleEl, cleanText);
      } else if (!pendingAgentMsg.pills.length) {
        pendingAgentMsg.el.remove();
      } else {
        pendingAgentMsg.bubbleEl.remove();
      }
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

    // Safety net: if the agent emitted a markdown-style multiple-choice
    // question instead of a ```question block (LLM sometimes ignores
    // the tool-call rule), detect the "Reply: A, B, C" footer and offer
    // a clickable chip row + optional note. The user gets the same
    // form-like UX without typing the letter in chat.
    if (!blocks.length && cleanText) {
      const replyOptions = detectReplyPattern(cleanText);
      if (replyOptions) {
        const chips = renderQuickReplyChips(replyOptions);
        chatLog.appendChild(chips);
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    }

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

    // No "type a custom answer" escape hatch — "+ Add a note" already
    // covers the elaboration case (pick the closest option + qualify
    // it), and the chat input below is always available for truly
    // off-script replies. The link was a footgun (no undo on a stray
    // click) and added a redundant code path.

    return card;
  }

  // Detect a "Reply: A, B, C" / "Please reply: A, B, or C" / etc footer
  // in an agent markdown message. Returns either an array of letter
  // labels (single_choice) or {kind:"yes_no"}, or null if no such
  // pattern is found.
  //
  // Why: SADiscoveryAgent sometimes emits a structured question as
  // markdown instead of calling ask_user_question. The chip row gives
  // users a click-not-type affordance regardless of which path the LLM
  // chose.
  function detectReplyPattern(text) {
    // Look only at the tail of the message — the "Reply:" prompt is
    // always near the end. Limits false positives where the body
    // happens to mention "reply" in unrelated context.
    const tail = text.slice(-500);

    // Word "reply" anywhere (case-insensitive, word-bounded — catches
    // "Reply:", "Please reply:", "**Reply:**", "(Reply A/B/C)", etc.)
    // followed (within the same sentence) by a list of single
    // uppercase letters or yes/no tokens.
    const replyRe = /\b[Rr]eply\b[^.!?\n]{0,80}/g;
    const yesNoRe = /\byes\b[^.!?\n]{0,40}\bno\b|\bno\b[^.!?\n]{0,40}\byes\b/i;
    // letter list — 2-6 single-cap letters separated by , / or whitespace
    const letterListRe = /\b([A-Z])(?:[\s,/]+(?:or\s+)?([A-Z]))(?:[\s,/]+(?:or\s+)?([A-Z]))?(?:[\s,/]+(?:or\s+)?([A-Z]))?(?:[\s,/]+(?:or\s+)?([A-Z]))?(?:[\s,/]+(?:or\s+)?([A-Z]))?\b/;

    let match;
    while ((match = replyRe.exec(tail)) !== null) {
      const span = match[0];

      // yes/no test inside the span
      if (yesNoRe.test(span)) {
        return { kind: "yes_no" };
      }

      // letter list inside the span
      const ll = span.match(letterListRe);
      if (ll) {
        const letters = ll.slice(1).filter(Boolean);
        // De-dup while preserving order
        const seen = new Set();
        const unique = letters.filter(l => (seen.has(l) ? false : (seen.add(l), true)));
        if (unique.length >= 2 && unique.length <= 6) {
          return { kind: "single_choice", letters: unique };
        }
      }
    }
    return null;
  }

  // Render a quick-reply chip row appended after a markdown agent
  // message. Click = submit (chip behaves like yes_no buttons —
  // immediate, with the note included if filled).
  function renderQuickReplyChips({ kind, letters }) {
    const card = document.createElement("div");
    card.className = "chat-msg agent quick-reply-chips";

    const label = document.createElement("div");
    label.className = "quick-reply-label";
    label.textContent = "Quick reply:";
    card.appendChild(label);

    const row = document.createElement("div");
    row.className = "quick-reply-row";

    const choices = kind === "yes_no" ? ["yes", "no"] : letters;
    const display = kind === "yes_no"
      ? { yes: "Yes", no: "No" }
      : Object.fromEntries(letters.map(l => [l, l]));

    // Track the optional note value so chips can grab it on click.
    let getNote = () => null;

    choices.forEach(value => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-reply-chip";
      btn.textContent = display[value];
      btn.addEventListener("click", () => {
        const note = getNote();
        const displayText = note ? `${display[value]} — ${note}` : display[value];
        // Lock the whole row so the user can't double-submit.
        Array.from(card.querySelectorAll("button, textarea")).forEach(el => el.disabled = true);
        card.classList.add("question-answered");
        submitQuickReply({ kind, value, displayText, note, cardEl: card });
      });
      row.appendChild(btn);
    });
    card.appendChild(row);

    // Note toggle (same UX as the form-card note section).
    getNote = renderNoteSection(card);

    return card;
  }

  async function submitQuickReply({ kind, value, displayText, note, cardEl }) {
    if (!chatSessionId) chatSessionId = deriveChatSessionId();
    if (!chatEventSource) openSseStream(chatSessionId);

    appendChatMessage("user", displayText);

    const eid = currentProjectId();
    const agent = chatAgentSelect?.value || "";
    const data = { kind: "quick_reply", source_kind: kind, answer: value };
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
      // Unlock so the user can retry.
      Array.from(cardEl.querySelectorAll("button, textarea")).forEach(el => el.disabled = false);
      cardEl.classList.remove("question-answered");
      appendChatMessage("agent", "[error] could not send reply: " + err.message + " — please retry");
    }
  }

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

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
        const [stats, intakeRes, artifacts, lifecycle, openItems] = await Promise.all([
          fetch(`/api/engagements/${encodeURIComponent(eid)}/overview`).then(r => r.json()),
          fetch(`/api/intake/load/${encodeURIComponent(eid)}`).then(r => r.json()),
          fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts`).then(r => r.json()).catch(() => []),
          fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`).then(r => r.json()).catch(() => ({ steps: {} })),
          fetch(`/api/engagements/${encodeURIComponent(eid)}/open-items?status=open&severity=blocking`).then(r => r.json()).catch(() => []),
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
        // In-progress when the agent has TOUCHED the step at all — any
        // non-NOT_STARTED status, OR artifacts exist, OR open-items
        // accrued. The status-based check catches the early-turn window
        // before any artifact is written (the agent's first set_step_status
        // flips status to NEEDS_CONTEXT). Without this the Start button
        // stays enabled for 30-90s after click, inviting double-submit.
        const discoveryInProgress = !discoveryDone && (
          (discoveryStatus !== "NOT_STARTED")
          || hasDiscoveryBrief || openItemsCount > 0 || hasDiscoverySummary
        );

        // Same for Design — driven by SADomainAgent's set_step_status calls.
        const designStatus = lifecycle?.steps?.design?.status || "NOT_STARTED";
        const designNote = lifecycle?.steps?.design?.note || "";
        const designDone = designStatus === "DONE" || designStatus === "DONE_WITH_CONCERNS";
        // Any artifact under a Domain scope folder means design is mid-flow.
        const designScopes = ["topic-design","broker-select","protocol-select","integration","mesh-design","ha-dr","sam-design","event-portal","migration"];
        const hasDesignArtifact = artifacts.some(a => designScopes.some(s => a.startsWith(s + "/")));
        const designInProgress = !designDone && (
          (designStatus !== "NOT_STARTED")
          || hasDesignArtifact
        );

        // Same for Review — driven by SAOrchestratorAgent's set_step_status
        // for step="review" after the 4 reviewers return. A review artifact
        // (reviews/*-review.md) means at least one reviewer finished even if
        // the orchestrator hasn't aggregated yet.
        const reviewStatus = lifecycle?.steps?.review?.status || "NOT_STARTED";
        const reviewNote = lifecycle?.steps?.review?.note || "";
        const reviewDone = reviewStatus === "DONE" || reviewStatus === "DONE_WITH_CONCERNS";
        const hasReviewArtifact = artifacts.some(a => a.startsWith("reviews/"));
        const reviewInProgress = !reviewDone && (
          (reviewStatus !== "NOT_STARTED")
          || hasReviewArtifact
        );

        // Validation — SAValidationAgent writes validation/validation-report.{md,yaml}
        // and calls set_step_status(step="validation"). Direct-dispatched.
        const validationStatus = lifecycle?.steps?.validation?.status || "NOT_STARTED";
        const validationNote = lifecycle?.steps?.validation?.note || "";
        const validationDone = validationStatus === "DONE" || validationStatus === "DONE_WITH_CONCERNS";
        const hasValidationArtifact = artifacts.some(a => a.startsWith("validation/"));
        const validationInProgress = !validationDone && (
          (validationStatus !== "NOT_STARTED")
          || hasValidationArtifact
        );

        // Blueprint — SABlueprintAgent writes blueprint/* + exports/engagement-package.zip.
        const blueprintStatus = lifecycle?.steps?.blueprint?.status || "NOT_STARTED";
        const blueprintNote = lifecycle?.steps?.blueprint?.note || "";
        const blueprintDone = blueprintStatus === "DONE" || blueprintStatus === "DONE_WITH_CONCERNS";
        const hasBlueprintArtifact = artifacts.some(a => a.startsWith("blueprint/") || a.startsWith("exports/"));
        const blueprintInProgress = !blueprintDone && (
          (blueprintStatus !== "NOT_STARTED")
          || hasBlueprintArtifact
        );

        // Provisioning — SAProvisioningAgent writes provisioning/* (opt-in).
        const provisioningStatus = lifecycle?.steps?.provisioning?.status || "NOT_STARTED";
        const provisioningNote = lifecycle?.steps?.provisioning?.note || "";
        const provisioningDone = provisioningStatus === "DONE" || provisioningStatus === "DONE_WITH_CONCERNS";
        const hasProvisioningArtifact = artifacts.some(a => a.startsWith("provisioning/"));
        const provisioningInProgress = !provisioningDone && (
          (provisioningStatus !== "NOT_STARTED")
          || hasProvisioningArtifact
        );

        // Active step on the lifecycle banner.
        const activeStepId = provisioningDone ? "complete"
          : (provisioningInProgress || blueprintDone) ? "provisioning"
          : (blueprintInProgress || validationDone) ? "blueprint"
          : (validationInProgress || reviewDone) ? "validation"
          : (reviewInProgress || designDone) ? "review"
          : (designInProgress || discoveryDone) ? "design"
          : (discoveryInProgress || hasIntake) ? "discovery"
          : "intake";
        const completedSteps = new Set();
        if (hasIntake) completedSteps.add("intake");
        if (discoveryDone) completedSteps.add("discovery");
        if (designDone) completedSteps.add("design");
        if (reviewDone) completedSteps.add("review");
        if (validationDone) completedSteps.add("validation");
        if (blueprintDone) completedSteps.add("blueprint");
        if (provisioningDone) completedSteps.add("provisioning");

        // Blocking open-items affecting Blueprint — typically recorded by
        // SAValidationAgent with affecting_step="blueprint". When any are
        // open, Start Blueprint must be disabled. Without this gate, the
        // user can bypass validation guardrails on a DONE_WITH_CONCERNS
        // verdict.
        const blueprintBlockers = Array.isArray(openItems)
          ? openItems.filter(i => i?.affecting_step === "blueprint" && i?.status === "open")
          : [];

        // One contextual CTA, always shown — content depends on lifecycle state.
        const cta = renderProgressCta({
          eid, hasIntake, discoveryStatus, discoveryNote,
          discoveryInProgress, openItemsCount,
          designStatus, designNote, designDone, designInProgress,
          reviewStatus, reviewNote, reviewDone, reviewInProgress,
          validationStatus, validationNote, validationDone, validationInProgress,
          blueprintStatus, blueprintNote, blueprintDone, blueprintInProgress,
          provisioningStatus, provisioningNote, provisioningDone, provisioningInProgress,
          blueprintBlockers,
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
            // Endpoint returns read_artifact's .data wrapped in JSON, so the body is a
            // JSON-encoded string; .json() decodes the escapes back to real newlines/quotes.
            const c = await r.json();
            view.innerHTML = renderArtifactContent(name, typeof c === "string" ? c : JSON.stringify(c, null, 2));
          } catch (err) {
            view.innerHTML = `<p class="artifacts-viewer-hint">Could not load: ${escapeHtml(err.message || err)}</p>`;
          }
        });
      });
    },

    stats: async (root, eid) => {
      const [stats, lc, arts, tok] = await Promise.all([
        fetch(`/api/engagements/${encodeURIComponent(eid)}/stats`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`).then(r => r.json()).catch(() => ({ steps: {} })),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/artifacts`).then(r => r.json()).catch(() => []),
        fetch(`/api/engagements/${encodeURIComponent(eid)}/token-usage`).then(r => r.json()).catch(() => null),
      ]);
      const fmtSec = (s) => {
        s = Math.max(0, Math.floor(s || 0));
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60); const r = s - m * 60;
        if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
        const h = Math.floor(m / 60); const mm = m - h * 60;
        return mm ? `${h}h ${mm}m` : `${h}h`;
      };
      const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString());

      // Step durations from lifecycle.steps (set_step_status writes started_at/updated_at).
      const stepRows = Object.entries(lc?.steps || {}).map(([name, info]) => {
        const started = info?.started_at;
        const updated = info?.updated_at;
        let durStr = "—";
        if (started && updated) {
          try {
            const ms = new Date(updated).getTime() - new Date(started).getTime();
            durStr = fmtSec(Math.floor(ms / 1000));
          } catch {}
        }
        const badge = info?.status === "DONE" ? `<span class="status-badge done">Done</span>`
          : info?.status === "DONE_WITH_CONCERNS" ? `<span class="status-badge advisory">Done with concerns</span>`
          : `<span class="status-badge">${escapeHtml(info?.status || "—")}</span>`;
        return `<tr>
          <td><strong>${escapeHtml(name)}</strong></td>
          <td>${badge}</td>
          <td>${durStr}</td>
          <td class="muted">${escapeHtml(info?.note || "")}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="4" class="muted">No steps recorded yet. Each agent writes its status via <code>set_step_status</code> at end-of-turn.</td></tr>`;

      const tokenTotals = tok?.totals || tok || null;
      const hasTokens = tokenTotals && (tokenTotals.input_tokens || tokenTotals.output_tokens);

      root.innerHTML = `<h1>Stats</h1>
        <p class="muted">Time, throughput, and token usage for this engagement. Per-step durations come from <code>meta/engagement-status.yaml</code>; token capture writes to <code>meta/telemetry/llm-calls.jsonl</code>.</p>

        <div class="stat-tile-row">
          <div class="stat-tile"><div class="stat-tile-label">Wall time</div><div class="stat-tile-value">${fmtSec(stats.wall_time_seconds)}</div></div>
          <div class="stat-tile"><div class="stat-tile-label">Execution</div><div class="stat-tile-value">${fmtSec(stats.execution_seconds)}</div></div>
          <div class="stat-tile"><div class="stat-tile-label">User wait</div><div class="stat-tile-value">${fmtSec(stats.user_wait_seconds)}</div></div>
          <div class="stat-tile"><div class="stat-tile-label">Steps completed</div><div class="stat-tile-value">${fmtNum(stats.steps_executed)}</div></div>
          <div class="stat-tile"><div class="stat-tile-label">Artifacts</div><div class="stat-tile-value">${fmtNum((arts || []).length)}</div></div>
        </div>

        <h2>Per-step timing</h2>
        <table class="stats-table">
          <thead><tr><th>Step</th><th>Status</th><th>Duration</th><th>Note</th></tr></thead>
          <tbody>${stepRows}</tbody>
        </table>

        <h2>Token usage</h2>
        ${hasTokens
          ? `<div class="stat-tile-row">
               <div class="stat-tile"><div class="stat-tile-label">Input</div><div class="stat-tile-value">${fmtNum(tokenTotals.input_tokens)}</div></div>
               <div class="stat-tile"><div class="stat-tile-label">Output</div><div class="stat-tile-value">${fmtNum(tokenTotals.output_tokens)}</div></div>
               <div class="stat-tile"><div class="stat-tile-label">Cached input</div><div class="stat-tile-value">${fmtNum(tokenTotals.cached_input_tokens)}</div></div>
             </div>
             <p class="muted">Cross-engagement breakdown: <a href="/settings#usage">Settings → Usage</a></p>`
          : `<div class="stats-pending">
               <p><strong>Per-engagement token capture is not yet wired into the running agents.</strong></p>
               <p class="muted">The capture infrastructure (<code>record_llm_call_telemetry</code>) and the <code>/api/engagements/{id}/token-usage</code> endpoint are built and ready. The remaining piece is each agent's <code>after_model_callback</code> registration — once that ships, this section will populate automatically. Cross-engagement totals (from when the WebUI itself calls the LLM) are visible at <a href="/settings#usage">Settings → Usage</a>.</p>
             </div>`}
        `;
    },

    export: async (root, eid) => {
      // Audience packs — descriptions are stable copy; readiness is computed
      // from lifecycle so disabled packs show *why* they're disabled.
      const AUDIENCE_PACKS = [
        { id: "blueprint", title: "Blueprint",   icon: "🏗️", desc: "Engineering handoff — architecture, topology, SAM YAMLs, broker provisioning, runbook.",         prereq: "design"    },
        { id: "executive", title: "Executive",   icon: "📊", desc: "Business outcome summary — ROI, risk reduction, strategic value. For CXO and board review.",     prereq: "blueprint" },
        { id: "admin-ops", title: "Admin & Ops", icon: "🔧", desc: "Day-2 operability — runbook, monitoring coverage, escalation, capacity planning, upgrade paths.", prereq: "blueprint" },
        { id: "security",  title: "Security",    icon: "🔒", desc: "Security posture — ACL model, TLS, authn/z, compliance, encryption at rest and in transit.",     prereq: "blueprint" },
        { id: "developers",title: "Developers",  icon: "💻", desc: "Developer experience — SDK choices, topic taxonomy, schema governance, onboarding path.",        prereq: "blueprint" },
      ];

      const lc = await fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`).then(r => r.json()).catch(() => ({ steps: {} }));
      const isDone = (s) => {
        const st = lc?.steps?.[s]?.status;
        return st === "DONE" || st === "DONE_WITH_CONCERNS";
      };

      const cards = AUDIENCE_PACKS.map(p => {
        const ready = isDone(p.prereq);
        const badge = ready
          ? `<span class="status-badge done">Ready</span>`
          : `<span class="status-badge pending">Awaiting ${escapeHtml(p.prereq)}</span>`;
        return `<div class="export-card${ready ? "" : " export-card-disabled"}">
          <div class="export-card-head">
            <div class="export-card-icon" aria-hidden="true">${p.icon}</div>
            <div class="export-card-title">${escapeHtml(p.title)}</div>
            ${badge}
          </div>
          <p class="export-card-desc">${escapeHtml(p.desc)}</p>
          <button class="cta-btn export-card-cta"${ready ? "" : " disabled"}
                  ${ready ? `onclick="window.__renderPack('${eid}','${p.id}')"` : ""}>
            ${ready ? "Render HTML →" : "Locked"}
          </button>
        </div>`;
      }).join("");

      root.innerHTML = `<h1>Export</h1>
        <p class="muted">Audience-tailored reports drawn from this engagement's artifacts. Each pack is auto-rendered from the relevant phase outputs; packs without their prerequisite phase complete stay locked until that phase wraps.</p>

        <h2>Audience reports</h2>
        <div class="export-grid">${cards}</div>

        <h2>Full archive</h2>
        <div class="export-archive">
          <div class="export-card-icon" aria-hidden="true">📦</div>
          <div class="export-archive-body">
            <div class="export-card-title">Engagement bundle</div>
            <p class="export-card-desc">Every artifact this engagement has produced — intake, discovery brief, design scopes, decisions, open items, findings, telemetry — packed as a single <code>.zip</code> for offline review or handoff.</p>
            <button class="cta-btn" onclick="window.__downloadZip('${eid}')">Download .zip →</button>
          </div>
        </div>`;
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
    reviewStatus, reviewNote, reviewDone, reviewInProgress,
    validationStatus, validationNote, validationDone, validationInProgress,
    blueprintStatus, blueprintNote, blueprintDone, blueprintInProgress,
    provisioningStatus, provisioningNote, provisioningDone, provisioningInProgress,
    blueprintBlockers,
  }) {
    blueprintBlockers = blueprintBlockers || [];
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

    // Subtle "escape hatch" row — same pattern across every step that has
    // a Restart action. Visually demoted so it doesn't compete with the
    // primary forward CTA, but discoverable and tooltip-explained.
    const restartDiscoveryRow = `
      <div class="progress-cta-secondary-actions">
        <button id="restart-discovery-btn" class="cta-link-danger"
                title="Re-run Discovery from scratch. Wipes discovery/* artifacts and the discovery step status; meta/decisions.yaml is preserved as audit trail. Only use this if requirements have materially changed.">
          ↺ Restart Discovery
        </button>
        <span class="secondary-action-hint">— requirements materially changed? wipe Discovery and start fresh</span>
      </div>`;
    const restartDesignRow = `
      <div class="progress-cta-secondary-actions">
        <button id="restart-design-btn" class="cta-link-danger"
                title="Re-run Design from scratch. Wipes every design scope artifact (topic-design, broker-select, …) and the design step status; meta/decisions.yaml is preserved. Only use this if the discovery brief or constraints have changed.">
          ↺ Restart Design
        </button>
        <span class="secondary-action-hint">— discovery brief changed? wipe design output and start fresh</span>
      </div>`;

    // Provisioning DONE — engagement complete.
    if (provisioningDone) {
      const badge = provisioningStatus === "DONE_WITH_CONCERNS"
        ? `<span class="status-badge advisory">Done with concerns</span>`
        : `<span class="status-badge done">Done</span>`;
      return `
        <div class="progress-cta done" role="region" aria-label="Provisioning complete">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Engagement complete</div>
            <h2>Provisioning is complete ${badge}</h2>
            ${provisioningNote ? `<p>${escapeHtml(provisioningNote)}</p>` : ""}
            <p>The Event Portal model has been provisioned. AsyncAPI specs
            are exported per application under <code>provisioning/asyncapi/</code>.
            The full engagement package (architecture, runbook, audience
            packs) is at <code>exports/engagement-package.zip</code>.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <a class="cta-btn" href="/projects/${encodeURIComponent(eid)}/artifacts">View artifacts →</a>
          </div>
        </div>`;
    }

    // Provisioning in progress.
    if (provisioningInProgress) {
      return `
        <div class="progress-cta in-progress" role="region" aria-label="Provisioning in progress">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Provisioning in progress</div>
            <h2>Continue Provisioning in chat</h2>
            <p>SAProvisioningAgent is creating Event Portal objects.
            ${provisioningNote ? `<em>${escapeHtml(provisioningNote)}</em> ` : ""}
            In Interactive mode, the agent pauses between layers for
            Apply / Skip confirmation. Click <strong>Continue in chat →</strong>
            to answer the next prompt.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
          </div>
        </div>`;
    }

    // Blueprint DONE — Provisioning is opt-in.
    if (blueprintDone) {
      const badge = blueprintStatus === "DONE_WITH_CONCERNS"
        ? `<span class="status-badge advisory">Done with concerns</span>`
        : `<span class="status-badge done">Done</span>`;
      return `
        <div class="progress-cta done" role="region" aria-label="Blueprint complete">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Blueprint → Provisioning (opt-in)</div>
            <h2>Blueprint is complete ${badge}</h2>
            ${blueprintNote ? `<p>${escapeHtml(blueprintNote)}</p>` : ""}
            <p>The deliverable package is assembled — architecture narrative,
            ops runbook, diagrams, and 5 audience packs bundled into
            <code>exports/engagement-package.zip</code>. The engagement
            can end here, or you can opt-in to live Event Portal
            <strong>Provisioning</strong> — SAProvisioningAgent will
            create EP objects via the EP Designer API (interactive by
            default, with Auto mode if you prefer hands-off).</p>
            <p class="muted" style="border-left: 3px solid var(--accent, #00C895); padding-left: 10px; font-size: 12px;">
              <strong>Note:</strong> Live EP API calls are Phase-5 work
              and not yet wired (see <code>ep_designer_mcp_tools.py</code>
              — every <code>create_*</code> returns a structured
              "not yet implemented" response). Pre-flight checks +
              dry-run plan generation work today; actual provisioning
              halts at the first create call.
            </p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="start-provisioning-btn" class="cta-btn" data-mode="interactive">Start Provisioning →</button>
            <button id="start-provisioning-auto-btn" class="cta-btn cta-btn-auto" data-mode="auto"
                    title="Auto mode: provision all layers without per-layer confirmation; first error halts and reports.">Start Auto ⚡</button>
            <a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View blueprint →</a>
          </div>
        </div>`;
    }

    // Blueprint in progress.
    if (blueprintInProgress) {
      return `
        <div class="progress-cta in-progress" role="region" aria-label="Blueprint in progress">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Blueprint in progress</div>
            <h2>Assembling the engagement package</h2>
            <p>SABlueprintAgent is composing the architecture narrative,
            runbook, diagrams, and 5 audience packs.
            ${blueprintNote ? `<em>${escapeHtml(blueprintNote)}</em> ` : ""}
            Click <strong>Continue in chat →</strong> to follow along —
            the package ZIP appears under <code>exports/</code> when ready.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
          </div>
        </div>`;
    }

    // Validation DONE — Blueprint is next, gated on blocking open-items.
    if (validationDone) {
      const badge = validationStatus === "DONE_WITH_CONCERNS"
        ? `<span class="status-badge advisory">Done with concerns</span>`
        : `<span class="status-badge done">Done</span>`;
      // Gate: SAValidationAgent records blocking open-items with
      // affecting_step="blueprint". When any are open, the Start
      // Blueprint button must be disabled — otherwise the user can
      // bypass validation guardrails when the verdict is
      // DONE_WITH_CONCERNS.
      const blockedByOpenItems = blueprintBlockers.length > 0;
      const blockerList = blockedByOpenItems
        ? `<div class="progress-blocker-list">
             <strong>${blueprintBlockers.length} blocking open-item${blueprintBlockers.length === 1 ? "" : "s"} must be resolved first:</strong>
             <ul>${blueprintBlockers.slice(0, 5).map(i => `<li><code>${escapeHtml(i.id || "?")}</code>: ${escapeHtml(i.description || "")}</li>`).join("")}</ul>
             ${blueprintBlockers.length > 5 ? `<small>(…and ${blueprintBlockers.length - 5} more — see Open Items)</small>` : ""}
           </div>`
        : "";
      const blueprintBtnAttrs = blockedByOpenItems
        ? `disabled title="Resolve the blocking open-items below before Blueprint can run."`
        : "";
      return `
        <div class="progress-cta done" role="region" aria-label="Validation complete">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Validation → Blueprint</div>
            <h2>Validation is complete ${badge}</h2>
            ${validationNote ? `<p>${escapeHtml(validationNote)}</p>` : ""}
            <p>The design has been audited against requirement coverage,
            antipatterns, consistency, deferred findings, terminology
            compliance, and schema sanity. Next step: <strong>Blueprint</strong> —
            SABlueprintAgent assembles the architecture narrative, ops
            runbook, diagrams, and 5 audience packs into a deliverable ZIP.</p>
            ${blockerList}
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="start-blueprint-btn" class="cta-btn" ${blueprintBtnAttrs}>Start Blueprint →</button>
            <a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View validation →</a>
            ${blockedByOpenItems ? `<a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/open-items">View open items →</a>` : ""}
          </div>
        </div>`;
    }

    // Validation in progress.
    if (validationInProgress) {
      return `
        <div class="progress-cta in-progress" role="region" aria-label="Validation in progress">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Validation in progress</div>
            <h2>Auditing the design</h2>
            <p>SAValidationAgent is gating the design — tracing
            requirements, scanning antipatterns, checking consistency,
            schema sanity, and terminology.
            ${validationNote ? `<em>${escapeHtml(validationNote)}</em> ` : ""}
            Click <strong>Continue in chat →</strong> to follow along.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
          </div>
        </div>`;
    }

    // Review DONE — Validation is next.
    if (reviewDone) {
      const badge = reviewStatus === "DONE_WITH_CONCERNS"
        ? `<span class="status-badge advisory">Done with concerns</span>`
        : `<span class="status-badge done">Done</span>`;
      return `
        <div class="progress-cta done" role="region" aria-label="Review complete">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Review → Validation</div>
            <h2>Review is complete ${badge}</h2>
            ${reviewNote ? `<p>${escapeHtml(reviewNote)}</p>` : ""}
            <p>The four reviewer agents (architect, developer, ops, security)
            have audited the design. Findings appear in the chat as an
            interactive card — click <strong>Apply / Defer / Discuss</strong>
            per finding. Next step: <strong>Validation</strong> —
            SAValidationAgent gates Blueprint by checking requirement
            coverage, antipatterns, consistency, and schema sanity.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="start-validation-btn" class="cta-btn">Start Validation →</button>
            <a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View reviews →</a>
          </div>
        </div>`;
    }

    // Review in progress — orchestrator is fanning out / aggregating.
    if (reviewInProgress) {
      return `
        <div class="progress-cta in-progress" role="region" aria-label="Review in progress">
          <div class="progress-cta-body">
            <div class="progress-cta-eyebrow">Review in progress</div>
            <h2>Reviewers are auditing the design</h2>
            <p>SAOrchestratorAgent has dispatched the four reviewer agents
            (architect, developer, ops, security) in parallel.
            ${reviewNote ? `<em>${escapeHtml(reviewNote)}</em> ` : ""}
            Each runs as a separate task; findings appear in chat once all
            four return. Click <strong>Continue in chat →</strong> to follow
            along.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
          </div>
        </div>`;
    }

    // Design DONE — Review is the next step.
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
            <p>Next step: <strong>Review</strong>. SAOrchestratorAgent fans
            out to four reviewer agents (architect, developer, ops, security)
            in parallel; each audits the design against a domain-specific
            rubric and records findings. You'll get a per-finding
            Apply / Defer / Discuss card in chat once they're done.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="start-review-btn" class="cta-btn">Start Review →</button>
            <a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View design →</a>
          </div>
          ${restartDesignRow}
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
            Click <strong>Continue in chat →</strong> to open the chat panel
            and answer the next form — each scope's artifact appears on the
            Artifacts tab as the agent finishes.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
          </div>
          ${restartDesignRow}
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
            <p>Next step: <strong>Design</strong>. SADomainAgent will walk
            the nine design scopes (topic taxonomy, broker selection,
            protocols, integration, mesh, HA/DR, SAM, event-portal,
            migration). Pick the pace: <strong>Start Design</strong>
            confirms every decision with you; <strong>Start Auto ⚡</strong>
            takes the recommended option for each and runs to the end —
            every decision still surfaces in chat as it's made.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="start-design-btn" class="cta-btn" data-mode="interactive">Start Design →</button>
            <button id="start-design-auto-btn" class="cta-btn cta-btn-auto" data-mode="auto"
                    title="Auto mode: take all recommended options; every decision still appears live in chat and is recorded in decisions.yaml with rationale.">Start Auto ⚡</button>
            <a class="cta-btn cta-btn-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View brief →</a>
          </div>
          ${restartDiscoveryRow}
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
            Click <strong>Continue in chat →</strong> to answer the next
            question — the brief appears here once the agent finishes its
            pass.</p>
          </div>
          <div class="progress-cta-actions progress-cta-actions-row">
            <button id="continue-in-chat-btn" class="cta-btn">Continue in chat →</button>
          </div>
          ${restartDiscoveryRow}
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
    // Lock the Start/Continue button on click so the user can't double-submit
    // before the agent has responded (and before lifecycle.steps.<step>.status
    // is written, which is what flips the CTA to "Continue in chat →"). The
    // disabled state survives until the next Progress page re-render, by
    // which point the lifecycle status is set and the CTA naturally swaps.
    const lockOnClick = (btn, startingLabel) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = startingLabel;
      });
    };
    const startDiscoveryBtn = root.querySelector("#start-discovery-btn");
    const continueBtn = root.querySelector("#continue-in-chat-btn");
    const startDesignBtn = root.querySelector("#start-design-btn");
    const startDesignAutoBtn = root.querySelector("#start-design-auto-btn");
    const startReviewBtn = root.querySelector("#start-review-btn");
    const startValidationBtn = root.querySelector("#start-validation-btn");
    const startBlueprintBtn = root.querySelector("#start-blueprint-btn");
    const startProvisioningBtn = root.querySelector("#start-provisioning-btn");
    const startProvisioningAutoBtn = root.querySelector("#start-provisioning-auto-btn");
    lockOnClick(startDiscoveryBtn, "Starting Discovery…");
    lockOnClick(continueBtn, "Opening chat…");
    lockOnClick(startDesignBtn, "Starting Design…");
    lockOnClick(startDesignAutoBtn, "Starting Auto…");
    lockOnClick(startReviewBtn, "Starting Review…");
    lockOnClick(startValidationBtn, "Starting Validation…");
    lockOnClick(startBlueprintBtn, "Starting Blueprint…");
    lockOnClick(startProvisioningBtn, "Starting Provisioning…");
    lockOnClick(startProvisioningAutoBtn, "Starting Auto…");

    // Shared kickoff body for Design; the click handlers prefix
    // "Mode: <mode>" so the Domain agent's prompt branches accordingly.
    const DESIGN_KICKOFF = "Discovery is complete. Read the discovery brief, then begin with topic-design (scope 1) and walk through the design scopes in their canonical order. Skip scopes the brief opts out of. Inside each scope, ask me only when there is a blocking decision to make.";
    // When EITHER design button is clicked, lock both so a fast double-tap
    // can't dispatch both interactive and auto for the same transition.
    const lockBothDesignButtons = () => {
      if (startDesignBtn) startDesignBtn.disabled = true;
      if (startDesignAutoBtn) startDesignAutoBtn.disabled = true;
    };

    startDiscoveryBtn?.addEventListener("click", () =>
      openChatWith(
        "Let's start discovery — please review the intake and ask your first follow-up.",
        "SADiscoveryAgent"));
    continueBtn?.addEventListener("click", () =>
      openChatWith("", null));
    startDesignBtn?.addEventListener("click", () => {
      lockBothDesignButtons();
      openChatWith(`Mode: interactive\n\n${DESIGN_KICKOFF}`, "SADomainAgent");
    });
    startDesignAutoBtn?.addEventListener("click", () => {
      lockBothDesignButtons();
      setAutoMode(eid, true);
      openChatWith(`Mode: auto\n\n${DESIGN_KICKOFF}`, "SADomainAgent");
    });
    // Start Review — same kickoff body as the chat-pane phase-handoff card
    // (PHASE_NEXT.design.kickoff). Routes to SAOrchestratorAgent which fans
    // out to the 4 reviewer agents via peer_<AgentName>.
    const REVIEW_KICKOFF = "Phase: review\n\nRun the Review phase. Fan out to peer_SAArchitectReviewerAgent, peer_SADeveloperReviewerAgent, peer_SAOpsReviewerAgent, peer_SASecurityReviewerAgent in this turn. After all four return, read_findings, write reviews/review-summary.md with severity counts + top concerns, then set_step_status(step=\"review\", status=...) per the rule (DONE if zero findings, DONE_WITH_CONCERNS if any finding recorded, BLOCKED if any reviewer returned BLOCKED).";
    startReviewBtn?.addEventListener("click", () =>
      openChatWith(REVIEW_KICKOFF, "SAOrchestratorAgent"));

    // Single-agent phases (validation/blueprint/provisioning) — direct
    // dispatch to the phase agent. Kickoff bodies match PHASE_NEXT entries
    // so both entry points (Progress CTA + chat phase-handoff card) lead
    // to the same conversation.
    startValidationBtn?.addEventListener("click", () =>
      openChatWith(PHASE_NEXT.review.kickoff, "SAValidationAgent"));
    startBlueprintBtn?.addEventListener("click", () =>
      openChatWith(PHASE_NEXT.validation.kickoff, "SABlueprintAgent"));
    const PROVISIONING_KICKOFF_BODY = PHASE_NEXT.blueprint.kickoff;
    startProvisioningBtn?.addEventListener("click", () =>
      openChatWith(`Mode: interactive\n\n${PROVISIONING_KICKOFF_BODY}`, "SAProvisioningAgent"));
    startProvisioningAutoBtn?.addEventListener("click", () =>
      openChatWith(`Mode: auto\n\n${PROVISIONING_KICKOFF_BODY}`, "SAProvisioningAgent"));

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
        // Backend cascade-wipes the full lifecycle from design through
        // provisioning. Mirror that on the frontend so every downstream
        // phase-handoff card can re-fire cleanly on the next run.
        ["discovery", "design", "review", "validation", "blueprint", "provisioning"]
          .forEach(step => _clearPhaseHint(eid, step));
        setAutoMode(eid, false);
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
        // The backend cascade-wipes EVERY downstream phase (review,
        // validation, blueprint, provisioning). Mirror that on the
        // frontend so a re-run can re-fire every handoff card cleanly.
        ["design", "review", "validation", "blueprint", "provisioning"]
          .forEach(step => _clearPhaseHint(eid, step));
        setAutoMode(eid, false);
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
      // Discovery done → next step is Design. Two buttons surface here:
      // Start Design (interactive — confirm every decision) and Start
      // Auto ⚡ (take all recommended options, run to completion). The
      // click handler picks up data-mode and prefixes the kickoff with
      // "Mode: <mode>" so the Domain agent branches on first turn.
      const designKickoff = "Discovery is complete. Read the discovery brief, then begin with topic-design (scope 1) and walk through the design scopes in their canonical order. Skip scopes the brief opts out of. Inside each scope, ask me only when there is a blocking decision to make.";
      action = {
        label: "Start Design →",
        agent: "SADomainAgent",
        prime: designKickoff,
        mode: "interactive",
        autoVariant: {
          label: "Start Auto ⚡",
          agent: "SADomainAgent",
          prime: designKickoff,
          mode: "auto",
          title: "Take all recommended options; every decision still appears live in chat as it's made.",
        },
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
                       data-agent="${escapeHtml(action.agent || "")}"
                       data-mode="${escapeHtml(action.mode || "interactive")}">${escapeHtml(action.label)}</button>`}
          ${action.autoVariant
            ? `<button class="cta-btn cta-btn-auto welcome-action"
                       data-prime="${escapeHtml(action.autoVariant.prime || "")}"
                       data-agent="${escapeHtml(action.autoVariant.agent || "")}"
                       data-mode="${escapeHtml(action.autoVariant.mode || "auto")}"
                       title="${escapeHtml(action.autoVariant.title || "")}">${escapeHtml(action.autoVariant.label)}</button>`
            : ""}
        </div>` : ""}
        <p class="welcome-hint">Or just type your question below — the agent has full project context.</p>
      </div>`;

    chatLog.querySelectorAll(".welcome-action[data-prime]").forEach(btn => {
      btn.addEventListener("click", () => {
        // Disable on first click — same double-submit guard as the
        // Progress CTA and Phase Handoff card. Welcome-card buttons
        // auto-submit a primed message; without the lock a double
        // tap fires two POSTs to /api/chat/message. Also lock the
        // sibling action button (the Interactive/Auto pair) so the
        // user can't accidentally fire both modes for the same phase.
        if (btn.disabled) return;
        chatLog.querySelectorAll(".welcome-action[data-prime]").forEach(b => b.disabled = true);
        const originalLabel = btn.textContent;
        btn.textContent = originalLabel.replace(/[→⚡]\s*$/,"").trim() + "…";
        const rawPrime = btn.getAttribute("data-prime") || "";
        const mode = btn.getAttribute("data-mode") || "interactive";
        // Prepend the mode marker as the first line; Domain reads it
        // on the first turn and branches into Auto-mode rules if set.
        const prime = rawPrime ? `Mode: ${mode}\n\n${rawPrime}` : rawPrime;
        const agent = btn.getAttribute("data-agent") || "";
        // Auto mode arms the per-scope dispatch loop so finalizeAgentBubble
        // chains scope-N+1 once scope-N marks done.
        if (mode === "auto") setAutoMode(currentProjectId?.(), true);
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
  // are tool-call internals, surfaced separately via extractDataParts).
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

  // Pull SAM data-part signals (tool_invocation_start, tool_result, etc.) out
  // of an A2A event. Discriminator is data.type per solace_agent_mesh.common.data_parts.
  function extractDataParts(ev) {
    const ed = ev?.data || {};
    const parts = [];
    const msgParts = ed.status?.message?.parts;
    if (Array.isArray(msgParts)) parts.push(...msgParts);
    if (Array.isArray(ed.artifacts)) {
      for (const a of ed.artifacts) {
        if (Array.isArray(a.parts)) parts.push(...a.parts);
      }
    }
    return parts
      .filter(p => p && (p.kind === "data" || p.type === "data") && p.data && typeof p.data === "object")
      .map(p => p.data);
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

  // Live agent-activity bar: a sticky one-liner above the chat log that
  // mirrors the latest status text or tool-trace label, so the user can
  // always see what the agent is doing right now without scrolling
  // through the bubble. Cleared (and hidden) by finalizeAgentBubble.
  const chatActivityBar = document.getElementById("chat-activity-bar");
  function setActivityBar(text) {
    if (!chatActivityBar) return;
    if (text) {
      chatActivityBar.textContent = text;
      chatActivityBar.classList.remove("hidden");
    } else {
      chatActivityBar.textContent = "";
      chatActivityBar.classList.add("hidden");
    }
  }

  // Heuristic: does this look like the continuation of the previous
  // pill rather than a fresh status? SAM's resolver sometimes flushes
  // the agent's status text mid-word ("republ" then "ish)"), and each
  // chunk independently passes isStatusPill — surfacing as two pills
  // where the second is meaningless on its own. If `text` starts with
  // a lowercase letter, a closing bracket, or punctuation, treat it
  // as a continuation of the previous pill.
  function _looksLikeContinuation(text) {
    if (!text) return false;
    const first = text.trimStart().charAt(0);
    if (!first) return false;
    // Lowercase letter, closing brace/bracket/paren, or sentence-tail
    // punctuation → continuation of an unfinished prior pill.
    return /[a-z\)\]\}\.\,\;\:\!\?…]/.test(first);
  }

  function appendActivityPill(text) {
    if (!pendingAgentMsg) return;
    // Merge into the previous pill if this fragment looks like a
    // continuation (mid-word buffer flush). Without this the user sees
    // pills like "REST for republ" followed by "ish)" — visually broken.
    const prev = pendingAgentMsg.pills[pendingAgentMsg.pills.length - 1];
    if (prev && _looksLikeContinuation(text)) {
      const span = prev.el.querySelector(".activity-pill-text");
      if (span) {
        prev.text = (prev.text || "") + text;
        span.textContent = prev.text;
      }
      setActivityBar(prev.text);
      chatLog.scrollTop = chatLog.scrollHeight;
      return;
    }
    setActivityBar(text);
    // Mark previous pill as done.
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

  // Render args dict as `key="abbrev", key2=12` — capped to 3 keys + ellipsis.
  function summarizeToolArgs(args) {
    if (!args || typeof args !== "object") return "()";
    const keys = Object.keys(args);
    if (!keys.length) return "()";
    const fmt = (v) => {
      if (typeof v === "string") return `"${v.length > 30 ? v.slice(0, 27) + "…" : v}"`;
      if (v === null || typeof v !== "object") return String(v);
      return Array.isArray(v) ? `[${v.length}]` : "{…}";
    };
    return "(" + keys.slice(0, 3).map(k => `${k}=${fmt(args[k])}`).join(", ")
      + (keys.length > 3 ? ", …" : "") + ")";
  }

  // Map known tool names to human-readable trace-pill labels, with the
  // most useful arg woven in. Anything not in this map falls back to
  // the raw tool name + summarised arg list (the previous behaviour).
  // Keep labels short — they sit inside a pill row in the chat panel.
  function friendlyToolLabel(name, args) {
    args = args || {};
    const trunc = (s, n = 40) => (s && s.length > n) ? s.slice(0, n - 1) + "…" : (s || "");
    switch (name) {
      case "load_preamble":         return "Loading shared guidance";
      case "load_jargon_list":      return "Loading terminology list";
      case "load_grounding":        return `Loading docs — ${trunc(args.topic || "?")}`;
      case "fetch_canonical_source":return `Fetching ${trunc(args.url_or_topic || "?")}`;
      case "query_integration_hub": return `Checking Integration Hub for ${trunc(args.backend_system || "?")}`;
      case "record_grounding_gap":  return `Flagging missing grounding (${trunc(args.topic || "?")})`;
      case "list_projects":         return "Listing projects";
      case "list_artifacts":        return args.category ? `Listing artifacts (${trunc(args.category)})` : "Listing artifacts";
      case "read_artifact":         return `Reading ${trunc(args.artifact_name || "artifact")}`;
      case "write_artifact":        return `Writing ${trunc(args.artifact_name || "artifact")}`;
      case "record_decision":       return `Recording decision — ${trunc(args.context || "")}`;
      case "read_decisions":        return "Reading prior decisions";
      case "record_finding":        return `Recording finding (${trunc(args.severity || "")})`;
      case "read_findings":         return "Reading findings";
      case "update_finding_status": return `Updating finding ${trunc(args.finding_id || "")} → ${trunc(args.new_status || "")}`;
      case "record_open_item":      return `Logging open item (${trunc(args.severity || "")})`;
      case "read_open_items":       return "Reading open items";
      case "update_open_item_status":return `Updating open item ${trunc(args.item_id || "")} → ${trunc(args.new_status || "")}`;
      case "record_feedback":       return "Recording feedback";
      case "read_feedback":         return "Reading feedback";
      case "ask_user_question":     return `Preparing question — ${trunc(args.question_id || args.question || "")}`;
      case "set_step_status":       return `Step ${trunc(args.step || "?")} → ${trunc(args.status || "?")}`;
      case "get_engagement_status": return "Reading step statuses";
      case "clear_step_status":     return `Clearing step status — ${trunc(args.step || "?")}`;
      case "parse_intake_document": return "Parsing intake document";
      case "export_intake_from_project":return "Exporting intake from project";
      case "import_source_context": return "Importing source context";
      default:                      return null;  // null → fall back to raw name + args
    }
  }

  // tool_invocation_start → add an in-progress trace pill.
  function appendToolTrace(d) {
    // Skip framework-internal tools — names that start with `_` are
    // SAM/ADK plumbing (e.g. `_continue_generation` fires when the LLM
    // hits max tokens and SAM auto-continues; `_notify_artifact_save`
    // is internal book-keeping). Surfacing these as user-visible pills
    // is just noise — the user sees "_continue_generation ()" with no
    // context. Real tools (read_artifact, record_decision, etc.) never
    // have an underscore prefix.
    if (d.tool_name && d.tool_name.startsWith("_")) return;
    if (!pendingAgentMsg) openThinkingBubble();
    const prev = pendingAgentMsg.pills[pendingAgentMsg.pills.length - 1];
    if (prev) {
      prev.el.classList.remove("in-progress");
      prev.el.classList.add("done");
      const icon = prev.el.querySelector(".activity-pill-icon");
      if (icon) icon.textContent = "✓";
    }
    const pill = document.createElement("div");
    pill.className = "activity-pill tool-call in-progress";
    pill.innerHTML = `<span class="activity-pill-icon">⏳</span>`
      + `<span class="activity-pill-text">`
      + `<span class="tool-call-name"></span>`
      + `<span class="tool-call-args"></span>`
      + `</span>`;
    const friendly = friendlyToolLabel(d.tool_name, d.tool_args);
    // Mirror into the sticky activity bar so the user sees the current
    // step without scrolling. Both paths feed it.
    setActivityBar(friendly || `${d.tool_name || "(tool)"}…`);
    if (friendly) {
      // Friendly path — single line, no monospace blob of raw args.
      pill.querySelector(".tool-call-name").textContent = friendly;
      pill.querySelector(".tool-call-args").textContent = "";
      pill.classList.add("tool-call-friendly");
    } else {
      // Unknown tool — fall back to raw name + summarised args so we
      // still show something useful for tools we haven't labelled yet.
      pill.querySelector(".tool-call-name").textContent = d.tool_name || "(unknown)";
      pill.querySelector(".tool-call-args").textContent = summarizeToolArgs(d.tool_args);
    }
    pendingAgentMsg.pillsContainer.appendChild(pill);
    const entry = { el: pill, text: d.tool_name || "(unknown)", fnCallId: d.function_call_id };
    pendingAgentMsg.pills.push(entry);
    if (d.function_call_id) pendingAgentMsg.pillByCallId.set(d.function_call_id, entry);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // tool_result → mark the matching pill done (by function_call_id).
  function completeToolTrace(d) {
    if (!pendingAgentMsg) return;
    const entry = d.function_call_id ? pendingAgentMsg.pillByCallId.get(d.function_call_id) : null;
    if (entry) {
      entry.el.classList.remove("in-progress");
      entry.el.classList.add("done");
      const icon = entry.el.querySelector(".activity-pill-icon");
      if (icon) icon.textContent = "✓";
    }
    // Independently of pill matching, look for a step-completion signal so
    // the handoff card can render once this turn finalizes.
    _queuePhaseHandoffFromToolResult(d);
  }

  // Phase-handoff: shared vocabulary used by the in-chat completion card and
  // (downstream) the Progress CTA, so the user sees the same next-action label
  // wherever the system points it out. Keep entries even for phases whose next
  // agent isn't wired yet — we still want to render "complete" cards for them.
  const PHASE_NEXT = {
    discovery: {
      nextLabel: "Design",
      ctaLabel: "Start Design →",
      agent: "SADomainAgent",
      kickoff: "Discovery is complete. Read the discovery brief, then begin with topic-design (scope 1) and walk through the design scopes in their canonical order. Skip scopes the brief opts out of. Inside each scope, ask me only when there is a blocking decision to make.",
    },
    design: {
      nextLabel: "Review",
      ctaLabel: "Start Review →",
      agent: "SAOrchestratorAgent",
      kickoff: "Phase: review\n\nRun the Review phase. Fan out to peer_SAArchitectReviewerAgent, peer_SADeveloperReviewerAgent, peer_SAOpsReviewerAgent, peer_SASecurityReviewerAgent in this turn. After all four return, read_findings, write reviews/review-summary.md with severity counts + top concerns, then set_step_status(step=\"review\", status=...) per the rule (DONE if zero critical, DONE_WITH_CONCERNS if any critical/important, BLOCKED if any reviewer returned BLOCKED).",
      // Reviewers are non-interactive (no per-finding chat questions),
      // so the Auto/Interactive distinction has no semantic effect for
      // this phase — render a single CTA.
      singleAction: true,
    },
    review: {
      nextLabel: "Validation",
      ctaLabel: "Start Validation →",
      agent: "SAValidationAgent",
      kickoff: "Phase: validation\n\nRun the Validation phase. Apply your 6-criterion rubric (requirement coverage, antipattern scan, consistency, deferred findings, terminology compliance, schema sanity). Record blocking open-items with affecting_step=\"blueprint\" so the lifecycle gates correctly. Write validation/validation-report.md and the machine YAML. Call set_step_status(step=\"validation\", ...) per the rule.",
      singleAction: true,
    },
    validation: {
      nextLabel: "Blueprint",
      ctaLabel: "Start Blueprint →",
      agent: "SABlueprintAgent",
      kickoff: "Phase: blueprint\n\nAssemble the final blueprint package. Read all design/review/validation artifacts. Compose blueprint/architecture.md + blueprint/runbook.md, write available Mermaid diagrams, render 5 audience packs (blueprint/executive/admin-ops/security/developers, both md+pdf), then assemble_zip to produce exports/engagement-package.zip. Call set_step_status(step=\"blueprint\", ...) per the rule.",
      singleAction: true,
    },
    blueprint: {
      nextLabel: "Provisioning",
      ctaLabel: "Start Provisioning →",
      agent: "SAProvisioningAgent",
      kickoff: "Phase: provisioning\n\nProvision the Event Portal model. Pre-flight (opt-in check + verify_tenant_access + validation gate), then dry-run plan, then per-layer creation [domains → schemas → events → applications] with reuse-by-content-match. Export AsyncAPI per provisioned application. Call set_step_status(step=\"provisioning\", ...) per the rule.",
      // Provisioning supports Mode: auto / Mode: interactive — render
      // both buttons so the user can choose per-layer confirmation vs
      // hands-off execution.
    },
  };

  // localStorage dedup so the in-chat handoff card fires only once per
  // (engagement, phase) transition into DONE. Cleared when the phase status
  // moves AWAY from DONE (e.g. user clicked Restart), so a fresh completion
  // re-fires the card.
  function _phaseHintKey(eid) { return `sa.hint.phase_done.${eid}`; }
  function _readPhaseHintSet(eid) {
    if (!eid) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(_phaseHintKey(eid)) || "[]")); }
    catch { return new Set(); }
  }
  function _writePhaseHintSet(eid, set) {
    if (!eid) return;
    try { localStorage.setItem(_phaseHintKey(eid), JSON.stringify([...set])); } catch {}
  }
  function _markPhaseHintShown(eid, step) {
    const set = _readPhaseHintSet(eid);
    set.add(step);
    _writePhaseHintSet(eid, set);
  }
  function _clearPhaseHint(eid, step) {
    const set = _readPhaseHintSet(eid);
    if (set.delete(step)) _writePhaseHintSet(eid, set);
  }

  // Queue handoff cards seen via SSE tool_result so they render AFTER the
  // agent's final answer (not mid-stream). Drained from finalizeAgentBubble.
  let _pendingPhaseHandoffs = [];

  function _queuePhaseHandoffFromToolResult(d) {
    if (d?.tool_name !== "set_step_status") return;
    const result = d.result_data;
    const data = result?.data || result || {};
    const step = data.step;
    const status = data.status;
    if (!step || !status) return;
    if (status !== "DONE" && status !== "DONE_WITH_CONCERNS") return;
    _pendingPhaseHandoffs.push({ step, status });
  }

  function _drainPendingPhaseHandoffs() {
    while (_pendingPhaseHandoffs.length) {
      const { step, status } = _pendingPhaseHandoffs.shift();
      // Review completion always renders the findings card first; the
      // phase-handoff card (review → validation) only renders when
      // validation has a PHASE_NEXT entry (i.e. validation agent is wired).
      if (step === "review") {
        renderFindingsCard().catch(() => { /* best-effort */ });
      }
      renderPhaseHandoffCard(step, status);
    }
  }

  // Build the findings card shown after Review completes. Fetches the
  // engagement's findings via /api/engagements/<eid>/findings (only
  // status=pending — applied/deferred findings are excluded so the user
  // sees what still needs action). For each finding, render a row with
  // Apply / Defer / Discuss buttons; clicking dispatches a follow-up
  // chat message to SAOrchestratorAgent, which the orchestrator's
  // prompt handles via update_finding_status / peer dispatch.
  async function renderFindingsCard() {
    const eid = currentProjectId?.();
    if (!eid) return;
    // Dedup — if a findings card is already on screen this session,
    // skip. Re-renders can fire if the orchestrator calls
    // set_step_status(step="review") twice (e.g. after a Discuss round
    // that re-runs aggregation). Use a single card per session; pending
    // findings update naturally as the user clicks Apply/Defer.
    if (chatLog.querySelector(".findings-card")) return;
    let findings;
    try {
      findings = await fetch(`/api/engagements/${encodeURIComponent(eid)}/findings?status=pending`)
        .then(r => r.json());
    } catch { return; }
    if (!Array.isArray(findings) || !findings.length) {
      // Review produced no findings — render a tiny "all clear" card.
      const ok = document.createElement("div");
      ok.className = "chat-msg agent findings-card findings-empty";
      ok.innerHTML = `
        <div class="findings-header">✓ Review complete — no findings recorded.</div>
        <p class="muted">All four reviewer agents (architect / developer / ops / security) audited the design and found no issues to address.</p>`;
      chatLog.appendChild(ok);
      chatLog.scrollTop = chatLog.scrollHeight;
      return;
    }

    // Group by severity, then by source agent.
    const bySeverity = { critical: [], important: [], advisory: [] };
    for (const f of findings) {
      const sev = (f.severity || "advisory").toLowerCase();
      if (bySeverity[sev]) bySeverity[sev].push(f);
      else bySeverity.advisory.push(f);
    }

    const card = document.createElement("div");
    card.className = "chat-msg agent findings-card";
    const counts = `${bySeverity.critical.length} critical · ${bySeverity.important.length} important · ${bySeverity.advisory.length} advisory`;
    card.innerHTML = `
      <div class="findings-header">
        <span class="findings-icon">🔍</span>
        <span class="findings-title">Review findings</span>
        <span class="findings-counts">${escapeHtml(counts)}</span>
      </div>
      <p class="muted">For each finding, choose <strong>Apply</strong> (Domain fixes it), <strong>Defer</strong> (converts to an open-item), or <strong>Discuss</strong> (ask the source reviewer a question).</p>
      <div class="findings-list"></div>`;
    const list = card.querySelector(".findings-list");
    const renderGroup = (sev) => {
      const items = bySeverity[sev];
      if (!items.length) return;
      for (const f of items) {
        const row = document.createElement("div");
        row.className = `finding-row severity-${escapeHtml(sev)}`;
        row.dataset.findingId = f.id;
        row.innerHTML = `
          <div class="finding-header">
            <span class="finding-badge severity-${escapeHtml(sev)}">${escapeHtml(sev.toUpperCase())}</span>
            <span class="finding-id">${escapeHtml(f.id || "?")}</span>
            <span class="finding-source">${escapeHtml(f.source_agent || "")}</span>
          </div>
          <div class="finding-body">
            <div class="finding-desc">${escapeHtml(f.description || "")}</div>
            <div class="finding-affected"><strong>Affected:</strong> <code>${escapeHtml(f.affected_artifact || "")}</code></div>
            <div class="finding-rec"><strong>Recommendation:</strong> ${escapeHtml(f.recommendation || "")}</div>
          </div>
          <div class="finding-actions">
            <button type="button" class="cta-btn finding-apply" data-action="Apply">Apply</button>
            <button type="button" class="cta-btn cta-btn-secondary finding-defer" data-action="Defer">Defer</button>
            <button type="button" class="cta-btn cta-btn-secondary finding-discuss" data-action="Discuss">Discuss</button>
          </div>`;
        list.appendChild(row);
      }
    };
    renderGroup("critical");
    renderGroup("important");
    renderGroup("advisory");

    // Wire button clicks — each one dispatches a follow-up chat message
    // to SAOrchestratorAgent. The orchestrator's prompt knows how to
    // handle "Apply finding F<id>" / "Defer finding F<id>" / "Discuss
    // finding F<id>: <question>" inputs (Finding resolution protocol).
    card.querySelectorAll(".finding-row").forEach(row => {
      const fid = row.dataset.findingId;
      row.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          const action = btn.dataset.action;
          // For Discuss, prompt the user for the question inline.
          let kickoff;
          if (action === "Discuss") {
            const q = window.prompt(
              `Discuss finding ${fid} — what's your question for the reviewer?`,
              ""
            );
            if (!q || !q.trim()) return;
            kickoff = `Discuss finding ${fid}: ${q.trim()}`;
          } else {
            kickoff = `${action} finding ${fid}`;
          }
          // Lock just this row's buttons so the user can act on other
          // findings while this one is in flight.
          row.querySelectorAll("[data-action]").forEach(b => b.disabled = true);
          row.classList.add("finding-row-pending");

          // Dispatch via the existing chat path; SAOrchestratorAgent is
          // already the current agent post-Review.
          applyChat("open");
          const sel = document.getElementById("chat-agent-select");
          if (sel) {
            const opt = Array.from(sel.options).find(o => o.value === "SAOrchestratorAgent");
            if (opt) sel.value = "SAOrchestratorAgent";
          }
          const ci = document.getElementById("chat-input");
          if (ci) {
            ci.value = kickoff;
            chatForm?.requestSubmit?.();
          }
        });
      });
    });

    chatLog.appendChild(card);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // Render the explicit "phase complete → next action" card. Idempotent via
  // _readPhaseHintSet so calling it from both SSE and the lifecycle poller
  // doesn't double up.
  function renderPhaseHandoffCard(step, status) {
    const eid = currentProjectId();
    if (!eid) return;
    if (_readPhaseHintSet(eid).has(step)) return;
    const cfg = PHASE_NEXT[step];
    if (!cfg) return;
    _markPhaseHintShown(eid, step);

    const stepDisplay = step.charAt(0).toUpperCase() + step.slice(1);
    const statusPhrase = status === "DONE_WITH_CONCERNS"
      ? "complete (with concerns)" : "complete";

    const card = document.createElement("div");
    card.className = "chat-msg agent phase-handoff";
    const showBothModes = cfg.agent && cfg.kickoff && !cfg.singleAction;
    const bodyText = showBothModes
      ? `Ready to move forward? Pick the pace: <strong>${escapeHtml(cfg.ctaLabel)}</strong> walks you through every decision; <strong>Start Auto ⚡</strong> takes the recommended option for each and runs straight to the end — every decision shows up live in chat so you can review.`
      : (cfg.agent && cfg.kickoff)
        ? `Ready to move forward? Click <strong>${escapeHtml(cfg.ctaLabel)}</strong> to begin.`
        : escapeHtml(cfg.pendingMessage || `Next phase (${cfg.nextLabel}) isn't wired up yet — check back soon.`);
    card.innerHTML = `
      <div class="phase-handoff-eyebrow">${escapeHtml(step)} → ${escapeHtml(cfg.nextLabel)}</div>
      <h3 class="phase-handoff-title">${escapeHtml(stepDisplay)} is ${statusPhrase}</h3>
      <p class="phase-handoff-body">${bodyText}</p>
      <div class="phase-handoff-actions">
        ${cfg.agent ? `<button type="button" class="phase-handoff-cta" data-mode="interactive">${escapeHtml(cfg.ctaLabel)}</button>` : ""}
        ${showBothModes ? `<button type="button" class="phase-handoff-cta phase-handoff-cta-auto" data-mode="auto" title="Take all recommended options; each decision still appears in chat as it's made.">Start Auto ⚡</button>` : ""}
        <a class="phase-handoff-secondary" href="/projects/${encodeURIComponent(eid)}/artifacts">View artifacts</a>
      </div>
      <small class="phase-handoff-hint">To redo ${escapeHtml(stepDisplay)} from scratch, use <em>Restart ${escapeHtml(stepDisplay)}</em> on the Progress page (rare; only when requirements have materially changed).</small>
    `;

    card.querySelectorAll(".phase-handoff-cta").forEach(btn => {
      btn.addEventListener("click", () => {
        // Disable BOTH mode buttons on click so a fast double-tap can't
        // fire interactive AND auto for the same phase transition.
        card.querySelectorAll(".phase-handoff-cta").forEach(b => b.disabled = true);
        const mode = btn.dataset.mode || "interactive";
        btn.textContent = mode === "auto" ? "Starting Auto…" : `${cfg.ctaLabel.replace(/→$/,"").trim()}…`;
        applyChat("open");
        if (cfg.agent) {
          const sel = document.getElementById("chat-agent-select");
          if (sel) {
            const opt = Array.from(sel.options).find(o => o.value === cfg.agent);
            if (opt) sel.value = cfg.agent;
          }
        }
        // Auto mode arms the per-scope dispatch loop for the current
        // engagement; the loop chains scope-N+1 once scope-N marks done.
        if (mode === "auto") setAutoMode(currentProjectId?.(), true);
        if (cfg.kickoff) {
          const ci = document.getElementById("chat-input");
          if (ci) {
            // Prepend the mode marker as the first line — Domain's prompt
            // reads it on the first turn and switches behaviour accordingly.
            ci.value = `Mode: ${mode}\n\n${cfg.kickoff}`;
            ci.focus();
            chatForm.requestSubmit?.();
          }
        }
      });
    });

    chatLog.appendChild(card);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // Lightweight poller — fallback for cases where the in-chat SSE trigger
  // misses: agent updated status from a non-chat path, user reloaded the
  // page mid-turn, or the chat panel was closed when DONE fired. Also
  // catches the reverse transition (DONE → anything else, e.g. restart)
  // and clears the dedup flag so the next DONE re-fires the card.
  const _lastLifecycleStatuses = {};
  async function pollLifecycle() {
    const eid = currentProjectId();
    if (!eid) return;
    let lc;
    try {
      lc = await fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`).then(r => r.json());
    } catch (e) { return; }
    const steps = lc?.steps || {};
    const seenSteps = new Set();
    for (const [step, info] of Object.entries(steps)) {
      seenSteps.add(step);
      const status = info?.status || "NOT_STARTED";
      const key = `${eid}/${step}`;
      const prev = _lastLifecycleStatuses[key];
      _lastLifecycleStatuses[key] = status;
      const isDone = status === "DONE" || status === "DONE_WITH_CONCERNS";
      const wasDone = prev === "DONE" || prev === "DONE_WITH_CONCERNS";
      // Transition INTO DONE — render handoff card (idempotent via seen-set).
      if (prev !== undefined && !wasDone && isDone) {
        renderPhaseHandoffCard(step, status);
      }
      // Transition OUT of DONE — clear the dedup flag so the next DONE re-fires,
      // and also clear the sticky agent for this engagement so a fresh
      // restart re-binds the dropdown to the configured default.
      if (wasDone && !isDone) {
        _clearPhaseHint(eid, step);
        clearStickyAgent(eid);
      }
    }
    // If a step disappeared from the lifecycle file (e.g., restart cleared it
    // entirely), also clear the hint and sticky-agent so a fresh completion
    // re-fires and the next engagement opens on the configured default.
    for (const key of Object.keys(_lastLifecycleStatuses)) {
      if (!key.startsWith(`${eid}/`)) continue;
      const step = key.slice(eid.length + 1);
      if (!seenSteps.has(step) && _lastLifecycleStatuses[key]) {
        _clearPhaseHint(eid, step);
        clearStickyAgent(eid);
        delete _lastLifecycleStatuses[key];
      }
    }
  }
  setInterval(pollLifecycle, 5000);

  // Empty-response card: rendered by finalizeAgentBubble when the agent
  // task ended with no actionable content (no text, no form card, no
  // markdown-fallback chips, no phase-handoff). The Continue button
  // submits a "continue" message routed to whichever agent is currently
  // selected in the dropdown — typically the same agent that just went
  // silent, so it picks up from where it stopped.
  function renderAgentEmptyCard() {
    const card = document.createElement("div");
    card.className = "chat-msg agent agent-empty";
    card.innerHTML = `
      <div class="agent-empty-eyebrow">No follow-up received</div>
      <p class="agent-empty-body">
        The agent finished this turn without asking the next question or
        signalling completion. Your last input was processed (decisions
        recorded, artifacts written if applicable), but the agent didn't
        chain to the next step.
      </p>
      <p class="agent-empty-body agent-empty-hint">
        Click <strong>Continue</strong> to nudge the agent forward, or
        type your own follow-up below.
      </p>
      <div class="agent-empty-actions">
        <button type="button" class="agent-empty-cta">Continue ↻</button>
      </div>
    `;
    card.querySelector(".agent-empty-cta").addEventListener("click", () => {
      const btn = card.querySelector(".agent-empty-cta");
      btn.disabled = true;
      btn.textContent = "Continuing…";
      const ci = document.getElementById("chat-input");
      if (ci) {
        ci.value = "Continue — please proceed with the next step.";
        chatForm.requestSubmit?.();
      }
    });
    chatLog.appendChild(card);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // Layer A: paint the placeholder + animated dots as soon as the user submits,
  // before any SSE event arrives. The dots are removed when first text streams in
  // (or, failing that, in finalizeAgentBubble).
  function openThinkingBubble() {
    if (pendingAgentMsg) return;
    setActivityBar("Thinking…");
    _stampSse();  // fresh turn → reset the silence timer baseline
    chatLog.querySelector(".chat-empty")?.remove();
    chatLog.querySelector(".welcome-card")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "chat-msg agent agent-thinking agent-turn";
    const pillsContainer = document.createElement("div");
    pillsContainer.className = "activity-pills";
    const dots = document.createElement("div");
    dots.className = "agent-thinking-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";
    const bubble = document.createElement("div");
    bubble.className = "agent-turn-text";
    wrap.appendChild(pillsContainer);
    wrap.appendChild(dots);
    wrap.appendChild(bubble);
    chatLog.appendChild(wrap);
    pendingAgentMsg = {
      el: wrap, lastText: "", pillsContainer, bubbleEl: bubble,
      dotsEl: dots, pills: [], pillByCallId: new Map(),
    };
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function startOrUpdateAgentBubble(text) {
    if (!text) return;
    chatLog.querySelector(".chat-empty")?.remove();
    chatLog.querySelector(".welcome-card")?.remove();
    const display = maskQuestionBlockDuringStream(text);
    const isPill = isStatusPill(text);

    if (!pendingAgentMsg) {
      // Fallback path — SSE event arrived without a prior submit (reconnect, etc).
      const wrap = document.createElement("div");
      wrap.className = "chat-msg agent agent-thinking agent-turn";
      const pillsContainer = document.createElement("div");
      pillsContainer.className = "activity-pills";
      const bubble = document.createElement("div");
      bubble.className = "agent-turn-text";
      wrap.appendChild(pillsContainer);
      wrap.appendChild(bubble);
      chatLog.appendChild(wrap);
      pendingAgentMsg = {
        el: wrap, lastText: text, pillsContainer, bubbleEl: bubble,
        dotsEl: null, pills: [], pillByCallId: new Map(),
      };
      if (isPill) {
        appendActivityPill(text);
      } else {
        renderAgentMarkdown(bubble, display);
      }
    } else if (text !== pendingAgentMsg.lastText) {
      // First real text — kill the thinking dots.
      if (pendingAgentMsg.dotsEl) {
        pendingAgentMsg.dotsEl.remove();
        pendingAgentMsg.dotsEl = null;
      }
      pendingAgentMsg.lastText = text;
      if (isPill) {
        const last = pendingAgentMsg.pills[pendingAgentMsg.pills.length - 1];
        if (!last || last.text !== text) appendActivityPill(text);
      } else {
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
      if (pendingAgentMsg.dotsEl) {
        pendingAgentMsg.dotsEl.remove();
        pendingAgentMsg.dotsEl = null;
      }
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
        // Capture by reference — pendingAgentMsg is set to null below, so
        // the click handler can't read it later.
        const pillsContainerRef = pendingAgentMsg.pillsContainer;
        const summary = document.createElement("div");
        summary.className = "activity-pills-summary";
        summary.innerHTML = `<span class="activity-pill-icon">✓</span><span>${n} step${n === 1 ? "" : "s"} (click to expand)</span>`;
        summary.addEventListener("click", () => {
          pillsContainerRef.classList.toggle("expanded");
          summary.classList.toggle("expanded");
        });
        pillsContainerRef.classList.add("collapsed");
        pillsContainerRef.parentNode.insertBefore(summary, pillsContainerRef);
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
    // the tool-call rule), try two pattern detectors and offer a
    // clickable chip row + optional note. The user gets the same
    // form-like UX without typing the answer in chat.
    //   1) detectReplyPattern: "Reply: A, B, C" letter-list footers.
    //   2) detectOptionsPattern: "**Option N (Recommended): Title**"
    //      headers + "Which option do you prefer?" tail. Catches the
    //      Domain agent's design-decision shape.
    let renderedChips = false;
    if (!blocks.length && cleanText) {
      const detected = detectReplyPattern(cleanText) || detectOptionsPattern(cleanText);
      if (detected) {
        const chips = renderQuickReplyChips(detected);
        chatLog.appendChild(chips);
        chatLog.scrollTop = chatLog.scrollHeight;
        renderedChips = true;
      }
    }

    // Empty-response handling: when the agent finishes without giving
    // the user anything actionable (no text body, no form card, no
    // quick-reply chips, no phase-handoff queued), render a small
    // "agent finished without a follow-up" card with a Continue button.
    // Without this, the user sees a stuck thinking-dots placeholder
    // and has no signal that the turn ended. Symptom we hit: Domain
    // recorded the user's decision then stopped emitting tool calls,
    // leaving the chat in apparent limbo.
    const producedActionable = cleanText || blocks.length || renderedChips || _pendingPhaseHandoffs.length;
    if (!producedActionable) {
      renderAgentEmptyCard();
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

    // Render any phase-handoff cards queued from set_step_status tool_result
    // events this turn. Deferred to here so they sit AFTER the agent's final
    // text instead of interrupting the stream.
    _drainPendingPhaseHandoffs();

    // Turn is done — hide the sticky activity bar until the next turn opens.
    setActivityBar(null);

    // Re-render the current page if we're on Progress / Overview so the
    // CTA reflects the latest lifecycle status — flips Start Discovery →
    // Continue in chat the moment the agent's first set_step_status lands,
    // closing the "button stays clickable after I clicked it" window.
    try {
      const view = (typeof currentView === "function") ? currentView() : "";
      if (view === "overview" || view === "progress") {
        if (typeof render === "function") render();
      }
    } catch { /* swallow — re-render is best-effort */ }

    // Auto-mode dispatch: if the turn we just finished closed a Design
    // scope (record_scope_progress with next_scope set) and Auto mode is
    // still armed for this engagement, render the advancing card and
    // schedule the next-scope kickoff. No-op when off / not applicable.
    _maybeAutoAdvance().catch(() => { /* best-effort */ });
  }

  // Normalize the question-card counter. The agent sometimes emits
  // self-defeating values like "Q1 of ~1 for topic-design" — the
  // "of ~1" carries no information (it claims there's exactly one
  // question while we're on it). Detect and trim such patterns; if
  // nothing meaningful remains, return null so the counter is omitted.
  function sanitizeCounter(s) {
    if (!s || typeof s !== "string") return null;
    let t = s.trim();
    if (!t) return null;
    // Strip "of ~0" / "of ~1" / "of 0" / "of 1" — meaningless totals.
    t = t.replace(/\s+of\s+~?\s*[01]\b/i, "").trim();
    // Strip "of ~<m>" when current >= m (e.g., "Q3 of ~2"). Likely an
    // LLM estimation error; better to show just the current index.
    t = t.replace(/Q(\d+)\s+of\s+~?\s*(\d+)/i, (m, cur, tot) =>
      parseInt(cur, 10) >= parseInt(tot, 10) ? `Q${cur}` : m);
    return t || null;
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
    const counterText = sanitizeCounter(schema.counter);
    if (counterText) {
      const counter = document.createElement("span");
      counter.className = "question-counter";
      counter.textContent = counterText;
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
  // Second safety net for the form-fallback path. The Domain agent
  // sometimes emits a structured question as markdown with bold
  // "**Option 1 (Recommended): Title**" / "**Option 2: Title**" headers
  // and a "Which option do you prefer?" tail. detectReplyPattern's
  // letter-list logic doesn't catch this — the labels are full prose,
  // not single letters. detectOptionsPattern picks up the option
  // headers and produces a richer chip payload with the labels intact.
  function detectOptionsPattern(text) {
    if (!text) return null;
    // Match an option header at line start:
    //   "**Option 1 (Recommended): Title**"
    //   "**Option 2: Title**"
    //   "Option 3: Title"
    //   "**Option 4 — Title**"   (em dash, no parenthetical)
    // The label captures the first prose line; pros/cons / bullets are
    // on subsequent lines and not part of the header.
    const re = /^\s*(?:\*\*)?\s*Option\s+(\d+)(?:\s*[\(—–\-:]\s*([^\)\n*]+?)\s*\)?)?\s*[:—–\-]?\s*([^\*\n]*?)\s*(?:\*\*)?\s*$/gim;
    const opts = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const num = m[1];
      const tag = (m[2] || "").trim();   // could be "Recommended", or empty
      const tail = (m[3] || "").trim();  // could be the label or empty
      // Heuristic: if tag is non-empty AND not "Recommended"-ish, treat as label
      const isRecTag = /^recommended$|^recommend/i.test(tag);
      const label = tail || (isRecTag ? "" : tag);
      if (!label) continue;
      opts.push({
        id: `option-${num}`,
        num,
        label,
        recommended: isRecTag,
      });
    }
    if (opts.length < 2) return null;

    // Confirm with a question phrase in the tail — guards against false
    // positives where "Option N:" appears in prose without a real ask.
    const tail = text.slice(-500).toLowerCase();
    const hasAsk = /which option|do you prefer|what.?s your preference|please (?:choose|select|pick)|your pick/i.test(tail);
    if (!hasAsk) return null;

    return { kind: "options", options: opts };
  }

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
  function renderQuickReplyChips(detected) {
    const { kind } = detected;
    const card = document.createElement("div");
    card.className = "chat-msg agent quick-reply-chips";

    const labelEl = document.createElement("div");
    labelEl.className = "quick-reply-label";
    labelEl.textContent = "Quick reply:";
    card.appendChild(labelEl);

    const row = document.createElement("div");
    row.className = "quick-reply-row";

    // Build a list of { value, displayLabel, recommended? } tuples.
    let chips = [];
    if (kind === "yes_no") {
      chips = [
        { value: "yes", displayLabel: "Yes" },
        { value: "no",  displayLabel: "No"  },
      ];
    } else if (kind === "options") {
      chips = detected.options.map(o => ({
        value: o.id,
        displayLabel: o.label,
        recommended: !!o.recommended,
      }));
    } else {
      // letter list (single_choice fallback)
      chips = detected.letters.map(l => ({ value: l, displayLabel: l }));
    }

    let getNote = () => null;

    chips.forEach(c => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-reply-chip";
      if (c.recommended) btn.classList.add("quick-reply-chip-recommended");
      // "options" chips carry prose labels — opt them into the long-label
      // layout (left-aligned, wraps, stacked vertically by the parent).
      if (kind === "options") btn.classList.add("quick-reply-chip-long");
      btn.textContent = c.recommended ? `★ ${c.displayLabel}` : c.displayLabel;
      btn.addEventListener("click", () => {
        const note = getNote();
        const displayText = note ? `${c.displayLabel} — ${note}` : c.displayLabel;
        Array.from(card.querySelectorAll("button, textarea")).forEach(el => el.disabled = true);
        card.classList.add("question-answered");
        submitQuickReply({ kind, value: c.value, displayText, note, cardEl: card });
      });
      row.appendChild(btn);
    });
    card.appendChild(row);

    getNote = renderNoteSection(card);
    return card;
  }

  // Shared error-recovery for the three user-submit paths
  // (text input, form card, quick-reply chip). All three previously left
  // pendingAgentMsg set and the sticky activity bar pinned on submit
  // failure — user saw a "Thinking..." spinner AND an error message.
  // This helper restores clean state so the user can retry.
  function _recoverFromSubmitError(errMsg, cardEl) {
    if (pendingAgentMsg) {
      try { pendingAgentMsg.el.remove(); } catch {}
      pendingAgentMsg = null;
    }
    setActivityBar(null);
    if (cardEl) {
      // Unlock the form / chip card so the user can retry. submitAnswer
      // and submitQuickReply lock these on submit; chatForm has no card.
      Array.from(cardEl.querySelectorAll("input, button, textarea")).forEach(el => el.disabled = false);
      cardEl.classList.remove("question-answered");
    }
    appendChatMessage("agent", `[error] ${errMsg} — please retry`);
  }

  async function submitQuickReply({ kind, value, displayText, note, cardEl }) {
    if (!chatSessionId) chatSessionId = deriveChatSessionId();
    if (!chatEventSource) openSseStream(chatSessionId);

    appendChatMessage("user", displayText);
    openThinkingBubble();

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
      _recoverFromSubmitError("could not send reply: " + err.message, cardEl);
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
    openThinkingBubble();

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
      _recoverFromSubmitError("could not submit answer: " + err.message, cardEl);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function openSseStream(sessionId) {
    if (chatEventSource) chatEventSource.close();
    _stampSse();  // fresh stream → reset the silence timer
    chatEventSource = new EventSource(`/api/chat/stream/${encodeURIComponent(sessionId)}`);
    chatEventSource.onmessage = (e) => {
      _stampSse();   // any SSE message resets the silence timer
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "TaskStatusUpdateEvent") {
          // Layer B: tool-call traces from SAM data parts.
          for (const d of extractDataParts(ev)) {
            if (d.type === "tool_invocation_start") appendToolTrace(d);
            else if (d.type === "tool_result") completeToolTrace(d);
            // agent_progress_update / llm_invocation / etc — text channel covers these.
          }
          const text = extractAgentText(ev);
          if (text) startOrUpdateAgentBubble(text);
        } else if (ev.type === "FinalResponse" || ev.type === "Task") {
          // Capture the responding agent so loadAgents() can restore it on
          // page reload — closes the "follow-up went to the wrong agent
          // after page re-init" bug.
          const ag = _extractRespondingAgent(ev) || (chatAgentSelect?.value || null);
          if (ag) setStickyAgent(currentProjectId(), ag);
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
          // Clear the sticky activity bar — without this it stays pinned
          // on "Thinking…" while the bubble shows the error message.
          setActivityBar(null);
        }
      } catch (err) { /* ignore malformed */ }
    };
    chatEventSource.addEventListener("complete", () => {
      // CRITICAL: null the variable, don't just .close(). Every
      // `if (!chatEventSource) openSseStream(...)` check throughout
      // the code is a truthiness check, not a readyState check —
      // leaving a closed-but-non-null reference here means the next
      // turn's submit handler thinks the stream is still open, never
      // calls openSseStream, and every subsequent SSE event from the
      // agent vanishes into the void until the user refreshes. Same
      // pattern as the logout teardown earlier in the file.
      if (chatEventSource) {
        chatEventSource.close();
        chatEventSource = null;
      }
    });
  }

  const chatAgentSelect = document.getElementById("chat-agent-select");

  // Sticky agent selection per engagement. Captured on FinalResponse, restored
  // by loadAgents() on page init. Without this, the dropdown reverts to the
  // gateway-configured default on every page reload, sending follow-up
  // messages to the wrong agent (the "proceed in order" misroute we saw).
  function _lastAgentKey(eid) { return `sa.last_agent.${eid}`; }
  function getStickyAgent(eid) {
    if (!eid) return null;
    try { return localStorage.getItem(_lastAgentKey(eid)) || null; }
    catch { return null; }
  }
  function setStickyAgent(eid, agentName) {
    if (!eid || !agentName) return;
    try { localStorage.setItem(_lastAgentKey(eid), agentName); } catch {}
  }
  function clearStickyAgent(eid) {
    if (!eid) return;
    try { localStorage.removeItem(_lastAgentKey(eid)); } catch {}
  }

  // --- Auto-mode state (per engagement, per design step) -----------------
  // The Design step is dispatched as ONE A2A task per scope so each scope
  // gets its own LLM-call budget (SAM caps at 30 turns per task). In Auto
  // mode the frontend chains the next scope automatically when the prior
  // scope finishes DONE / DONE_WITH_CONCERNS. Pause clears the flag; user
  // can resume by clicking "Continue in chat" which falls back to manual.
  function _autoModeKey(eid) { return `sa.auto_mode.${eid}`; }
  function isAutoModeActive(eid) {
    if (!eid) return false;
    try { return localStorage.getItem(_autoModeKey(eid)) === "1"; }
    catch { return false; }
  }
  function setAutoMode(eid, active) {
    if (!eid) return;
    try {
      if (active) localStorage.setItem(_autoModeKey(eid), "1");
      else localStorage.removeItem(_autoModeKey(eid));
    } catch {}
  }

  // Per-scope kickoff for Auto-mode advance. Includes the prior scopes_done
  // list so the agent can skip already-finished work even if the agent's
  // session was reset (cold restart between scopes).
  function _buildAutoAdvanceKickoff(nextScope, scopesDone) {
    const done = (scopesDone || []).join(", ") || "(none)";
    return `Mode: auto\nScope: ${nextScope}\n\n` +
      `Continue Design — next scope is \`${nextScope}\`. Scopes already ` +
      `completed: ${done}. Read prior scope artifacts as needed for ` +
      `context, then walk this scope's decisions. Call ` +
      `record_scope_progress at end of scope (with next_scope = the ` +
      `next applicable scope, or null if this is the final one).`;
  }

  // Tracks an in-flight auto-advance countdown so "Pause Auto" can cancel it.
  let _pendingAutoAdvanceTimer = null;
  function _cancelPendingAutoAdvance() {
    if (_pendingAutoAdvanceTimer) {
      clearTimeout(_pendingAutoAdvanceTimer);
      _pendingAutoAdvanceTimer = null;
    }
  }

  // Render the "Auto: advancing to <next> in N…" card. Returns the card el
  // so the caller can update / remove it. The card has a "Pause Auto" button
  // that cancels the pending dispatch AND clears the Auto-mode flag so the
  // remaining scopes stay manual.
  function renderAutoAdvanceCard(nextScope, scopesDone) {
    const card = document.createElement("div");
    card.className = "chat-msg agent auto-advance-card";
    const doneList = (scopesDone || []).join(", ") || "(none yet)";
    card.innerHTML = `
      <div class="auto-advance-header">
        <span class="auto-advance-icon">⚡</span>
        <span class="auto-advance-title">Auto mode — advancing</span>
      </div>
      <div class="auto-advance-body">
        <p>Next scope: <strong><code>${escapeHtml(nextScope)}</code></strong></p>
        <p class="muted">Completed: ${escapeHtml(doneList)}</p>
        <p class="auto-advance-countdown">Dispatching in <span class="auto-advance-secs">3</span>s…</p>
      </div>
      <div class="auto-advance-actions">
        <button type="button" class="cta-btn cta-btn-secondary auto-advance-pause">Pause Auto</button>
        <button type="button" class="cta-btn auto-advance-now">Dispatch now</button>
      </div>`;
    return card;
  }

  // Look at the current engagement's lifecycle and, if Auto mode is active
  // and the just-completed turn marked a scope DONE / DONE_WITH_CONCERNS
  // with a `next_scope`, schedule a delayed dispatch of the next scope.
  // Called from finalizeAgentBubble after the turn renders.
  async function _maybeAutoAdvance() {
    const eid = currentProjectId?.();
    if (!eid) return;
    if (!isAutoModeActive(eid)) return;
    let lifecycle;
    try {
      lifecycle = await fetch(`/api/engagements/${encodeURIComponent(eid)}/lifecycle`)
        .then(r => r.json());
    } catch { return; }
    const sp = lifecycle?.steps?.design?.scope_progress;
    if (!sp) return;
    // Final scope done — clear the flag, let the normal phase-handoff card render.
    if (!sp.next) {
      setAutoMode(eid, false);
      return;
    }
    // Pause auto-loop on non-clean exits — user takes over.
    if (sp.status !== "DONE" && sp.status !== "DONE_WITH_CONCERNS") return;

    // Dedup: if we already dispatched this exact scope_progress (same
    // current+status+updated_at), don't re-fire. Guards against the agent
    // crashing without writing a fresh scope_progress on the next attempt
    // — without this, the loop would re-dispatch the SAME next-scope.
    const fingerprint = `${sp.current}|${sp.status}|${sp.updated_at}`;
    const dedupKey = `sa.auto_last_dispatched.${eid}`;
    let lastDispatched = null;
    try { lastDispatched = localStorage.getItem(dedupKey); } catch {}
    if (lastDispatched === fingerprint) return;

    // Don't double-render if a prior auto-advance card already on screen.
    if (chatLog.querySelector(".auto-advance-card")) return;

    const card = renderAutoAdvanceCard(sp.next, sp.done || []);
    chatLog.appendChild(card);
    chatLog.scrollTop = chatLog.scrollHeight;

    const dispatch = () => {
      _cancelPendingAutoAdvance();
      card.remove();
      try { localStorage.setItem(dedupKey, fingerprint); } catch {}
      const ci = document.getElementById("chat-input");
      if (ci) {
        ci.value = _buildAutoAdvanceKickoff(sp.next, sp.done || []);
        chatForm?.requestSubmit?.();
      }
    };

    card.querySelector(".auto-advance-pause")?.addEventListener("click", () => {
      _cancelPendingAutoAdvance();
      setAutoMode(eid, false);
      card.querySelector(".auto-advance-body").innerHTML =
        `<p class="muted">Auto mode paused. Remaining scopes will not dispatch automatically.</p>`;
      card.querySelector(".auto-advance-actions").innerHTML = "";
    });
    card.querySelector(".auto-advance-now")?.addEventListener("click", dispatch);

    // 3s countdown — gives the user a moment to read the prior scope's
    // summary and decide whether to pause.
    let secs = 3;
    const tick = () => {
      const el = card.querySelector(".auto-advance-secs");
      if (el) el.textContent = String(secs);
      if (secs <= 0) { dispatch(); return; }
      secs -= 1;
      _pendingAutoAdvanceTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  // Pull the responding agent's name from a FinalResponse event payload.
  // SAM attaches it to status.message.metadata.agent_name in
  // _publish_text_as_partial_a2a_status_update. Fall back to whatever the
  // dropdown was set to when the message was sent.
  function _extractRespondingAgent(ev) {
    try {
      return ev?.data?.status?.message?.metadata?.agent_name
          || ev?.data?.metadata?.agent_name
          || null;
    } catch { return null; }
  }

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
      // Resolve which agent should end up selected, in this preference order:
      //   1. User's prior pick in this session (the dropdown value right now).
      //   2. Sticky agent for the current engagement (captured from the last
      //      FinalResponse — survives page reload).
      //   3. Gateway-configured default_agent_name.
      const sticky = getStickyAgent(currentProjectId());
      const desired = (previousChoice && names.has(previousChoice)) ? previousChoice
                    : (sticky && names.has(sticky))                 ? sticky
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
    openThinkingBubble();

    const body = { text, session_id: chatSessionId };
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
      _recoverFromSubmitError("could not dispatch: " + err.message);
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

  // Desync detection — based on SSE-stream inactivity, NOT on the
  // active-step endpoint. Reason: compute_active_step reads
  // session.active_step from meta/session.yaml, which Discovery and Domain
  // don't update. So "Idle" in the status bar is unreliable as a "no task
  // is running" signal — it'd false-positive on every multi-minute turn.
  //
  // SSE inactivity is more truthful: as long as the agent is alive, SSE
  // events flow (status updates, tool traces, tokens, intermediate text).
  // If we see >SSE_SILENCE_MS of quiet WHILE pendingAgentMsg is set, the
  // SSE channel has dropped or the task has hung silently — same UX
  // outcome, render the recovery card with a Reload button.
  let _lastSseEventAt = Date.now();
  // 240s (4 min) accommodates legitimately slow turns — Discovery's
  // brief-write turn ran ~5min today with a 116s LLM-composition quiet
  // gap, Domain's per-scope artifact turns can be similar. Earlier 90s
  // would have false-positived on both. The cost of being too generous:
  // user waits a bit longer before the recovery card appears if SSE
  // actually drops. The cost of being too aggressive: spurious "Reload"
  // prompts in the middle of a healthy turn. Favor too-generous.
  const _SSE_SILENCE_MS = 240000;
  function _stampSse() { _lastSseEventAt = Date.now(); }

  setInterval(() => {
    if (!pendingAgentMsg) return;
    const silentFor = Date.now() - _lastSseEventAt;
    if (silentFor >= _SSE_SILENCE_MS) {
      _renderSseDesyncRecoveryCard();
    }
  }, 5000);  // check every 5s; render only when silentFor crosses 90s

  // Renders a one-shot recovery card when we detect SSE-channel desync.
  // Removes the stale thinking placeholder, shows a "result missed" card
  // with a Reload button, and clears pendingAgentMsg so the user can send
  // a fresh message without first having to refresh.
  let _desyncCardShown = false;
  function _renderSseDesyncRecoveryCard() {
    if (_desyncCardShown) return;
    _desyncCardShown = true;
    if (pendingAgentMsg) {
      try { pendingAgentMsg.el.remove(); } catch {}
      pendingAgentMsg = null;
    }
    setActivityBar(null);
    const card = document.createElement("div");
    card.className = "chat-msg agent agent-empty";
    card.innerHTML = `
      <div class="agent-empty-eyebrow">Result not received</div>
      <p class="agent-empty-body">
        The agent finished this turn but the WebUI didn't receive the
        final event — likely an SSE connection drop, a suspended tab,
        or stale cached JavaScript. The agent's work was saved
        (decisions, artifacts, status updates) — only the in-chat
        rendering was lost.
      </p>
      <p class="agent-empty-body agent-empty-hint">
        Click <strong>Reload</strong> to refresh and pick up the latest
        state from the server.
      </p>
      <div class="agent-empty-actions">
        <button type="button" class="agent-empty-cta">Reload ↻</button>
      </div>
    `;
    card.querySelector(".agent-empty-cta").addEventListener("click", () => {
      window.location.reload();
    });
    chatLog.appendChild(card);
    chatLog.scrollTop = chatLog.scrollHeight;
    // Re-arm the one-shot guard once the user navigates away or sends
    // a new message (covered by finalizeAgentBubble running on the next
    // turn) so a future desync still surfaces.
  }
  // Reset the one-shot guard whenever a turn finalizes normally — fresh
  // desyncs in future turns should still raise the card.
  const _origFinalizeForDesync = finalizeAgentBubble;
  finalizeAgentBubble = function (...args) {
    _desyncCardShown = false;
    return _origFinalizeForDesync.apply(this, args);
  };

  // Belt-and-suspenders: detect outright SSE errors and surface the same
  // card. EventSource auto-reconnects on transient drops, but if the
  // browser keeps it CLOSED we'd never get a FinalResponse — same UX
  // failure mode the poller catches, just faster.
  function _armSseErrorHandler() {
    if (!chatEventSource) return;
    chatEventSource.addEventListener("error", () => {
      // readyState 2 = CLOSED. readyState 0 = reconnecting (don't panic).
      setTimeout(() => {
        if (chatEventSource && chatEventSource.readyState === 2) {
          // Null the reference so the next submit's lazy-reopen check
          // actually fires. Without this, every subsequent turn would
          // talk to a closed stream and lose all events.
          chatEventSource = null;
          if (pendingAgentMsg) _renderSseDesyncRecoveryCard();
        }
      }, 2000);
    });
  }
  const _origOpenSse = openSseStream;
  openSseStream = function (sid) {
    _origOpenSse(sid);
    _armSseErrorHandler();
  };

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

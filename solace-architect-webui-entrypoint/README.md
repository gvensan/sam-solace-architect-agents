# solace-architect-webui-entrypoint

[![CI](https://github.com/solacecommunity/solace-agent-mesh-plugins/actions/workflows/plugin-webui-entrypoint.yml/badge.svg)](https://github.com/solacecommunity/solace-agent-mesh-plugins/actions)

**SAM entrypoint plugin for the [Solace Architect](https://github.com/solacecommunity/solace-agent-mesh-plugins) agent family.** Serves a browser dashboard, an HTML intake form, audience-specific report viewers, and a REST API — bridging human/REST traffic to any agent on the SAM mesh over A2A.

> The metadata field `type = "gateway"` is preserved in `pyproject.toml` per SAM's plugin-manifest enum (legacy name). The user-facing resource type is "entrypoint" per current SAM convention.

## What it does

| Surface | Path | Purpose |
|---|---|---|
| Dashboard SPA | `/` | Three-pane shell — collapsible sidebar (collapses to a 56px icon rail), main content with 6 views (Overview, Decisions, Timeline, Open Items, Artifacts, Stats, Export), and a resizable right-side chat panel with an agent picker. Layout state persists in `localStorage`. |
| HTML intake form | `/intake/new`, `/intake/edit/{id}` | V1-ported 1379-line form with offline integration catalog, autocomplete, Save-as-YAML/Markdown, Load-from-YAML, live preview, Submit → creates engagement + persists both `discovery/intake.json` (lossless) and `discovery/discovery-brief.yaml` (normalized) under the user namespace |
| Audience-pack reports | `/api/engagements/{id}/exports/render` | Render any of the 5 audience packs (Blueprint, Executive, Admin & Ops, Security, Developers) as HTML; bundle all as zip |
| REST API | `/api/*` | 26 JSON routes — project lifecycle (list/create/archive/rename/clone), dashboard data, intake (preview/submit/load/parse-yaml), exports, feedback |
| Auth | `/login`, `/signup`, `/api/auth/*` | Local SQLite + argon2id user/password auth. First signup becomes admin. Sessions in HttpOnly cookies, rate-limited login. Set `WEBUI_REQUIRE_AUTH=false` to skip in dev. |
| Chat | `/api/chat/message` + SSE `/api/chat/stream/{session_id}` | Targets any agent discovered on the SAM mesh. Picker populated from `/api/agents` (refreshed every 15s); default = `default_agent_name` from config. Project-free by design — if a project is active, its id rides along as `engagement_id` metadata. Supports file attachments, a New Chat reset button, and per-session history persisted in `localStorage`. |
| Settings | `/settings` | Account info, change-password modal, read-only display of server-side feature flags (`WEBUI_REQUIRE_AUTH`, `WEBUI_ENABLE_SIGNUP`) |
| Health probes | `/health`, `/ready` | Unauthenticated. `/health` = liveness (200 once HTTP is up). `/ready` = readiness (503 until the gateway has finished initializing; also reports `discovered_agents` count). |

Full route table: `src/solace_architect_webui_entrypoint/routes/api.py`.

## Install

### From GitHub (the usual way)

The plugin lives in a multi-plugin repo, so pip needs the `#subdirectory=…` hint:

```bash
sam plugin install git+https://github.com/solacecommunity/solace-agent-mesh-plugins.git#subdirectory=solace-architect-webui-entrypoint

# Then instantiate the component in your SAM project (drops config.yaml into
# configs/gateways/ and registers the component):
sam plugin add sa_webui --plugin solace-architect-webui-entrypoint
```

A specific branch or tag: `…@<ref>#subdirectory=solace-architect-webui-entrypoint`.

To re-install after upstream changes:

```bash
SAM_PLUGIN_INSTALL_COMMAND="pip install --force-reinstall --no-deps {package}" \
  sam plugin install git+https://github.com/solacecommunity/solace-agent-mesh-plugins.git#subdirectory=solace-architect-webui-entrypoint
```

### From the Community plugins catalog (once registered)

```bash
sam plugin catalog
# + Add Registry → https://github.com/solacecommunity/solace-agent-mesh-plugins, name "Community"
sam plugin add sa_webui --plugin solace-architect-webui-entrypoint
```

### Local development (editable)

```bash
git clone https://github.com/solacecommunity/solace-agent-mesh-plugins.git
cd solace-agent-mesh-plugins/solace-architect-webui-entrypoint

pip install -e ../../solace-architect-core/   # if working against an in-tree core
pip install -e .[test]
```

## Configure

Add to `.env` in the SAM project root (the directory you run `sam run` from):

### Solace broker (client credentials only — never SEMP/admin)
| Variable | Default | Description |
|---|---|---|
| `NAMESPACE` | *(required)* | A2A namespace; fails loud if unset. Use `sa-dev` for local testing. |
| `SOLACE_BROKER_URL` | `ws://localhost:8008` | Broker WebSocket URL. |
| `SOLACE_BROKER_USERNAME` | `default` | Client username with pub/sub rights — NOT admin/SEMP. |
| `SOLACE_BROKER_PASSWORD` | `default` | — |
| `SOLACE_BROKER_VPN` | `default` | — |
| `SOLACE_DEV_MODE` | `false` | `true` for local Docker brokers (skips TLS verification + production-only checks). |

### LLM (LiteLLM via SAM/ADK)
| Variable | Default | Description |
|---|---|---|
| `LLM_SERVICE_GENERAL_MODEL_NAME` | *(required)* | LiteLLM provider-prefixed model, e.g. `anthropic/claude-sonnet-4-20250514`, `openai/gpt-4o`, `gemini/gemini-1.5-pro`, or a proxy alias. |
| `LLM_SERVICE_ENDPOINT` | *(blank)* | Leave blank for cloud providers; set for LiteLLM proxies, Azure OpenAI, Ollama, or self-hosted LLMs. |
| `LLM_SERVICE_API_KEY` | *(required)* | Provider or LiteLLM-proxy key. |

### WebUI entrypoint
| Variable | Default | Description |
|---|---|---|
| `WEBUI_PORT` | `9080` | HTTP listener port. **Do not use 8080** — that's the default for SAM's stock webui gateway and the broker admin UI. |
| `WEBUI_HOST` | `0.0.0.0` | Bind address. |
| `WEBUI_ENTRYPOINT_ID` | `sa-webui-ep-01` | Unique entrypoint ID — change when running multiple instances against one broker. |
| `WEBUI_REQUIRE_AUTH` | `true` | Set `false` to bypass login entirely (dev only). |
| `WEBUI_BRANDING_OVERRIDES` | *(blank)* | Optional path to a branding YAML overlay; defaults to `solace_architect_core`'s bundled `branding.yaml`. |
| `AUTH_TYPE` | `none` | `none` = local user/password (the Phase 1 default). `oidc` is reserved for Phase 2 (not yet wired). |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | — | Only when `AUTH_TYPE=oidc` (Phase 2, future). |
| `SA_STORAGE_ROOT` | `/tmp/sa-artifacts` | Where engagement artifacts and per-user namespaces are persisted. When unset, the entrypoint defaults this env var to `artifact_service.base_path` from `config.yaml` at startup — so SA's own state (projects.yaml, intake.json, decisions, brief) and SAM's filesystem artifact service share one root. Set explicitly to override both. |
| `LOG_LEVEL` | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR`. |

> **No broker admin permissions needed.** Solace Architect plugins do messaging only — they never create VPNs, queues, or ACL profiles via SEMP. Broker-admin operations stay in your IaC + Mission Control workflow.

## Run

```bash
mkdir -p logs                # SAM doesn't auto-create the log dir
sam run                      # picks up every installed plugin from configs/
```

…or run only this entrypoint config:

```bash
sam run configs/gateways/solace-architect-webui-entrypoint.yaml
```

Open `http://localhost:9080`.

**First signup creates the admin user.** Visit `/signup`, register, and you're in. Subsequent users sign up the same way (no invite system in Phase 1 — disable signup at the source if you need to lock it down). For dev, set `WEBUI_REQUIRE_AUTH=false` in `.env` to skip auth entirely.

For an end-to-end engagement, also install the SA agent plugins:

```bash
for p in orchestrator discovery domain blueprint \
         reviewer-architect reviewer-developer reviewer-ops reviewer-security \
         validation; do
  sam plugin install git+https://github.com/solacecommunity/solace-agent-mesh-plugins.git#subdirectory=solace-architect-${p}
  sam plugin add "sa_${p}" --plugin "solace-architect-${p}"
done
# Opt-in (only with EP Designer MCP access):
# sam plugin install … #subdirectory=solace-architect-provisioning
```

Without the SA agents, the chat picker will still show whatever generic SAM agents are on the mesh (e.g. `OrchestratorAgent`, `BuiltInTools`). The rest of the UI (intake form, dashboard, exports) works regardless.

## Example: start an engagement

```bash
curl -X POST http://localhost:9080/api/intake/submit \
  -H "Content-Type: application/json" \
  --cookie "sa_session=<your-session-token>" \
  -d @./fixtures/bank_chat_agent.yaml
# → {"engagement_id":"retail-banking-chat-agent","project":{...},"open_items":[]}

# Subscribe to the live agent stream
curl -N http://localhost:9080/api/chat/stream/<session_id>
# → SSE events from the targeted agent
```

The session token comes from a successful `POST /api/auth/login` (sets the `sa_session` cookie). For programmatic clients, use the same `Set-Cookie` header pattern.

## Testing

```bash
cd plugins/solace-architect-webui-entrypoint/
.venv/bin/python -m pytest -v
# → 25 passed
```

Always invoke pytest through the project venv's Python (`. .venv/bin/python -m pytest`). System pytest may miss `solace-agent-mesh`, causing plugin-discovery tests to skip.

The test suite covers:
- **Plugin contract** — module-level `info` dict + `App`/`Component` class wiring
- **Routes** — full registration table, JSON shape of every handler, auth wiring, agent discovery
- **Static assets** — files present in wheel; three-pane SPA shell; persisted layout-state keys; intake form action buttons + V2 submit endpoint + embedded catalog
- **Auth** — login/signup/logout, rate limiting, session cookie round-trip, first-admin promotion

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `OSError: [errno 48] address already in use` on 8080 | SAM's stock `a2a_webui_app` already binds 8080 | The plugin defaults to **9080**; if you see 8080, set `WEBUI_PORT=9080` in the project `.env` (or edit `configs/gateways/solace-architect-webui-entrypoint.yaml`) |
| `Max clients exceeded` on broker startup | Another process owns this entrypoint's broker queue | Set `WEBUI_ENTRYPOINT_ID=sa-webui-ep-02` (or stop the duplicate) |
| `Login Failure` / `UNAUTHORIZED` on broker connect | Broker credentials wrong | Check `SOLACE_BROKER_USERNAME`/`_PASSWORD`/`_VPN` |
| Browser stuck at `/login` | First run, no users yet | Click "Sign up" — the first account is auto-promoted to admin |
| Connection refused on broker | Broker isn't running | Start your local broker or fix `SOLACE_BROKER_URL` |
| Dashboard loads but `/api/*` returns 404 | Plugin loaded as agent, not entrypoint | Verify `pyproject.toml` has `[tool.solace_architect_webui_entrypoint.metadata] type = "gateway"` |
| Chat picker says "(no agents discovered)" | No agents installed or broker discovery still warming up | Wait 15s and the picker re-polls; otherwise install at least one agent plugin |
| `ValueError: Could not find 'info' dictionary` at startup | Stale install missing module-level `info` | Re-install: `pip install --force-reinstall --no-deps git+…` |
| `Cannot import 'solace_agent_mesh'` | SAM not in the venv `sam run` uses | `pip install solace-agent-mesh` into that venv |

## License

Apache 2.0. See [LICENSE](../../LICENSE).

## Related plugins

This entrypoint pairs with the [Solace Architect agent plugins](../). The full family:

| Plugin | Type | Required? |
|---|---|---|
| `solace-architect-orchestrator` | agent | yes |
| `solace-architect-discovery` | agent | yes |
| `solace-architect-domain` | agent | yes |
| `solace-architect-blueprint` | agent | yes (final assembly + audience packs) |
| `solace-architect-validation` | agent | recommended |
| `solace-architect-reviewer-architect`, `-developer`, `-ops`, `-security` | agent | recommended (any subset) |
| `solace-architect-provisioning` | agent | opt-in (live Event Portal provisioning via EP Designer MCP) |

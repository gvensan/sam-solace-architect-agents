# solace-architect-webui-entrypoint

[![CI](https://github.com/solacecommunity/solace-agent-mesh-plugins/actions/workflows/plugin-webui-entrypoint.yml/badge.svg)](https://github.com/solacecommunity/solace-agent-mesh-plugins/actions)

**SAM entrypoint plugin for the [Solace Architect](https://github.com/solacecommunity/solace-agent-mesh-plugins) agent family.** Serves a browser dashboard, an HTML intake form, audience-specific report viewers, and a REST API — bridging human/REST traffic to the `SAOrchestratorAgent` over A2A.

> The metadata field `type = "gateway"` is preserved in `pyproject.toml` per SAM's plugin-manifest enum (legacy name). The user-facing resource type is "entrypoint" per current SAM convention.

## What it does

| Surface | Path | Purpose |
|---|---|---|
| Dashboard SPA | `/` | Six views — Overview, Timeline, Decisions, Open Items, Artifacts, Stats, plus Export and a chat surface |
| HTML intake form | `/intake/` | Sectioned form with **live skill-routing preview**, Save-as-YAML / Save-as-Markdown, Load-from-YAML, Submit → creates engagement + dispatches to `SADiscoveryAgent` |
| Audience-pack reports | `/reports/{engagement_id}/{audience}` | Hosted HTML for each of the 5 packs (Blueprint, Executive, Admin & Ops, Security, Developers) plus PDF + zip |
| REST API | `/api/*` | Programmatic surface — project lifecycle, dashboard data, exports |
| SSE chat stream | `/api/chat/stream/{session_id}` | Server-Sent Events from agent activity to the browser |

Routes shipped: **23**. See `src/solace_architect_webui_entrypoint/routes/api.py` for the full table.

## Install

### From the Community plugins registry (after PR merges)

```bash
# One-time: register the registry
sam plugin catalog
# + Add Registry → https://github.com/solacecommunity/solace-agent-mesh-plugins, name "Community"

# Install (pulls solace-architect-core from PyPI as a transitive dep)
sam plugin add solace-architect-webui-entrypoint --plugin solace-architect-webui-entrypoint
```

### Local development (editable)

```bash
git clone https://github.com/<your-org>/sam-solace-architect.git
cd sam-solace-architect

pip install -e ./solace-architect-core/
pip install -e ./plugins/solace-architect-webui-entrypoint/[test]
```

## Configure

Required environment (`.env`):

### Solace broker (client credentials only — never SEMP / admin)
| Variable | Default | Description |
|---|---|---|
| `NAMESPACE` | *(required)* | A2A namespace; fails loud if unset. Use `sa-dev` for local testing. |
| `SOLACE_BROKER_URL` | `ws://localhost:8008` | Broker WebSocket URL. |
| `SOLACE_BROKER_USERNAME` | `default` | **Client username** with pub/sub rights — NOT an admin / SEMP user. |
| `SOLACE_BROKER_PASSWORD` | `default` | — |
| `SOLACE_BROKER_VPN` | `default` | — |
| `SOLACE_DEV_MODE` | `false` | Set `true` for local Docker broker (skips TLS verification + production-only checks). |

### LLM (LiteLLM via SAM/ADK)
| Variable | Default | Description |
|---|---|---|
| `LLM_SERVICE_GENERAL_MODEL_NAME` | *(required)* | LiteLLM provider-prefixed model, e.g. `anthropic/claude-sonnet-4-20250514`, `openai/gpt-4o`, `gemini/gemini-1.5-pro`, or a custom proxy alias. |
| `LLM_SERVICE_ENDPOINT` | *(blank)* | Leave blank for cloud providers; set for LiteLLM proxies, Azure OpenAI, Ollama, or any self-hosted LLM. |
| `LLM_SERVICE_API_KEY` | *(required)* | Provider API key (or LiteLLM-proxy key). |

### WebUI entrypoint
| Variable | Default | Description |
|---|---|---|
| `WEBUI_PORT` | `8080` | HTTP listener port. Change if 8080 conflicts (e.g., broker admin UI). |
| `WEBUI_HOST` | `0.0.0.0` | Bind address. |
| `WEBUI_ENTRYPOINT_ID` | `sa-webui-ep-01` | Unique entrypoint ID — change if running multiple instances against one broker. |
| `AUTH_TYPE` | `none` | `none` (anonymous, Phase 1) or `oidc` (Phase 2). |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | — | Only when `AUTH_TYPE=oidc`. |
| `SA_STORAGE_ROOT` | `/tmp/sam-solace-architect` | Where engagement artifacts are persisted. |
| `LOG_LEVEL` | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR`. |

> **No broker admin permissions needed.** Solace Architect plugins do messaging only — they never create VPNs, queues, or ACL profiles via SEMP. Those broker-admin operations stay in your IaC + Mission Control workflow.

## Run

```bash
sam run plugins/solace-architect-webui-entrypoint/config.yaml
```

Then open `http://localhost:8080`.

For an end-to-end engagement, also install the agent plugins:

```bash
for p in orchestrator discovery domain blueprint \
         reviewer-architect reviewer-developer reviewer-ops reviewer-security \
         validation; do
  sam plugin add "solace-architect-${p}" --plugin "solace-architect-${p}"
done
# opt-in (only if you have EP Designer MCP):
# sam plugin add solace-architect-provisioning --plugin solace-architect-provisioning

sam run        # picks up every installed plugin
```

## Example: start an engagement

```bash
curl -X POST http://localhost:8080/api/intake/submit \
  -H "Content-Type: application/json" \
  -d @../../test-harness/fixtures/bank_chat_agent.yaml
# → {"engagement_id":"retail-banking-chat-agent","project":{...},"open_items":[]}

# Subscribe to the live stream
curl -N http://localhost:8080/api/chat/stream/<session_id>
# → SSE events from SAOrchestratorAgent
```

## Testing

```bash
cd plugins/solace-architect-webui-entrypoint/
pytest -v
# → 14 passed locally (6 more activate when solace-agent-mesh is installed)
```

The test suite covers:
- **Plugin-discovery contract** — `info` dict + App class + Component class inheritance
- **Route registration** — all 23 routes well-formed + required endpoints present
- **Handler behavior** — end-to-end project create, intake preview, intake submit
- **Static asset shipping** — files present in wheel; dashboard nav links; intake form wiring

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Max clients exceeded` on startup | Another process is already using this entrypoint's broker queue | `WEBUI_ENTRYPOINT_ID=sa-webui-ep-02 sam run …` or stop the other process |
| `Login Failure` / `UNAUTHORIZED` | Broker credentials wrong | Check `SOLACE_BROKER_USERNAME` / `_PASSWORD` / `_VPN` in `.env` |
| Connection refused | Broker isn't running | Start your local broker or fix `SOLACE_BROKER_URL` |
| Dashboard loads but `/api/*` returns 404 | Plugin loaded as agent, not entrypoint | Verify `pyproject.toml` has `[tool.solace_architect_webui_entrypoint.metadata] type = "gateway"` |
| Browser shows "No active project" forever | No agents installed yet | Install at least `solace-architect-orchestrator` and `solace-architect-discovery` |
| `Cannot import 'solace_agent_mesh'` | SAM not installed | `pip install solace-agent-mesh` |

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

# solace-architect-visualizer

Forked from [sam-visualizer](https://github.com/gvensan/sam-visualizer) at commit `dist/` snapshot. **One-way fork.** Upstream changes do not flow here and vice versa.

Embedded under `/visualizer` in the Solace Architect WebUI entrypoint. On page load the app fetches `GET /api/visualizer/config` from the same origin, pre-fills broker URL / VPN / credentials / namespace / current engagement from the WebUI session, and auto-connects in `live` mode. The original "set broker URL" modal stays as a manual-override fallback.

## How it ships

- **Source** (this folder) is committed to git.
- **Build output** lives at `../src/solace_architect_webui_entrypoint/webui/visualizer/` and is **also committed** so end users don't need Node when they `pip install` the plugin. The Python wheel manifest includes that folder.
- `node_modules/` is gitignored.

When you change anything here, rebuild before commit:

```bash
cd plugins/solace-architect-webui-entrypoint/visualizer-src
npm ci           # or: npm install
npm run build    # outputs into ../src/.../webui/visualizer/
```

That's the only step. Then `git status` will show the rebuilt assets ready to stage.

The plugin root's `Makefile` exposes the same as `make visualizer-build`.

## What's different from upstream sam-visualizer

| File | Change |
|---|---|
| `package.json` | Renamed package to `solace-architect-visualizer`; added `clean` script. |
| `vite.config.ts` | `base: '/visualizer/'` (so asset URLs are `/visualizer/assets/...` when mounted under that path) and `build.outDir` points at the Python plugin's static dir. |
| `index.html` | Title says "Solace Architect — Live View". |
| `src/ui/App.tsx` | On mount, `fetch('/api/visualizer/config', { credentials: 'include' })`; if it succeeds, switch to `live` mode and auto-connect with the returned broker config. Reads `?engagement=<id>` from URL for the engagement filter. Modal stays as fallback. |
| `src/broker/solaceClient.ts` | Optional `engagementId` on `BrokerConfig`; messages whose metadata `engagement_id` doesn't match are dropped before dispatch. |

Everything else is verbatim.

## Standalone usage (development only)

```bash
npm run dev     # spins up Vite at http://localhost:5173 against fixtures + the broker URL modal
```

In standalone dev mode, `fetch('/api/visualizer/config')` will 404 and the app falls back to the original localStorage-default + modal flow — same UX as upstream.

## License

Inherited from upstream — Apache 2.0.

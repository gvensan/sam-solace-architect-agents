# solace-architect-provisioning

**SAM agent plugin** — Opt-in live EP provisioning via EP Designer MCP. Strictly opt-in (intake.preferences.provision_event_portal). Never silently skips.

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.10](../../documents/v2spec.md).
## Opt-in only

This plugin is **opt-in**. It runs only when the intake declares `preferences.provision_event_portal: true`. It also requires the EP Designer MCP server installed in the SAM runtime and `SOLACE_API_TOKEN` (Designer Read+Write scope).


## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-provisioning --plugin solace-architect-provisioning
```

## License

Apache 2.0.

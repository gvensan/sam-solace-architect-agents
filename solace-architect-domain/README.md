# solace-architect-domain

**SAM agent plugin** — Solace platform domain expert — 9 design scopes (topic, broker, SAM, protocol, mesh, HA/DR, migration, integration, Event Portal).

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.3](../../documents/v2spec.md).

## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-domain --plugin solace-architect-domain
```

## License

Apache 2.0.

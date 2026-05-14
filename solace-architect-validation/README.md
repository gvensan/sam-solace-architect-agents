# solace-architect-validation

**SAM agent plugin** — Consistency, antipattern, requirement-tracing, deferred-finding validation. Produces the gating report.

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.8](../../documents/v2spec.md).

## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-validation --plugin solace-architect-validation
```

## License

Apache 2.0.

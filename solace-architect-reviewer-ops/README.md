# solace-architect-reviewer-ops

**SAM agent plugin** — Operations-perspective reviewer — monitoring, failure modes, capacity, runbooks, alerting.

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.6](../../documents/v2spec.md).

## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-reviewer-ops --plugin solace-architect-reviewer-ops
```

## License

Apache 2.0.

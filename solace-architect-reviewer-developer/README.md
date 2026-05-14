# solace-architect-reviewer-developer

**SAM agent plugin** — Developer-perspective reviewer — topic usability, SDK choices, schema governance, error handling, onboarding.

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.5](../../documents/v2spec.md).

## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-reviewer-developer --plugin solace-architect-reviewer-developer
```

## License

Apache 2.0.

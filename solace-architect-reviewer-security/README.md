# solace-architect-reviewer-security

**SAM agent plugin** — Security-perspective reviewer — auth, ACLs, encryption, credential management, regulatory compliance.

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.7](../../documents/v2spec.md).

## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-reviewer-security --plugin solace-architect-reviewer-security
```

## License

Apache 2.0.

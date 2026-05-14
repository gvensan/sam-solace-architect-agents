# solace-architect-blueprint

**SAM agent plugin** — Final blueprint assembly + 5-audience-pack rendering (HTML + PDF via WeasyPrint) + zip export. Ships the ported V1 HTML report generator.

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.9](../../documents/v2spec.md).

## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-blueprint --plugin solace-architect-blueprint
```

## License

Apache 2.0.

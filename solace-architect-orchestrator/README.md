# solace-architect-orchestrator

**SAM agent plugin** — `SAOrchestratorAgent`, the central coordinator for Solace Architect engagements.

Sequences design, review, validation, blueprint, and (opt-in) provisioning agents. Owns workflow state, execution mode (auto/interactive), finding resolution, open-item gating, and Completion Status Protocol routing.

**Status:** Phase 0 scaffold — no working code yet. See [v2spec §4.1](../../documents/v2spec.md).

## Install (development)

```bash
pip install -e ../../solace-architect-core/
pip install -e .
```

## Install (end users, after community-repo PR merges)

```bash
sam plugin add solace-architect-orchestrator --plugin solace-architect-orchestrator
```

## Required env vars

Inherited from the SAM install: `NAMESPACE`, `SOLACE_BROKER_*`, model API keys. See `../../test-harness/.env.example`.

## License

Apache 2.0.

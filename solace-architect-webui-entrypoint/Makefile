# Solace Architect WebUI entrypoint — developer make targets.
#
# The visualizer (forked from sam-visualizer) lives in `visualizer-src/`
# as Preact/Vite/TypeScript source. Its built output is committed at
# `src/solace_architect_webui_entrypoint/webui/visualizer/` so the Python
# wheel travels with the built assets and end users don't need Node to
# `pip install` this plugin.
#
# Whenever you change visualizer-src/, run `make visualizer-build` and
# commit the resulting webui/visualizer/ changes alongside the source.
# The CI check `make visualizer-verify` exists to catch missed rebuilds.

.PHONY: help visualizer-install visualizer-build visualizer-clean visualizer-verify visualizer-dev visualizer-test

VISUALIZER_DIR := visualizer-src
VISUALIZER_OUT := src/solace_architect_webui_entrypoint/webui/visualizer

help:
	@echo "Solace Architect WebUI entrypoint — make targets"
	@echo
	@echo "  visualizer-install  Install node_modules in $(VISUALIZER_DIR)/"
	@echo "  visualizer-build    Build the visualizer; output lands in $(VISUALIZER_OUT)/"
	@echo "  visualizer-dev      Run Vite dev server (standalone mode)"
	@echo "  visualizer-test     Run visualizer unit tests"
	@echo "  visualizer-clean    Remove the built visualizer assets"
	@echo "  visualizer-verify   Fail if visualizer-src/ has unbuilt changes (CI guard)"

visualizer-install:
	cd $(VISUALIZER_DIR) && npm ci

visualizer-build:
	cd $(VISUALIZER_DIR) && npm run build

visualizer-dev:
	cd $(VISUALIZER_DIR) && npm run dev

visualizer-test:
	cd $(VISUALIZER_DIR) && npm test

visualizer-clean:
	rm -rf $(VISUALIZER_OUT)

# CI guard: rebuild and assert the working tree is clean — checks for BOTH
# modified files (`git diff`) AND untracked files (`git ls-files --others`).
# The untracked check is critical for the hashed bundles vite emits: each
# build produces `index-<hash>.js` with a fresh name. Without the second
# check, a brand-new bundle slips through unstaged and ships an index.html
# that 404s its own JS.
visualizer-verify:
	@$(MAKE) visualizer-build
	@dirty=0; \
	if ! git diff --quiet -- $(VISUALIZER_OUT); then \
	  echo "ERROR: $(VISUALIZER_OUT) has uncommitted changes vs source."; \
	  git --no-pager diff --stat -- $(VISUALIZER_OUT); \
	  dirty=1; \
	fi; \
	untracked=$$(git ls-files --others --exclude-standard -- $(VISUALIZER_OUT)); \
	if [ -n "$$untracked" ]; then \
	  echo "ERROR: $(VISUALIZER_OUT) has untracked files (likely a rebuilt hashed bundle):"; \
	  printf '  %s\n' $$untracked; \
	  dirty=1; \
	fi; \
	if [ $$dirty -eq 1 ]; then \
	  echo; \
	  echo "Run \`make visualizer-build\` then \`git add $(VISUALIZER_OUT)\` and commit."; \
	  exit 1; \
	fi

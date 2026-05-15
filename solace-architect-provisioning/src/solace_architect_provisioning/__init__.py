"""solace-architect-provisioning plugin — Opt-in live EP provisioning via EP Designer MCP. Strictly opt-in (intake.preferences.provision_event_portal). Never silently skips."""

from solace_architect_core.logging_setup import attach_plugin_file_handler

# Opt-in per-plugin log file (writes ${SA_LOG_DIR}/<package>.log when SA_LOG_DIR is set).
attach_plugin_file_handler(__name__)

__version__ = "0.1.0"

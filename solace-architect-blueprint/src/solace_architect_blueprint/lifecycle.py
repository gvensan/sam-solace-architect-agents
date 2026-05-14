"""Plugin init/cleanup for SABlueprintAgent.

Registers the local report_generator with solace_architect_core.tools.blueprint_tools
so that render_audience_pack delegates here. This is the cross-plugin contract
documented in v2spec §5.5.
"""

from solace_architect_core.tools.blueprint_tools import register_renderer

from .report_generator import render_pack


async def init(*args, **kwargs):
    """Register this plugin's renderer with the core blueprint_tools dispatcher."""
    register_renderer(render_pack)
    return None


async def cleanup(*args, **kwargs):
    """Unregister on plugin shutdown."""
    return None

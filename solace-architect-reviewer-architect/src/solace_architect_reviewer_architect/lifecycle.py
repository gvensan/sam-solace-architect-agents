"""Plugin init/cleanup for SAArchitectReviewerAgent.

Phase 0: stubs. Phase 1+ wires tools from solace-architect-core, applies the system
prompt, registers routes (entrypoint plugins).
"""


async def init(*args, **kwargs):
    """Plugin init hook. Phase 0: no-op."""
    return None


async def cleanup(*args, **kwargs):
    """Plugin cleanup hook. Phase 0: no-op."""
    return None

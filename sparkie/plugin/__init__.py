"""Hermes tool registration; the dashboard uses the same observation reader."""

import json
from sparkie_sparks.fleet import read_status
from sparkie_sparks.energy import read_energy

SCHEMA = {
    "name": "spark_fleet_status",
    "description": "Read timestamped Spark observations without waking machines. Stale observations are not current state. This tool cannot change or power a Spark.",
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}


def fleet_status(args, **kwargs):
    if args:
        return json.dumps({"available": False, "sparks": [], "message": "This lookup takes no arguments."})
    return json.dumps(read_status())


def register(ctx, *, compute_provider=None):
    from sparkie_sparks.checked_comparison import register as register_comparison
    register_comparison(ctx)
    from sparkie_sparks.memory_controls import correction_feedback, guard
    ctx.register_hook('pre_tool_call', guard)
    ctx.register_hook('transform_tool_result', correction_feedback)
    from sparkie_sparks.owner_login import register as register_owner_login
    register_owner_login(ctx)
    # Native selection accepts toolset names, not individual tools. A named
    # subtraction keeps native composites and coding/delegation postures intact.
    from toolsets import create_custom_toolset
    create_custom_toolset('sparkie-unavailable-extraction',
                          'Hosted extraction is unavailable in the local-only profile',
                          tools=['web_extract'])
    from sparkie_sparks.workspace_service import configured_provider
    ctx.register_terminal_environment_provider(compute_provider or configured_provider())
    from sparkie_sparks.telegram_controls import register as register_telegram
    ctx.register_telegram_handler(register_telegram)
    from sparkie_sparks.proposals import register as register_proposals
    register_proposals(ctx)
    from sparkie_sparks.recovery_replies import register as register_recovery_replies
    register_recovery_replies(ctx)
    from sparkie_sparks.update_proposals import register as register_updates
    register_updates(ctx)
    ctx.register_tool(name="spark_fleet_status", toolset="sparks", schema=SCHEMA,
                      handler=fleet_status, description="DGX Spark fleet observations")
    ctx.register_tool(name="spark_electricity", toolset="sparks", schema={
        "name": "spark_electricity",
        "description": "Read recorded wall-meter electricity by day, ISO week, month or year in Pacific time. Optionally supply a USD/kWh rate to estimate cost for that recorded usage. Missing readings are not zero. This does not save a rate or wake machines.",
        "parameters": {"type": "object", "properties": {
            "month": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}$", "description": "Compatibility option for a month; do not combine with another period selection."},
            "period": {"type": "string", "enum": ["day", "week", "month", "year"]},
            "selected": {"type": "string", "description": "Day YYYY-MM-DD, ISO week YYYY-Www, month YYYY-MM, or year YYYY; omit for the current period."},
            "rate": {"type": "number", "minimum": 0, "maximum": 10, "description": "Optional USD per kWh for this estimate only; no rate is saved."},
        }, "additionalProperties": False},
    }, handler=electricity, description="Electricity usage and estimated cost")


def electricity(args, **kwargs):
    if not isinstance(args, dict) or set(args) - {"month", "period", "selected", "rate"}:
        return json.dumps({"available": False, "message": "Choose a day, week, month or year. This lookup cannot change electricity rates."})
    try:
        return json.dumps(read_energy(month=args.get('month'), period=args.get('period', 'month'), selected=args.get('selected'), rate=args.get('rate')))
    except (ValueError, TypeError):
        return json.dumps({"available": False, "message": "Choose a valid period and an optional rate from $0 to $10 per kWh."})

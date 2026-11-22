"""Test helpers: use Hermes's configured route and inspect its actual wire fields."""

import json


def configured_agent_kwargs(config, *, base_url, model):
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from hermes_constants import resolve_reasoning_config
    runtime = resolve_runtime_provider(requested=config['model']['provider'], target_model=model)
    assert runtime['base_url'].rstrip('/') == base_url.rstrip('/')
    assert runtime['provider'] == 'custom' and runtime['api_mode'] == 'chat_completions'
    reasoning = resolve_reasoning_config(config, model)
    assert reasoning == {'enabled': True, 'effort': 'low'}, reasoning
    return {key: runtime.get(key) for key in ('base_url', 'provider', 'api_key', 'api_mode',
                                             'requested_provider', 'request_overrides')} | {'reasoning_config': reasoning}


def trace_generation_fields(agent, *, max_sends=None, expected_tools=None, expected_soul=None):
    """Observe request-local native clients; never record headers or prompts."""
    import httpx
    fields = ('model', 'temperature', 'top_p', 'top_k', 'chat_template_kwargs', 'reasoning_effort', 'max_tokens')
    records = []
    original_send = httpx.Client.send
    def capture(client, request, *args, **kwargs):
        if request.url.path.endswith('/chat/completions'):
            if max_sends is not None and len(records) >= max_sends:
                raise RuntimeError('Local inference send budget exhausted.')
            body = json.loads(request.content)
            record = {key: body.get(key) for key in fields}
            records.append(record)
            if expected_soul is not None:
                record['exact_soul_present'] = any(expected_soul in str(message.get('content', ''))
                                                   for message in body['messages']
                                                   if message.get('role') in ('system', 'developer'))
            if expected_tools is not None:
                record['tool_names'] = sorted(tool['function']['name'] for tool in body.get('tools') or [])
                if record['tool_names'] != expected_tools:
                    raise RuntimeError(f"Unexpected tools on native request: {record['tool_names']}")
            assert record['temperature'] == 1.0 and record['top_p'] == 0.95 and record['top_k'] == 20, record
            assert record['reasoning_effort'] == 'low', record
            assert record['chat_template_kwargs'] == {'enable_thinking': True, 'thinking': True, 'reasoning_effort': 'low'}, record
        return original_send(client, request, *args, **kwargs)
    httpx.Client.send = capture
    def detach():
        httpx.Client.send = original_send
    return records, detach

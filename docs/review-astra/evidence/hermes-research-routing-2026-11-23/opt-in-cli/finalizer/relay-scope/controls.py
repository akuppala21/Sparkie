"""Compare the full native primary and auxiliary SDK payloads around the summary."""

from copy import deepcopy
from hashlib import sha256
import json

import httpx


def capture_control(agent, label):
    from agent.auxiliary_client import call_llm

    messages = [{"role": "user", "content": "What is two plus two?"}]
    original = httpx.Client.send
    observations = []

    def intercept(client, request, *args, **kwargs):
        body = json.loads(request.content)
        assert str(request.url) == "http://127.0.0.1:32202/v1/chat/completions"
        assert body["model"] == "sparkie-hermes-main" and not body.get("stream")
        assert not observations
        wire = json.dumps(
            body, separators=(",", ":"), sort_keys=True, ensure_ascii=False
        ).encode()
        observations.append(
            {
                "label": label,
                "body_sha256": sha256(wire).hexdigest(),
                "thinking_options": body.get("chat_template_kwargs"),
                "wire_effort": body.get("reasoning_effort"),
            }
        )
        return httpx.Response(
            200,
            request=request,
            json={
                "id": "control",
                "object": "chat.completion",
                "created": 0,
                "model": body["model"],
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "four"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    httpx.Client.send = intercept
    try:
        if label == "title-generation":
            response = call_llm(
                task="title_generation",
                provider=agent.provider,
                model=agent.model,
                base_url=agent.base_url,
                api_key="cpu-fixture",
                api_mode="chat_completions",
                messages=messages,
                reasoning_config=deepcopy(agent.reasoning_config),
                extra_body={
                    "chat_template_kwargs": {
                        "enable_thinking": True,
                        "thinking": True,
                        "reasoning_effort": "low",
                    }
                },
            )
        else:
            response = agent._interruptible_api_call(
                agent._build_api_kwargs(messages, tools_for_api=[])
            )
        assert response.choices[0].message.content == "four"
        assert len(observations) == 1
        return observations[0]
    finally:
        httpx.Client.send = original

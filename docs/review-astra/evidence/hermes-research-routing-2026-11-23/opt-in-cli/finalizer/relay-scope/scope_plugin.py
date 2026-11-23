"""Experimental opt-in component for a fixed local Hermes profile."""

import nemo_relay as relay

KIND = "sparkie_local_summary_test"


class LocalSummary:
    def validate(self, config):
        return []

    def register(self, config, context):
        context.register_llm_request_intercept(
            "summary-thinking", 10, False, self.intercept
        )

    @staticmethod
    def intercept(name, request, annotated):
        content = request.content
        handle = relay.scope.get_handle()
        if (
            name == "openai.chat_completions"
            and content.get("model") == "sparkie-hermes-main"
            and handle.name == "hermes.logical_llm_call"
            and (handle.metadata or {}).get("hermes.call_role") == "iteration_summary"
        ):
            extra = content.get("extra_body") or {}
            options = extra.get("chat_template_kwargs") or {}
            if (
                options.get("enable_thinking") is True
                and options.get("thinking") is True
            ):
                options = {**options, "enable_thinking": False, "thinking": False}
                extensions = annotated.extra or {}
                assert extensions.get("extra_body") == extra
                annotated.extra = {
                    **extensions,
                    "extra_body": {**extra, "chat_template_kwargs": options},
                }
        return relay.LLMRequestInterceptOutcome(request, annotated)

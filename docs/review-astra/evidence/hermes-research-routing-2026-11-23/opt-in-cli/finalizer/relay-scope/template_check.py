"""Render a synthetic prompt with the pinned checkpoint template on CPU."""

from hashlib import sha256
import json
import sys
from pathlib import Path
from jinja2.sandbox import ImmutableSandboxedEnvironment

source = Path(sys.argv[1]).read_bytes()
digest = sha256(source).hexdigest()
assert digest == "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041"
template = ImmutableSandboxedEnvironment(
    trim_blocks=True, lstrip_blocks=True
).from_string(source.decode())
rows = []
for enabled in [True, False]:
    prompt = template.render(
        messages=[{"role": "user", "content": "What is two plus two?"}],
        add_generation_prompt=True,
        enable_thinking=enabled,
        thinking=enabled,
        reasoning_effort="low",
    )
    assistant = prompt.split("<|im_start|>assistant\n")[-1]
    assert assistant == ("<think>\n" if enabled else "<think>\n\n</think>\n\n")
    assert ("Reasoning effort is set to low." in prompt) == enabled
    rows.append(
        {
            "enable_thinking": enabled,
            "assistant_suffix": assistant,
            "low_instruction_present": enabled,
        }
    )
print(json.dumps({"template_sha256": digest, "results": rows}, indent=2))

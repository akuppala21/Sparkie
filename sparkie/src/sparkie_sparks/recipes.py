"""Read the two reviewed local recipe records shipped with the candidate."""

import json
from pathlib import Path


_MODEL_DIR = Path(__file__).resolve().parents[2] / "models"


def read_catalog():
    selected = json.loads((_MODEL_DIR / "main-model.json").read_text(encoding="utf-8"))
    previous = json.loads((_MODEL_DIR / "dealign-flash-next.json").read_text(encoding="utf-8"))
    trial = selected["measurements"]
    draft = selected["speculative_profile"]
    return {
        "selected": {
            "repository": selected["repository"],
            "revision": selected["revision"],
            "source": selected["sources"][0],
            "selected_on": selected["selected_on"],
            "engine": selected["engine"],
            "version": selected["engine_version"],
            "image": selected["candidate_image"],
            "context": selected["configured_context_tokens"],
            "algorithm": draft["description"],
            "draft_repository": draft["draft_repository"],
            "draft_revision": draft["draft_revision"],
            "draft_source": selected["sources"][1],
            "draft_tokens": draft["num_draft_tokens"],
            "quantization": draft["draft_quantization"],
            "qualification": selected["qualification"],
            "deployment_record": selected["deployment_status"],
            "limits": selected["limits"],
            "serial_decode_tps": trial["serial_decode_tps"],
            "concurrent_per_request_tps": trial["concurrent_per_request_tps"],
            "ready_seconds": trial["ready_seconds"],
        },
        "comparison": {
            "repository": previous["repository"],
            "revision": previous["revision"],
            "source": previous["sources"][0],
            "image": previous["candidate_image"],
            "digest": previous["candidate_image_digest"],
            "qualification": previous["qualification"],
            "limits": previous["limits"],
        },
    }

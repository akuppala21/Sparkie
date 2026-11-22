import json
from pathlib import Path

from sparkie_sparks.recipes import read_catalog


def test_selected_recipe_preserves_serving_pins_and_failed_trial_evidence():
    models = Path(__file__).resolve().parents[1] / "models"
    manifest = json.loads((models / "main-model.json").read_text())
    selected = read_catalog()["selected"]
    assert selected["revision"] == manifest["revision"]
    assert selected["draft_revision"] == manifest["speculative_profile"]["draft_revision"]
    assert selected["source"].endswith("/tree/" + selected["revision"])
    assert selected["draft_source"].endswith("/tree/" + selected["draft_revision"])
    assert selected["image"] == manifest["candidate_image"]
    assert selected["limits"] == manifest["limits"]
    assert selected["qualification"] == manifest["qualification"]
    assert selected["deployment_record"] == manifest["deployment_status"]
    assert selected["concurrent_per_request_tps"] == manifest["measurements"]["concurrent_per_request_tps"]


def test_previous_recipe_retains_cache_defect_and_does_not_inherit_selection():
    comparison = read_catalog()["comparison"]
    assert "ring-address collision" in comparison["qualification"]
    assert "selected_on" not in comparison
    assert comparison["source"].endswith("/tree/" + comparison["revision"])
    assert comparison["digest"].startswith("sha256:")

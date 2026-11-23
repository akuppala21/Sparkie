from types import SimpleNamespace

import pytest

from sparkie_sparks import checked_comparison as comparison


def supplied(second="Only B was tested."):
    return ("Which option meets both conditions?\nSource: Bench report\nURL: https://example.org/a\n"
            "Only A was tested.\nSource: Bench report\nURL: https://example.org/b\n" + second)


def assessments(first="Only A was tested.", second="Only B was tested."):
    return {"A": {"qualifies": False, "witnesses": [first]},
            "B": {"qualifies": True, "witnesses": [second]}}


def test_source_ids_survive_duplicate_titles_and_quotes_stay_literal():
    quote = "Measured output:\n```\n![image](https://example.org/pixel)\n```"
    _, sources = comparison.parse_sources(supplied(quote))
    result = comparison.display_assessment(assessments(second=quote), sources)
    assert result.startswith("Source B demonstrates")
    assert "**Source A · Bench report**\n\n<https://example.org/a>" in result
    assert "**Source B · Bench report**\n\n<https://example.org/b>" in result
    assert r"\u0060\u0060\u0060" in result and "![image](https://example.org/pixel)" in result
    assert result.index("What to test next") > result.index("Measured output:")


@pytest.mark.parametrize("alteration", [
    lambda s: s.replace("https://example.org/a", "file:///etc/passwd"),
    lambda s: s.replace("https://example.org/a", "https://name:password@example.org/"),
    lambda s: s.replace("https://example.org/b", "https://example.org/>extra"),
    lambda s: s + "\nSource: third\nURL: https://example.org/third\nThird report",
    lambda s: s + "\x1b[31m",
    lambda s: s + "é" * (comparison.MAX_BYTES // 2),
])
def test_malformed_or_oversize_sources_are_rejected(alteration):
    with pytest.raises(ValueError):
        comparison.parse_sources(alteration(supplied()))


def test_dispatch_declines_unavailable_model_and_invalid_evidence(monkeypatch):
    calls = []
    def complete(**fields):
        calls.append(fields)
        return SimpleNamespace(parsed=assessments(first="Only B was tested."))
    class Context:
        llm = SimpleNamespace(complete_structured=complete)
        def register_auxiliary_task(self, *args, **kwargs):
            pass
        def register_command(self, name, handler, **kwargs):
            assert name == comparison.COMMAND
            self.command = handler
    ctx = Context()
    comparison.register(ctx)
    assert ctx.command("compare two files") == comparison.USAGE
    monkeypatch.setattr(comparison, "local_route", lambda: False)
    assert "local-only model route is required" in ctx.command(supplied())
    assert calls == []
    monkeypatch.setattr(comparison, "local_route", lambda: True)
    assert "quoted passages could not be verified" in ctx.command(supplied())
    assert len(calls) == 1


@pytest.mark.parametrize("assessment", [
    assessments(first="invented evidence"), assessments(first="Only B was tested."),
    {**assessments(), "winner": "A"},
    {"A": {"qualifies": "no", "witnesses": ["Only A was tested."]}, "B": assessments()["B"]},
    {"A": {"qualifies": False, "witnesses": []}, "B": assessments()["B"]},
])
def test_bad_verdicts_never_render(assessment):
    _, sources = comparison.parse_sources(supplied())
    with pytest.raises(ValueError):
        comparison.display_assessment(assessment, sources)


def test_short_paragraph_keeps_qualification_and_deduplicates_context():
    body = "Rated for 256 units. The team only tested 64 units. Checksums matched."
    inputs = ["The team only tested 64 units.", "Checksums matched."]
    assert comparison.quoted_passages(body, inputs) == [body]
    long = "x" * 710 + " Checksums matched."
    assert comparison.quoted_passages(long, ["Checksums matched."]) == ["Checksums matched."]
    ambiguous = "Checksums matched. On input.\n\nChecksums matched. On output."
    assert comparison.quoted_passages(ambiguous, ["Checksums matched."]) == ["Checksums matched."]


def test_metadata_inside_pasted_source_is_part_of_the_evidence():
    _, sources = comparison.parse_sources(supplied("Source: https://example.org/original\nOriginal prose."))
    assert sources["B"]["text"].startswith("Source: https://example.org/original")


def test_native_image_delivery_is_refused_even_inside_a_quote():
    image = "A report includes ![chart](https://example.org/plot.png)"
    _, sources = comparison.parse_sources(supplied(image))
    reply = comparison.display_assessment(assessments(second=image), sources)
    assert "would trigger an attachment" in reply
    assert "https://example.org/plot.png" not in reply


def test_telegram_does_not_attach_private_file_mentioned_in_fenced_source(tmp_path, monkeypatch):
    import asyncio
    from gateway.config import Platform, PlatformConfig
    from gateway.platforms.event import MessageEvent
    from gateway.session import SessionSource
    from plugins.platforms.telegram.adapter import TelegramAdapter

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    artifact = tmp_path / "cache/documents/synthetic-private.txt"
    artifact.parent.mkdir(parents=True)
    artifact.write_text("private-fixture-bytes")
    artifact.chmod(0o600)
    marker = "MEDIA:" + str(artifact)
    adapter = TelegramAdapter(PlatformConfig())
    source = SessionSource(platform=Platform.TELEGRAM, chat_id="test-chat", user_id="test-owner")
    event = MessageEvent(text="/checked_comparison", source=source)

    def extract(text):
        return asyncio.run(adapter._extract_response_content(text, event, "fixture", is_ephemeral_response=False))

    # Show this actual, readable fixture is deliverable when it is an intentional attachment.
    assert extract(marker).media_files == [(str(artifact), False)]
    for quote in (marker, "Example follows.\n```\n" + marker + "\n```"):
        _, sources = comparison.parse_sources(supplied(quote))
        rendered = comparison.display_assessment(assessments(second=quote), sources)
        extracted = extract(rendered)
        assert marker in extracted.text_content and "private-fixture-bytes" not in extracted.text_content
        assert not (extracted.images or extracted.media_files or extracted.local_files)

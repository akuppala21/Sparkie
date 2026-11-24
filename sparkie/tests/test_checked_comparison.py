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
    assert result.startswith("The local model judged that Source B demonstrates the full requirement.")
    assert "Sparkie matched the quotations to the supplied texts." in result
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


def test_native_pasted_url_headers_retain_sources_and_literal_body():
    body = "The command recorded @url:`https://example.org/quoted`."
    plain = supplied(body)
    native = plain.replace("URL: https://example.org/a", "URL: @url:`https://example.org/a`")
    native = native.replace("URL: https://example.org/b", "URL: @url:`https://example.org/b`")
    assert comparison.parse_sources(native) == comparison.parse_sources(plain)
    assert comparison.parse_sources(native)[1]["B"]["text"] == body


@pytest.mark.parametrize("link", ["@url:`file:///etc/passwd`", "@url:`https://user@host.example/`",
                                  "@url:`https://example.org/` extra", "@url:`https://example.org/``"])
def test_invalid_native_url_headers_are_rejected(link):
    with pytest.raises(ValueError):
        comparison.parse_sources(supplied().replace("https://example.org/a", link))


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


def test_long_table_uses_original_headings_columns_and_selected_rows_in_source_order():
    header = r"Workload \| mode | One device | Two devices"
    alignment = ":--- | ---: | :---:"
    first = r"Long \| sample | 53 units | 87 units"
    last = "Short sample | 26 units | 41 units"
    title = "Measured conditions\n==================="
    section = "## Bench A"
    before = "Measured in the lab."
    after = "A field trial is still pending."
    table = "\n".join([header, alignment, first, *[f"Other run {i} | 0 | 1" for i in range(55)], last])
    body = "\n\n".join([title, "## Earlier setup", before, section, table, after])
    excerpts = comparison.quoted_passages(body, [after, "41 units", before, first, "87 units"])
    assert excerpts == [title, before, section + "\n\n" + "\n".join([header, alignment, first]), last, after]
    assert all(excerpt in body for excerpt in excerpts)


def test_short_table_keeps_adjoining_qualification():
    body = "## Sample\n\n| Lot | Mass |\n| :- | -: |\n| A | 19 g |\nOnly a pilot."
    assert comparison.quoted_passages(body, ["19 g"]) == [body]


def test_repeated_cells_require_an_unambiguous_witness():
    body = ("| Run | Cold | Warm |\n|---|---|---|\n| First | 24 s | 9 s |\n| Second | 24 s | 7 s |"
            "\n\n| Plan | Goal |\n|--|--|\n| Future | 7 s |")
    for cell in ("24 s", "7 s"):
        with pytest.raises(comparison.AmbiguousTableQuote):
            comparison.quoted_passages(body, [cell])
    assert "| First | 24 s | 9 s |" in comparison.quoted_passages(body, ["| First | 24 s |"])[0]


@pytest.mark.parametrize("example", [
    "~~~md\n# Example\n| Metric | Proposed |\n| --- | --- |\n| Peak | 19 units |\n~~~",
    "<!--\n# Example\n| Metric | Proposed |\n| --- | --- |\n| Peak | 19 units |\n-->",
    "| Metric | Proposed |\n| invalid | here |\n| Peak | 19 units |",
])
def test_non_tables_do_not_borrow_headings(example):
    body = "# Actual measurements\n\n" + example + "\n" + "z" * 720
    assert comparison.quoted_passages(body, ["19 units"]) == ["19 units"]


def test_table_heading_attachment_is_refused_on_expansion():
    body = "## ![figure](https://example.org/chart.png)\n\n| Group | Count |\n|--|--|\n| Teal | 42 |"
    _, sources = comparison.parse_sources(supplied(body))
    result = comparison.display_assessment(assessments(second="| Teal | 42 |"), sources)
    assert "would trigger an attachment" in result and "chart.png" not in result


def test_ragged_row_cannot_assign_an_extra_value_to_a_named_column():
    report = "| Run | Cold | Warm |\n|---|---|---|\n| Third | 5 s | 7 s | 8 s |"
    with pytest.raises(comparison.AmbiguousTableQuote, match="number of cells"):
        comparison.quoted_passages(report, ["8 s"])


def test_row_and_caption_retain_column_labels_and_show_a_heading_once():
    heading = "## Timings"
    header = "| Setup | One Spark | Two Sparks |"
    alignment = "|---|---:|---:|"
    row = "| Selected | 26 | 41 |"
    caption = "Only warm runs are included."
    data = [header, alignment, *[f"| Other {i} | 8 | 14 |" for i in range(55)], row]
    source = heading + "\n\n" + "\n".join(data) + "\n\n" + caption
    witness = row + "\n\n" + caption
    assert comparison.quoted_passages(source, [heading, witness]) == [
        heading + "\n\n" + header + "\n" + alignment, witness]


def test_spanning_excerpt_rejects_an_ambiguous_caption_and_a_ragged_row():
    table = "| Setup | One | Two |\n|---|---|---|\n"
    witness = "| Sample | 5 | 7 |\n\nMeasured in the field."
    source = table + witness + "\n\n## Another location\n\n" + table + witness
    with pytest.raises(comparison.AmbiguousTableQuote, match="occurs more than once"):
        comparison.quoted_passages(source, [witness])
    ragged = "| Sample | 5 | 7 | 11 |\n\nMeasured in the field."
    with pytest.raises(comparison.AmbiguousTableQuote, match="number of cells"):
        comparison.quoted_passages(table + ragged, [ragged])


def test_quote_crossing_two_tables_keeps_original_prose_and_both_schemas():
    first = "## First test\n\n| Lot | Kilograms |\n|--|--|\n| A | 9 |"
    note = "A second instrument reported pressure."
    second = "## Second test\n\n| Lot | Pascals |\n|--|--|\n| A | 11 |"
    source = "\n\n".join((first, note, second))
    witness = source[source.index("| A | 9 |"):source.index("11") + 2]
    excerpts = comparison.quoted_passages(source, [witness])
    assert excerpts == [source]

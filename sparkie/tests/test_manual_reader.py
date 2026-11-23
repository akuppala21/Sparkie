from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import socket
import subprocess
import sys

import pytest


script = Path(__file__).resolve().parents[1] / "skills/local-recipe-review/scripts/read_manual.py"
spec = spec_from_file_location("manual_reader", script)
reader = module_from_spec(spec)
spec.loader.exec_module(reader)


def resolve(monkeypatch, ips):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in ips
    ])


def test_pins_public_ip_and_keeps_exact_requested_release(monkeypatch):
    resolve(monkeypatch, ["1.1.1.1"])
    assert reader.public_target("https://docs.example.org/2/manual?view=v2.4#option") == (
        "https://docs.example.org/2/manual?view=v2.4", "docs.example.org:443:1.1.1.1")


@pytest.mark.parametrize("ips", [["127.0.0.1"], ["1.1.1.1", "10.1.2.3"], ["169.254.169.254"], ["224.0.0.1"]])
def test_rejects_nonpublic_and_mixed_destinations(monkeypatch, ips):
    resolve(monkeypatch, ips)
    with pytest.raises(ValueError, match="public addresses"):
        reader.public_target("https://publisher.example.org/")


@pytest.mark.parametrize("url", ["file:///tmp/m", "https://user:secret@site.example/x", "https://site.example:8000", "https://a\\@b/"])
def test_refuses_credentials_nondefault_ports_and_non_https(url):
    with pytest.raises(ValueError):
        reader.public_target(url)


def test_preserves_original_and_qualifying_context(monkeypatch, tmp_path):
    raw = b"<nav>False winner</nav><section id='limit'><h2>Capacity</h2><p>Limit is <em>20</em> items.</p><p>Benchmarked only on the small input.</p></section>"
    resolve(monkeypatch, ["1.1.1.1"])

    def fetch(args, **kwargs):
        assert args[1] == "--disable" and "--location" not in args and "-L" not in args
        assert args[args.index("--resolve") + 1] == "docs.example.org:443:1.1.1.1"
        Path(args[args.index("--output") + 1]).write_bytes(raw)
        return subprocess.CompletedProcess(args, 0, stdout="200\ntext/html; charset=UTF-8")

    monkeypatch.setattr(subprocess, "run", fetch)
    data = reader.read_page("https://docs.example.org/2/reference", ["limit is 20", "False winner"], tmp_path)
    assert Path(data["original"]).read_bytes() == raw
    assert Path(data["text"]).read_text().splitlines() == ["Capacity", "Limit is 20 items.", "Benchmarked only on the small input."]
    hit = data["matches"][0]["passages"][0]
    assert hit["line"] == 2 and hit["anchor"] == "limit" and "only on the small input" in hit["excerpt"]
    assert data["matches"][1]["hits"] == 0


def test_redirect_is_not_evidence_for_the_requested_version(tmp_path, monkeypatch):
    resolve(monkeypatch, ["1.1.1.1"])
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess([], 0, stdout="302\ntext/html"))
    with pytest.raises(ValueError, match="HTTP 302"):
        reader.read_page("https://docs.example.org/1/old", ["feature"], tmp_path)
    assert not (tmp_path / "passages.txt").exists()


def test_adjacent_conflicting_rules_keep_their_own_line_and_anchor():
    lines = [("old", "Old rule applies. " + "Other details. " * 50),
             ("new", "On current workers the old rule never applies.")]
    old, new = reader.passages(lines, ["old rule"])[0]["passages"]
    assert old["context_lines"] == [1, 1] and old["anchor"] == "old"
    assert new["context_lines"] == [2, 2] and new["anchor"] == "new"
    assert new["excerpt"] == lines[1][1]


def test_refuses_deep_nesting_before_processing_unmatched_closing_tags():
    with pytest.raises(reader.ManualError, match="nesting depth"):
        reader.Manual().feed("<i>" * (reader.MAX_DEPTH + 1) + "</m>" * 20_000)


@pytest.mark.parametrize("bad_id", ["x" * 10000, "broken\nfragment", "no\u202efragment"])
def test_oversized_or_control_anchor_falls_back_to_enclosing_section(bad_id):
    doc = reader.Manual()
    doc.feed(f'<section id="ref"><p id="{bad_id}">Actual rule</p></section>')
    hit = reader.passages(doc.lines, ["rule"])[0]["passages"][0]
    assert hit["anchor"] == "ref" and hit["excerpt"] == "Actual rule"


def test_inline_id_cannot_reassign_preceding_text_to_the_next_rule():
    doc = reader.Manual()
    doc.feed('<p id="outer">Old rule.<span id="inner"><br>New rule.</span></p>')
    assert doc.lines == [("outer", "Old rule."), ("outer", "New rule.")]


@pytest.mark.parametrize("url", [
    "https://a:secret_fixture_value@docs.example.org/reference",
    "https://docs.example.org/reference?X-Amz-Signature=secret_fixture_value",
    "https://docs.example.org/reference?secret_fixture_value",
])
def test_cli_redacts_rejected_input_before_any_network_access(monkeypatch, tmp_path, capsys, url):
    monkeypatch.setattr(sys, "argv", ["read_manual.py", url, "--find", "rule"])
    monkeypatch.setattr(reader.tempfile, "mkdtemp", lambda **kw: str(tmp_path))
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: pytest.fail("unexpected lookup"))
    assert reader.main() == 1
    captured = capsys.readouterr()
    assert "secret_fixture_value" not in captured.out + captured.err
    assert json.loads(captured.out)["input"] == 1


def test_cli_redacts_subprocess_exception(monkeypatch, tmp_path, capsys):
    resolve(monkeypatch, ["1.1.1.1"])
    monkeypatch.setattr(sys, "argv", ["read_manual.py", "https://docs.example.org/ref", "--find", "rule"])
    monkeypatch.setattr(reader.tempfile, "mkdtemp", lambda **kw: str(tmp_path))

    def failed_fetch(*args, **kwargs):
        raise subprocess.CalledProcessError(22, ["curl", "secret_fixture_value"])

    monkeypatch.setattr(subprocess, "run", failed_fetch)
    assert reader.main() == 1
    captured = capsys.readouterr()
    assert "secret_fixture_value" not in captured.out + captured.err
    assert json.loads(captured.out)["error"]


@pytest.mark.parametrize(("failure", "message"), [
    (socket.gaierror("sensitive_detail"), "DNS lookup failed"),
    (subprocess.TimeoutExpired(["curl", "sensitive_detail"], 22), "timed out"),
    (subprocess.CalledProcessError(28, ["curl", "sensitive_detail"]), "timed out"),
    (subprocess.CalledProcessError(60, ["curl", "sensitive_detail"]), "TLS certificate"),
    (subprocess.CalledProcessError(63, ["curl", "sensitive_detail"]), "size limit"),
])
def test_cli_reports_failure_stage_without_echoing_private_details(failure, message, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(sys, "argv", ["read_manual.py", "https://docs.example.org/ref", "--find=--limit"])
    monkeypatch.setattr(reader.tempfile, "mkdtemp", lambda **kw: str(tmp_path))
    calls = []

    def read(url, terms, directory):
        calls.append(terms)
        raise failure

    monkeypatch.setattr(reader, "read_page", read)
    assert reader.main() == 1
    output = capsys.readouterr()
    assert message in json.loads(output.out)["error"]
    assert "sensitive_detail" not in output.out + output.err
    assert calls == [["--limit"]]


def test_bad_page_encoding_is_reported_without_returning_page_bytes(monkeypatch, tmp_path):
    resolve(monkeypatch, ["1.1.1.1"])

    def fetch(args, **kwargs):
        Path(args[args.index("--output") + 1]).write_bytes(b"private_fixture\xff")
        return subprocess.CompletedProcess(args, 0, stdout="200\ntext/html; charset=utf-8")

    monkeypatch.setattr(subprocess, "run", fetch)
    with pytest.raises(reader.ManualError, match="decode the publisher") as caught:
        reader.read_page("https://docs.example.org/ref", ["--limit"], tmp_path)
    assert "private_fixture" not in str(caught.value)
    assert not (tmp_path / "passages.txt").exists()


def test_omitted_list_ends_preserve_each_sibling_and_close_the_last_item():
    doc = reader.Manual()
    items = "".join(f'<li id="item-{i}"><a href="/">Entry {i}.</a>' for i in range(250))
    doc.feed('<section id="parent"><ul>' + items + '</ul>After the list.</section>')
    assert doc.lines == [(f"item-{i}", f"Entry {i}.") for i in range(250)] + [
        ("parent", "After the list.")]
    hit = reader.passages(doc.lines, ["Entry 249."])[0]["passages"][0]
    assert hit["anchor"] == "item-249" and hit["context_lines"] == [250, 250]


@pytest.mark.parametrize("list_tag", ["ul", "ol", "menu"])
def test_nested_list_stays_in_outer_item_and_hidden_sibling_ends(list_tag):
    doc = reader.Manual()
    doc.feed(f'<section id="section"><ul><li id="outer">Outer.<{list_tag}><li id="one">First.'
             f'<li hidden>Hidden.<li>Third.</{list_tag}>Outer tail.<li>Sibling.</ul>Done.</section>')
    assert doc.lines == [("outer", "Outer."), ("one", "First."), ("outer", "Third."),
                         ("outer", "Outer tail."), ("section", "Sibling."), ("section", "Done.")]


def test_really_nested_lists_still_hit_the_depth_limit():
    with pytest.raises(reader.ManualError, match="nesting depth"):
        reader.Manual().feed("<ul><li>item" * (reader.MAX_DEPTH + 1))


def test_code_example_keeps_executable_layout_and_citable_lines():
    doc = reader.Manual()
    doc.feed('<section id="example"><p>Example   follows.</p><pre><code>'
             '<span>if</span> ready:\r\n\t# check before reporting\r\n'
             '\treport(&quot;ok&quot;)<br>\tfinish()<span hidden>bad<br>data</span>\n\n'
             'done()\n</code></pre><p>Only on   success.</p></section>')
    assert doc.lines == [("example", line) for line in [
        "Example follows.", "if ready:", "\t# check before reporting",
        '\treport("ok")', "\tfinish()", "", "done()", "Only on success."]]
    hit = reader.passages(doc.lines, ["check before reporting"], doc.code_ranges)[0]["passages"][0]
    assert hit["context_lines"] == [3, 5]
    assert hit["excerpt"] == '\t# check before reporting\n\treport("ok")\n\tfinish()'
    assert hit["clipped"]


def test_adjacent_unanchored_code_blocks_keep_separate_lines():
    doc = reader.Manual()
    doc.feed("<pre><div>a()</div><div>  b()</div>\n</pre><pre>c()</pre><p>Next.</p>")
    # A literal LF following a line wrapper is kept, including a trailing blank line.
    assert doc.lines == [("", "a()"), ("", "  b()"), ("", ""), ("", "c()"), ("", "Next.")]
    hit = reader.passages(doc.lines, ["a()"], doc.code_ranges)[0]["passages"][0]
    assert hit["excerpt"] == "a()\n  b()\n" and not hit["clipped"]


def test_preformatted_line_limit_is_cumulative_and_checked_before_expansion(monkeypatch):
    monkeypatch.setattr(reader, "MAX_LINES", 4)
    doc = reader.Manual()
    doc.feed("<p>Intro</p><pre>a\nb\nc</pre>")
    with pytest.raises(reader.ManualError, match="number of text lines"):
        doc.feed("<pre>" + "\n" * 10_000 + "</pre>")
    assert len(doc.lines) == 4


def linked_page(raw, fragment, term, monkeypatch, directory, media_type="text/html"):
    resolve(monkeypatch, ["1.1.1.1"])

    def fetch(args, **kwargs):
        assert args[-1] == "https://docs.example.org/release"
        Path(args[args.index("--output") + 1]).write_bytes(raw.encode())
        return subprocess.CompletedProcess(args, 0, stdout=f"200\n{media_type}; charset=UTF-8")

    monkeypatch.setattr(subprocess, "run", fetch)
    return reader.read_page("https://docs.example.org/release#" + fragment, [term], directory)


def test_definition_fragment_returns_only_its_entry_with_document_line_numbers(monkeypatch, tmp_path):
    raw = ("<section><dl><dt id='old'>old(x=1)<dd>first default: 1"
           "<dt id='option.parse'>parse(x=2)<dt>alias(x=2)<dd>correct default: 2"
           "<dd>second description of its default"
           "<dt id='new'>new(x=3)<dd>last default: 3</dl></section>")
    result = linked_page(raw, "option%2Eparse", "default", monkeypatch, tmp_path)
    assert result["source"].endswith("#option.parse")
    assert result["section"] == {"status": "found", "basis": "definition", "line_ranges": [[3, 3], [5, 6]]}
    match = result["matches"][0]
    assert match["hits"] == 2
    lines = Path(result["text"]).read_text().splitlines()
    assert [lines[p["line"] - 1] for p in match["passages"]] == ["correct default: 2", "second description of its default"]


def test_heading_fragment_stops_at_peer_heading_or_new_section(monkeypatch, tmp_path):
    raw = ("<article><h2 id='choice'>Choice</h2><p>Rule one.</p><h3>Details</h3><p>Rule two.</p>"
           "<h2>Other</h2><p>Rule three.</p></article><aside>Rule four.</aside>")
    result = linked_page(raw, "choice", "rule", monkeypatch, tmp_path)
    assert result["section"]["line_ranges"] == [[1, 4]]
    assert result["matches"][0]["hits"] == 2
    assert all("three" not in x["excerpt"] for x in result["matches"][0]["passages"])


@pytest.mark.parametrize(("raw", "fragment", "status"), [
    ("<section><p>Nearby rule</p></section>", "private-token", "unresolved"),
    ("<section id='hidden-id' hidden>Hidden rule</section><p>Visible rule</p>", "hidden-id", "unresolved"),
    ("<section id='dup-id'>Rule one</section><div id='dup-id'>Rule two</div>", "dup-id", "ambiguous"),
    ("<p><span id='inline-id'>Unscoped locator</span> Nearby rule</p>", "inline-id", "unresolved"),
])
def test_unresolved_fragments_do_not_borrow_evidence_or_echo_input(raw, fragment, status, monkeypatch, tmp_path):
    result = linked_page(raw, fragment, "rule", monkeypatch, tmp_path)
    assert result["section"] == {"status": status, "line_ranges": []}
    assert result["matches"] == [{"term": "rule", "hits": 0, "passages": []}]
    assert fragment not in json.dumps(result)
    assert Path(result["original"]).read_text() == raw


def test_section_fragment_keeps_child_sections_but_excludes_its_neighbours(monkeypatch, tmp_path):
    raw = ("<section id='old'><p>Old rule</p></section><section id='selected'><h2>Middle</h2>"
           "<section id='child'><p>Qualified rule</p></section></section><section id='last'>New rule</section>")
    result = linked_page(raw, "selected", "rule", monkeypatch, tmp_path)
    assert result["matches"][0]["hits"] == 1
    assert result["matches"][0]["passages"][0]["excerpt"] == "Qualified rule"
    assert result["section"]["line_ranges"] == [[2, 3]]


def test_heading_keeps_visible_qualifier_and_stops_at_nested_peer_after_implicit_p(monkeypatch, tmp_path):
    raw = ("<article><h2 id='target'>Target</h2><p>Allowed.<script>analytics()</script>"
           "<div><h2 hidden>Hidden</h2><p>Only after verification."
           "<h2>Other</h2><p>Different rule.</div></article>")
    result = linked_page(raw, "target", "verification", monkeypatch, tmp_path)
    assert result["section"] == {"status": "found", "basis": "heading", "line_ranges": [[1, 3]]}
    assert result["matches"][0]["passages"][0]["excerpt"] == "Only after verification."


def test_grouped_definition_keeps_qualifier_and_excludes_hidden_next_term(monkeypatch, tmp_path):
    raw = ("<dl><div><dt id='a'>A<dd>Default A.</dd><script>ignored</script>"
           "<dd>Default A has a qualifier.<dt hidden>B<dd>Default B.</div></dl>")
    result = linked_page(raw, "a", "default", monkeypatch, tmp_path)
    assert result["matches"][0]["hits"] == 2
    assert result["section"] == {"status": "found", "basis": "definition", "line_ranges": [[1, 3]]}


def test_heading_cannot_extend_past_its_parent_or_an_implicit_paragraph(monkeypatch, tmp_path):
    raw = ("<article><p id='first'>First rule.<h2>Other</h2><div><h3 id='choice'>Choice</h3>"
           "<p>Rule inside.</div><p>Rule outside.</article>")
    result = linked_page(raw, "choice", "rule", monkeypatch, tmp_path)
    assert result["matches"][0]["hits"] == 1
    assert result["matches"][0]["passages"][0]["excerpt"] == "Rule inside."


def test_heading_in_section_header_includes_its_body_and_excludes_the_next_section(monkeypatch, tmp_path):
    raw = ("<section><header><hgroup><h2 id='choice'>Choice</h2><p>Subtitle.</p></hgroup></header>"
           "<p>Rule inside.</p></section><p>Rule outside.</p>")
    result = linked_page(raw, "choice", "rule", monkeypatch, tmp_path)
    assert result["section"]["line_ranges"] == [[1, 3]]
    assert result["matches"][0]["hits"] == 1
    assert result["matches"][0]["passages"][0]["excerpt"] == "Rule inside."


def test_compact_table_preserves_empty_cells_and_keeps_linked_row_separate(monkeypatch, tmp_path):
    raw = ("<table><thead><tr><th>Mode<th>Idle<th>Busy<tbody>"
           "<tr id='solo'><th>Solo<td><td>42<tr><th>Pair<td>81<td>99</table>")
    result = linked_page(raw, "solo", "Solo", monkeypatch, tmp_path)
    assert Path(result["text"]).read_text().splitlines() == [
        "| Mode | Idle | Busy", "| Solo | | 42", "| Pair | 81 | 99",
    ]
    assert result["section"]["line_ranges"] == [[2, 2]]
    assert result["matches"][0]["passages"][0]["excerpt"] == "| Solo | | 42"


def test_long_table_with_omitted_ends_preserves_visible_siblings(monkeypatch, tmp_path):
    raw = ("<table id='readings'><tbody><tr><td hidden>private<td>First"
           + "<tr><td>Recorded<td>0" * (reader.MAX_DEPTH + 1)
           + "<tfoot><tr><td>Done</table><p>Recorded elsewhere</p>")
    result = linked_page(raw, "readings", "Recorded", monkeypatch, tmp_path)
    lines = Path(result["text"]).read_text().splitlines()
    assert lines[0] == "| First" and lines[-2:] == ["| Done", "Recorded elsewhere"]
    assert result["matches"][0]["hits"] == reader.MAX_DEPTH + 1
    assert result["section"]["line_ranges"] == [[1, len(lines) - 1]]


def test_merged_cells_keep_their_scope_and_separate_rows_in_excerpt(monkeypatch, tmp_path):
    raw = ("<table id='prices'><tr><th>Group<th colspan='2'>Rates"
           "<tr><td rowspan='0'>Plan<td>10<td>20<tr><td>30<td>40</table>")
    result = linked_page(raw, "prices", "Rates", monkeypatch, tmp_path)
    excerpt = result["matches"][0]["passages"][0]["excerpt"]
    assert excerpt.splitlines() == [
        "| Group | [colspan=2] Rates", "| [rowspan=0] Plan | 10 | 20", "| 30 | 40",
    ]


@pytest.mark.parametrize("tag", ["del", "s", "strike"])
def test_corrected_values_are_read_without_joining_old_and_new_digits(tag, monkeypatch, tmp_path):
    raw = (f'<section id="limits"><p>Limit: <{tag}><b>112</b></{tag}><ins>12</ins> items/s.</p>'
           '<p>Only for one worker.</p></section>')
    result = linked_page(raw, "limits", "12 items/s", monkeypatch, tmp_path)
    hit, = result["matches"][0]["passages"]
    assert hit["excerpt"] == "Limit: 12 items/s.\nOnly for one worker."
    assert "struck through" in result["revision_note"]
    assert Path(result["original"]).read_text() == raw


def test_entirely_withdrawn_section_provides_no_current_evidence(monkeypatch, tmp_path):
    raw = '<section id="price"><del><p>Price is 51 credits.</p></del></section>'
    result = linked_page(raw, "price", "51 credits", monkeypatch, tmp_path)
    assert result["lines"] == 0 and Path(result["text"]).read_bytes() == b""
    assert result["matches"][0]["hits"] == 0 and result["section"]["line_ranges"] == []
    assert "original" in result["revision_note"]
    assert Path(result["original"]).read_text() == raw


def test_documentation_about_edit_markup_remains_literal(monkeypatch, tmp_path):
    raw = '<section id="example"><pre>&lt;del&gt;42&lt;/del&gt;</pre></section>'
    result = linked_page(raw, "example", "42", monkeypatch, tmp_path)
    assert result["matches"][0]["passages"][0]["excerpt"] == "<del>42</del>"
    assert "revision_note" not in result


@pytest.mark.parametrize("removed", [
    "<del><br>19:00</del>",
    "<s><span><del>19:00<br>once</del></span><br></s>",
])
def test_removed_break_preserves_current_time_and_search_hit(removed, monkeypatch, tmp_path):
    raw = f'<section id="desk"><p>Thursday 16{removed}:30 collection.</p></section>'
    result = linked_page(raw, "desk", "16:30", monkeypatch, tmp_path)
    assert Path(result["text"]).read_text() == "Thursday 16:30 collection.\n"
    assert result["matches"][0]["passages"][0]["excerpt"] == "Thursday 16:30 collection."


@pytest.mark.parametrize("prefix", ["", "h:"])
def test_xhtml_edits_use_their_namespace_and_preserve_current_fragment(prefix, monkeypatch, tmp_path):
    ns = 'xmlns:h' if prefix else 'xmlns'
    raw = (f'<{prefix}html {ns}="http://www.w3.org/1999/xhtml"><{prefix}body>'
           f'<{prefix}section id="desk"><{prefix}p>Thursday <{prefix}del><{prefix}s>19:00</{prefix}s>'
           f'</{prefix}del><{prefix}ins>16:30</{prefix}ins> collection.</{prefix}p></{prefix}section>'
           f'</{prefix}body></{prefix}html>')
    result = linked_page(raw, "desk", "16:30", monkeypatch, tmp_path, "application/xhtml+xml")
    assert result["section"] == {"status": "found", "basis": "element", "line_ranges": [[1, 1]]}
    assert result["matches"][0]["passages"][0]["excerpt"] == "Thursday 16:30 collection."
    assert "19:00" not in Path(result["text"]).read_text()
    assert "revision_note" in result and Path(result["original"]).read_text() == raw


@pytest.mark.parametrize("declaration", [
    '<!DOCTYPE html SYSTEM "https://example.invalid/external.dtd">',
    '<!DOCTYPE html [<!ENTITY old "19:00">]>',
])
def test_xhtml_refuses_external_and_internal_dtds_before_writing_passages(declaration, monkeypatch, tmp_path):
    raw = declaration + '<html xmlns="http://www.w3.org/1999/xhtml"><p id="desk">16:30</p></html>'
    with pytest.raises(reader.ManualError, match="DTD"):
        linked_page(raw, "desk", "16:30", monkeypatch, tmp_path, "application/xhtml+xml")
    assert not (tmp_path / "passages.txt").exists()


def test_foreign_xhtml_content_stays_out_of_the_current_measurement(monkeypatch, tmp_path):
    raw = ('<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" '
           'xmlns:h="http://www.w3.org/1999/xhtml" xmlns:v="http://www.w3.org/2000/svg">'
           '<body><p id="desk">Thursday <h:del><v:svg><v:text>19:00</v:text></v:svg>'
           '</h:del>16:30 &amp; later.</p><v:svg><v:text>19:00</v:text></v:svg></body></html>')
    result = linked_page(raw, "desk", "16:30", monkeypatch, tmp_path, "application/xhtml+xml")
    assert Path(result["text"]).read_text() == "Thursday 16:30 & later.\n"
    assert result["matches"][0]["hits"] == 1 and "revision_note" in result


def test_malformed_xhtml_is_refused_without_current_passages(monkeypatch, tmp_path):
    raw = '<html xmlns="http://www.w3.org/1999/xhtml"><p id="desk"><del>19:00</p></html>'
    with pytest.raises(reader.ManualError, match="well-formed XHTML"):
        linked_page(raw, "desk", "19:00", monkeypatch, tmp_path, "application/xhtml+xml")
    assert not (tmp_path / "passages.txt").exists()


@pytest.mark.parametrize("markup", [
    "<br hidden>",
    '<span aria-hidden="true"><br></span>',
    '<span hidden>earlier value<br>19:00</span>',
])
def test_hidden_break_does_not_split_a_visible_value(markup, monkeypatch, tmp_path):
    raw = f'<section id="desk"><p>The cutoff is 16{markup}:30.<br>Next line.</p></section>'
    result = linked_page(raw, "desk", "16:30", monkeypatch, tmp_path)
    assert Path(result["text"]).read_text().splitlines() == ["The cutoff is 16:30.", "Next line."]
    assert result["matches"][0]["hits"] == 1
    assert Path(result["original"]).read_text() == raw


@pytest.mark.parametrize("element", [
    '<div hidden><p>Old</p><pre>example</pre></div>',
    '<section aria-hidden="TRUE"><ul><li>Old</li></ul></section>',
    '<script type="application/json">{"value": 17}</script><template><p>Old</p></template>',
])
def test_excluded_subtree_preserves_visible_identifier_and_anchor(element, monkeypatch, tmp_path):
    raw = f'<div id="key">Choose AB{element}29.</div><p id="other">Later.</p>'
    result = linked_page(raw, "key", "AB29", monkeypatch, tmp_path)
    assert Path(result["text"]).read_text().splitlines() == ["Choose AB29.", "Later."]
    hit, = result["matches"][0]["passages"]
    assert hit["anchor"] == "key" and hit["context_lines"] == [1, 1]
    assert result["section"]["line_ranges"] == [[1, 1]]


def test_hidden_sibling_closes_a_visible_implied_paragraph():
    doc = reader.Manual()
    doc.feed('<div><p id="first">First<div hidden>Old</div>Second</div>')
    assert doc.lines == [("first", "First"), ("", "Second")]


@pytest.mark.parametrize("xhtml", [True, False])
def test_opaque_illustration_cannot_join_two_visible_numbers(xhtml, monkeypatch, tmp_path):
    graphic = '<svg xmlns="http://www.w3.org/2000/svg"><text>figure</text></svg>'
    body = '<p id="limits">12' + graphic + '34</p>'
    raw = '<html xmlns="http://www.w3.org/1999/xhtml"><body>' + body + '</body></html>' if xhtml else body
    media = "application/xhtml+xml" if xhtml else "text/html"
    result = linked_page(raw, "limits", "1234", monkeypatch, tmp_path, media)
    assert result["matches"][0]["hits"] == 0
    assert Path(result["text"]).read_text().splitlines() == ["12", "34"]

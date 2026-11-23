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

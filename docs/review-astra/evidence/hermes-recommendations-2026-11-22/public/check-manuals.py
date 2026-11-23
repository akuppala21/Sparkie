"""Compare two reader files on the same publisher bytes. Run on a compute Spark."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
from tempfile import TemporaryDirectory


def load(name, path):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cases = [
    ("3.13/library/gzip.html#gzip.compress", "mtime", "mtime=None", "gzip.decompress("),
    ("3.14/library/gzip.html#gzip.compress", "mtime", "mtime=0", "gzip.decompress("),
    ("3.13/tutorial/controlflow.html#else-clauses-on-loops", "is a prime number",
     "is a prime number", "def fib("),
    ("3.13/library/urllib.parse.html#urllib.parse.unquote_plus", "string",
     "string must be a str", "string may be either a str or a bytes object"),
]


def check(old, new, case, workspace):
    page, term, required, excluded = case
    url = "https://docs.python.org/" + page
    with TemporaryDirectory(dir=workspace) as tmp:
        result = new.read_page(url, [term], Path(tmp))
        old_page = old.Manual()
        old_page.feed(Path(result["original"]).read_bytes().decode("utf-8"))
        old_page.close()
        old_page.flush()
        assert result["source"] == url and result["section"]["status"] == "found"
        full_text = Path(result["text"]).read_text(encoding="utf-8")
        assert full_text == "".join(line + "\n" for _, line in old_page.lines)
        lines = full_text.splitlines()
        ranges = result["section"]["line_ranges"]
        selected = "\n".join(line for start, stop in ranges for line in lines[start-1:stop])
        assert required.casefold() in selected.casefold(), (url, required)
        assert excluded.casefold() not in selected.casefold(), (url, excluded)
        hits = result["matches"][0]["passages"]
        assert hits and all(any(a <= h["line"] <= h["context_lines"][1] <= b for a, b in ranges)
                            for h in hits)
        prior = old.passages(old_page.lines, [term], old_page.code_ranges)[0]["passages"]
        return {"url": url, "html_sha256": result["raw_sha256"], "section": result["section"],
                "previous_first_hits": [h["line"] for h in prior], "scoped_first_hits": [h["line"] for h in hits],
                "required_passage": required, "excluded_neighbour": excluded, "full_text_matches": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--workspace", type=Path, default=Path("/workspace"))
    args = parser.parse_args()
    previous, current = load("before", args.before), load("after", args.after)
    print(json.dumps([check(previous, current, item, args.workspace) for item in cases], indent=2))

"""Read passages from public HTTPS manuals in the native terminal workspace."""
import argparse
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import socket
import subprocess
import tempfile
from urllib.parse import parse_qsl, quote, unquote, urlsplit, urlunsplit


MAX_BYTES = 4 * 1024 * 1024
MAX_DEPTH = 128
MAX_LINES = 65_536


class ManualError(ValueError):
    """A message safe to display in the chat."""


class Manual(HTMLParser):
    """Keep visible text blocks and the nearest enclosing block's HTML anchor."""

    boundaries = set("p div section article h1 h2 h3 h4 h5 h6 li dt dd pre tr br".split())
    ignored = set("head nav aside footer script style noscript svg template".split())
    headings = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
    section_tags = {"div", "section", "article", "pre", "li", "dt", "dd", "p"}
    closes_paragraph = set(("address article aside blockquote details div dl fieldset figcaption figure footer form "
                            "h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre search section table ul").split())
    paragraph_scope = {"button", "table", "td", "th", "html", "template", "applet", "caption", "object", "marquee"}
    list_containers = {"ul", "ol", "menu", "dl"}
    list_scope_boundaries = list_containers | ignored | {
        "html", "applet", "pre", "caption", "table", "td", "th", "marquee", "object",
    }
    void = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self, fragment=None):
        super().__init__()
        self.fragment = fragment
        self.fragment_count = 0
        self.fragment_ranges = []
        self.definition_parent = None
        self.heading_parent_depth = -1
        self.fragment_basis = None
        self.definition_phase = None
        self.heading_level = 0
        self.stack = []
        self.parts = []
        self.lines = []
        self.pre_depth = None
        self.code_ranges = []

    def flush(self):
        raw = "".join(self.parts)
        self.parts.clear()
        if not raw:
            return
        first = len(self.lines)
        if self.pre_depth is not None:
            # Preserve physical lines, including indentation and internal blank lines.
            # Check the count before splitting untrusted input into Python objects.
            value = raw.replace("\r\n", "\n").replace("\r", "\n").removesuffix("\n")
            count = value.count("\n") + 1
            if first + count > MAX_LINES:
                raise ManualError("The manual exceeds the supported number of text lines.")
            anchor = self.stack[self.pre_depth][1]
            self.lines.extend((anchor, line) for line in value.split("\n"))
            self.code_ranges.append((first, first + count))
        else:
            value = " ".join(raw.split())
            if value:
                if len(self.lines) >= MAX_LINES:
                    raise ManualError("The manual exceeds the supported number of text lines.")
                anchor = self.stack[-1][1] if self.stack else ""
                self.lines.append((anchor, value))
        end = len(self.lines)
        if end > first and (self.heading_level or (self.stack and self.stack[-1][3])):
            if self.fragment_ranges and self.fragment_ranges[-1][1] == first:
                self.fragment_ranges[-1] = (self.fragment_ranges[-1][0], end)
            else:
                self.fragment_ranges.append((first, end))

    def code_line_break(self):
        # Some highlighters wrap each line in a div instead of writing an LF.
        if self.parts and not self.parts[-1].endswith(("\r", "\n")):
            self.parts.append("\n")

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.pre_depth is None and (tag in self.boundaries or tag in self.ignored):
            self.flush()
        if self.fragment and tag in self.closes_paragraph:
            # HTML closes an open p before these block starts, even without </p>.
            for i in range(len(self.stack) - 1, -1, -1):
                open_tag = self.stack[i][0]
                if open_tag in self.paragraph_scope:
                    break
                if open_tag == "p":
                    self.flush()
                    self.pop_elements(i)
                    break
        if tag in {"li", "dt", "dd"}:
            # HTML permits omitted ends before a sibling item. Nested lists
            # protect the outer item from an inner term or definition.
            items = {"li"} if tag == "li" else {"dt", "dd"}
            for index in range(len(self.stack) - 1, -1, -1):
                open_tag = self.stack[index][0]
                if open_tag in self.list_scope_boundaries:
                    break
                if open_tag in items:
                    self.pop_elements(index)
                    break
        hidden = ((bool(self.stack) and self.stack[-1][2]) or tag in self.ignored
                  or "hidden" in attrs or attrs.get("aria-hidden") == "true")
        if self.pre_depth is not None and not hidden and tag in self.boundaries and tag != "br":
            self.code_line_break()
        parent = self.stack[-1] if self.stack else None
        selected = bool(parent and parent[3])
        if self.definition_phase and parent is self.definition_parent:
            if tag == "dd":
                selected = True
                self.definition_phase = "descriptions"
            elif tag == "dt":
                if self.definition_phase != "terms":
                    self.definition_phase = None
            elif not hidden:
                self.definition_phase = None
        if not hidden and self.heading_level and self.headings.get(tag, 7) <= self.heading_level:
            self.heading_level = 0
        if self.fragment and attrs.get("id") == self.fragment:
            self.fragment_count += 1
            if not hidden and tag in self.headings:
                self.heading_parent_depth = len(self.stack) - 1
                # header/hgroup can label their enclosing article or section.
                container = self.heading_parent_depth
                while container >= 0 and self.stack[container][0] in {"header", "hgroup"}:
                    container -= 1
                if container >= 0 and self.stack[container][0] in {"article", "section", "main"}:
                    self.heading_parent_depth = container
                self.heading_level = self.headings[tag]
                self.fragment_basis = "heading"
            elif not hidden and tag in self.section_tags:
                selected = True
                self.fragment_basis = "element"
                if tag == "dt" and parent and (parent[0] == "dl" or
                        (parent[0] == "div" and len(self.stack) > 1 and self.stack[-2][0] == "dl")):
                    self.definition_parent, self.definition_phase = parent, "terms"
                    self.fragment_basis = "definition"
        if tag not in self.void:
            if len(self.stack) >= MAX_DEPTH:
                raise ManualError("The manual exceeds the supported HTML nesting depth.")
            anchor = self.stack[-1][1] if self.stack else ""
            element_id = attrs.get("id") or ""
            if (tag in self.boundaries and 0 < len(element_id) <= 200 and element_id.isprintable()
                    and not any(c.isspace() for c in element_id)):
                anchor = element_id
            if tag == "pre" and self.pre_depth is None:
                self.pre_depth = len(self.stack)
            self.stack.append((tag, anchor, hidden, selected))
        elif tag == "br" and not hidden:
            self.parts.append("\n" if self.pre_depth is not None else " ")
        if tag in {"th", "td"} and not hidden:
            self.parts.append(" ")

    def pop_elements(self, index):
        if self.heading_level and index <= self.heading_parent_depth:
            self.heading_level = 0
        del self.stack[index:]

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if self.pre_depth is not None:
                    if i <= self.pre_depth:
                        self.flush()
                        self.pre_depth = None
                    elif tag in self.boundaries and not self.stack[i][2]:
                        self.code_line_break()
                elif tag in self.boundaries or tag in self.ignored or tag in self.list_containers:
                    self.flush()
                self.pop_elements(i)
                break

    def handle_data(self, data):
        if not self.stack or not self.stack[-1][2]:
            self.parts.append(data)


def public_target(url):
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if (len(url) > 4096 or parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username is not None
            or parsed.password is not None or not re.fullmatch(r"[A-Za-z0-9.-]+", host)
            or any(ord(c) <= 32 or ord(c) == 127 for c in url) or "\\" in url):
        raise ManualError("Expected a public HTTPS page without credentials.")
    # Preserve ordinary documentation version and language selectors. Other query
    # parameters may hold signatures or tokens that would be copied into citations.
    if parsed.query:
        selectors = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True, max_num_fields=4)
        if not selectors or any(key.lower() not in {"version", "v", "view", "lang", "locale", "release"}
                                or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}", value)
                                for key, value in selectors):
            raise ManualError("Use a public manual link with only version or language selectors.")
    addresses = [ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]
    if not addresses or any(not addr.is_global or addr.is_multicast for addr in addresses):
        raise ManualError("The manual must resolve exclusively to public addresses.")
    address = next((addr for addr in addresses if addr.version == 4), addresses[0])
    pinned = str(address) if address.version == 4 else f"[{address}]"
    return urlunsplit(parsed._replace(fragment="")), f"{host}:443:{pinned}"


def passages(lines, terms, code_ranges=(), search_ranges=None):
    if search_ranges is None:
        search_ranges = [(0, len(lines))]
    code_starts = {start for start, _ in code_ranges}
    found = []
    for term in terms:
        pattern = re.compile(re.escape(term), re.IGNORECASE)
        excerpts = []
        hits = 0
        for start, stop in search_ranges:
            for i in range(start, stop):
                anchor, line = lines[i]
                match = pattern.search(line)
                if not match:
                    continue
                hits += 1
                if len(excerpts) == 2:
                    continue
                left = max(0, match.start() - 120)
                text = line[left:]
                end = i
                code = next((span for span in code_ranges if span[0] <= i < span[1]), None)
                limit = min(code[1] if code else stop, stop, i + 3)
                while (code or anchor) and len(text) < 460 and end + 1 < limit:
                    next_anchor, following = lines[end + 1]
                    if not code and (next_anchor != anchor or end + 1 in code_starts):
                        break
                    end += 1
                    text += ("\n" if code else " ") + following
                partial_block = code is not None and (i > code[0] or end + 1 < code[1])
                excerpts.append({"line": i + 1, "anchor": anchor, "context_lines": [i + 1, end + 1],
                                 "excerpt": text[:460], "clipped": left > 0 or len(text) > 460 or partial_block})
        found.append({"term": term, "hits": hits, "passages": excerpts})
    return found


def read_page(url, terms, directory):
    source, pin = public_target(url)
    raw = directory / "source.html"
    # Keep curl's TLS hostname verification; pin the connection to the checked address.
    # No redirects, proxies, curlrc, cookies, credentials or custom request headers.
    result = subprocess.run([
        "curl", "--disable", "--silent", "--show-error", "--globoff", "--proto", "=https",
        "--noproxy", "*", "--resolve", pin, "--connect-timeout", "6", "--max-time", "18",
        "--max-filesize", str(MAX_BYTES), "--output", str(raw), "--write-out",
        "%{http_code}\n%{content_type}", "--", source,
    ], text=True, capture_output=True, check=True, timeout=22)
    status, _, content_type = result.stdout.partition("\n")
    if status != "200":
        if re.fullmatch(r"[0-9]{3}", status):
            raise ManualError(f"The publisher returned HTTP {status}.")
        raise ManualError("The publisher did not return an HTTP status.")
    if content_type.split(";")[0].strip().lower() not in {"text/html", "application/xhtml+xml"}:
        raise ManualError("The publisher did not return an HTML manual.")
    if raw.stat().st_size > MAX_BYTES:
        raise ManualError("Manual exceeds the download size limit.")
    data = raw.read_bytes()
    charset = re.search(r"charset\s*=\s*[\"']?([\w.-]+)", content_type, re.I)
    fragment = unquote(urlsplit(url).fragment)
    safe_fragment = 0 < len(fragment) <= 200 and fragment.isprintable() and not any(c.isspace() for c in fragment)
    manual = Manual(fragment if safe_fragment else None)
    try:
        page = data.decode(charset[1] if charset else "utf-8")
    except (UnicodeError, LookupError):
        raise ManualError("Could not decode the publisher's page using its declared or default encoding.") from None
    manual.feed(page)
    manual.close()
    manual.flush()
    if not manual.lines:
        raise ManualError("The page provided no readable text blocks.")
    plain = directory / "passages.txt"
    plain.write_text("\n".join(line for _, line in manual.lines) + "\n", encoding="utf-8")
    result = {"source": source, "raw_sha256": hashlib.sha256(data).hexdigest(), "original": str(raw),
              "text": str(plain), "lines": len(manual.lines)}
    ranges = None
    if fragment:
        # Never echo an unknown fragment, which may contain private URL state.
        # An unresolved link supplies no section evidence. The full artifact
        # remains available for separately identified whole-page research.
        ranges = []
        if manual.fragment_count == 1 and manual.fragment_ranges:
            ranges = manual.fragment_ranges
            result["source"] += "#" + quote(fragment, safe="-._~:")
            result["section"] = {"status": "found", "basis": manual.fragment_basis, "line_ranges": [[a + 1, b] for a, b in ranges]}
        else:
            status = "ambiguous" if manual.fragment_count > 1 else "unresolved"
            result["section"] = {"status": status, "line_ranges": []}
    result["matches"] = passages(manual.lines, terms, manual.code_ranges, ranges)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("urls", nargs="+")
    parser.add_argument("--find", action="append", required=True,
                        help="Literal phrase to locate. For a flag, use --find=--flag.")
    args = parser.parse_args()
    if len(args.urls) > 4 or len(args.find) > 4 or any(not t.strip() or len(t) > 160 for t in args.find):
        parser.error("Use at most four pages and one to four short search phrases.")
    ok = True
    for number, url in enumerate(dict.fromkeys(args.urls), start=1):
        try:
            directory = Path(tempfile.mkdtemp(prefix="manual-", dir="/workspace"))
            print(json.dumps(read_page(url, args.find, directory), ensure_ascii=False), flush=True)
        except (OSError, ValueError, LookupError, subprocess.SubprocessError) as error:
            print(json.dumps({"input": number, "error": failure_message(error)}), flush=True)
            ok = False
    return 0 if ok else 1


def failure_message(error):
    # DNS and curl exceptions can include a private URL, hostname or command.
    if isinstance(error, ManualError):
        return str(error)
    if isinstance(error, socket.gaierror):
        return "DNS lookup failed for the manual publisher."
    if isinstance(error, subprocess.TimeoutExpired):
        return "The manual request timed out."
    if isinstance(error, subprocess.CalledProcessError):
        return {
            7: "Could not connect to the manual publisher.",
            28: "The manual request timed out.",
            35: "The TLS handshake with the manual publisher failed.",
            60: "Could not verify the manual publisher's TLS certificate.",
            63: "Manual exceeds the download size limit.",
        }.get(error.returncode, "The manual download failed.")
    return "Could not fetch or decode this public manual."


if __name__ == "__main__":
    raise SystemExit(main())

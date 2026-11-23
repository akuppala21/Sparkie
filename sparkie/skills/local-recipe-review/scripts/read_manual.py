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
from urllib.parse import parse_qsl, urlsplit, urlunsplit


MAX_BYTES = 4 * 1024 * 1024
MAX_DEPTH = 128


class ManualError(ValueError):
    """A message safe to display in the chat."""


class Manual(HTMLParser):
    """Keep visible text blocks and the nearest enclosing block's HTML anchor."""

    boundaries = set("p div section article h1 h2 h3 h4 h5 h6 li dt dd pre tr br".split())
    ignored = set("head nav aside footer script style noscript svg template".split())
    list_containers = {"ul", "ol", "menu"}
    list_scope_boundaries = list_containers | ignored | {
        "html", "applet", "caption", "table", "td", "th", "marquee", "object",
    }
    void = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self):
        super().__init__()
        self.stack = []
        self.parts = []
        self.lines = []

    def flush(self):
        value = " ".join("".join(self.parts).split())
        if value:
            anchor = self.stack[-1][1] if self.stack else ""
            self.lines.append((anchor, value))
        self.parts.clear()

    def handle_starttag(self, tag, attrs):
        if tag in self.boundaries or tag in self.ignored:
            self.flush()
        if tag == "li":
            # An li end tag may be omitted before its next sibling. A nested
            # list or another scope boundary protects the outer item.
            for index in range(len(self.stack) - 1, -1, -1):
                open_tag = self.stack[index][0]
                if open_tag in self.list_scope_boundaries:
                    break
                if open_tag == "li":
                    del self.stack[index:]
                    break
        if tag not in self.void:
            if len(self.stack) >= MAX_DEPTH:
                raise ManualError("The manual exceeds the supported HTML nesting depth.")
            attrs = dict(attrs)
            _, anchor, hidden = self.stack[-1] if self.stack else ("", "", False)
            element_id = attrs.get("id") or ""
            if (tag in self.boundaries and 0 < len(element_id) <= 200 and element_id.isprintable()
                    and not any(c.isspace() for c in element_id)):
                anchor = element_id
            self.stack.append((tag, anchor,
                               hidden or tag in self.ignored or "hidden" in attrs or attrs.get("aria-hidden") == "true"))
        elif tag == "br":
            self.parts.append(" ")
        if tag in {"th", "td"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in self.boundaries or tag in self.ignored or tag in self.list_containers:
            self.flush()
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
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


def passages(lines, terms):
    found = []
    for term in terms:
        pattern = re.compile(re.escape(term), re.IGNORECASE)
        excerpts = []
        hits = 0
        for i, (anchor, line) in enumerate(lines):
            match = pattern.search(line)
            if not match:
                continue
            hits += 1
            if len(excerpts) == 2:
                continue
            left = max(0, match.start() - 120)
            text = line[left:]
            end = i
            while anchor and len(text) < 460 and end + 1 < min(len(lines), i + 3):
                next_anchor, following = lines[end + 1]
                if next_anchor != anchor:
                    break
                end += 1
                text += " " + following
            excerpts.append({"line": i + 1, "anchor": anchor, "context_lines": [i + 1, end + 1],
                             "excerpt": text[:460], "clipped": left > 0 or len(text) > 460})
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
    manual = Manual()
    manual.feed(data.decode(charset[1] if charset else "utf-8"))
    manual.close()
    manual.flush()
    if not manual.lines:
        raise ManualError("The page provided no readable text blocks.")
    plain = directory / "passages.txt"
    plain.write_text("\n".join(line for _, line in manual.lines) + "\n", encoding="utf-8")
    return {"source": source, "raw_sha256": hashlib.sha256(data).hexdigest(), "original": str(raw),
            "text": str(plain), "lines": len(manual.lines), "matches": passages(manual.lines, terms)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("urls", nargs="+")
    parser.add_argument("--find", action="append", required=True, help="Literal phrase to locate, repeat for other facts.")
    args = parser.parse_args()
    if len(args.urls) > 4 or len(args.find) > 4 or any(not t.strip() or len(t) > 160 for t in args.find):
        parser.error("Use at most four pages and one to four short search phrases.")
    ok = True
    for number, url in enumerate(dict.fromkeys(args.urls), start=1):
        try:
            directory = Path(tempfile.mkdtemp(prefix="manual-", dir="/workspace"))
            print(json.dumps(read_page(url, args.find, directory), ensure_ascii=False), flush=True)
        except (OSError, ValueError, LookupError, subprocess.SubprocessError) as error:
            # Library and process exceptions can contain URLs, headers or arguments.
            message = str(error) if isinstance(error, ManualError) else "Could not fetch or decode this public manual."
            print(json.dumps({"input": number, "error": message}), flush=True)
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

# Read a public release manual in the Hermes workspace

The reader runs in the native Hermes terminal with Python 3 and curl. It fetches up to four public HTTPS HTML pages, reports short passages for up to four literal phrases, and saves the original bytes and visible text for the current workspace. Each result includes the exact public URL, source hash and matching line numbers. Use the native file reader to check qualifications near a match. Check the original HTML when a table or code block depends on formatting.

For example, this command reads the same extraction guidance in two CPython releases.

```sh
python3 ~/.hermes/skills/local-recipe-review/scripts/read_manual.py \
  'https://docs.python.org/3.13/library/tarfile.html' \
  'https://docs.python.org/3.14/library/tarfile.html' \
  --find 'extraction_filter' --find 'denial-of-service'
```

A failed URL is identified by its position. A missing phrase means the literal lookup found no match. Search the saved text for another spelling or open the relevant section before drawing a conclusion. Use the page matching the requested release and check that the publisher identifies that release. A current manual may describe several versions.

The helper accepts public pages served directly on HTTPS port 443. It omits fragments from the network request, keeps common version and language selectors, and rejects other query parameters, redirects, non-HTML responses, and nonpublic addresses. Downloads are limited to 4 MiB per page. The checked sandbox supplies curl 8.14.1. A tool result supplies evidence to inspect. A claim about behavior still needs a supporting passage or an appropriately scoped reproduction.

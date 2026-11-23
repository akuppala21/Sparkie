"""Compare the saved manual against an independently extracted Python example."""
import ast
from hashlib import sha256
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

class Blocks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks = []
        self.parts = None

    def handle_starttag(self, tag, attrs):
        if tag == 'pre':
            self.parts = []
        elif self.parts is not None and tag == 'br':
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag == 'pre' and self.parts is not None:
            self.blocks.append(''.join(self.parts).strip('\n'))
            self.parts = None

    def handle_data(self, data):
        if self.parts is not None:
            self.parts.append(data)

reader = load('reader', '/src/skills/local-recipe-review/scripts/read_manual.py')
before = load('before', '/src/before.py')
url = 'https://docs.python.org/3.13/howto/logging-cookbook.html'
data = reader.read_page(url, ['import logging'], Path('/workspace'))
raw = Path(data['original']).read_text()
extract = Blocks()
extract.feed(raw)
old = before.Manual()
old.feed(raw)
old.close()
old.flush()
old_text = '\n'.join(line for _, line in old.lines)
saved = Path(data['text']).read_text()
for block in extract.blocks:
    if 'def worker_configurer(queue):' not in block:
        continue
    try:
        ast.parse(block)
    except SyntaxError:
        continue
    assert block not in old_text
    assert block in saved
    first = saved[:saved.index(block)].count('\n') + 1
    assert '\n'.join(saved.split('\n')[first-1:first-1+len(block.split('\n'))]) == block
    print(json.dumps(dict(publisher=url, html_sha256=data['raw_sha256'], block_sha256=sha256(block.encode()).hexdigest(), first_line=first, lines=len(block.split('\n')), original_parses_as_python=True, previous_exact=False, revised_exact=True)))
    break
else:
    raise AssertionError('No qualifying unmodified publisher example')

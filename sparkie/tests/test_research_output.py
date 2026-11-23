import json
from types import SimpleNamespace

import pytest

from behavior.research_output import verify_source_reader


def test_registered_reader_hidden_from_agent_cannot_pass_preflight():
    agent = SimpleNamespace(tools=[{'function': {'name': 'skills_list'}}])
    with pytest.raises(RuntimeError, match='cannot read its sources'):
        verify_source_reader(agent, lambda *_: pytest.fail('unavailable tool dispatched'), {})


@pytest.mark.parametrize('content,truncated', [('1|Title', False), ('1|Title\n2|URL\n3|Excerpt', True)])
def test_incomplete_source_cannot_pass_preflight(content, truncated):
    agent = SimpleNamespace(tools=[{'function': {'name': 'read_file'}}])
    source = {'A': {'title': 'Title', 'url': 'URL', 'text': 'Excerpt'}}
    with pytest.raises(RuntimeError, match='complete source A'):
        verify_source_reader(agent, lambda *_: json.dumps({'content': content, 'truncated': truncated}), source)

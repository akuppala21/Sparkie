"""Exercise the source-checkout evidence utility using original source text and conflicting runs."""
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import subprocess
import sys

import pytest


script = Path(__file__).resolve().parents[1] / 'tools/check_research_evidence.py'
spec = spec_from_file_location('check_evidence', script)
checker = module_from_spec(spec)
spec.loader.exec_module(checker)


def specimen(value, source):
    settings = 'Single node, batch Q, reasoning off, 3 runs at 256 tokens'
    quote = f'Throughput: {value} items/s.'
    row = dict(source=source, kind='measured', quote=quote, nodes='Single node',
               workload='batch Q', thinking='reasoning off', protocol='3 runs at 256 tokens',
               metric='Throughput', unit='items/s', value=value)
    return (f'https://example.org/{source}', settings + '\n' + quote), row


def pair():
    a, x = specimen('12', 1)
    b, y = specimen('8', 2)
    return [a, b], {'claims': [x, y], 'compare': [[1, 2]]}


def test_matched_scalar_arithmetic_keeps_attribution_and_semantic_limit():
    sources, sheet = pair()
    result = checker.check(sheet, sources)
    assert [row['reference'] for row in result['claims']] == [ref for ref, _ in sources]
    assert result['comparisons'] == [{'claims': [1, 2], 'unmatched': [], 'left_divided_by_right': '1.5'}]
    assert 'whether the declared conditions actually apply' in result['limit']


@pytest.mark.parametrize('field,value', [('quote', 'Throughput: 120 items/s.'),
    ('protocol', 'a different test'), ('value', '2'), ('value', 'NaN'), ('source', True)])
def test_rejects_missing_or_wrong_source_evidence(field, value):
    sources, sheet = pair()
    sheet['claims'][0][field] = value
    with pytest.raises(ValueError):
        checker.check(sheet, sources)


def test_absent_field_is_a_sheet_error_and_unknown_field_blocks_ratio():
    sources, sheet = pair()
    del sheet['claims'][0]['workload']
    with pytest.raises(ValueError, match='workload'):
        checker.check(sheet, sources)
    sheet['claims'][0]['workload'] = None
    result = checker.check(sheet, sources)['comparisons'][0]
    assert 'left_divided_by_right' not in result and 'workload is missing or differs.' in result['unmatched']


def test_different_node_counts_and_configured_limits_do_not_support_a_ratio():
    sources, sheet = pair()
    sources[1] = (sources[1][0], sources[1][1].replace('Single node', 'Two nodes'))
    sheet['claims'][1].update(nodes='Two nodes', kind='configured')
    result = checker.check(sheet, sources)['comparisons'][0]
    assert 'left_divided_by_right' not in result
    assert result['unmatched'] == ['Two measured scalar values are required.', 'nodes is missing or differs.']


@pytest.mark.parametrize('quote,value', [('16–24 items/s', '24'), ('16 - 24 items/s', '16'),
    ('16 to 24 items/s', '24'), ('1,000 items/s', '1'), ('~16 items/s', '16'),
    ('0.12 items/s', '12'), ('256 items/s', '25')])
def test_range_endpoint_partial_number_and_approximation_are_not_exact_scalars(quote, value):
    assert not checker.scalar_in_quote(value, quote)


def test_quoted_ranges_remain_available_when_arithmetic_is_unavailable():
    sources, sheet = pair()
    sources[0] = (sources[0][0], sources[0][1].replace('12 items/s', '10–12 items/s'))
    row = sheet['claims'][0]
    row['quote'] = 'Throughput: 10–12 items/s.'
    for field in ('value', 'unit', 'metric'):
        del row[field]
    assert checker.check(sheet, sources)['comparisons'][0]['unmatched']


def test_refuses_silently_omitted_source():
    sources, sheet = pair()
    sheet['claims'].pop()
    with pytest.raises(ValueError, match='every supplied source'):
        checker.check(sheet, sources)


def test_header_and_workspace_boundary(tmp_path):
    workspace = tmp_path / 'workspace'
    workspace.mkdir()
    path = workspace / 'source.md'
    url = 'https://example.org/claim'
    path.write_text(f'Source: {url}\nAuthor: Example\nPost: 2\n\n**Original**: A\n')
    assert checker.load_source(path, workspace) == (url, '**Original**: A\n')
    outside = tmp_path / 'outside'
    outside.write_text('private')
    (workspace / 'link').symlink_to(outside)
    with pytest.raises(ValueError, match='workspace'):
        checker.load_source('link', workspace)


def test_source_checkout_command_uses_the_supplied_directory(tmp_path):
    sources, sheet = pair()
    for name, (url, body) in zip(('one.md', 'two.md'), sources):
        (tmp_path / name).write_text(url + '\n' + body)
    cmd = [sys.executable, str(script), '--workspace', str(tmp_path), 'one.md', 'two.md']
    result = subprocess.run(cmd, input=json.dumps(sheet), text=True, capture_output=True, check=True)
    assert json.loads(result.stdout)['comparisons'][0]['left_divided_by_right'] == '1.5'

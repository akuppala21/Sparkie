"""Exercise the source-checkout evidence utility using original source text and conflicting runs."""
from importlib.util import module_from_spec, spec_from_file_location
from decimal import Decimal
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


@pytest.mark.parametrize('quote', [
    'Throughput: 12 seconds after setup took 8 items/s.',
    'Throughput: 12 items/s/worker.',
    'Throughput: 12 items/s per worker.',
    'Throughput: 12\nitems/s refers to a different row.',
])
def test_a_different_measurements_unit_cannot_authorize_arithmetic(quote):
    sources, sheet = pair()
    row = sheet['claims'][0]
    sources[0] = (sources[0][0], sources[0][1].replace(row['quote'], quote))
    row['quote'] = quote
    result = checker.check(sheet, sources)
    assert result['claims'][0]['quote'] == quote
    comparison = result['comparisons'][0]
    assert comparison['unmatched'] and 'left_divided_by_right' not in comparison


def test_prefixed_currency_amounts_are_still_comparable():
    sources, sheet = pair()
    for i, row in enumerate(sheet['claims']):
        original = row['quote']
        row.update(quote='Price: $' + row['value'] + '.', unit='$', metric='Price')
        sources[i] = (sources[i][0], sources[i][1].replace(original, row['quote']))
    assert checker.check(sheet, sources)['comparisons'][0]['left_divided_by_right'] == '1.5'


@pytest.mark.parametrize('original', ['112 items/s', '0.12 items/s', '8–12 items/s', '≈12 items/s'])
def test_shortening_the_source_cannot_turn_a_fragment_into_a_measured_number(original):
    sources, sheet = pair()
    ref, body = sources[0]
    sources[0] = ref, body.replace('12 items/s', original)
    sheet['claims'][0]['quote'] = '12 items/s'
    with pytest.raises(ValueError, match='standalone decimal'):
        checker.check(sheet, sources)


@pytest.mark.parametrize('original,comparable', [
    ('12 items/s per worker', False),
    ('12 items/s/worker', False),
    ('12 items/s to 23 items/s', False),
    ('12 items/s. Other run: 12 items/s/worker', False),
    ('12 items/s. Repeated run: 12 items/s.', True),
])
def test_shortened_unit_uses_every_matching_location_in_the_original(original, comparable):
    sources, sheet = pair()
    ref, body = sources[0]
    sources[0] = ref, body.replace('12 items/s', original)
    sheet['claims'][0]['quote'] = '12 items/s'
    result = checker.check(sheet, sources)['comparisons'][0]
    assert ('left_divided_by_right' in result) == comparable


@pytest.mark.parametrize('quoted_price', ['$12 per hour', '$12/day', '$12 million'])
def test_price_unit_keeps_its_original_denominator_and_scale(quoted_price):
    sources, sheet = pair()
    for i, row in enumerate(sheet['claims']):
        source_price = quoted_price if i == 0 else '$8'
        ref, body = sources[i]
        sources[i] = ref, body.replace(row['quote'], 'Price: ' + source_price)
        row.update(quote='$' + row['value'], metric='Price', unit='$')
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


def test_source_conditions_and_result_cannot_be_borrowed_from_other_runs():
    lines = [
        'One worker, cold audit, reasoning off, full validation: throughput 37–43 files/hour.',
        'One worker, cold audit, reasoning off, full validation: throughput 54 files/hour.',
        'One worker, warm preview, reasoning off, header scan: throughput 27 files/hour.',
    ]
    def row(quote, value):
        return dict(source=1, kind='measured', quote=quote, nodes='One worker', workload='cold audit',
                    thinking='reasoning off', protocol='full validation', metric='throughput',
                    unit='files/hour', value=value)
    claims = [row(lines[1], '54'), row(lines[0], ['37', '43']), row(lines[2], '27')]
    sheet = {'claims': claims, 'compare': [[1, 2], [1, 3]]}
    for separator in ('\n', '\n\n', ' '):
        matched, mismatched = checker.check(sheet, [('report', separator.join(lines))])['comparisons']
        bounds = [Decimal(54) / Decimal(base) for base in (43, 37)]
        assert matched['left_divided_by_right_range'] == list(map(str, bounds))
        assert matched['relative_change_percent_range'] == [str((r - 1) * 100) for r in bounds]
        assert mismatched['unmatched'] and 'left_divided_by_right' not in mismatched


def test_ambiguous_short_quote_must_be_supported_at_each_occurrence():
    sources, sheet = pair()
    _, a = sources[0]
    sources[0] = ('report', a + '\n\nTwo nodes, other batch, thinking on, preview only.\nThroughput: 12 items/s.')
    result = checker.check(sheet, sources)['comparisons'][0]
    assert result['unmatched'] and 'left_divided_by_right' not in result


@pytest.mark.parametrize('line,quote', [
    ('Single node, batch Q, reasoning off, 3 runs at 256 tokens. Throughput unavailable; '
     'different suite: 12 items/s.', '12 items/s'),
    ('Single node, batch Q, reasoning off, 3 runs at 256 tokens: Throughput 8 items/s and 12 items/s.',
     'Single node, batch Q, reasoning off, 3 runs at 256 tokens: Throughput 8 items/s and 12 items/s.'),
    ('Single node, batch Queries, reasoning off, 3 runs at 256 tokens: Throughput 12 items/s.',
     'Single node, batch Queries, reasoning off, 3 runs at 256 tokens: Throughput 12 items/s.'),
])
def test_another_clause_competing_reading_or_partial_label_is_insufficient(line, quote):
    sources, sheet = pair()
    sources[0] = ('report', line)
    sheet['claims'][0]['quote'] = quote
    result = checker.check(sheet, sources)['comparisons'][0]
    assert result['unmatched'] and 'left_divided_by_right' not in result


@pytest.mark.parametrize('competing', ['1,200', '1.2e3', '1E+3', '1_200', '+1200', '.25'])
def test_unsupported_competing_reading_withholds_ratio(competing):
    sources, sheet = pair()
    settings = sources[0][1].splitlines()[0]
    quote = f'{settings}: Throughput {competing} items/s and 12 items/s.'
    sources[0] = ('report', quote)
    sheet['claims'][0]['quote'] = quote
    result = checker.check(sheet, sources)['comparisons'][0]
    assert result['unmatched'] and 'left_divided_by_right' not in result


@pytest.mark.parametrize('competing', ['1,200\u00a0items/s', '1k items/s', '9', '−12 items/s'])
def test_unaccounted_number_in_measurement_record_withholds_ratio(competing):
    sources, sheet = pair()
    settings = sources[0][1].splitlines()[0]
    quote = f'{settings}: Throughput {competing} and 12 items/s.'
    sources[0] = ('report', quote)
    sheet['claims'][0]['quote'] = quote
    result = checker.check(sheet, sources)['comparisons'][0]
    assert result['unmatched'] and 'left_divided_by_right' not in result


def test_unicode_negative_reading_cannot_supply_a_positive_value():
    sources, sheet = pair()
    sources[0] = (sources[0][0], sources[0][1].replace('12 items/s', '−12 items/s'))
    sheet['claims'][0]['quote'] = '12 items/s'
    with pytest.raises(ValueError, match='standalone decimal'):
        checker.check(sheet, sources)


def test_digits_in_exact_conditions_and_metric_allow_scalar_range_comparison():
    sources, sheet = pair()
    for i, row in enumerate(sheet['claims']):
        value = ['8', '12'] if i else '12'
        reading = '8–12' if i else '12'
        quote = f'2 nodes, batch Q, reasoning off, 3 runs at 256 tokens: P95 throughput {reading} items/s.'
        row.update(quote=quote, nodes='2 nodes', metric='P95 throughput', value=value)
        sources[i] = ('report', quote)
    comparison = checker.check(sheet, sources)['comparisons'][0]
    assert comparison['unmatched'] == []
    assert comparison['left_divided_by_right_range'] == ['1', '1.5']


@pytest.mark.parametrize('left,right,expected', [
    (['4', '6'], ['8', '10'], ['0.4', '0.75']),
    (['-6', '-4'], ['8', '10'], ['-0.75', '-0.4']),
    (['4', '6'], ['-2', '2'], None),
])
def test_interval_extrema_and_undefined_denominator(left, right, expected):
    sources, sheet = pair()
    for i, row in enumerate(sheet['claims']):
        bounds = (left, right)[i]
        quote = 'Latency: ' + ' to '.join(bounds) + ' ms.'
        sources[i] = (sources[i][0], sources[i][1].replace(row['quote'], quote))
        row.update(quote=quote, value=bounds, metric='Latency', unit='ms')
    result = checker.check(sheet, sources)['comparisons'][0]
    if expected is None:
        assert result['unmatched'] and 'left_divided_by_right_range' not in result
    else:
        assert result['left_divided_by_right_range'] == expected


@pytest.mark.parametrize('body,value', [
    ('10 to 15 ms', ['10', '12']), ('10–15 ms', ['15', '10']),
    ('≈10–15 ms', ['10', '15']), ('10–15–20 ms', ['10', '15']),
])
def test_incomplete_or_qualified_range_cannot_authorize_math(body, value):
    assert not checker.amount_in_quote(value, body, unit='ms')

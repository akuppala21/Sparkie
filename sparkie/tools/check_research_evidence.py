"""Check a prepared JSON comparison sheet against saved original text files."""
import argparse
from decimal import Decimal
import json
from pathlib import Path
import re
import sys


CONDITIONS = ('nodes', 'workload', 'thinking', 'protocol')
FIELDS = {'source', 'kind', 'quote', *CONDITIONS}
NUMERIC = {'metric', 'value', 'unit'}
LIMIT = 2 * 1024 * 1024 + 4096   # forum reader body limit plus its citation header
SEMANTIC_LIMIT = (
    'Literal matches establish wording only. Read the surrounding text to decide '
    'which setup a quote describes, whether it was measured, and whether the '
    'declared conditions actually apply to both numbers.'
)


def load_source(path, workspace):
    path = (workspace / path).resolve()
    if not path.is_relative_to(workspace) or not path.is_file():
        raise ValueError('Use a regular source file inside the current workspace.')
    with path.open('rb') as handle:
        data = handle.read(LIMIT + 1)
    if not data or len(data) > LIMIT:
        raise ValueError('Source is empty or exceeds the size limit.')
    text = data.decode('utf-8')
    first, _, rest = text.partition('\n')
    reference = first.removeprefix('Source: ').strip()
    if not re.fullmatch(r'https?://[^\s<>]+', reference):
        return str(path), text
    # The forum reader also prepends author/post attribution before the untouched body.
    if first.startswith('Source: ') and re.match(r'^Author: [^\n]+\nPost: \d+\n\n', rest):
        rest = rest.split('\n\n', 1)[1]
    return reference, rest


def literal(value, body, field):
    if not isinstance(value, str) or not value.strip() or len(value) > 1600 or value not in body:
        raise ValueError(f'{field} must be an exact, nonempty excerpt from its source.')


def scalar_in_quote(value, quote, *, unit=None):
    if not isinstance(value, str) or len(value) > 32 or not re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?', value):
        return False
    token = r'(?<![\w.+-])(?<!\d,)' + re.escape(value) + r'(?!\w|\.\d|,\d)'
    for match in re.finditer(token, quote):
        before, after = quote[:match.start()], quote[match.end():]
        if unit is not None:
            # A unit elsewhere in the same source may belong to a different measurement.
            suffix = r'^[^\S\n]*' + re.escape(unit) + r'(?![\w/%*^·]|[.-]\w|\s+per\s+\w)'
            currency_prefix = unit in ('$', '€', '£', '¥') and before.rstrip(' \t').endswith(unit)
            if not currency_prefix and not re.match(suffix, after):
                continue
        if (not re.search(r'(?:\d\s*(?:[-–—]|\bto)|[~≈<>≤≥])\s*$', before)
                and not re.match(r'^\s*(?:[-–—]|to\b)\s*\d', after)):
            return True
    return False


def check(sheet, sources):
    if not isinstance(sheet, dict) or set(sheet) != {'claims', 'compare'}:
        raise ValueError('Provide claims and compare arrays.')
    claims, pairs = sheet['claims'], sheet['compare']
    if not isinstance(claims, list) or not 1 <= len(claims) <= 32:
        raise ValueError('Provide 1 to 32 claims.')
    if not isinstance(pairs, list) or len(pairs) > 16:
        raise ValueError('Provide up to 16 comparison pairs.')
    rows = []
    covered = set()
    for i, row in enumerate(claims, 1):
        if not isinstance(row, dict) or set(row) not in (FIELDS, FIELDS | NUMERIC):
            raise ValueError(f'Claim {i} needs source, kind, quote, nodes, workload, thinking, protocol. '
                             'For numeric checks also supply metric, value and unit together.')
        index = row['source']
        if type(index) is not int or not 1 <= index <= len(sources):
            raise ValueError(f'Claim {i} has an invalid source number.')
        if row['kind'] not in ('measured', 'configured', 'described'):
            raise ValueError(f'Claim {i} needs a measured, configured or described kind.')
        ref, body = sources[index - 1]
        literal(row['quote'], body, f'Claim {i} quote')
        for key in CONDITIONS:
            if row[key] is not None:
                literal(row[key], body, f'Claim {i} {key}')
        if 'value' in row:
            for key in ('metric', 'unit'):
                literal(row[key], body, f'Claim {i} {key}')
            value = row['value']
            if not scalar_in_quote(value, row['quote']):
                raise ValueError(f'Claim {i} value needs one standalone decimal from its result quote. '
                                 'Keep ranges as quoted text and omit the numeric fields.')
        rows.append(dict(row, reference=ref))
        covered.add(index)
    if covered != set(range(1, len(sources) + 1)):
        raise ValueError('At least one quoted claim is needed from every supplied source.')
    comparisons = []
    for pair in pairs:
        if (not isinstance(pair, list) or len(pair) != 2 or pair[0] == pair[1]
                or any(type(n) is not int or not 1 <= n <= len(rows) for n in pair)):
            raise ValueError('Each comparison must name two different claim numbers, starting at 1.')
        left, right = (rows[n - 1] for n in pair)
        reasons = []
        if any(row['kind'] != 'measured' or 'value' not in row for row in (left, right)):
            reasons.append('Two measured scalar values are required.')
        elif any(not scalar_in_quote(row['value'], row['quote'], unit=row['unit']) for row in (left, right)):
            reasons.append('The result quote must show each scalar with its stated unit before calculating a ratio.')
        for key in ('metric', 'unit', *CONDITIONS):
            if not left.get(key) or left.get(key) != right.get(key):
                reasons.append(f'{key} is missing or differs.')
        result = {'claims': pair, 'unmatched': reasons}
        if not reasons:
            divisor = Decimal(right['value'])
            if divisor == 0:
                reasons.append('The denominator is zero.')
            else:
                result['left_divided_by_right'] = str(Decimal(left['value']) / divisor)
        comparisons.append(result)
    return {'claims': rows, 'comparisons': comparisons, 'limit': SEMANTIC_LIMIT}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True, help='Directory containing the saved originals.')
    parser.add_argument('sources', nargs='+', help='Text files in source-number order, relative to that directory.')
    args = parser.parse_args()
    try:
        if len(args.sources) > 8:
            raise ValueError('Use up to eight sources per sheet.')
        payload = sys.stdin.buffer.read(128 * 1024 + 1)
        if len(payload) > 128 * 1024:
            raise ValueError('Comparison sheet exceeds 128 KiB.')
        directory = args.workspace.resolve(strict=True)
        if not directory.is_dir():
            raise ValueError('The workspace must be a directory containing the saved originals.')
        sources = [load_source(name, directory) for name in args.sources]
        print(json.dumps(check(json.loads(payload), sources), ensure_ascii=False))
    except (ValueError, OSError, RecursionError) as exc:
        print(f'Cannot check this evidence: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

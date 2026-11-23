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
DECIMAL = r'-?[0-9]+(?:\.[0-9]+)?'
RANGE_SEPARATOR = r'(?:[ \t]*[-–—][ \t]*|[ \t]+to[ \t]+)'
RECORD_BREAK = re.compile(r'\n|(?<=;)[ \t]*|(?<=[.!?])[ \t]+')
LIMIT = 2 * 1024 * 1024 + 4096   # forum reader body limit plus its citation header
SEMANTIC_LIMIT = (
    'Arithmetic is conditional on the supplied measurement labels. Literal matches establish wording only. '
    'Read the surrounding text to decide '
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


def amount_pattern(value):
    values = value if isinstance(value, list) else [value]
    if isinstance(value, list) and len(value) != 2:
        return None
    if any(not isinstance(v, str) or len(v) > 32 or not re.fullmatch(DECIMAL, v) for v in values):
        return None
    if len(values) == 2 and Decimal(values[0]) > Decimal(values[1]):
        return None
    return RANGE_SEPARATOR.join(re.escape(v) for v in values)


def amount_in_quote(value, quote, *, unit=None, source=None):
    pattern = amount_pattern(value)
    if pattern is None:
        return False
    number = re.compile(r'(?<![\w.+−-])(?<!\d,)' + pattern + r'(?!\w|\.\d|,\d)')
    amounts = list(number.finditer(quote))
    if not amounts:
        return False
    text = quote if source is None else source
    # A truncated quote can hide part of a number, a range, or a unit. Check
    # boundaries in the original while requiring the witness inside the quote.
    leading_qualifier = r'(?:\d\s*(?:[-–—]|\bto)|[~≈<>≤≥])\s*(?:[$€£¥][ \t]*)?'
    qualified = {m.end() for m in re.finditer(leading_qualifier + '(?=' + pattern + ')', text)}
    range_end = re.compile(r'\s*(?:[-–—]|to\b)\s*(?:[$€£¥]\s*)?\d')
    if unit is not None:
        suffix = re.compile(r'[^\S\n]*' + re.escape(unit) + r'(?![\w/%*^·]|[.-]\w|\s+per\s+\w)')
    currency_rate = re.compile(r'\s*(?:/|per\b|a\b|an\b|each\b|thousand\b|million\b|billion\b)', re.I)

    def supported(offset, amount):
        start, end = offset + amount.start(), offset + amount.end()
        if not number.match(text, start) or start in qualified or range_end.match(text, end):
            return False
        if unit is None:
            return True
        if unit in ('$', '€', '£', '¥') and quote[:amount.start()].rstrip(' \t').endswith(unit):
            return not currency_rate.match(text, end)
        label = suffix.match(text, end)
        return bool(label and label.end() <= offset + len(quote) and not range_end.match(text, label.end()))

    offset = text.find(quote)
    if offset < 0:
        return False
    while offset >= 0:
        if not any(supported(offset, amount) for amount in amounts):
            return False
        offset = text.find(quote, offset + 1)
    return True


def scalar_in_quote(value, quote, *, unit=None, source=None):
    return isinstance(value, str) and amount_in_quote(value, quote, unit=unit, source=source)


def bound_measurement(row, body):
    """Require the same numeric record and conditions at every occurrence of the result quote."""
    quote, unit, metric = row['quote'], row['unit'], row['metric']
    labels = [row[key] for key in CONDITIONS]
    if not all(labels):
        return False
    amount = rf'{DECIMAL}(?:{RANGE_SEPARATOR}{DECIMAL})?'
    escaped_unit = re.escape(unit)
    numeric = (rf'{escaped_unit}[^\S\n]*({amount})(?!\w|\.\d|,\d)' if unit in ('$', '€', '£', '¥')
               else rf'({amount})[^\S\n]*{escaped_unit}(?![\w/%*^·])')
    readings = re.compile(r'(?<![\w.+−-])(?<!\d,)' + numeric)
    expected = re.compile(amount_pattern(row['value']))

    def literal_term(term):
        start = r'(?<!\w)' if re.match(r'\w', term[0]) else ''
        end = r'(?!\w)' if re.match(r'\w', term[-1]) else ''
        return re.compile(start + re.escape(term) + end)

    terms = [literal_term(label) for label in sorted(labels, key=len, reverse=True)]
    metric_term = literal_term(metric)
    def one_amount(record):
        matches = list(readings.finditer(record))
        if not matches or any(not expected.fullmatch(match[1]) for match in matches):
            return False
        residual = readings.sub(' ', record)
        for term in [*terms, metric_term]:
            residual = term.sub(' ', residual, count=1)
        return not any(char.isnumeric() for char in residual)

    complete_quote = metric_term.search(quote) and all(term.search(quote) for term in terms)
    occurrences = 0
    for paragraph in re.split(r'\n[ \t]*\n', body):
        if quote not in paragraph:
            continue
        records = RECORD_BREAK.split(paragraph)
        matching = [record for record in records if quote in record]
        count = paragraph.count(quote)
        if (complete_quote and sum(record.count(quote) for record in matching) == count
                and all(one_amount(record) for record in matching)):
            occurrences += count
            continue
        # Existing sheets can quote only the result under a complete, literal settings header.
        marker = metric_term.search(paragraph)
        if not marker:
            return False
        header, result = paragraph[:marker.start()], paragraph[marker.start():].rstrip()
        for term in terms:
            header, removed = term.subn('', header)
            if not removed:
                return False
        if (header.strip(' \t\r\n.,;:|') or '\n' in result or result.count(quote) != count
                or any(quote not in record for record in RECORD_BREAK.split(result))
                or not one_amount(result)):
            return False
        occurrences += count
    return occurrences == body.count(quote) and occurrences > 0


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
            if not amount_in_quote(value, row['quote'], source=body):
                raise ValueError(f'Claim {i} value needs one standalone decimal or its complete ordered range '
                                 'from the result quote.')
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
        elif any(not amount_in_quote(row['value'], row['quote'], unit=row['unit'], source=sources[row['source'] - 1][1]) for row in (left, right)):
            reasons.append('The result quote must show the complete value or interval with its stated unit.')
        for key in ('metric', 'unit', *CONDITIONS):
            if not left.get(key) or left.get(key) != right.get(key):
                reasons.append(f'{key} is missing or differs.')
        if not reasons and any(not bound_measurement(row, sources[row['source'] - 1][1])
                               for row in (left, right)):
            reasons.append('The result, metric and conditions must belong to one unambiguous source record.')
        result = {'claims': pair, 'unmatched': reasons}
        if not reasons:
            numerator, denominator = left['value'], right['value']
            if isinstance(numerator, list) or isinstance(denominator, list):
                left_bounds = [Decimal(n) for n in (numerator if isinstance(numerator, list) else [numerator])]
                right_bounds = [Decimal(n) for n in (denominator if isinstance(denominator, list) else [denominator])]
                if right_bounds[0] <= 0 <= right_bounds[-1]:
                    reasons.append('The denominator includes zero.')
                else:
                    ratios = [a / b for a in left_bounds for b in right_bounds]
                    bounds = [min(ratios), max(ratios)]
                    result['left_divided_by_right_range'] = [str(r) for r in bounds]
                    result['relative_change_percent_range'] = [str((r - 1) * 100) for r in bounds]
            elif Decimal(denominator) == 0:
                reasons.append('The denominator is zero.')
            else:
                result['left_divided_by_right'] = str(Decimal(numerator) / Decimal(denominator))
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

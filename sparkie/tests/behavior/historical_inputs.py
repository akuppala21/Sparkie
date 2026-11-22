"""Open separately supplied, licensed historical inputs only after verifying their bytes."""
import hashlib
from pathlib import Path

EXPECTED = {
    'comparison/held-out-sources.json': '52c3880761d9036430dd15e2041ddeca45c058f03e33c3f0a2fb18e1ed5b0715',
    'finalist/MSE.md': 'a1f65ecbbd27c274dd24f2e7465c5250c8038cc853a5e79cb0c53bc46b4ea38c',
}


def historical_text(name):
    path = Path(__file__).resolve().parent / name
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        raise ValueError(f'Provide the separately authorized {name} described in SOURCE-INPUTS.md.') from None
    if hashlib.sha256(data).hexdigest() != EXPECTED[name]:
        raise ValueError(f'Historical source differs from its reviewed SHA-256: {name}')
    return data.decode('utf-8')

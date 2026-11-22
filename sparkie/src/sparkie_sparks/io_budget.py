"""Per-request deadline for the existing synchronous private controller reads."""
from contextlib import contextmanager
from contextvars import ContextVar
import time

_budget = ContextVar('sparkie_private_io_deadline', default=None)


def remaining_io(maximum):
    budget = _budget.get()
    if budget is None:
        return maximum
    deadline, clock = budget
    remaining = deadline - clock()
    if remaining <= 0:
        raise TimeoutError('The private controller observation budget expired.')
    return min(maximum, remaining)


@contextmanager
def io_budget(seconds, *, clock=time.monotonic):
    # A nested request can shorten, never extend its enclosing deadline.
    duration = remaining_io(seconds)
    token = _budget.set((clock() + duration, clock))
    try:
        yield
    finally:
        _budget.reset(token)

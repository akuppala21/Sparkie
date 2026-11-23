# Running the affected UI check

During a timed repair, Hermes ran the affected Python checks and then spent the last part of its turn looking for the browser check. The Python result now gives the command for the Sparks panel when a panel or electricity change selects it. The existing browser helper accepts the exported baseline alone and prints a fresh results directory. A caller can still supply a directory for the report and screenshots. Other browser tasks retain their own checks.

The browser test now observes which period the page requests. The default month omits the historical selection, choosing an older month sends its recorded key, and the UI sends no empty selection. A separate authenticated request with an explicitly empty selection must return HTTP 400.

| Trial on the compute worker | Observed result |
| --- | --- |
| Portable affected Python checks | 63 passed in 6.02 s, including native plugin registration. The selector still listed the additional groups due. |
| Original calendar defect reintroduced in an isolated checkout | All 12 earlier browser checks completed. The new regression failed when the API returned 200 for an empty selection. |
| Corrected checkout in a fresh worker | All 13 browser checks passed. Chromium captured the desktop page, phone page and phone workload detail. |

Both browser runs used the same owner-neutral code, native login fixture and local, network-isolated runtime. The sole difference in the failing checkout was the original parser's treatment of empty strings as a missing selection. This was development validation. It performed no live fleet action.

The compact model evaluator previously required a single machine hostname, even when another enrolled worker was idle with the same model. It now checks the existing private compute enrollment on every execution path before writing a receipt. Enrollment also selects the compact evaluation when the shared fixture changes. The published example carries enrollment placeholders. The held release is separate from these development changes.

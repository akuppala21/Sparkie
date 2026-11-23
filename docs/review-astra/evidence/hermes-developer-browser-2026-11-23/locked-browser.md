# Reproducing the dashboard checks in a fresh worker

From the editable extension checkout, install the locked browser driver once. The checkout supplies the driver version and npm verifies the published archive's integrity. Chromium comes from the existing compute worker image.

```sh
npm ci --prefix tests/browser --ignore-scripts --no-audit --no-fund
python3 tests/browser/run_sparks.py "$baseline" /workspace/sparks-browser-results
```

Use the extracted release path from `spark_update_source` for `baseline` and a fresh output directory. The check opens a local dashboard with a temporary owner and synthetic fleet and electricity data. Reading a dashboard or running an ordinary chat installs nothing.

On Spark 2, the cold-worker error named the install command before starting a server. A clean package download installed the single pinned dependency in 564 ms. In a separate worker with networking disabled, `npm ci --offline` verified and installed that dependency from the npm cache in 536 ms. All 12 dashboard checks passed through Chromium using the edited checkout. The workers ran as UID 12001 with a read-only root, one CPU and no Docker socket.

Separate checks of the maintenance skill and browser helper passed 112 affected Python tests in 1.82 seconds and verified a checkout-only JavaScript marker in the actual page. Those checks provided the browser module directly. The package-manager replay above exercises the recovery advice added to the cold-worker error. Both used local test fixtures and made zero model calls. [Earlier worker measurements](results.json)

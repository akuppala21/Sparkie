# Running affected checks from an ordinary exported workspace

A fresh private compute worker can use the release's own Python and uv to install the frozen development group in its own home and run a command in the current checkout. A maintenance chat can invoke the helper again from a new shell. This is an on-demand development tool. [Helper](../../../../sparkie/tools/dev-python.sh)

```sh
bash tools/dev-python.sh "$baseline" tools/checks.py --paths tools/checks.py --run-python
```

Spark 2 ran the following checks with an unprivileged worker, a read-only root, the exported release and base interpreter mounted read-only, no credentials and no prepared developer environment. The source and base trees belonged to the independently verified candidate with manifest `a6730d4ed5b9108f19dc785a6a7098a3338e7fb3d02d305ff8741f7496ceaf1e`. The worker had its ordinary Linux home and workspace volumes.

| Condition | Observed result |
| --- | --- |
| No network, empty wheel cache | uv returned exit 1. The requested Python process never ran. |
| Retry with the frozen wheel cache, two callers starting together | One developer environment contained all 38 packages. Both callers imported Hermes, FastAPI, pytest 9.1.1 and pytest-asyncio 1.4.0 using the same Python. |
| New login shell, ordinary affected selector | 49 tests passed in 3.54 seconds. A separate command's intentional exit 17 reached its caller. |
| Fresh worker, empty cache, public package network | uv prepared 38 pinned packages in 5.47 seconds and installed them in 127 milliseconds. The command imported Hermes, FastAPI and both test packages. |

The initial test fixture mounted the operator's private parent directory and the worker could not traverse it. A second fixture put the development environment on a temporary filesystem where native libraries could not be loaded. The completed checks used the two exported trees and the normal executable worker home volume. The worker cached developer files independently of the checkout and the serving environment. These checks ran in the worker image and from a fresh login shell. They did not ask the model to choose the helper or promote a release.

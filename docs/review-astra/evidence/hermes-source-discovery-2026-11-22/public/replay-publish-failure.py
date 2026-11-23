"""Exercise the proposed in-place copy under a lock, entirely in a new temp directory."""
import fcntl
import json
import multiprocessing
import os
from pathlib import Path
import tempfile


def interrupted_publish(directory):
    with (directory / "publish.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with (directory / "current").open("wb") as current:
            current.write(b"new ")
            current.flush()
            os.fsync(current.fileno())
            os._exit(23)  # A writer dies after the first chunk, before the rest.


def replay():
    old, new = b"old manifest\n", b"new manifest\n"
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp)
        (directory / "current").write_bytes(old)
        writer = multiprocessing.get_context("spawn").Process(target=interrupted_publish, args=(directory,))
        writer.start()
        writer.join()
        if writer.exitcode != 23:
            raise RuntimeError("Writer did not stop at the simulated failure.")
        with (directory / "publish.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_SH)
            visible = (directory / "current").read_bytes()
        if visible != b"new " or visible in (old, new):
            raise AssertionError("Expected an incomplete published file after writer death.")
        print(json.dumps({"scope": "isolated in-place copy and cooperating reader using a shared lock file",
                          "writer_exit": writer.exitcode, "reader_acquired_lock": True,
                          "visible": visible.decode(), "old_or_new": visible in (old, new)}))


if __name__ == "__main__":
    replay()

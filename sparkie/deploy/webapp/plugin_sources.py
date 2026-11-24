"""Stage Sparkie's reviewed native Webapp entries in Hermes's bundled plugin directory."""
import argparse
import filecmp
import hashlib
import json
from pathlib import Path
import shutil


ENTRIES = {
    "sparkie-fleet": {name: name for name in
                      ("plugin.js", "common.js", "sparks-panel.js", "recipes-panel.js", "cold-landing.js")},
    "sparkie-recipes": {"plugin.js": "recipes-entry.js"},
}


def stage(extension, native, *, restore=False):
    inputs = extension / "webapp_plugin"
    pins = json.loads((extension / "deploy/webapp/plugin-inputs.json").read_text())
    if set(pins) != {name for files in ENTRIES.values() for name in files.values()}:
        raise ValueError("Unexpected reviewed Webapp plugin source list")
    plugins = native / "apps/desktop/src/plugins"
    if plugins.is_symlink() or not plugins.is_dir():
        raise ValueError("Missing native Webapp plugin directory")
    for folder, files in ENTRIES.items():
        destination = plugins / folder
        if restore:
            if (destination.is_symlink() or not destination.is_dir()
                    or {entry.name for entry in destination.iterdir()} != set(files)):
                raise ValueError("Unexpected exported plugin directory: " + folder)
        elif destination.exists() or destination.is_symlink():
            raise ValueError("The upstream plugin directory already exists: " + folder)
        for name, source in files.items():
            original, copy = inputs / source, destination / name
            if original.is_symlink() or not original.is_file():
                raise ValueError("Missing regular plugin source: " + source)
            if hashlib.sha256(original.read_bytes()).hexdigest() != pins[source]:
                raise ValueError("The Webapp plugin source differs from the reviewed build: " + source)
            if restore and (copy.is_symlink() or not copy.is_file()
                            or not filecmp.cmp(original, copy, shallow=False)):
                raise ValueError("The exported plugin differs from its source: " + name)
    for folder, files in ENTRIES.items():
        destination = plugins / folder
        if restore:
            for name in files:
                (destination / name).unlink()
            destination.rmdir()
        else:
            destination.mkdir()
            for name, source in files.items():
                shutil.copyfile(inputs / source, destination / name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native", type=Path)
    parser.add_argument("--restore", action="store_true",
                        help="Remove matching bundled sources from a temporary exported checkout")
    args = parser.parse_args()
    stage(Path(__file__).resolve().parents[2], args.native, restore=args.restore)

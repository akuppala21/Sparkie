"""Prepare Hermes's supported bundled-plugin directory; never install it.

The full pinned plugin collection is kept. Only stock dashboard-auth discovery
manifests are omitted, so a newly created profile cannot offer another process-
global login provider. Native auth implementation modules remain importable.
"""
import json
from pathlib import Path
import shutil


def prepare_bundle(upstream_plugins: Path, destination: Path, extension: Path):
    upstream_plugins = upstream_plugins.resolve(strict=True)
    extension = extension.resolve(strict=True)
    if destination.exists():
        raise FileExistsError("The plugin bundle destination must be new")
    recipes = extension.parent / "recipes_plugin"
    names = ["sparkie-sparks", "sparkie-home"]
    if recipes.is_dir():
        names.append("sparkie-recipes")
    for name in names:
        if (upstream_plugins / name).exists():
            raise ValueError(f"The upstream collection already contains {name}")

    def ignored(directory, names):
        relative = Path(directory).relative_to(upstream_plugins)
        omitted = {"__pycache__", ".git"} & set(names)
        if relative.parts and relative.parts[0] == "dashboard_auth":
            omitted |= {"plugin.yaml", "plugin.yml", "plugin.json"} & set(names)
        return omitted

    shutil.copytree(upstream_plugins, destination, ignore=ignored)
    shutil.copytree(extension, destination / "sparkie-sparks",
                    ignore=shutil.ignore_patterns("__pycache__", ".git"))
    # The root override and the visible /sparks entry share one component.
    # Only the original plugin owns API routes and registers agent capabilities.
    dashboard = destination / "sparkie-sparks/dashboard"
    alias = destination / "sparkie-home/dashboard"
    alias.mkdir(parents=True)
    manifest = json.loads((dashboard / "manifest.json").read_text())
    manifest.update(name="sparkie-home", tab={"override": "/"})
    manifest.pop("api", None)
    for asset in (manifest["entry"], manifest.get("css")):
        if asset:
            (alias / asset).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(dashboard / asset, alias / asset)
    (alias / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if recipes.is_dir():
        shutil.copytree(recipes, destination / "sparkie-recipes",
                        ignore=shutil.ignore_patterns("__pycache__", ".git"))
    return destination


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("upstream_plugins", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--extension", type=Path, default=Path(__file__).resolve().parents[1] / "plugin")
    args = parser.parse_args()
    prepare_bundle(args.upstream_plugins, args.destination, args.extension)

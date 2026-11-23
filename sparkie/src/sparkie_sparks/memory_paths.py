"""Keep native file and profile management separate from owner-reviewed memory."""
from pathlib import Path


NAMED_REVIEW_LIMIT = (
    "Memory changes can be reviewed only in the default owner profile. "
    "This action would change a named profile's memory or its review records."
)


def _memory_roots(home):
    return home / "memories", home / "pending" / "memory"


def file_review_refusal(target, *, recursive=False):
    from hermes_constants import get_default_hermes_root, get_routing_process_hermes_home

    launch = get_routing_process_hermes_home().resolve()
    home = get_default_hermes_root(home=launch).resolve()
    profiles = (home / "profiles").resolve()
    target = Path(target).resolve()
    homes = {home, launch}
    if profiles.is_dir():
        homes.update(path for path in profiles.iterdir() if path.is_dir())
    if target.is_relative_to(profiles) and target != profiles:
        # Upload can create the destination's parents before a profile exists.
        homes.add(profiles / target.relative_to(profiles).parts[0])
    for profile in homes:
        stores, journal = _memory_roots(profile)
        protected = (stores.resolve(), journal.resolve())
        if (any(target == (stores / name).resolve() for name in ("MEMORY.md", "USER.md"))
                or any(target.is_relative_to(path) or (recursive and path.is_relative_to(target)) for path in protected)):
            if profile != home:
                return NAMED_REVIEW_LIMIT
            return "Use Memory changes in the default owner profile, or Erase memory for removal."
    return None


def require_empty_profile_memory(home):
    """Refuse to publish or discard native stores or decisions with a profile."""
    stores, journal = _memory_roots(home)
    for path in (stores / "MEMORY.md", stores / "USER.md"):
        if path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_size)):
            raise ValueError(NAMED_REVIEW_LIMIT)
    if journal.is_symlink() or (journal.exists() and (
            not journal.is_dir() or any(path.name != ".owner-review.lock" for path in journal.iterdir()))):
        raise ValueError(NAMED_REVIEW_LIMIT)

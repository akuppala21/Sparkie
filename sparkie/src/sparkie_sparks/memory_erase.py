"""Erase an exact, owner-reviewed literal from one native profile.

These primitives grant no authority. The checked owner operation supplies the
trusted home and durably binds the prepared plan. Only hashes, offsets and counts
leave this module. Native corrections and ordinary reads use Hermes directly.
"""

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path


class ErasurePlanChanged(ValueError):
    """No erasure was dispatched. The owner must review the current scope."""


TEXT_FIELDS = (
    "content",
    "api_content",
    "reasoning",
    "reasoning_content",
    "reasoning_details",
    "tool_calls",
    "display_metadata",
    "codex_reasoning_items",
    "codex_message_items",
)
JSON_FIELDS = {
    "reasoning_details",
    "tool_calls",
    "display_metadata",
    "codex_reasoning_items",
    "codex_message_items",
}


def _hash(value):
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


@contextmanager
def _native(home):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from tools.memory_tool import load_on_disk_store
    from hermes_state import SessionDB

    home = Path(home)
    if not home.is_absolute() or home.resolve(strict=True) != home:
        raise ValueError("Use the configured native profile directory.")
    for relative in (
        "memories",
        "memories/USER.md",
        "memories/MEMORY.md",
        "state.db",
        "state.db-wal",
        "state.db-shm",
        "state.db-journal",
    ):
        if (home / relative).is_symlink():
            raise ValueError("Native erasure cannot follow redirected state files.")
    token = set_hermes_home_override(home)
    db = None
    try:
        if (home / "state.db").is_file():
            db = SessionDB(db_path=home / "state.db")
        yield load_on_disk_store(), db
    finally:
        try:
            if db is not None:
                db.close()
        finally:
            reset_hermes_home_override(token)


def _entries(store, target):
    return store.user_entries if target == "user" else store.memory_entries


def _anchor(store, target, literal):
    matches = [
        (name, entry) for name in ("user", "memory") for entry in _entries(store, name) if literal in entry
    ]
    if len(matches) != 1 or matches[0][0] != target:
        raise ErasurePlanChanged("Choose exact text from a single entry in the selected native memory.")
    return matches[0][1]


def _replace(value, literal, replacement):
    if isinstance(value, str):
        return value.replace(literal, replacement)
    if isinstance(value, list):
        return [_replace(item, literal, replacement) for item in value]
    if isinstance(value, dict):
        if any(literal in key for key in value):
            raise ErasurePlanChanged(
                "The text also matches a structured field name. Choose a more specific value."
            )
        updated = {}
        for key, item in value.items():
            if key in {"id", "type", "name", "tool_call_id"} and isinstance(item, str) and literal in item:
                raise ErasurePlanChanged(
                    "The text also matches a structured identifier. Choose a more specific value."
                )
            if key == "arguments" and isinstance(item, str):
                try:
                    arguments = json.loads(item)
                except ValueError:
                    updated[key] = _replace(item, literal, replacement)
                else:
                    clean = _replace(arguments, literal, replacement)
                    updated[key] = item if arguments == clean else json.dumps(clean, ensure_ascii=False)
            else:
                updated[key] = _replace(item, literal, replacement)
        return updated
    return value


def _clean(db, field, raw, literal, replacement):
    if not isinstance(raw, str):
        return raw
    if field == "content":
        value = db._decode_content(raw)
        clean = _replace(value, literal, replacement)
        return raw if value == clean else db._encode_content(clean)
    if field in JSON_FIELDS:
        try:
            value = json.loads(raw)
        except ValueError:
            if literal in raw:
                raise ErasurePlanChanged("A stored structured value is invalid. Its scope cannot be reviewed.")
            return raw
        clean = _replace(value, literal, replacement)
        return raw if clean == value else json.dumps(clean, ensure_ascii=False)
    return raw.replace(literal, replacement)


def _history(db, conn, literal, replacement, *, guard=False):
    """Native prune keeps searchable archived twins. Edit matched fields in place.

    The pinned native FTS triggers maintain both indexes. Using Hermes's own write
    transaction and guards covers inactive and compacted rows without duplicating
    source content or deleting unrelated messages.
    """
    edits, sessions = [], set()
    for row in conn.execute(
        "SELECT id, session_id, tool_name, " + ",".join(TEXT_FIELDS) + " FROM messages ORDER BY id"
    ):
        if row["tool_name"] and literal in row["tool_name"]:
            raise ErasurePlanChanged("The text also names a native tool. Choose a more specific value.")
        for field in TEXT_FIELDS:
            old = row[field]
            new = _clean(db, field, old, literal, replacement)
            if old != new:
                edits.append(("messages", row["id"], field, _hash(old), new))
                sessions.add(row["session_id"])
    for row in conn.execute(
        "SELECT s.id,s.title,s.last_activity_description,COALESCE(p.prompt,s.system_prompt) AS prompt "
        "FROM sessions s LEFT JOIN system_prompts p ON s.system_prompt_hash=p.hash ORDER BY s.id"
    ):
        for field in ("title", "last_activity_description", "prompt"):
            old = row[field]
            if isinstance(old, str) and literal in old:
                edits.append(("sessions", row["id"], field, _hash(old), old.replace(literal, replacement)))
                sessions.add(row["id"])
    if guard and db._guarded_ids(conn, sessions):
        raise ErasurePlanChanged(
            "A matching conversation is still running or being compacted. Review it after it finishes."
        )
    return edits


def _plan(home, target, literal, entry, edits):
    return {
        "schema": 1,
        "profile_sha256": _hash(str(home)),
        "target": target,
        "entry_sha256": _hash(entry),
        "offset": entry.index(literal),
        "length": len(literal),
        "literal_sha256": _hash(literal),
        "memory_entries": 1,
        "message_rows": len({row[1] for row in edits if row[0] == "messages"}),
        "session_rows": len({row[1] for row in edits if row[0] == "sessions"}),
        "scope_sha256": _hash([(table, key, field, old, _hash(new)) for table, key, field, old, new in edits]),
    }


def matches_request(plan, target, literal):
    """Bind a repeated owner request to its durable original text without storing it."""
    return (
        isinstance(plan, dict)
        and target in ("user", "memory")
        and isinstance(literal, str)
        and plan.get("target") == target
        and plan.get("literal_sha256") == _hash(literal)
    )


def prepare(home, target, literal):
    if (
        target not in ("user", "memory")
        or not isinstance(literal, str)
        or not literal.strip()
        or len(literal) > 4096
        or "\x00" in literal
    ):
        raise ValueError("Choose exact text from a native user or memory entry.")
    with _native(home) as (store, db):
        entry = _anchor(store, target, literal)
        replacement = "[erased]" if literal not in "[erased]" else "█"
        edits = (
            db._read_retrying_ioerr(lambda conn: _history(db, conn, literal, replacement))
            if db is not None
            else []
        )
        return _plan(home, target, literal, entry, edits)


def apply(home, plan):
    if (
        not isinstance(plan, dict)
        or plan.get("target") not in ("user", "memory")
        or plan.get("profile_sha256") != _hash(str(home))
    ):
        raise ErasurePlanChanged("The saved native erasure plan does not match this profile.")
    with _native(home) as (store, db):
        target = plan["target"]
        entries = [entry for entry in _entries(store, target) if _hash(entry) == plan.get("entry_sha256")]
        if len(entries) != 1 or type(plan.get("offset")) is not int or type(plan.get("length")) is not int:
            raise ErasurePlanChanged("The reviewed native memory entry changed.")
        entry = entries[0]
        literal = entry[plan["offset"] : plan["offset"] + plan["length"]]
        if (
            not literal
            or _hash(literal) != plan.get("literal_sha256")
            or _anchor(store, target, literal) != entry
        ):
            raise ErasurePlanChanged("The reviewed native text changed.")
        replacement = "[erased]" if literal not in "[erased]" else "█"

        def scrub(conn):
            edits = _history(db, conn, literal, replacement, guard=True) if conn is not None else []
            if _plan(home, target, literal, entry, edits) != plan:
                raise ErasurePlanChanged(
                    "The matching text or its conversation copies changed. Review the new scope."
                )
            retired_prompts = set()
            for table, key, field, _, new in edits:
                if field == "prompt":
                    previous = conn.execute(
                        "SELECT system_prompt_hash FROM sessions WHERE id=?", (key,)
                    ).fetchone()[0]
                    if previous:
                        retired_prompts.add(previous)
                    prompt_hash = db._store_system_prompt(conn, new)
                    conn.execute(
                        "UPDATE sessions SET system_prompt=NULL,system_prompt_hash=? WHERE id=?",
                        (prompt_hash, key),
                    )
                else:
                    # Table and column come exclusively from _history's fixed lists.
                    conn.execute(f"UPDATE {table} SET {field}=? WHERE id=?", (new, key))
            if edits:
                # Only collect the superseded snapshots from this specific operation.
                for digest in retired_prompts:
                    conn.execute(
                        "DELETE FROM system_prompts WHERE hash=? AND NOT EXISTS "
                        "(SELECT 1 FROM sessions WHERE system_prompt_hash=? OR tool_names=?)",
                        (digest, digest, digest),
                    )
                if _history(db, conn, literal, replacement):
                    raise RuntimeError("Native history verification failed. Its transaction was cancelled.")

        # Serialize against Hermes saves. Commit the guarded history transaction
        # before removing the last durable source of the literal from memory.
        def change(current, _limit):
            if entry not in current or any(literal in other for other in current if other != entry):
                raise ErasurePlanChanged("The native entry changed before erasure.")
            if db is not None:
                db._execute_write(scrub)
            else:
                scrub(None)
            updated = []
            for value in current:
                if value != entry:
                    updated.append(value)
                elif value != literal:
                    updated.append(value.replace(literal, replacement))
            return updated, "Reviewed memory span erased."

        result = store._mutate(target, change)
        if not result.get("success"):
            raise RuntimeError("The memory write was not verified. Check the operation before retrying.")
        store.load_from_disk()
        if any(literal in value for name in ("memory", "user") for value in _entries(store, name)):
            raise RuntimeError("Memory changed concurrently. Inspect the operation before retrying.")
        # Once memory has changed, a failed reconciliation is never a fresh
        # pre-dispatch refusal, even if a new session introduced another copy.
        if db is not None:
            try:
                remaining = db._read_retrying_ioerr(lambda conn: _history(db, conn, literal, replacement))
            except Exception as exc:
                raise RuntimeError(
                    "Native erasure readback stopped. Inspect the operation before retrying."
                ) from exc
            if remaining:
                raise RuntimeError(
                    "A conversation changed during native erasure. Inspect the operation before retrying."
                )
        return {
            "complete": True,
            **{key: plan[key] for key in ("memory_entries", "message_rows", "session_rows")},
        }

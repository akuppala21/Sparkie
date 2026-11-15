/* ───────── pruning the copies on a Spark (A8) ───────── */
// Area: features        Rules: R61        Tests: prune.test.mjs, runner.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The copies program's pruning (21-copies.mjs joins this text into it): when a new set opens on a Spark, older sets
// there go: any older than COPIES_DAYS, all but the newest COPIES_SETS (the new one counts), then the oldest until the
// copies on that Spark hold COPIES_BYTES. Never the new set, a set the console names (runnerKeep: the newest set of a chat
// that can still undo it), nor one whose unit systemd says still runs or can't tell. A set's age is its folder's
// modification time, which only this program writes (both walls hide the folder). What goes leaves its manifest and a
// pruned.json, so an undo can say "pruned" file by file (pruned_answer); that mark goes too after COPIES_MARK_DAYS, past
// the journal's two months undo reads. One look at the copies folder (os.scandir), sizes only of the sets left, and at
// most COPIES_PRUNE_MOST removed in one go, so a folder someone made long costs one listing. No link is followed.
// Pruning (A8): when a new set opens on a Spark, older ones there go past 7 days, past the newest 20, then the oldest
// until the copies on that Spark hold 2 GB (the stand-in fleet may set each); 200 at most in one go; a pruned set's mark
// (its manifest, kept so an undo can say "pruned") goes after 62 days, past the journal's two months undo reads.
const COPIES_DAYS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_COPIES_DAYS) || 7;
const COPIES_SETS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_COPIES_SETS) || 20;
const COPIES_BYTES = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_COPIES_BYTES) || 2 * 2 ** 30;
const COPIES_PRUNE_MOST = 200, COPIES_MARK_DAYS = 62;
const COPIES_PRUNE_PY = String.raw`
SETNAME = re.compile(r'^s[0-9a-z]{8,24}$')

def tree_size(top):
    # the bytes of the plain files under a set, never through a link
    n = 0
    for dp, dns, fns in os.walk(top, followlinks=False):
        for x in fns:
            try:
                st = os.lstat(os.path.join(dp, x))
            except OSError:
                continue
            if stat.S_ISREG(st.st_mode):
                n += st.st_size
    return n

def prune(base):
    # Older sets go when a new one opens (A8): older than the days given, all but the newest sets given (the new one
    # counts), then the oldest until the copies on this Spark hold the bytes given. Never the new set, one the console
    # names (keep: the newest set of a chat that can still undo it), nor one whose unit systemd says still runs or can't
    # tell. What goes leaves its manifest and a pruned.json behind, so an undo can say "pruned" file by file; such a
    # mark goes too once it is older than the journal's window. One look at the folder, sizes only of what is left, and
    # at most the given number removed in one go.
    P = A['prune']
    now, sets, marks = time.time(), [], []
    with os.scandir(base) as it:
        for d in it:
            if d.name == A['set'] or not SETNAME.match(d.name):
                continue
            try:
                st = d.stat(follow_symlinks=False)
            except OSError:
                continue
            if not stat.S_ISDIR(st.st_mode) or st.st_uid != UID:
                continue
            (marks if os.path.lexists(os.path.join(base, d.name, 'pruned.json')) else sets).append((st.st_mtime, d.name))
    keep = set(P.get('keep') or [])
    for t, n in sets:
        unit = (P.get('units') or {}).get(n)
        if unit and unit_live(unit) not in (3, 4):
            keep.add(n)
    sets.sort(reverse=True)
    gone, rest = [], []
    for i, (t, n) in enumerate(sets):
        if n in keep:
            rest.append((t, n))
        elif now - t > P['days'] * 86400:
            gone.append((n, 'older than %d days' % P['days']))
        elif i + 2 > P['sets']:
            gone.append((n, 'past the newest %d sets on this Spark' % P['sets']))
        else:
            rest.append((t, n))
    total, sizes = tree_size(os.path.join(base, A['set'])), {}
    for t, n in rest:
        sizes[n] = tree_size(os.path.join(base, n))
        total += sizes[n]
    for t, n in reversed(rest):
        if total <= P['bytes']:
            break
        if n not in keep:
            gone.append((n, 'past the %s the copies on this Spark keep' % (('%g GB' % (P['bytes'] / 2 ** 30)) if P['bytes'] >= 2 ** 30 else ('%g MB' % round(P['bytes'] / 2 ** 20, 1)))))
            total -= sizes[n]
    out = []
    for n, why in gone[:P['most']]:
        sd = os.path.join(base, n)
        info = {'set': n, 'why': why, 'files': 0, 'bytes': 0, 'paths': []}
        try:
            man = json.loads(read(os.path.join(sd, 'manifest.json'), 64 << 20))
            kept = [e for e in man.get('entries', []) if e.get('kind') == 'file' and not e.get('way')]
            info.update(files=len(kept), bytes=sum(e.get('size', 0) for e in kept), paths=[show(e['path']) for e in kept[:20]])
            mark = True
        except (OSError, OverflowError, ValueError, AttributeError):
            mark = False
        for x in os.listdir(sd):
            if mark and x == 'manifest.json':
                continue
            q = os.path.join(sd, x)
            if stat.S_ISDIR(os.lstat(q).st_mode):
                shutil.rmtree(q)
            else:
                os.unlink(q)
        if mark:
            put(os.path.join(sd, 'pruned.json'), json.dumps({'at': now, 'why': why}).encode())
        else:
            os.rmdir(sd)
        out.append(info)
    for t, n in marks[:P['most']]:
        if now - t > P['marks'] * 86400:
            shutil.rmtree(os.path.join(base, n))
    return out


def pruned_answer(sd, man, after, only):
    # a set pruned since: its copies are gone and only its manifest is left, so each file says so (and the answer ends)
    try:
        gone = json.loads(read(os.path.join(sd, 'pruned.json'), 1 << 20))
    except (OSError, OverflowError, ValueError):
        gone = None
    if gone is not None:
        when = time.strftime('%Y-%m-%d', time.localtime(gone.get('at', 0)))
        missed, same = [], []
        for e in man['notKept']:
            if only is None or e['path'] in only:
                missed.append({'path': e['path'], 'why': 'never kept: ' + e['why']})
        for e in sorted(man['entries'], key=lambda e: e['path']):
            p = e['path']
            if only is not None and p not in only:
                continue
            before = {'absent': 'absent', 'link': 'link:' + e.get('target', ''), 'dir': 'dir:%o' % e.get('mode', 0), 'file': 'file:%o:%s' % (e.get('mode', 0), e.get('sha', ''))}[e['kind']]
            if fp(p) == before:
                same.append(p)
            elif e['kind'] == 'absent':
                missed.append({'path': p, 'why': 'it was not there before the change: left as it is'})
            else:
                missed.append({'path': p, 'why': 'pruned: its copy was removed on %s (%s)' % (when, gone.get('why', 'pruned'))})
        OUT.update(restored=[], same=[show(p) for p in same], notRestored=[dict(e, path=show(e['path'])) for e in missed], cutOff=after is None, pruned={'at': when, 'why': gone.get('why', 'pruned')})
        done()
`;

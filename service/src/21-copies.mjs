/* ───────── the copies a change makes first, and putting them back (A7b) ───────── */
// Area: features        Rules: R61        Tests: runner.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Before the runner (21-runner.mjs) runs a change on a compute Spark, every file the sorter placed it as writing,
// removing or changing (its result's placed and wide: a * expanded there, a wide folder walked) is copied into a set of
// its own, ~/.local/share/spark-console/before/<set>/ on that Spark (the walls hide that folder from every command):
// folder 0700, files 0600, the bytes, the mode and the path of each kept, so a restore is exact. At most 16 MB a file
// and 128 MB a command; a file past a limit, unreadable or not a plain file, and what a named link points to, is "not
// kept", with why. The set's name is made by code. One fixed Python program does it all on the Spark, as the owner, in
// one of four modes: copy (the set and its manifest; the ways-in fingerprints too; then older sets pruned,
// 21-copies-prune.mjs), after (the fingerprints once the
// command has run), restore (the set's files put back) and drop (a set whose command never ran). It never follows a
// link: a path with a link in the folders above it is neither copied nor written; a file is read and written with
// O_NOFOLLOW, and a restore writes a new file beside the old one and renames it into place, so a link that is there now
// is replaced, never written through. A restore writes only the paths the set's manifest names, the manifest only when
// its SHA-256 is the one the journal's start line kept, and a copy only when its bytes have the SHA-256 the manifest
// kept. Only the console's own text is run: the paths travel as data.
const COPIES_FILE_MAX = 16 * 2 ** 20, COPIES_SET_MAX = 128 * 2 ** 20;
const COPIES_COUNT_MAX = 20000;
const copiesSetName = () => `s${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
const COPIES_PY = String.raw`
import base64, glob, hashlib, json, os, re, secrets, shutil, stat, subprocess, sys, time
A = json.loads(base64.b64decode(sys.argv[1]).decode())
HOME = os.path.realpath(os.environ['HOME'])
BASE = os.path.join(HOME, '.local', 'share', 'spark-console', 'before')
UID = os.getuid()
OUT = {}
NOFOLLOW = os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0)

def show(p):
    return '~' + p[len(HOME):] if p == HOME or p.startswith(HOME + '/') else p

def done():
    sys.stdout.write('\nRESULT ' + base64.b64encode(json.dumps(OUT).encode()).decode() + '\n')
    sys.exit(0)

def stop(why):
    OUT['error'] = why
    done()

def folder(path, make):
    # every part from the home down: a real folder of this account, never a link; made 0700 when missing
    rel = os.path.relpath(path, HOME)
    if rel == '..' or rel.startswith('../'):
        stop('the copies folder is not under the home folder')
    cur = HOME
    for part in rel.split('/'):
        cur = os.path.join(cur, part)
        try:
            st = os.lstat(cur)
        except FileNotFoundError:
            if not make:
                return None
            os.mkdir(cur, 0o700)
            st = os.lstat(cur)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != UID:
            stop(show(cur) + ' is not a folder of this account (a link, or not a folder)')
    return cur

def whole(p):
    if p == '~' or p.startswith('~/'):
        p = HOME + p[1:]
    if not p.startswith('/') or '\0' in p:
        return None
    return os.path.normpath(p)

def linked(p):
    d = os.path.dirname(p)
    return os.path.realpath(d) != d

def under(p, top):
    return p == top or p.startswith(top.rstrip('/') + '/')

def read(p, most):
    fd = os.open(p, os.O_RDONLY | NOFOLLOW)
    try:
        parts, n = [], 0
        while True:
            b = os.read(fd, 1 << 20)
            if not b:
                return b''.join(parts)
            n += len(b)
            if n > most:
                raise OverflowError()
            parts.append(b)
    finally:
        os.close(fd)

def fp(p):
    try:
        st = os.lstat(p)
    except (FileNotFoundError, NotADirectoryError):
        return 'absent'
    except OSError:
        return 'unreadable'
    m = '%o' % stat.S_IMODE(st.st_mode)
    if stat.S_ISLNK(st.st_mode):
        return 'link:' + os.readlink(p)
    if stat.S_ISDIR(st.st_mode):
        return 'dir:' + m
    if not stat.S_ISREG(st.st_mode):
        return 'other:%o' % st.st_mode
    try:
        return 'file:%s:%s' % (m, hashlib.sha256(read(p, A['fileMax'])).hexdigest())
    except (OSError, OverflowError):
        return 'file:%s:%d:%d' % (m, st.st_size, st.st_mtime_ns)

# A bracket in a name, as bash may read it ([abc], [!a], [^a], [[:digit:]]) or as the letters themselves
BRACKET = re.compile(r'\[(?:[!^]?\]?(?:\[:[a-z]+:\]|[^\]])*)\]')

def expand(p):
    # a name holding * ? or [ is the file of exactly that name (there or not), what it matches as a pattern, and what
    # it matches with each [...] read as anything: bash reads [^a], a class or a quoted [x] its own way
    q = whole(p)
    if q is None:
        return [(p, 'not a path the copy can place')]
    if any(c in q for c in '*?['):
        loose = BRACKET.sub('*', q)
        found = set(glob.glob(q)) | (set(glob.glob(loose)) if loose != q else set())
        return [(q, None)] + [(x, None) for x in sorted(found) if x != q]
    return [(q, None)]

def walk(top):
    yield top
    try:
        if not stat.S_ISDIR(os.lstat(top).st_mode):
            return
    except OSError:
        return
    for dp, dns, fns in os.walk(top, followlinks=False):
        for x in sorted(dns) + sorted(fns):
            yield os.path.join(dp, x)

def ways_now():
    out = {}
    for p in A['ways']:
        q = whole(p)
        if q is None:
            continue
        out[p] = fp(q)
        try:
            if stat.S_ISDIR(os.lstat(q).st_mode):
                for x in sorted(os.listdir(q))[:200]:
                    out[p + '/' + x] = fp(os.path.join(q, x))
        except OSError:
            pass
    return out

def later(p, man):
    # (a change cut off has no after.json: what was written after its time ran out, its limit and a minute from the end
    # of the copy, is not its; by the changed time, which no command can set)
    try:
        return os.lstat(p).st_ctime > man.get('at', 0) + man.get('seconds', 0) + A.get('slack', 60)
    except OSError:
        return False

def unit_live(unit):
    # (systemd's own answer: 0 active, 3 or 4 not; anything else can't be told)
    try:
        return subprocess.run(['systemctl', 'is-active', '--quiet', unit + '.service'], stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20).returncode
    except (OSError, subprocess.TimeoutExpired):
        return None

def setdir(make):
    base = folder(BASE, make)
    if base is None:
        stop('the copies of that change are gone')
    sd = os.path.join(base, A['set'])
    if make:
        os.mkdir(sd, 0o700)
        os.mkdir(os.path.join(sd, 'files'), 0o700)
    try:
        st = os.lstat(sd)
    except FileNotFoundError:
        stop('the copies of that change are gone')
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != UID:
        stop('the copies of that change are not a folder of this account')
    return sd

def put(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)

` + COPIES_PRUNE_PY + String.raw`
def manifest(sd):
    try:
        raw = read(os.path.join(sd, 'manifest.json'), 64 << 20)
    except (OSError, OverflowError):
        stop('the record of that change\'s copies is not there')
    if hashlib.sha256(raw).hexdigest() != A['sha']:
        stop('the record of that change\'s copies was changed since')
    return json.loads(raw)

if A['mode'] == 'copy':
    sd = setdir(True)
    man = {'set': A['set'], 'seconds': A.get('seconds', 0), 'allow': [], 'entries': [], 'notKept': []}
    total, seen = 0, set()
    # (the ways in the owner's account first, outside the command's 128 MB, so a put-back always has them)
    places = [(p, False, True) for p in A['ways'] if p.startswith('~/')] + [(p, False, False) for p in A['placed']] + [(p, True, False) for p in A['wide']]
    for p, wide, way in places:
        def lost(path, why):
            man['notKept'].append(dict({'path': path, 'why': why}, **({'way': True} if way else {})))
        for q, bad in expand(p):
            if bad:
                lost(q, bad)
                continue
            man['allow'].append(q)
            for x in (walk(q) if wide else [q]):
                if x in seen:
                    continue
                seen.add(x)
                if len(man['entries']) >= ` + COPIES_COUNT_MAX + String.raw`:
                    lost(x, 'more files than one change keeps')
                    continue
                if under(x, BASE):
                    lost(x, 'it is in the copies\' own folder')
                    continue
                if linked(x):
                    lost(x, 'a link in the folders above it')
                    continue
                mark = {'way': True} if way else {}
                try:
                    st = os.lstat(x)
                except (FileNotFoundError, NotADirectoryError):
                    man['entries'].append(dict({'path': x, 'kind': 'absent'}, **mark))
                    continue
                except OSError:
                    lost(x, 'it could not be read')
                    continue
                mode = stat.S_IMODE(st.st_mode)
                if stat.S_ISLNK(st.st_mode):
                    man['entries'].append(dict({'path': x, 'kind': 'link', 'target': os.readlink(x)}, **mark))
                    # (a write to a named link goes where it points, and that is not copied)
                    if not wide and not way:
                        lost(x, 'a link: what it points to is not copied')
                elif stat.S_ISDIR(st.st_mode):
                    man['entries'].append(dict({'path': x, 'kind': 'dir', 'mode': mode}, **mark))
                elif not stat.S_ISREG(st.st_mode):
                    lost(x, 'not a plain file')
                elif st.st_size > A['fileMax']:
                    lost(x, 'over %d MB' % (A['fileMax'] >> 20))
                elif not way and total + st.st_size > A['allMax']:
                    lost(x, 'past the %d MB one change keeps' % (A['allMax'] >> 20))
                else:
                    try:
                        data = read(x, A['fileMax'])
                    except (OSError, OverflowError):
                        lost(x, 'it could not be read')
                        continue
                    n = len(man['entries'])
                    put(os.path.join(sd, 'files', str(n)), data)
                    total += 0 if way else len(data)
                    man['entries'].append(dict({'path': x, 'kind': 'file', 'mode': mode, 'size': len(data), 'sha': hashlib.sha256(data).hexdigest(), 'n': n}, **mark))
    # (the change's time counts from here, once every copy is made: the unit starts after this)
    man['at'] = time.time()
    raw = json.dumps(man).encode()
    put(os.path.join(sd, 'manifest.json'), raw)
    # (the older sets on this Spark, now that this one is open: a problem there never stops the change)
    if A.get('prune'):
        try:
            OUT['pruned'] = prune(os.path.dirname(sd))
        except OSError as x:
            OUT['pruneProblem'] = x.strerror or 'error'
    OUT.update(sha=hashlib.sha256(raw).hexdigest(), kept=[dict({'path': show(e['path']), 'kind': e['kind']}, **({'way': True} if e.get('way') else {})) for e in man['entries']],
               notKept=[dict(e, path=show(e['path'])) for e in man['notKept']], ways=ways_now())
    done()

if A['mode'] == 'after':
    sd = setdir(False)
    man = manifest(sd)
    after = {e['path']: fp(e['path']) for e in man['entries']}
    put(os.path.join(sd, 'after.json'), json.dumps(after).encode())
    OUT.update(ways=ways_now())
    done()

if A['mode'] == 'restore':
    sd = setdir(False)
    man = manifest(sd)
    if A.get('unit'):
        live = unit_live(A['unit'])
        if live == 0:
            stop('that change is still running there (' + A['unit'] + '), so nothing was put back: ask again when it has ended')
        if live not in (3, 4):
            stop('whether that change still runs there could not be told, so nothing was put back')
    try:
        after = json.loads(read(os.path.join(sd, 'after.json'), 64 << 20))
    except (OSError, OverflowError, ValueError):
        after = None
    only = None if A.get('only') is None else set(whole(p) or p for p in A['only'])
    pruned_answer(sd, man, after, only)
    restored, same, missed = [], [], []
    for e in man['notKept']:
        if only is None or e['path'] in only:
            missed.append({'path': e['path'], 'why': 'never kept: ' + e['why']})
    order = sorted(man['entries'], key=lambda e: (e['kind'] != 'dir', e['path'].count('/'), e['path']))
    for e in order:
        p = e['path']
        if only is not None and p not in only:
            continue
        if not any(under(p, a) for a in man['allow']):
            missed.append({'path': p, 'why': 'not a place the change named'})
            continue
        if linked(p):
            missed.append({'path': p, 'why': 'a link in the folders above it now'})
            continue
        before = {'absent': 'absent', 'link': 'link:' + e.get('target', ''), 'dir': 'dir:%o' % e.get('mode', 0), 'file': 'file:%o:%s' % (e.get('mode', 0), e.get('sha', ''))}[e['kind']]
        now = fp(p)
        if now == before:
            same.append(p)
            continue
        if A.get('check') and after is not None and after.get(p) != now:
            missed.append({'path': p, 'why': 'changed again since the change: left as it is'})
            continue
        if A.get('check') and after is None and e['kind'] != 'dir' and later(p, man):
            missed.append({'path': p, 'why': 'written after that change\'s time ran out: left as it is'})
            continue
        try:
            if e['kind'] == 'absent':
                missed.append({'path': p, 'why': 'it was not there before the change: left as it is'})
            elif e['kind'] == 'dir':
                if now == 'absent':
                    os.mkdir(p, 0o700)
                    os.chmod(p, e['mode'])
                elif now.startswith('dir:'):
                    os.chmod(p, e['mode'])
                else:
                    missed.append({'path': p, 'why': 'something else is there now'})
                    continue
                restored.append(p)
            else:
                d = os.path.dirname(p)
                if not os.path.isdir(d) or linked(p):
                    missed.append({'path': p, 'why': 'its folder is gone'})
                    continue
                tmp = os.path.join(d, '.spark-console-put-back-' + secrets.token_hex(6))
                if e['kind'] == 'link':
                    os.symlink(e['target'], tmp)
                else:
                    try:
                        data = read(os.path.join(sd, 'files', str(e['n'])), A['fileMax'])
                    except (OSError, OverflowError):
                        missed.append({'path': p, 'why': 'its copy is not a plain file any more'})
                        continue
                    if hashlib.sha256(data).hexdigest() != e['sha']:
                        missed.append({'path': p, 'why': 'its copy was changed since'})
                        continue
                    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600)
                    try:
                        os.write(fd, data)
                        os.fchmod(fd, e['mode'])
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                try:
                    os.replace(tmp, p)
                except OSError:
                    os.unlink(tmp)
                    missed.append({'path': p, 'why': 'a folder is there now'})
                    continue
                restored.append(p)
        except OSError as x:
            missed.append({'path': p, 'why': 'it could not be written (%s)' % (x.strerror or 'error')})
    OUT.update(restored=[show(p) for p in restored], same=[show(p) for p in same], notRestored=[dict(e, path=show(e['path'])) for e in missed], cutOff=after is None)
    done()

if A['mode'] == 'drop':
    # (a set whose command never ran: rmtree removes links, never what they point to)
    import shutil
    shutil.rmtree(setdir(False))
    OUT.update(dropped=True)
    done()
stop('no such mode')
`;
// One run of the program on a Spark: its mode and its data; the answer, or an HttpError with its reason.
async function copiesOn(node, mode, data, timeout = 180000) {
  const arg = Buffer.from(JSON.stringify({ mode, fileMax: COPIES_FILE_MAX, allMax: COPIES_SET_MAX, ...data })).toString('base64');
  const r = await run(node, `python3 - ${arg} <<'SPARK_COPIES_PY'\n${COPIES_PY}\nSPARK_COPIES_PY`, { timeout });
  const m = /^RESULT ([A-Za-z0-9+/=]+)$/m.exec(r.out);
  if (!m) {
    if (r.code === 255) throw new HttpError(503, `${sparkName(node)} isn’t answering, so nothing was changed.`);
    throw new HttpError(502, `The copies on ${sparkName(node)} couldn’t be made or read (${maskSecrets(String(r.err || r.out).trim().split('\n').pop() || 'no answer').slice(0, 200)}), so nothing was changed.`);
  }
  const v = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  if (v.error) throw new HttpError(409, `The copies on ${sparkName(node)}: ${maskSecrets(String(v.error)).slice(0, 300)}.`);
  return v;
}

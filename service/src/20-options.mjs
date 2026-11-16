/* ───────── the sorter's options: what each program's options are, read one way for all ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// One reader for every program's options, and each program's options from its manual.
// sortOpts(spec, args) reads a program's options as getopt does: -abc is three letters; a letter that takes a value takes
// the rest of its word or the next word (-o.bash_profile, -fsSLo x); --name=value or --name value; a long name may be cut
// short to any beginning only it has; -- ends the options; plain words are the rest (with first, the first plain word
// ends the options too, and so does each option named in first, after its value). An option not in the spec is returned
// as unknown, and so is a word from a $ or a command where an option may stand: one that starts with it, or an
// unquoted one bash may split into more words (requests$X), unless it is an option's own value (-j$(nproc)). The sorter
// (20-sort.mjs) answers it as a doubt, so a program with a spec is a plain change only with options from its manual,
// the ones people type. A spec is "letters" then long names: after a letter or a long name, : (or =) when it takes a
// value, > when that value is a file it writes, } when it is a folder it writes names of its own into (wide); a long
// name marked ! is one the program has that is a doubt (so --python is not read as --python-version). For a program
// whose options aren't getopt's (gcc -Wall, go -race): [the pattern every option word matches, the pattern of those
// that take the next word]. Left out on purpose, so a doubt: an option that runs a program, reads more options or names
// from a file nobody read, or reaches past the folder it is given. Keys code:<name> are an interpreter's options before
// its script; git:<verb> and conda:run a sub-command's.
const sortSpec = s => {
  if (Array.isArray(s) || s instanceof RegExp) return { re: [s].flat()[0], takes: [s].flat()[1] ?? null };
  const [short, ...longs] = s.split(' '), map = new Map();
  for (let i = 0; i < short.length; i++) if (!':>}@'.includes(short[i])) map.set(short[i], ':>}@'.includes(short[i + 1] ?? 'x') ? short[i + 1] : false);
  return { short: map, long: longs.filter(Boolean).map(l => [l.replace(/^!?--|[=>}@]$/g, ''), l.startsWith('!') ? '!' : /[=>}@]$/.test(l) ? l.slice(-1).replace('=', ':') : false]) };
};
const SORT_NOOPTS = sortSpec('');
// A word bash may split into more words (an unquoted $ or `): a doubt where an option or its value stands, unless all
// that is unknown in it is $(nproc) or $(getconf _NPROCESSORS_ONLN), a number. A value marked @ (an address, an index,
// a registry, a file of code) is a doubt whenever the sorter can't read it, quoted or not.
const sortNproc = s => s.length === 1 && s[0].length === 1 && !s[0][0].group && !s[0][0].assigns.length && !s[0][0].redirs.length && /^(?:nproc(?: --all)?|getconf _NPROCESSORS_ONLN)$/.test(s[0][0].words.map(w => w.text).join(' '));
const sortSplits = w => !!w?.split && !(!w.vars && w.subs?.length && w.subs.every(sortNproc));
function sortOpts(spec = SORT_NOOPTS, args = [], plainRe = null, first = null) {
  const opts = [], plain = [], val = (w, text) => ({ ...w, text, subs: [] });
  let unknown = null, end = args.length;
  const rest = k => { end = k; plain.push(...args.slice(k)); };
  const next = (w, k, kind) => { const v = args[k] ?? val(w, ''); if (sortSplits(v) || (kind === '@' && v.unknown)) unknown ??= v.text || '$…'; return v; };
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.unknown ? w.lit ?? '' : w.text;
    // (after --, a word is a name whatever its first sign)
    if (t === '--' && !w.unknown) { for (const x of args.slice(k + 1)) x.literal = true; rest(k + 1); break; }
    if (!t.startsWith('-') || t === '-' || (plainRe && !w.unknown && plainRe.test(t))) {
      if (first) { rest(k); break; }
      if (w.unknown && (!t || w.split)) unknown ??= w.text || '$…';
      plain.push(w);
      continue;
    }
    if (spec.re) {
      const takes = !!spec.takes?.test(t);
      if (!spec.re.test(t) || (w.unknown && !takes) || sortSplits(w)) unknown ??= w.text || t;
      opts.push([t, takes ? (w.unknown ? val(w, '') : next(w, ++k)) : true, takes ? ':' : false]);
      continue;
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('='), n = t.slice(2, eq < 0 ? undefined : eq), hits = spec.long.filter(([l]) => l.startsWith(n));
      const h = hits.find(([l]) => l === n) ?? (hits.length === 1 ? hits[0] : null);
      if (!h || !n || h[1] === '!' || (w.unknown && eq < 0)) { unknown ??= w.text || t; continue; }
      if (sortSplits(w) || (h[1] === '@' && eq >= 0 && w.unknown)) unknown ??= w.text || t;
      opts.push([h[0], !h[1] ? true : eq >= 0 ? val(w, t.slice(eq + 1)) : next(w, ++k, h[1]), h[1]]);
      if (first?.includes(h[0])) { rest(k + 1); break; }
      continue;
    }
    let stop = false, took = false;
    for (let j = 1; j < t.length; j++) {
      const takes = spec.short.get(t[j]);
      if (takes === undefined) { unknown ??= w.text || t; break; }
      if (takes) { took = true; if (sortSplits(w) || (takes === '@' && w.unknown)) unknown ??= w.text || t; opts.push([t[j], j < t.length - 1 || w.unknown ? val(w, t.slice(j + 1)) : next(w, ++k, takes), takes]); stop = !!first?.includes(t[j]); break; }
      opts.push([t[j], true, false]);
    }
    if (w.unknown && !took) unknown ??= w.text || t;
    if (stop) { rest(k + 1); break; }
  }
  const of = kind => opts.filter(([, v, x]) => x === kind && v !== true && v.text && v.text !== '-').map(([, v]) => v);
  return { opts, plain, unknown, end, writes: of('>'), dirs: of('}'), has: (...n) => opts.some(([o]) => n.includes(o)), all: (...n) => opts.filter(([o]) => n.includes(o)).map(([, v]) => v) };
}
// From each program's manual, the options people type.
const CC_OPTS = /^-(?:[cSEgswvMPCG]|O[0-3sgz]?|Ofast|g\w*|W[\w,=.+:/-]*|std=\S+|m(?!plugin)[\w=.,+-]+|f(?!plugin)[\w=.,+-]+|[DUILlo]\S*|x\S*|isystem\S*|iquote\S*|idirafter\S*|include\S*|shared|static\S*|pthread|pedantic\S*|pie|no-pie|rdynamic|rpath|nostdlib|nostartfiles|MM|MD|MMD|MF|MT|MQ|MP|dM|pg|pipe|ansi|save-temps|dumpversion|dumpmachine|print-\S+|time|Xlinker|Xassembler|Xpreprocessor|Xcompiler|Xptxas|Xnvlink|arch=?\S*|code=\S+|gencode=?\S*|lineinfo|rdc=\S+|dc|dlink|ptx|cubin|fatbin|keep|expt-[\w-]+|use_fast_math|maxrregcount=?\d*|diag-suppress=?\S*|-(?:version|help|param=\S+|sysroot=\S+|use_fast_math|gpu-architecture=\S+|gpu-code=\S+|compiler-options=?\S*|ptxas-options=\S+|linker-options=\S+|expt-[\w-]+|extended-lambda|std=\S+|output-file=?\S*|compile|shared|relocatable-device-code=\S+|generate-code=\S+|threads=?\d*|keep|resource-usage|verbose|optimize=\S+|device-debug|generate-line-info|default-stream=\S+|diag-suppress=\S+|Werror=\S+|machine=\S+))$/;
const CC_TAKES = /^-(?:[oxIDUL]|MF|MT|MQ|isystem|iquote|idirafter|include|Xlinker|Xassembler|Xpreprocessor|Xcompiler|Xptxas|Xnvlink|arch|code|gencode)$/;
const SORT_OPTS = Object.fromEntries(Object.entries({
  cp: 'abdfHiLlnPpRrS:sTt:uvxZ --archive --attributes-only --backup --copy-contents --dereference --force --interactive --link --no-dereference --no-clobber --no-preserve= --no-target-directory --one-file-system --parents --preserve --recursive --reflink --remove-destination --sparse= --strip-trailing-slashes --suffix= --symbolic-link --target-directory= --update --verbose --debug --context --keep-directory-symlink --help --version',
  mv: 'bfinS:t:TuvZ --backup --force --interactive --no-clobber --no-target-directory --strip-trailing-slashes --suffix= --target-directory= --update --verbose --debug --exchange --no-copy --context --help --version',
  ln: 'bdfFinLPrsS:t:Tv --backup --directory --force --interactive --logical --no-dereference --no-target-directory --physical --relative --symbolic --suffix= --target-directory= --verbose --help --version',
  install: 'bcCdDg:m:o:pS:t:TvZ --backup --compare --directory --group= --mode= --owner= --preserve-timestamps --strip --suffix= --target-directory= --no-target-directory --verbose --debug --preserve-context --context --help --version',
  tee: 'aip --append --ignore-interrupts --output-error --help --version', rm: 'dfiIrRv --dir --force --interactive --one-file-system --recursive --verbose --preserve-root --no-preserve-root --help --version',
  rmdir: 'pv --ignore-fail-on-non-empty --parents --verbose --help --version', unlink: ' --help --version', shred: 'fn:s:uvxz --force --iterations= --size= --remove --verbose --exact --zero --help --version',
  truncate: 'cor:s: --no-create --io-blocks --reference= --size= --help --version', chmod: 'cfvR --changes --silent --quiet --verbose --recursive --preserve-root --no-preserve-root --help --version',
  chown: 'cfvhRHLP --changes --silent --quiet --verbose --dereference --no-dereference --from= --recursive --preserve-root --no-preserve-root --help --version',
  chattr: 'RVfv:p:', setfacl: 'm:x:bkndRLPtv --modify= --remove= --remove-all --remove-default --set= --mask --no-mask --default --recursive --logical --physical --test --version --help',
  mkdir: 'm:pvZ --mode= --parents --verbose --context --help --version', touch: 'acd:fhmr:t: --no-create --date= --no-dereference --reference= --time= --help --version', mkfifo: 'm:Z --mode= --context --help --version',
  mktemp: 'dp:qtu --directory --dry-run --quiet --suffix= --tmpdir= --help --version', csplit: 'b:f:kn:szq --suffix-format= --prefix= --keep-files --digits= --quiet --silent --elide-empty-files --suppress-matched --help --version',
  split: 'a:b:C:del:n:t:x --suffix-length= --additional-suffix= --bytes= --line-bytes= --elide-empty-files --lines= --number= --separator= --numeric-suffixes --hex-suffixes --verbose --help --version',
  zip: 'rqv0123456789jDXymuFgoeilAJkLS --recurse-paths --quiet --verbose --junk-paths --no-dir-entries --no-extra --symlinks --move --update --freshen --grow --encrypt --help --version',
  gzip: 'cdfhklLnNqrS:tv0123456789 --stdout --to-stdout --decompress --uncompress --force --keep --list --no-name --name --quiet --recursive --suffix= --test --verbose --fast --best --rsyncable --synchronous --help --version',
  bzip2: 'cdzkfqtvsL123456789 --stdout --decompress --compress --keep --force --quiet --test --verbose --small --fast --best --help --version',
  xz: 'zdtlkfcqvT:0123456789eF:C:M:H --compress --decompress --uncompress --test --list --keep --force --stdout --to-stdout --quiet --verbose --threads= --format= --check= --memlimit= --extreme --suffix= --no-warn --robot --help --version',
  zstd: 'zdtlkfcqvo>T:0123456789rD:MB: --compress --decompress --uncompress --test --list --keep --force --stdout --quiet --verbose --output> --threads= --rm --long --ultra --fast --adapt --no-progress --progress --exclude-compressed --sparse --no-sparse --memory= --help --version',
  lz4: 'zdtlkfcqvm0123456789B:r --compress --decompress --test --list --keep --force --stdout --quiet --verbose --multiple --rm --fast --best --favor-decSpeed --help --version',
  curl: '#fsSLkIvOJiNgGZ46nqlo>H:X:d:u:A:e:b:c>m:w:x@T:F:r:C:E:D>Y:y:z:t:P:Q:U: !--config --fail --fail-with-body --silent --show-error --location --location-trusted --insecure --output> --remote-name --remote-name-all --remote-header-name --header= --request= --data= --data-raw= --data-binary= --data-urlencode= --data-ascii= --user= --user-agent= --referer= --cookie= --cookie-jar> --max-time= --connect-timeout= --write-out= --proxy@ --upload-file= --form= --form-string= --range= --continue-at= --cert= --cacert= --capath= --key= --dump-header> --retry= --retry-delay= --retry-max-time= --retry-all-errors --retry-connrefused --compressed --create-dirs --output-dir= --http1.0 --http1.1 --http2 --http3 --ipv4 --ipv6 --head --include --verbose --progress-bar --no-progress-meter --limit-rate= --max-filesize= --get --globoff --oauth2-bearer= --json= --url@ --noproxy= --unix-socket= --abstract-unix-socket= --resolve@ --connect-to@ --keepalive-time= --no-keepalive --no-buffer --tlsv1.2 --tlsv1.3 --tls-max= --ssl-reqd --fail-early --parallel --parallel-max= --netrc --netrc-optional --basic --digest --anyauth --ntlm --negotiate --list-only --append --stderr> --trace> --trace-ascii> --trace-time --help --version',
  wget: 'qvcNSrkKmplxEHFdO>o>a>t:T:w:U:Q:A:R:D:I:X:l:P:i@B@n: --quiet --verbose --no-verbose --continue --timestamping --output-document> --output-file> --append-output> --tries= --timeout= --wait= --waitretry= --random-wait --user-agent= --quota= --accept= --reject= --accept-regex= --reject-regex= --domains= --include-directories= --exclude-directories= --level= --directory-prefix= --input-file@ --base@ --force-html --recursive --mirror --page-requisites --convert-links --backup-converted --adjust-extension --no-parent --no-directories --force-directories --no-host-directories --cut-dirs= --no-clobber --spider --show-progress --progress= --header= --no-check-certificate --ca-certificate= --content-disposition --trust-server-names --limit-rate= --https-only --max-redirect= --retry-connrefused --server-response --span-hosts --inet4-only --inet6-only --no-cache --no-cookies --load-cookies= --save-cookies> --keep-session-cookies --post-data= --method= --body-data= --user= --password= --http-user= --http-password= --no-proxy --compression= --restrict-file-names= --ignore-case --no-glob --report-speed= --debug !--config !--use-askpass --help --version',
  aria2c: 'cqxsjZVd:o:i@x:s:j:k: --continue --quiet --dir= --out= --input-file@ --max-connection-per-server= --split= --min-split-size= --max-concurrent-downloads= --check-certificate= --file-allocation= --summary-interval= --auto-file-renaming= --allow-overwrite= --header= --user-agent= --max-tries= --retry-wait= --timeout= --connect-timeout= --console-log-level= --check-integrity= --help --version',
  patch: 'bEflNRstuvp:i@o>d:D:F:g:r>B:V:Y:z: --backup --batch --force --forward --quiet --silent --reverse --posix --dry-run --unified --verbose --strip= --input@ --output> --directory= --reject-file> --fuzz= --binary --no-backup-if-mismatch --remove-empty-files --ignore-whitespace --help --version',
  rsync: 'avzrlptgoDhPHAXSnuWcCiqRxbLkKyf:T}B: !--rsh !--rsync-path !--daemon !--config --archive --verbose --compress --recursive --links --perms --times --group --owner --devices --specials --human-readable --progress --partial --partial-dir} --hard-links --acls --xattrs --sparse --dry-run --update --whole-file --checksum --relative --one-file-system --backup --backup-dir} --suffix= --copy-links --copy-unsafe-links --safe-links --keep-dirlinks --exclude= --include= --exclude-from= --include-from= --files-from= --from0 --filter= --delete --delete-before --delete-after --delete-during --delete-delay --delete-excluded --remove-source-files --stats --info= --itemize-changes --quiet --no-perms --no-owner --no-group --no-times --chmod= --chown= --numeric-ids --size-only --ignore-existing --existing --inplace --append --append-verify --bwlimit= --timeout= --contimeout= --mkpath --temp-dir} --max-size= --min-size= --ignore-times --modify-window= --out-format= --log-file> --link-dest= --compare-dest= --copy-dest= --compress-level= --no-motd --prune-empty-dirs --fuzzy --help --version',
  scp: '346ABCpqrTvc:i:l:P:', sftp: '46aCfNpqrvb:c:i:l:P:R:B:',
  pip: 'vqUIylouVhr@c@e@i@f@t:d: !--python --verbose --quiet --upgrade --user --requirement@ --constraint@ --editable@ --index-url@ --extra-index-url@ --find-links@ --no-index --no-deps --pre --force-reinstall --ignore-installed --ignore-requires-python --no-cache-dir --disable-pip-version-check --no-build-isolation --break-system-packages --target= --prefix= --root= --upgrade-strategy= --only-binary= --no-binary= --prefer-binary --require-hashes --dry-run --report> --isolated --no-input --timeout= --retries= --yes --dest= --platform= --python-version= --implementation= --abi= --trusted-host@ --cache-dir= --log> --progress-bar= --root-user-action= --format= --outdated --uptodate --not-required --local --all --path= --files --exclude= --exclude-editable --no-warn-script-location --no-warn-conflicts --compile --no-compile --no-clean --use-pep517 --no-use-pep517 --config-settings= --proxy@ --cert= --client-cert= --require-virtualenv --no-color --exists-action= --group= --help --version',
  npm: 'gDPOEySfqdlsw: !--userconfig !--globalconfig !--script-shell !--node-options --global --save --save-dev --save-optional --save-exact --save-prod --save-peer --no-save --force --legacy-peer-deps --strict-peer-deps --production --prod --dev --omit= --include= --prefix= --registry@ --loglevel= --silent --quiet --verbose --yes --dry-run --workspace= --workspaces --include-workspace-root --if-present --audit --fund --no-audit --no-fund --ignore-scripts --foreground-scripts --json --parseable --depth= --all --long --location= --prefer-offline --prefer-online --offline --no-package-lock --package-lock-only --frozen-lockfile --immutable --pure-lockfile --non-interactive --network-timeout= --filter= --recursive --engine-strict --install-strategy= --install-links --cache= --help --version',
  conda: 'ynqvaeCSc@n:p:f@ --yes --name= --prefix= --channel@ --override-channels --strict-channel-priority --quiet --verbose --dry-run --json --all --file@ --force-reinstall --force --no-deps --only-deps --update-deps --freeze-installed --clone= --use-local --offline --solver= --copy --no-default-packages --from-history --no-builds --envs --use-index-cache --show --get --set --add --remove --append --prepend --prune --keep-env --help --version',
  'conda:run': 'n:p:a: --name= --prefix= --no-capture-output --live-stream --attach= --no-banner',
  apt: 'yqsdfmVuhat: --yes --assume-yes --assume-no --quiet --simulate --dry-run --download-only --no-download --fix-broken --fix-missing --ignore-missing --no-install-recommends --install-recommends --no-install-suggests --only-upgrade --reinstall --purge --auto-remove --autoremove --target-release= --show-progress --no-upgrade --installed --upgradable --upgradeable --all-versions --full --names-only --print-uris --fix-policy --allow-releaseinfo-change --allow-unauthenticated --force-yes --allow-downgrades --allow-remove-essential --allow-change-held-packages --help --version',
  hf: 'hq --local-dir= --revision= --include= --exclude= --repo-type= --cache-dir= --quiet --max-workers= --force-download --resume-download --local-dir-use-symlinks= --private --commit-message= --repo-id= --token= --help',
  'ssh-keygen': 'qyvlLBHcAf:t:b:C:N:P:a:E:F:R:', sysctl: 'aenNqwpb --all --values --names --quiet --write --load= --system --binary --pattern= --help --version',
  systemctl: 'aqlfnrt:p:o:n: --user --system --global --now --no-pager --no-block --force --runtime --all --full --no-legend --legend= --plain --quiet --type= --state= --failed --lines= --output> --property= --value --show-types --signal= --kill-whom= --job-mode= --no-ask-password --wait --recursive --reverse --before --after --with-dependencies --help --version',
  ss: 'tulpnaxwmeiso46HOKAErA:f:F:D> --diag> --tcp --udp --listening --processes --numeric --all --unix --raw --memory --extended --info --summary --options --resolve --no-header --kill --family= --filter= --help --version',
  ping: 'cnqvi46IWwstTlLDOAfbB:c:i:W:w:s:t:I:l:', blkid: 'dghiklLoprsSu:o:s:c>p --output> --match-tag=', dmidecode: 't:s:qu --type= --string= --quiet --dump --no-sysfs --from-dump= --help --version',
  lshw: [/^-(?:short|businfo|class|C|c|sanitize|numeric|quiet|notime|json|xml|html|X|enable|disable|version|help)$/, /^-(?:class|C)$/],
  'iptables-save': 'ct: --counters --table=', netstat: 'tulpnaexrsWicgMNvo46 --tcp --udp --listening --program --numeric --all --extended --route --statistics --interfaces --wide',
  traceroute: 'nIT46UFq:w:m:p:f:N:i:s:', dig: '46bcfhimpqtuxvy:k:', host: 'aCdlrTvwc:N:R:t:W:46', nslookup: '',
  'nvidia-smi': [/^(?:-[qLxuhicdlfsom]|-lms|-mp|-p2p|--(?:query|list-gpus|xml-format|unit|id|display|loop|loop-ms|query-gpu|query-compute-apps|query-supported-clocks|query-accounted-apps|query-retired-pages|format|filename|help-query-gpu|help|dtd|debug)(?:=.*)?)$/, /^(?:-[idlfcso]|-lms|-p2p|--(?:id|display|loop|loop-ms|query-gpu|query-compute-apps|format|filename))$/],
  journalctl: 'aefklmqrxNb:n:S:U:u:p:t:o:D:M:g:F:c: --all --pager-end --follow --full --no-full --lines= --no-tail --reverse --quiet --merge --boot= --list-boots --dmesg --unit= --user-unit= --priority= --identifier= --facility= --output> --output-fields= --utc --catalog --since= --until= --directory= --file= --root= --machine= --grep= --case-sensitive= --no-pager --no-hostname --fields --field= --cursor= --after-cursor= --show-cursor --system --user --disk-usage --header --verify --list-catalog --help --version',
  wait: 'fnp:', unzip: 'aAbBcCDfhjJKlLMnNopqstTuUvVWXZzd:x:P:',
  awk: 'bcCNOPrSstMnF:v:f@e:E@i@l@ --posix --traditional --characters-as-bytes --sandbox --re-interval --field-separator= --assign= --file@ --source= --include@ --load@ --lint --help --version',
  make: 'BbdeikLnpqRrSstvwj:l:C@f@I@o:W:O: --always-make --directory@ --debug --environment-overrides --file@ --makefile@ --include-dir@ --ignore-errors --jobs= --keep-going --load-average= --check-symlink-times --just-print --dry-run --recon --old-file= --assume-old= --output-sync= --print-data-base --question --no-builtin-rules --no-builtin-variables --silent --quiet --no-silent --stop --no-keep-going --touch --trace --print-directory --no-print-directory --what-if= --new-file= --assume-new= --warn-undefined-variables --help --version',
  ninja: 'nvC:f:j:k:l:d:t:w: --verbose --quiet --version --help',
  cmake: [/^-(?:[SBGDUTA]\S*|j\d*|L[AH]*|N|v|Wn?o?-?(?:dev|deprecated)|Werror=\S+|-(?:build|target|config|parallel|install|prefix|preset|fresh|verbose|clean-first|log-level|toolchain|version|help|graphviz|system-information|warn-uninitialized|component|strip|list-presets|install-prefix|debug-find|log-context|no-warn-unused-cli|check-system-vars)(?:=\S*)?)$/, /^-(?:[SBGTACDU]|j|-(?:build|target|config|parallel|install|prefix|preset|component|toolchain|log-level|graphviz))$/],
  meson: [/^-(?:D\S*|C|j\d*|v|-(?:buildtype|prefix|reconfigure|wipe|backend|default-library|libdir|bindir|optimization|debug|warnlevel|werror|native-file|cross-file|verbose|jobs|clean|quiet|dry-run|destdir|no-rebuild|suite|print-errorlogs|num-processes|help|version|tags|skip-subprojects|strip|unity)(?:=\S*)?)$/, /^-(?:C|j|D|-(?:buildtype|prefix|backend|default-library|libdir|bindir|optimization|warnlevel|native-file|cross-file|jobs|destdir|suite|num-processes|tags))$/],
  cargo: [/^-(?:[qvrFpjVZ]|j\d+|Z\S+|-(?:release|features|all-features|no-default-features|target|target-dir|bin|bins|example|examples|lib|tests|test|benches|bench|all-targets|package|workspace|exclude|jobs|locked|offline|frozen|quiet|verbose|manifest-path|path|root|force|color|message-format|profile|timings|keep-going|no-run|no-fail-fast|doc|open|name|vcs|edition|version|help|list|precise|aggressive|dry-run|allow-dirty|fix|all)(?:=\S*)?)$/, /^-(?:[pjFZ]|-(?:features|target|target-dir|bin|example|test|bench|package|exclude|jobs|manifest-path|path|root|color|message-format|profile|name|vcs|edition))$/],
  go: [/^--?(?:o|v|x|a|n|race|msan|asan|cover|work|trimpath|short|benchmem|json|failfast|u|d|m|t|i|C|tags|ldflags|gcflags|asmflags|mod|modfile|buildvcs|buildmode|p|count|run|skip|timeout|bench|benchtime|cpu|coverprofile|covermode|coverpkg|cpuprofile|memprofile|f|w|s|l|e|h|help|version)(?:=.*)?$/, /^--?(?:o|C|p|tags|ldflags|gcflags|asmflags|mod|modfile|buildmode|count|run|skip|timeout|bench|benchtime|cpu|coverprofile|covermode|coverpkg|cpuprofile|memprofile|f)$/],
  rustc: [/^-(?:o|O|g|v|[LlCWADF]\S*|-(?:edition|crate-type|crate-name|target|emit|test|cfg|extern|out-dir|cap-lints|explain|print|verbose|version|help|error-format|json)(?:=\S*)?)$/, /^-(?:o|[LlCWADF]|-(?:edition|crate-type|crate-name|target|emit|cfg|extern|out-dir|cap-lints|explain|print|error-format))$/],
  gcc: [CC_OPTS, CC_TAKES], nvcc: [CC_OPTS, CC_TAKES],
  javac: [/^-(?:d|cp|classpath|sourcepath|source|target|encoding|g\S*|nowarn|verbose|deprecation|parameters|implicit:\S+|Xlint\S*|Werror|-release|-module-path|-source-path|-class-path|-enable-preview|-add-modules|version|help|h|s)(?:=\S*)?$/, /^-(?:d|cp|classpath|sourcepath|source|target|encoding|-release|-module-path|-source-path|-class-path|-add-modules)$/],
  mvn: [/^-(?:[BqXeUoNcC]|D\S*|P\S*|pl|am|amd|rf|T|f|-(?:batch-mode|quiet|debug|errors|update-snapshots|offline|non-recursive|projects|also-make|also-make-dependents|resume-from|threads|file|fail-at-end|fail-fast|fail-never|no-transfer-progress|show-version|version|help|activate-profiles|define)(?:=\S*)?)$/, /^-(?:[DPTf]|pl|rf|-(?:projects|resume-from|threads|file|activate-profiles|define))$/],
  gradle: [/^-(?:[qiwsSx]|D\S*|P\S*|p|-(?:offline|quiet|info|warn|debug|stacktrace|full-stacktrace|no-daemon|daemon|parallel|no-parallel|build-cache|no-build-cache|refresh-dependencies|continue|dry-run|exclude-task|project-dir|scan|configuration-cache|no-configuration-cache|console|warning-mode|max-workers|rerun-tasks|version|help|status|stop)(?:=\S*)?)$/, /^-(?:[DPxp]|-(?:exclude-task|project-dir|console|warning-mode|max-workers))$/],
  bazel: [/^-(?:c|k|j|-(?:config|compilation_mode|jobs|keep_going|verbose_failures|test_output|define|copt|cxxopt|linkopt|host_copt|action_env|test_env|test_filter|test_arg|platforms|cpu|nobuild|subcommands|show_progress|curses|color|noshow_progress|disk_cache|output_groups|build_tests_only|cache_test_results|runs_per_test|test_timeout|local_ram_resources|local_cpu_resources|announce_rc|nocache_test_results|expunge|async|output|noshow_loading_progress|version|help)(?:=\S*)?)$/, /^-(?:c|j)$/],
  'code:python': 'BbdEhiIOqsSuvVxPc:m:W:X: --version --help', 'code:perl': 'acilnpsTtUvVwe:E:I:M:m:x:0:F:', 'code:node': 'hvcie:p:r: --eval= --print= --require= --import= --check --version --help --input-type= --watch --inspect --inspect-brk --enable-source-maps --experimental-vm-modules --no-warnings --max-old-space-size= --env-file= --conditions= --test --trace-warnings',
  'code:ruby': 'acdilnpsvwyUWe:E:I:r:F:0: --version --help --disable-gems --yjit --jit --verbose --enable= --disable=', 'code:php': 'nqahilmsvr:f:B:R:E:F: --version --help', 'code:lua': 'ivWEe:l:',
  'git:add': 'AunpivfNe --all --update --patch --interactive --dry-run --verbose --force --intent-to-add --ignore-errors --renormalize --chmod= --no-all --ignore-removal --sparse',
  'git:commit': 'amqsSvnepm:F:C:c:t: --all --message= --file= --amend --no-edit --quiet --signoff --verbose --allow-empty --allow-empty-message --author= --date= --reuse-message= --reedit-message= --fixup= --squash= --no-verify --gpg-sign --no-gpg-sign --cleanup= --only --include --edit --reset-author --dry-run --short --porcelain --status --no-status --trailer= --patch',
  'git:push': 'fuqvno: !--receive-pack !--exec --force --force-with-lease --force-if-includes --set-upstream --all --tags --follow-tags --delete --prune --dry-run --quiet --verbose --no-verify --atomic --push-option= --mirror --porcelain --progress --recurse-submodules= --no-thin --no-tags',
  'git:pull': 'rqvfn !--upload-pack --rebase --no-rebase --ff-only --ff --no-ff --squash --quiet --verbose --all --autostash --no-autostash --depth= --unshallow --tags --prune --force --allow-unrelated-histories --strategy= --no-edit --edit --recurse-submodules --stat --no-stat',
  'git:fetch': 'apqvftnj: !--upload-pack --all --prune --prune-tags --tags --no-tags --depth= --unshallow --dry-run --force --quiet --verbose --multiple --jobs= --recurse-submodules --append --set-upstream --progress --deepen= --shallow-since=',
  'git:clone': 'qvnlb:o:j: !--upload-pack !--template !--config !--separate-git-dir --branch= --depth= --single-branch --no-single-branch --recurse-submodules --recursive --shallow-submodules --no-checkout --bare --mirror --quiet --verbose --progress --origin= --filter= --sparse --jobs= --no-tags --reference= --dissociate --no-hardlinks --shallow-since=',
  'git:checkout': 'fqmptb:B: --force --quiet --merge --patch --track --no-track --detach --orphan= --ours --theirs --conflict= --recurse-submodules --ignore-other-worktrees --progress',
  'git:switch': 'dfqmtc:C: --create= --force-create= --detach --force --discard-changes --quiet --merge --track --no-track --orphan= --guess --no-guess --progress --recurse-submodules',
  'git:reset': 'qpN --soft --mixed --hard --merge --keep --quiet --patch --intent-to-add', 'git:mv': 'fknv --force --dry-run --verbose', 'git:rm': 'fnqr --force --dry-run --quiet --cached --ignore-unmatch --sparse',
  'git:merge': 'nqvsem:s:X: --ff --no-ff --ff-only --squash --no-squash --commit --no-commit --edit --no-edit --message= --strategy= --strategy-option= --abort --continue --quit --allow-unrelated-histories --stat --no-stat --quiet --verbose --autostash --log --signoff --no-verify',
  'git:rebase': 'iqvfnsx:X: --interactive --onto= --continue --abort --skip --quit --edit-todo --keep-empty --autosquash --no-autosquash --autostash --no-autostash --exec= --root --strategy= --strategy-option= --quiet --verbose --force-rebase --fork-point --no-fork-point --update-refs --rebase-merges --keep-base --signoff --no-verify',
  'git:stash': 'ukaqpm: --include-untracked --keep-index --all --quiet --patch --message= --staged --index', 'git:tag': 'adsflnvm:F:u: --annotate --delete --sign --force --list --message= --file= --local-user= --contains= --sort= --points-at=',
  'git:branch': 'dDmMcCfavrltu: --delete --move --copy --force --all --verbose --remotes --list --set-upstream-to= --unset-upstream --track --no-track --contains= --merged --no-merged --sort= --show-current --create-reflog --column --format=',
  'git:remote': 'vft:m: --verbose --fetch --tags --no-tags --mirror= --track= --master= --push --add --delete --all --dry-run',
  'git:config': 'lf: --global --system --local --file= --list --get --get-all --get-regexp --unset --unset-all --add --replace-all --type= --bool --int --show-origin --show-scope --null --name-only --rename-section --remove-section --default=',
  'git:init': 'qb: !--template !--separate-git-dir --quiet --bare --initial-branch= --shared= --object-format=', 'git:clean': 'dfinqxXe:', 'git:restore': 'pqsWS --source= --staged --worktree --quiet --patch --ours --theirs',
  'git:cherry-pick': 'enxsm: --edit --no-commit --signoff --mainline= --continue --abort --quit --skip --strategy= --strategy-option= --allow-empty --keep-redundant-commits --ff',
  'git:revert': 'enm:s --edit --no-edit --no-commit --mainline= --signoff --continue --abort --quit --skip --strategy= --strategy-option=',
  'git:submodule': 'q --init --recursive --remote --merge --rebase --checkout --force --quiet --depth= --jobs= --reference= --single-branch --no-fetch --filter= --recommend-shallow --cached --files --summary-limit=',
  'git:lfs': 'I:X: --all --include= --exclude= --local --skip-repo --force', 'git:worktree': 'fdb:B: --force --detach --checkout --no-checkout --lock --track --no-track --guess-remote --orphan --porcelain --expire= --reason=',
  'git:apply': '3Rvqp:C: --check --stat --numstat --summary --index --cached --reverse --reject --unidiff-zero --apply --directory= --exclude= --include= --whitespace= --verbose --quiet --3way --allow-empty',
  'git:am': '3sqk --signoff --keep --keep-cr --quiet --3way --abort --continue --skip --resolved --directory= --exclude= --include= --ignore-date --committer-date-is-author-date',
  'git:bisect': ' --term-old= --term-new= --no-checkout --first-parent', 'git:gc': 'q --aggressive --auto --quiet --prune= --no-prune --force',
  'git:archive': 'lvo> --format= --output> --prefix= --list --verbose --worktree-attributes', 'git:format-patch': 'nkso}v: --output-directory} --numbered --stdout --cover-letter --signoff --subject-prefix=',
  'git:sparse-checkout': ' --cone --no-cone --sparse-index', 'git:difftool': 'ydgx: --dir-diff --no-prompt --prompt --gui --no-gui --extcmd= --staged --cached', 'git:maintenance': ' --auto --quiet --task=',
  'git:notes': 'fm:F:C:c: --ref= --force --message= --file= --reuse-message= --reedit-message=', 'git:fsck': ' --full --strict --unreachable --lost-found --no-dangling --connectivity-only', 'git:prune': 'nv --dry-run --verbose --expire=',
  'git:repack': 'adADfFlnq --window= --depth= --max-pack-size=', 'git:pack-refs': ' --all --prune', 'git:reflog': ' --all --expire= --expire-unreachable= --dry-run --verbose --rewrite --updateref',
}).map(([n, s]) => [n, sortSpec(s)]));
for (const [n, to] of [['chgrp', 'chown'], ['gunzip', 'gzip'], ['bunzip2', 'bzip2'], ['unxz', 'xz'], ['unzstd', 'zstd'], ['zstdcat', 'zstd'], ['lz4cat', 'lz4'], ['pip3', 'pip'],
  ['pnpm', 'npm'], ['yarn', 'npm'], ['mamba', 'conda'], ['micromamba', 'conda'], ['apt-get', 'apt'], ['aptitude', 'apt'], ['huggingface-cli', 'hf'], ['ip6tables-save', 'iptables-save'],
  ['ping6', 'ping'], ['gmake', 'make'], ['g++', 'gcc'], ['cc', 'gcc'], ['c++', 'gcc'], ['clang', 'gcc'], ['clang++', 'gcc'], ['gawk', 'awk'], ['mawk', 'awk'], ['nawk', 'awk'],
  ['code:python2', 'code:python'], ['code:python3', 'code:python'], ['code:nodejs', 'code:node'], ['code:luajit', 'code:lua']]) SORT_OPTS[n] = SORT_OPTS[to];
// A word chmod or chattr reads as a mode, not an option (chmod -x f, chattr +i f).
const SORT_MODES = { chmod: /^[-+=][rwxXstugoa,+=-]*$/, chattr: /^[-+=][aAcCdDeFijmPsStTux]+$/ };

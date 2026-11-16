// A stand-in for GitHub's REST API, for test/selfchange.test.mjs: the few routes Spark Console calls for a proposal of
// its own code, kept in memory. No real GitHub is ever called by the suite. The branches themselves live in a bare
// repository the test makes (SPARK_CONSOLE_REPO_URL); this answers for the pull requests, their reviews and the check
// runs on a commit, as GitHub words them:
//   GET   /repos/:owner/:repo/pulls?state=open|closed|all&head=owner:branch
//   POST  /repos/:owner/:repo/pulls          {title, head, base, body}  (422 when one is open for that head already)
//   PATCH /repos/:owner/:repo/pulls/:n       {state}
//   GET   /repos/:owner/:repo/pulls/:n/reviews
//   GET   /repos/:owner/:repo/commits/:sha/check-runs
// Every request is kept in `calls` (method, path, whether it carried the expected token, its body); a test sets
// `checkRuns[sha]` and `reviews[n]` to what GitHub would say, and `failPosts` to the number of pull requests to refuse
// (500) before one opens. For the merge (C8d), `headOf(ref)` gives a branch's commit and `mainOf()` main's (a pull
// request's head.sha, GET /branches/main), and `merge(pr, sha)` merges in the bare repository; PUT …/pulls/:n/merge
// merges only at the head it names. As on GitHub, a merge marks nothing tested: that comes from the run on main.
//   GET   /repos/:owner/:repo/branches/main
//   PUT   /repos/:owner/:repo/pulls/:n/merge   {sha, merge_method}
import http from 'node:http';

export async function startGitHub({ token }) {
  const state = { pulls: [], checkRuns: {}, reviews: {}, calls: [], failPosts: 0, headOf: () => null, mainOf: () => null, merge: () => null };
  const shown = p => ({ ...p, head: { ...p.head, sha: state.headOf(p.head.ref) } });
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://github'), path = url.pathname;
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch {}
      const authorized = req.headers.authorization === `Bearer ${token}`;
      state.calls.push({ method: req.method, path, query: url.search, authorized, body });
      if (!authorized) return send(res, 401, { message: 'Bad credentials' });
      let m;
      if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(path))) {
        if (req.method === 'GET') {
          const st = url.searchParams.get('state') || 'open', head = url.searchParams.get('head');
          return send(res, 200, state.pulls.filter(p => (st === 'all' || p.state === st) && (!head || `${m[1]}:${p.head.ref}` === head)).map(shown));
        }
        if (req.method === 'POST') {
          if (state.failPosts > 0) { state.failPosts--; return send(res, 500, { message: 'Server Error' }); }
          if (!body?.title || !body?.head || body?.base !== 'main') return send(res, 422, { message: 'Validation Failed' });
          if (state.pulls.some(p => p.state === 'open' && p.head.ref === body.head)) return send(res, 422, { message: 'A pull request already exists' });
          const pr = { number: state.pulls.length + 1, state: 'open', title: body.title, body: body.body, head: { ref: body.head }, base: { ref: body.base }, merged_at: null };
          state.pulls.push(pr);
          return send(res, 201, pr);
        }
      }
      if ((m = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(path)) && req.method === 'PATCH') {
        const pr = state.pulls.find(p => p.number === Number(m[1]));
        if (!pr) return send(res, 404, { message: 'Not Found' });
        if (body?.state) pr.state = body.state;
        return send(res, 200, pr);
      }
      if ((m = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviews$/.exec(path)) && req.method === 'GET') return send(res, 200, state.reviews[m[1]] || []);
      if (/^\/repos\/[^/]+\/[^/]+\/branches\/main$/.test(path) && req.method === 'GET') return send(res, 200, { name: 'main', commit: { sha: state.mainOf() } });
      if ((m = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/.exec(path)) && req.method === 'PUT') {
        const pr = state.pulls.find(p => p.number === Number(m[1]));
        if (!pr || pr.state !== 'open') return send(res, 404, { message: 'Not Found' });
        if (body?.sha !== state.headOf(pr.head.ref)) return send(res, 409, { message: 'Head branch was modified. Review and try the merge again.' });
        const sha = state.merge(pr, body.sha);
        Object.assign(pr, { state: 'closed', merged_at: new Date().toISOString() });
        return send(res, 200, { sha, merged: true, message: 'Pull Request successfully merged' });
      }
      if ((m = /^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/check-runs$/.exec(path)) && req.method === 'GET') {
        const runs = state.checkRuns[m[1]] || [];
        return send(res, 200, { total_count: runs.length, check_runs: runs });
      }
      send(res, 404, { message: 'Not Found' });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise(resolve => server.close(resolve)) };
}

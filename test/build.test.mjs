// service/server.mjs is generated: service/src/*.mjs joined in name order (tools/build-server.mjs). It must match its
// parts exactly, so what's tested, locked and installed is what the parts say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './start-mock.mjs';
import { buildServer } from '../tools/build-server.mjs';
import { codeMap } from '../tools/code-map.mjs';

test('service/server.mjs is exactly service/src/*.mjs joined (run node tools/build-server.mjs after editing a part)', () => {
  assert.ok(readFileSync(join(REPO, 'service', 'server.mjs'), 'utf8') === buildServer(), 'server.mjs is out of date with its parts');
});

// docs/code-map.md is how an agent finds where something lives: it is written from the code and has to match it.
test('docs/code-map.md is exactly what the code makes (run node tools/code-map.mjs after editing a part)', () => {
  assert.ok(readFileSync(join(REPO, 'docs', 'code-map.md'), 'utf8') === codeMap(), 'docs/code-map.md is out of date with the code');
});

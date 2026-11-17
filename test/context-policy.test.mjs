// Covers: T42's pure context policy: all supported flag spellings, separate and equals values, equal and conflicting
// duplicates, malformed values and number bounds; explicit, selected-setup and model-owned provenance versus automatic
// settings; normalized overrides without caller mutation; proposed reductions and dropped flags; independent frozen
// copies; a shared three-attempt deadline that cannot be refreshed or bypassed by malformed state. No fleet is used.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_FLAGS, contextNumber, contextValue, contextOverride, contextPolicy,
  contextChange, contextAttempt, contextFreeze,
} from '../service/src/17-context.mjs';

const FLAGS = ['--context-length', '--max-model-len', '--max_seq_len', '--ctx-size', '-c'];
const WINDOW = 30 * 60 * 1000;

describe('context values and overrides', () => {
  test('each engine spelling reads separate and equals values while unrelated settings stay unrelated', () => {
    assert.deepEqual([...CONTEXT_FLAGS].sort(), [...FLAGS].sort());
    for (const flag of FLAGS) {
      assert.equal(contextValue(['--dtype', 'bfloat16', flag, '32768', '--port', '8000']), 32768, flag);
      assert.equal(contextValue([`${flag}=65536`, '--port=8000']), 65536, `${flag}=`);
    }
    assert.equal(contextValue(['--max-num-seqs', '4', '--dtype=bfloat16']), null);
    assert.equal(contextValue(), null);
    assert.equal(contextValue(['--ctx-size-extra=99', '--max-model-length', '32768']), null, 'a prefix is not a context flag');
  });

  test('equal duplicates have one meaning; conflicting values never silently choose the first or last', () => {
    assert.equal(contextValue(['--context-length', '32768', '--ctx-size=32768', '-c', '32768']), 32768);
    assert.equal(contextValue(['--max-model-len=32768', '--max-model-len', '32768']), 32768);
    for (const args of [
      ['--context-length', '32768', '-c=16384'],
      ['--max-model-len=16384', '--max-model-len', '32768'],
      ['-c', '1', '--ctx-size', '2147483647'],
    ]) assert.throws(() => contextValue(args), /different context lengths/);
  });

  test('malformed, missing and out-of-range flag values are rejected', () => {
    for (const flag of FLAGS) {
      for (const value of ['', '0', '-1', '1.5', '1e3', '0x4000', '032768', 'NaN', 'Infinity', 'tokens', '32768=65536', '2147483648']) {
        assert.throws(() => contextValue([`${flag}=${value}`]), undefined, `${flag}=${value}`);
        assert.throws(() => contextValue([flag, value]), undefined, `${flag} ${value}`);
      }
      assert.throws(() => contextValue([flag]), undefined, `${flag} without its value`);
      assert.throws(() => contextValue([flag, '--dtype', 'bfloat16']), undefined, 'another flag cannot be its value');
    }
  });

  test('numeric requests are whole positive bounded token counts, never coercions', () => {
    for (const n of [1, 16384, 32768, 2147483647]) assert.equal(contextNumber(n), n);
    for (const n of [0, -1, 1.5, NaN, Infinity, -Infinity, 2147483648, '32768', null, undefined, true, false])
      assert.throws(() => contextNumber(n), undefined, `invalid numeric request ${String(n)}`);
  });

  test('an explicit override replaces every old alias with one engine flag and preserves the caller input', () => {
    const args = Object.freeze(['--dtype', 'bfloat16', '--context-length=65536', '--port', '8000', '-c', '65536', '--max-model-len', '65536']);
    const before = [...args];
    for (const flag of FLAGS) {
      const fixed = contextOverride(args, 32768, flag);
      assert.deepEqual(fixed, ['--dtype', 'bfloat16', '--port', '8000', flag, '32768']);
      assert.equal(contextValue(fixed), 32768);
      assert.deepEqual(args, before);
      assert.notEqual(fixed, args);
    }
    assert.throws(() => contextOverride(args, 32768, '--made-up-context'));
    assert.throws(() => contextOverride(args, 0, '--context-length'));
    assert.throws(() => contextOverride(args, '32768', '--context-length'));
  });
});

describe('whose context the start must preserve', () => {
  test('an explicit request wins, then a named setup, then a model-owned setup; automatic values grant no owner provenance', () => {
    const args = Object.freeze(['--context-length', '65536']);
    assert.deepEqual(contextPolicy({ args, requested: 32768 }), { tokens: 32768, source: 'requested' });
    assert.deepEqual(contextPolicy({ args, requested: 32768, selected: true, own: true }), { tokens: 32768, source: 'requested' });
    assert.deepEqual(contextPolicy({ args, selected: true }), { tokens: 65536, source: 'selected setup' });
    assert.deepEqual(contextPolicy({ args, own: true }), { tokens: 65536, source: 'model setup' });
    assert.deepEqual(contextPolicy({ args, selected: true, own: true }), { tokens: 65536, source: 'selected setup' });
    assert.equal(contextPolicy({ args }), null, 'a value chosen automatically is not an owner constraint');
    assert.equal(contextPolicy({ selected: true, args: ['--dtype', 'bfloat16'] }), null, 'selection does not invent a context value');
    assert.equal(contextPolicy({ own: true }), null);
    for (const requested of [0, null, '32768']) assert.throws(() => contextPolicy({ args, requested, selected: true }));
  });

  test('an automatic fix that reduces protected context or removes its flag needs a question', () => {
    const policy = Object.freeze({ tokens: 65536, source: 'requested' });
    assert.deepEqual(contextChange(policy, { contextCap: 32768 }), { tokens: 32768 });
    assert.equal(contextChange(policy, { contextCap: 65536 }), null);
    assert.equal(contextChange(policy, { contextCap: 131072 }), null);
    assert.equal(contextChange(policy, { dropFlags: ['--attention-backend'] }), null);
    for (const flag of FLAGS) assert.deepEqual(contextChange(policy, { dropFlags: [flag] }), { unsupported: true }, flag);
    assert.equal(contextChange(null, { contextCap: 32768, dropFlags: ['--context-length'] }), null, 'automatic settings have no owner constraint to waive');
    for (const contextCap of [0, -1, 1.5, NaN, Infinity, '32768', null, 2147483648])
      assert.throws(() => contextChange(policy, { contextCap }), undefined, `invalid proposed cap ${String(contextCap)}`);
    assert.deepEqual(policy, { tokens: 65536, source: 'requested' });
  });

  test('freezing a proposed start makes a separate deeply immutable snapshot', () => {
    const original = {
      args: ['--context-length', '65536'],
      policy: { tokens: 65536, source: 'selected setup' },
      setup: { env: { MODE: 'owner' }, nodes: ['spark3', 'spark4'] },
      attempt: { attempts: 1, deadline: 1800000 },
    };
    const snapshot = contextFreeze(original);
    original.args[1] = '32768'; original.setup.env.MODE = 'changed'; original.setup.nodes.push('spark1'); original.attempt.attempts = 99;
    assert.deepEqual(snapshot.args, ['--context-length', '65536']);
    assert.equal(snapshot.setup.env.MODE, 'owner');
    assert.deepEqual(snapshot.setup.nodes, ['spark3', 'spark4']);
    assert.equal(snapshot.attempt.attempts, 1);
    for (const value of [snapshot, snapshot.args, snapshot.policy, snapshot.setup, snapshot.setup.env, snapshot.setup.nodes, snapshot.attempt]) assert.ok(Object.isFrozen(value));
    assert.throws(() => { snapshot.policy.tokens = 32768; }, TypeError);
    assert.throws(() => snapshot.args.push('--changed'), TypeError);
    assert.throws(() => { snapshot.setup.env.MODE = 'changed'; }, TypeError);
    assert.equal(contextFreeze(null), null);
  });
});

describe('a start shares its attempts and deadline across owner questions', () => {
  test('three attempts share the original deadline and never mutate an earlier attempt', () => {
    const first = contextAttempt(null, 1000, WINDOW), kept = contextFreeze(first);
    assert.deepEqual(first, { attempts: 1, deadline: 1000 + WINDOW });
    const second = contextAttempt(kept, 2000, WINDOW);
    const third = contextAttempt(contextFreeze(second), first.deadline - 1, WINDOW);
    assert.deepEqual(second, { attempts: 2, deadline: first.deadline });
    assert.deepEqual(third, { attempts: 3, deadline: first.deadline });
    assert.deepEqual(first, kept, 'a continuation does not mutate an earlier saved attempt');
    assert.throws(() => contextAttempt(third, first.deadline - 1, WINDOW), /three attempts|30 minutes/);
    assert.throws(() => contextAttempt(first, first.deadline, WINDOW), /three attempts|30 minutes/, 'the exact deadline is too late');
    assert.throws(() => contextAttempt(first, first.deadline + 1, WINDOW), /three attempts|30 minutes/);
    assert.equal(contextAttempt(first, 2000, 1).deadline, first.deadline, 'a new caller window cannot refresh the saved deadline');
    assert.deepEqual(contextAttempt(null, first.deadline, WINDOW), { attempts: 1, deadline: first.deadline + WINDOW }, 'only a genuinely new start gets a new budget');
  });

  test('malformed budget state and invalid clocks cannot bypass either bound', () => {
    for (const previous of [
      { attempts: -1, deadline: 10000 }, { attempts: 0.5, deadline: 10000 }, { attempts: '1', deadline: 10000 },
      { attempts: NaN, deadline: 10000 }, { attempts: 1, deadline: NaN }, { attempts: 1, deadline: Infinity },
      { attempts: 1 }, { deadline: 10000 },
    ]) assert.throws(() => contextAttempt(previous, 1000, WINDOW), undefined, `invalid saved attempt ${JSON.stringify(previous)}`);
    for (const now of [NaN, Infinity, -Infinity, -1]) assert.throws(() => contextAttempt(null, now, WINDOW));
    for (const window of [0, -1, 1.5, NaN, Infinity, WINDOW + 1]) assert.throws(() => contextAttempt(null, 1000, window));
  });
});

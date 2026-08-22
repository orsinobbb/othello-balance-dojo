import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ExactTeachingSession } from '../src/core/session.js';
import { analyzeTurn } from '../src/core/teaching.js';
import { THEORY_CATALOG } from '../src/core/theory-catalog.js';
import { NativeBalancedDag } from '../src/data/native-balanced-dag.js';

const bytes = await readFile(new URL('../data/shards/shard-000001.otbdag', import.meta.url));
const dag = new NativeBalancedDag(bytes);

test('theory catalog is structured and has unique measurable rules', () => {
  assert.ok(THEORY_CATALOG.length >= 15);
  assert.equal(new Set(THEORY_CATALOG.map((theory) => theory.id)).size, THEORY_CATALOG.length);
  for (const theory of THEORY_CATALOG) {
    assert.equal(typeof theory.measure, 'function');
    assert.ok(theory.weight > 0);
    assert.ok(theory.direction === 1 || theory.direction === -1);
    assert.equal(typeof theory.principle, 'string');
    assert.equal(typeof theory.caveat, 'string');
    assert.equal(typeof theory.explain, 'function');
  }
});

test('analysis separates blind theory ranking from exact proof labels', () => {
  const session = new ExactTeachingSession(dag, dag.root(0), { control: 'both' });
  const analysis = analyzeTurn(session);
  assert.equal(analysis.theory.catalogSize, THEORY_CATALOG.length);
  assert.equal(analysis.theory.ranked.length, analysis.legalCount);
  assert.ok(analysis.theory.activeTheories.length > 3);
  assert.ok(analysis.theory.primaryTheory);
  assert.ok(analysis.theory.selected.balanced);
  assert.ok(analysis.theory.ranked.every((fact) => Number.isFinite(fact.theoryScore)));
});

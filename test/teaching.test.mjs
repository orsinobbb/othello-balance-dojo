import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ExactTeachingSession } from '../src/core/session.js';
import { analyzeTurn } from '../src/core/teaching.js';
import { NativeBalancedDag } from '../src/data/native-balanced-dag.js';

const bytes = await readFile(new URL('../data/shards/shard-000001.otbdag', import.meta.url));
const dag = new NativeBalancedDag(bytes);

test('C1 lesson derives the supplied human reasoning from the board', () => {
  const session = new ExactTeachingSession(dag, dag.root(0), { control:'both' });
  const analysis = analyzeTurn(session);
  assert.equal(analysis.color, '黑');
  assert.equal(analysis.legalCount, 10);
  assert.deepEqual(analysis.regions.map((region) => region.size), [10, 3, 3, 1, 1, 1, 1]);
  assert.deepEqual(analysis.shortlist.map((fact) => fact.name).sort(), ['A2', 'B2', 'C1', 'H6']);
  assert.deepEqual(analysis.sharedSingletons.map((fact) => fact.name), ['C1']);
  assert.deepEqual(analysis.balanced.map((fact) => fact.name), ['C1']);
});

test('both-side control lets one user choose every balanced move', () => {
  const session = new ExactTeachingSession(dag, dag.root(0), { control:'both' });
  const first = analyzeTurn(session).balanced[0];
  assert.equal(session.playStudentMove(first.displaySquare).accepted, true);
  assert.equal(session.turnColor, 1);
  assert.equal(session.isStudentTurn, true);
  const second = analyzeTurn(session).balanced[0];
  assert.equal(session.playStudentMove(second.displaySquare).accepted, true);
  assert.equal(session.turnColor, 0);
  assert.equal(session.history[0].color, 0);
  assert.equal(session.history[1].color, 1);
});


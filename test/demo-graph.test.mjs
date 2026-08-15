import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ExactTeachingSession } from '../src/core/session.js';
import { NativeBalancedDag, NativeEdgeOutcome } from '../src/data/native-balanced-dag.js';

const bytes = await readFile(new URL('../data/shards/shard-000001.otbdag', import.meta.url));
const dag = new NativeBalancedDag(bytes);

test('demo shard exposes its 16 exact roots', () => {
  assert.equal(dag.rootCount, 16);
  assert.ok(dag.nodeCount > 1_000);
});

test('a balanced route reaches a terminal draw', () => {
  const session = new ExactTeachingSession(dag, dag.root(0), { random:() => 0 });
  let guard = 100;
  while (session.phase === 'playing' && guard-- > 0) {
    const edge = session.balancedEdges()[0];
    assert.ok(edge, `no balanced edge at node ${session.nodeId}`);
    session.advance(edge, session.isStudentTurn ? 'student' : 'computer');
  }
  assert.equal(session.phase, 'terminal');
  assert.equal(session.empties, 0);
});

test('a failure move is retained as review without changing the node', () => {
  const rootId = Array.from({ length:dag.rootCount }, (_, index) => dag.root(index))
    .find((id) => dag.edgesForNode(id).some((edge) => edge.outcome === NativeEdgeOutcome.FAILURE));
  assert.notEqual(rootId, undefined);
  const session = new ExactTeachingSession(dag, rootId);
  const failure = session.edges.find((edge) => edge.outcome === NativeEdgeOutcome.FAILURE);
  const result = session.playStudentMove(session.displaySquare(failure.move));
  assert.equal(result.reason, 'failure');
  assert.equal(session.nodeId, rootId);
  assert.equal(session.phase, 'review');
  assert.equal(session.retry(), true);
  assert.equal(session.phase, 'playing');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatureTargets, lessonFeatures, selectLessons, selectShardIds } from '../src/curriculum/selector.js';

function candidate(root, shard, overrides = {}) {
  return {
    root,
    sourceShardId: shard,
    primaryTheoryFamily: 'mobility',
    primaryTheoryId: 'opponent-mobility',
    difficulty: 'intermediate',
    balancedMoveCount: 1,
    legalMoveCount: 7,
    calculationRequired: false,
    difficultyScore: 15,
    ...overrides
  };
}

test('lesson features cover pedagogy dimensions', () => {
  const features = lessonFeatures(candidate('a', 1));
  assert.deepEqual(features, [
    'family:mobility',
    'theory:opponent-mobility',
    'difficulty:intermediate',
    'choice:unique',
    'calculation:supported',
    'legal:medium'
  ]);
  assert.ok(buildFeatureTargets([candidate('a', 1)], 10).size >= 6);
});
test('selection preserves pinned root and expands across diverse shards', () => {
  const candidates = [
    candidate('a', 1),
    candidate('b', 1),
    candidate('c', 2, { primaryTheoryFamily: 'corner', primaryTheoryId: 'take-corner', difficulty: 'foundation' }),
    candidate('d', 2, { primaryTheoryFamily: 'corner', primaryTheoryId: 'deny-corner', balancedMoveCount: 2 }),
    candidate('e', 3, { primaryTheoryFamily: 'tempo', primaryTheoryId: 'forced-pass', difficulty: 'advanced', calculationRequired: true }),
    candidate('f', 3, { primaryTheoryFamily: 'parity', primaryTheoryId: 'odd-region', legalMoveCount: 10 })
  ];
  const shardIds = selectShardIds(candidates, [
    { id: 1, bytes: 100 }, { id: 2, bytes: 100 }, { id: 3, bytes: 100 }
  ], { lessonCount: 4, maxShards: 3, pinnedShardIds: [1] });
  assert.deepEqual(new Set(shardIds), new Set([1, 2, 3]));
  const lessons = selectLessons(candidates.filter((item) => shardIds.includes(item.sourceShardId)), 4, { pinnedRoots: ['a'] });
  assert.equal(lessons.length, 4);
  assert.ok(lessons.some((item) => item.root === 'a'));
  assert.equal(new Set(lessons.map((item) => item.root)).size, 4);
  assert.ok(new Set(lessons.map((item) => item.primaryTheoryFamily)).size >= 3);
});

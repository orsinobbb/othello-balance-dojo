import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningEvent, LearningEventType, mergeEventSets, projectLearningState } from '../src/core/learning-model.js';

function event(id, overrides = {}) {
  return createLearningEvent({
    eventId: id,
    eventType: LearningEventType.MOVE_ATTEMPTED,
    profileId: 'local', deviceId: 'device-1', clientSeq: Number(id.slice(1)),
    occurredAt: `2026-08-2${id.slice(1)}T00:00:00.000Z`, lessonId: 'lesson-a',
    outcome: 'value_preserving', conceptTags: ['tempo'], ...overrides
  });
}

test('all proven value-preserving moves count as correct evidence', () => {
  const projection = projectLearningState([
    event('e1', { move: 'C1' }),
    event('e2', { move: 'H6', transfer: true })
  ], { now: new Date('2026-08-30T00:00:00Z') });
  assert.equal(projection.totals.attempts, 2);
  assert.equal(projection.totals.valuePreserving, 2);
  assert.equal(projection.totals.failures, 0);
  assert.equal(projection.mastery[0].independentSuccesses, 2);
});

test('hinted success carries less mastery evidence than independent success', () => {
  const independent = projectLearningState([event('e1', { hintLevel: 0 })]).mastery[0];
  const revealed = projectLearningState([event('e1', { hintLevel: 3 })]).mastery[0];
  assert.ok(independent.evidenceWeight > revealed.evidenceWeight);
  assert.ok(independent.score > revealed.score);
});

test('mistakes schedule an earlier review and event merge is idempotent', () => {
  const mistake = event('e1', { outcome: 'failure' });
  const projection = projectLearningState([mistake], { now: new Date('2026-08-30T00:00:00Z') });
  assert.equal(projection.reviewQueue[0].reason, 'mistake');
  assert.equal(mergeEventSets([mistake], [mistake]).length, 1);
});

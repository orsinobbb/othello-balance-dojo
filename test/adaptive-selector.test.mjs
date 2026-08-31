import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPlan } from '../src/curriculum/adaptive-selector.js';

const lessons = ['a', 'b', 'c'].map((id) => ({
  id,
  title: id,
  pedagogy: { primaryTheoryId: `concept-${id}`, theoryIds: [], balancedMoveCount: 1 }
}));

test('daily plan prioritises due mistakes and never duplicates lessons', () => {
  const projection = {
    mastery: [], completedLessons: [{ lessonId: 'a' }],
    reviewQueue: [{ lessonId: 'a', dueAt: '2026-08-01T00:00:00Z', reason: 'mistake' }],
    dueReviews: [{ lessonId: 'a', dueAt: '2026-08-01T00:00:00Z', reason: 'mistake' }]
  };
  const plan = buildDailyPlan(lessons, projection, { size: 3, now: new Date('2026-08-31T00:00:00Z') });
  assert.equal(plan[0].lesson.id, 'a');
  assert.equal(plan[0].reason, '到期複習');
  assert.equal(new Set(plan.map((item) => item.lesson.id)).size, plan.length);
});

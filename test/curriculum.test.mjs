import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRICULUM_KEY, isLessonAvailable, loadCurriculum, recordLessonSuccess } from '../src/storage/curriculum-store.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('curriculum starts at lesson one and unlocks sequentially', () => {
  const storage = memoryStorage();
  let state = loadCurriculum(storage, 16);
  assert.equal(state.completedCount, 0);
  assert.equal(state.unlockedThrough, 0);
  assert.equal(isLessonAvailable(state, 0), true);
  assert.equal(isLessonAvailable(state, 1), false);

  state = recordLessonSuccess(storage, 16, 0, { moves: 20 });
  assert.equal(state.completedCount, 1);
  assert.equal(state.unlockedThrough, 1);
  assert.equal(isLessonAvailable(state, 1), true);
  assert.equal(isLessonAvailable(state, 2), false);
});

test('replaying a completed lesson keeps its first success and counts reviews', () => {
  const storage = memoryStorage();
  recordLessonSuccess(storage, 16, 0, { moves: 20 });
  const first = JSON.parse(storage.getItem(CURRICULUM_KEY)).completed[0];
  const state = recordLessonSuccess(storage, 16, 0, { moves: 18 });
  assert.equal(state.completed[0].firstCompletedAt, first.firstCompletedAt);
  assert.equal(state.completed[0].completionCount, 2);
  assert.equal(state.completed[0].moves, 18);
});

export const CURRICULUM_KEY = 'balance-dojo-curriculum-v1';

function cleanCompleted(value, lessonCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, record]) => {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < lessonCount && record && typeof record === 'object';
  }));
}

function unlockedThrough(completed, lessonCount) {
  let index = 0;
  while (index < lessonCount && completed[index]) index += 1;
  return Math.min(index, Math.max(0, lessonCount - 1));
}

export function loadCurriculum(storage, lessonCount) {
  let parsed = {};
  try { parsed = JSON.parse(storage.getItem(CURRICULUM_KEY) || '{}'); } catch { parsed = {}; }
  const completed = cleanCompleted(parsed.completed, lessonCount);
  return {
    version: 1,
    completed,
    completedCount: Object.keys(completed).length,
    unlockedThrough: unlockedThrough(completed, lessonCount)
  };
}

export function isLessonAvailable(curriculum, index) {
  return Boolean(curriculum.completed[index]) || index <= curriculum.unlockedThrough;
}

export function recordLessonSuccess(storage, lessonCount, index, details = {}) {
  const curriculum = loadCurriculum(storage, lessonCount);
  const previous = curriculum.completed[index];
  const now = new Date().toISOString();
  curriculum.completed[index] = {
    firstCompletedAt: previous?.firstCompletedAt || now,
    lastCompletedAt: now,
    completionCount: (previous?.completionCount || 0) + 1,
    moves: Number(details.moves || 0)
  };
  storage.setItem(CURRICULUM_KEY, JSON.stringify({ version: 1, completed: curriculum.completed }));
  return loadCurriculum(storage, lessonCount);
}

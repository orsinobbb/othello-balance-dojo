export const CURRICULUM_KEY = 'balance-dojo-curriculum-v2';
export const LEGACY_CURRICULUM_KEY = 'balance-dojo-curriculum-v1';

function lessonIds(lessons) {
  if (Number.isInteger(lessons)) return Array.from({ length: lessons }, (_, index) => String(index));
  return lessons.map((lesson, index) => String(lesson.id || index));
}

function cleanCompleted(value, ids) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const valid = new Set(ids);
  return Object.fromEntries(Object.entries(value).filter(([id, record]) => valid.has(id) && record && typeof record === 'object'));
}

function migrateLegacy(storage, ids) {
  let legacy = {};
  try { legacy = JSON.parse(storage.getItem(LEGACY_CURRICULUM_KEY) || '{}'); } catch { legacy = {}; }
  if (!legacy.completed || typeof legacy.completed !== 'object') return {};
  return Object.fromEntries(Object.entries(legacy.completed)
    .filter(([index, record]) => ids[Number(index)] && record && typeof record === 'object')
    .map(([index, record]) => [ids[Number(index)], record]));
}

function unlockedThrough(completed, ids) {
  let index = 0;
  while (index < ids.length && completed[ids[index]]) index += 1;
  return Math.min(index, Math.max(0, ids.length - 1));
}

export function loadCurriculum(storage, lessons) {
  const ids = lessonIds(lessons);
  let parsed = {};
  try { parsed = JSON.parse(storage.getItem(CURRICULUM_KEY) || '{}'); } catch { parsed = {}; }
  const completed = cleanCompleted(parsed.completed, ids);
  if (Object.keys(completed).length === 0) Object.assign(completed, migrateLegacy(storage, ids));
  return {
    version: 2,
    lessonIds: ids,
    completed,
    completedCount: Object.keys(completed).length,
    unlockedThrough: unlockedThrough(completed, ids)
  };
}

export function isLessonCompleted(curriculum, index) {
  return Boolean(curriculum.completed[curriculum.lessonIds[index]]);
}

export function isLessonAvailable(curriculum, index) {
  return isLessonCompleted(curriculum, index) || index <= curriculum.unlockedThrough;
}

export function recordLessonSuccess(storage, lessons, index, details = {}) {
  const curriculum = loadCurriculum(storage, lessons);
  const id = curriculum.lessonIds[index];
  if (!id) throw new Error(`未知題目索引：${index}`);
  const previous = curriculum.completed[id];
  const now = new Date().toISOString();
  curriculum.completed[id] = {
    firstCompletedAt: previous?.firstCompletedAt || now,
    lastCompletedAt: now,
    completionCount: (previous?.completionCount || 0) + 1,
    moves: Number(details.moves || 0)
  };
  storage.setItem(CURRICULUM_KEY, JSON.stringify({ version: 2, completed: curriculum.completed }));
  return loadCurriculum(storage, lessons);
}

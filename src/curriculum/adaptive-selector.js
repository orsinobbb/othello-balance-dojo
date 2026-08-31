import { MasteryState } from '../core/learning-model.js';

const STATE_PRIORITY = Object.freeze({
  [MasteryState.LEARNING]: 5,
  [MasteryState.RECOGNISABLE]: 3,
  [MasteryState.STABLE]: 1.5,
  [MasteryState.TRANSFER_READY]: 0.5
});

export function lessonConcepts(lesson) {
  const pedagogy = lesson?.pedagogy || {};
  return [...new Set([
    pedagogy.primaryTheoryId,
    ...(pedagogy.theoryIds || []),
    pedagogy.primaryTheoryFamily ? `family:${pedagogy.primaryTheoryFamily}` : null
  ].filter(Boolean))];
}
export function scoreLesson(lesson, projection, { now = new Date() } = {}) {
  const mastery = new Map((projection?.mastery || []).map((item) => [item.conceptId, item]));
  const completed = new Set((projection?.completedLessons || []).map((item) => item.lessonId));
  const due = new Map((projection?.reviewQueue || []).map((item) => [item.lessonId, item]));
  const concepts = lessonConcepts(lesson);
  const weakness = concepts.reduce((score, conceptId) => {
    const record = mastery.get(conceptId);
    return score + (record ? STATE_PRIORITY[record.state] || 1 : 4);
  }, 0) / Math.max(1, concepts.length);
  const dueItem = due.get(lesson.id);
  const dueScore = dueItem && new Date(dueItem.dueAt) <= now ? (dueItem.reason === 'mistake' ? 12 : 8) : 0;
  const novelty = completed.has(lesson.id) ? 0 : 4;
  const multiSolution = Number(lesson.pedagogy?.balancedMoveCount || 0) > 1 ? 1 : 0;
  const calculation = lesson.pedagogy?.calculationRequired ? 0.5 : 0;
  return dueScore + weakness + novelty + multiSolution + calculation;
}

export function buildDailyPlan(lessons, projection, { size = 6, now = new Date() } = {}) {
  const ranked = lessons.map((lesson, index) => ({ lesson, index, score: scoreLesson(lesson, projection, { now }) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const dueIds = new Set((projection?.dueReviews || []).map((item) => item.lessonId));
  const completed = new Set((projection?.completedLessons || []).map((item) => item.lessonId));
  const chosen = [];
  const used = new Set();
  const add = (candidate, reason) => {
    if (!candidate || used.has(candidate.lesson.id) || chosen.length >= size) return;
    chosen.push({ ...candidate, reason });
    used.add(candidate.lesson.id);
  };
  for (const candidate of ranked.filter((item) => dueIds.has(item.lesson.id))) add(candidate, '到期複習');
  for (const candidate of ranked.filter((item) => !completed.has(item.lesson.id))) add(candidate, '新決策');
  for (const candidate of ranked) add(candidate, '弱點加強');
  return chosen;
}

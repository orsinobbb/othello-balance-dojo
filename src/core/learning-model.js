const DAY_MS = 24 * 60 * 60 * 1000;

export const LearningEventType = Object.freeze({
  LESSON_STARTED: 'lesson_started',
  HINT_USED: 'hint_used',
  MOVE_ATTEMPTED: 'move_attempted',
  LESSON_COMPLETED: 'lesson_completed',
  ASSESSMENT_COMPLETED: 'assessment_completed'
});

export const MasteryState = Object.freeze({
  LEARNING: 'learning',
  RECOGNISABLE: 'recognisable',
  STABLE: 'stable',
  TRANSFER_READY: 'transfer_ready'
});

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function isoTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('Invalid event time');
  return date.toISOString();
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

export function createLearningEvent(input, { idFactory = defaultIdFactory, now = new Date() } = {}) {
  if (!input?.eventType) throw new Error('eventType is required');
  if (!input?.profileId) throw new Error('profileId is required');
  if (!input?.deviceId) throw new Error('deviceId is required');
  return Object.freeze({
    eventId: input.eventId || idFactory(),
    deviceId: input.deviceId,
    profileId: input.profileId,
    sessionId: input.sessionId || null,
    clientSeq: Number.isInteger(input.clientSeq) ? input.clientSeq : 0,
    occurredAt: isoTime(input.occurredAt || now),
    eventType: input.eventType,
    datasetId: input.datasetId || null,
    lessonId: input.lessonId || null,
    positionId: input.positionId || null,
    nodeId: input.nodeId ?? null,
    side: input.side || null,
    move: input.move || null,
    outcome: input.outcome || null,
    hintLevel: Math.max(0, Math.min(4, Number(input.hintLevel || 0))),
    latencyMs: Math.max(0, Number(input.latencyMs || 0)),
    conceptTags: uniqueStrings(input.conceptTags),
    criticality: Math.max(0.25, Math.min(1.5, Number(input.criticality || 1))),
    transfer: Boolean(input.transfer),
    schemaVersion: 1,
    appVersion: input.appVersion || 'web-v2',
    details: input.details && typeof input.details === 'object' ? input.details : {}
  });
}

function evidenceWeight(event) {
  const independence = Math.max(0.35, 1 - event.hintLevel * 0.18);
  const transfer = event.transfer ? 1.2 : 1;
  return Math.max(0.1, event.criticality * independence * transfer);
}

function stateFor(record) {
  const score = (record.successWeight + 1) / (record.evidenceWeight + 2);
  if (record.evidenceWeight >= 7 && record.independentSuccesses >= 3 && record.transferSuccesses >= 2 && score >= 0.82) {
    return { state: MasteryState.TRANSFER_READY, score };
  }
  if (record.evidenceWeight >= 4 && record.independentSuccesses >= 2 && score >= 0.74) {
    return { state: MasteryState.STABLE, score };
  }
  if (record.evidenceWeight >= 2 && score >= 0.62) return { state: MasteryState.RECOGNISABLE, score };
  return { state: MasteryState.LEARNING, score };
}

function reviewDelay(state, correct) {
  if (!correct) return 4 * 60 * 60 * 1000;
  return ({
    [MasteryState.LEARNING]: DAY_MS,
    [MasteryState.RECOGNISABLE]: 3 * DAY_MS,
    [MasteryState.STABLE]: 7 * DAY_MS,
    [MasteryState.TRANSFER_READY]: 14 * DAY_MS
  })[state] || DAY_MS;
}

function emptyTotals() {
  return { attempts: 0, valuePreserving: 0, failures: 0, hints: 0, completedLessons: 0, activeDays: 0, averageLatencyMs: 0 };
}

export function projectLearningState(events, { now = new Date() } = {}) {
  const ordered = [...(events || [])].sort((left, right) =>
    String(left.occurredAt).localeCompare(String(right.occurredAt)) || String(left.eventId).localeCompare(String(right.eventId)));
  const mastery = new Map();
  const reviews = new Map();
  const completed = new Map();
  const activeDays = new Set();
  const totals = emptyTotals();
  let latencyTotal = 0;
  let lastActivityAt = null;

  for (const event of ordered) {
    if (!event?.eventId || !event.occurredAt) continue;
    activeDays.add(event.occurredAt.slice(0, 10));
    lastActivityAt = event.occurredAt;
    if (event.eventType === LearningEventType.HINT_USED) totals.hints += 1;
    if (event.eventType === LearningEventType.LESSON_COMPLETED && event.lessonId) {
      const previous = completed.get(event.lessonId);
      completed.set(event.lessonId, {
        lessonId: event.lessonId,
        firstCompletedAt: previous?.firstCompletedAt || event.occurredAt,
        lastCompletedAt: event.occurredAt,
        completionCount: (previous?.completionCount || 0) + 1
      });
    }
    if (event.eventType !== LearningEventType.MOVE_ATTEMPTED) continue;

    totals.attempts += 1;
    latencyTotal += event.latencyMs || 0;
    const correct = event.outcome === 'value_preserving';
    if (correct) totals.valuePreserving += 1;
    else totals.failures += 1;
    const weight = evidenceWeight(event);

    for (const conceptId of uniqueStrings(event.conceptTags)) {
      const record = mastery.get(conceptId) || {
        conceptId, attempts: 0, successWeight: 0, failureWeight: 0, evidenceWeight: 0,
        independentSuccesses: 0, transferSuccesses: 0, lastSeenAt: null
      };
      record.attempts += 1;
      record.evidenceWeight += weight;
      if (correct) {
        record.successWeight += weight;
        if (event.hintLevel === 0) record.independentSuccesses += 1;
        if (event.transfer) record.transferSuccesses += 1;
      } else {
        record.failureWeight += weight;
      }
      record.lastSeenAt = event.occurredAt;
      Object.assign(record, stateFor(record));
      mastery.set(conceptId, record);
    }

    const itemId = event.lessonId || event.positionId || `${event.datasetId}:${event.nodeId}`;
    if (itemId) {
      const weakestState = uniqueStrings(event.conceptTags)
        .map((tag) => mastery.get(tag)?.state || MasteryState.LEARNING)
        .sort((left, right) => Object.values(MasteryState).indexOf(left) - Object.values(MasteryState).indexOf(right))[0]
        || MasteryState.LEARNING;
      reviews.set(itemId, {
        itemId,
        lessonId: event.lessonId,
        positionId: event.positionId,
        reason: correct ? 'spaced_review' : 'mistake',
        dueAt: new Date(new Date(event.occurredAt).getTime() + reviewDelay(weakestState, correct)).toISOString(),
        lastOutcome: event.outcome,
        conceptTags: uniqueStrings(event.conceptTags)
      });
    }
  }

  totals.completedLessons = completed.size;
  totals.activeDays = activeDays.size;
  totals.averageLatencyMs = totals.attempts ? Math.round(latencyTotal / totals.attempts) : 0;
  const nowMs = new Date(now).getTime();
  const reviewQueue = [...reviews.values()].sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  return {
    schemaVersion: 1,
    generatedAt: isoTime(now),
    lastActivityAt,
    totals,
    completedLessons: [...completed.values()],
    mastery: [...mastery.values()].sort((left, right) => left.score - right.score || left.conceptId.localeCompare(right.conceptId)),
    reviewQueue,
    dueReviews: reviewQueue.filter((item) => new Date(item.dueAt).getTime() <= nowMs)
  };
}

export function mergeEventSets(...sets) {
  const merged = new Map();
  for (const event of sets.flat()) {
    if (event?.eventId && !merged.has(event.eventId)) merged.set(event.eventId, event);
  }
  return [...merged.values()].sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));
}

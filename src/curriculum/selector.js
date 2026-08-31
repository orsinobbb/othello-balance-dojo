const FEATURE_WEIGHTS = Object.freeze({
  family: 2,
  theory: 2.5,
  difficulty: 1.5,
  choice: 1,
  calculation: 1.5,
  legal: 0.75
});

function featurePrefix(feature) {
  return feature.slice(0, feature.indexOf(':'));
}
export function lessonFeatures(lesson) {
  return [
    `family:${lesson.primaryTheoryFamily || 'calculation'}`,
    `theory:${lesson.primaryTheoryId || 'none'}`,
    `difficulty:${lesson.difficulty}`,
    `choice:${lesson.balancedMoveCount === 1 ? 'unique' : 'multiple'}`,
    `calculation:${lesson.calculationRequired ? 'required' : 'supported'}`,
    `legal:${lesson.legalMoveCount <= 5 ? 'small' : lesson.legalMoveCount <= 8 ? 'medium' : 'large'}`
  ];
}

function splitTarget(total, keys, ratios = null) {
  const result = new Map();
  if (keys.length === 0) return result;
  const weights = keys.map((key) => ratios?.[key] ?? 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  keys.forEach((key, index) => result.set(key, Math.max(1, Math.round(total * weights[index] / weightTotal))));
  return result;
}

export function buildFeatureTargets(candidates, lessonCount) {
  const byPrefix = new Map();
  for (const candidate of candidates) {
    for (const feature of lessonFeatures(candidate)) {
      const prefix = featurePrefix(feature);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
      byPrefix.get(prefix).add(feature);
    }
  }

  const ratios = {
    difficulty: {
      'difficulty:foundation': 0.25,
      'difficulty:intermediate': 0.45,
      'difficulty:advanced': 0.30
    },
    calculation: {
      'calculation:required': 0.35,
      'calculation:supported': 0.65
    },
    legal: {
      'legal:small': 0.25,
      'legal:medium': 0.50,
      'legal:large': 0.25
    }
  };
  const targets = new Map();
  for (const [prefix, values] of byPrefix) {
    const keys = [...values].sort();
    for (const [key, value] of splitTarget(lessonCount, keys, ratios[prefix])) targets.set(key, value);
  }
  return targets;
}

function addCoverage(coverage, candidates) {
  for (const candidate of candidates) {
    for (const feature of lessonFeatures(candidate)) coverage.set(feature, (coverage.get(feature) || 0) + 1);
  }
}

function marginalScore(candidates, coverage, targets) {
  const local = new Map();
  for (const candidate of candidates) {
    for (const feature of lessonFeatures(candidate)) local.set(feature, (local.get(feature) || 0) + 1);
  }
  let score = 0;
  for (const [feature, available] of local) {
    const target = targets.get(feature) || 1;
    const deficit = Math.max(0, target - (coverage.get(feature) || 0));
    const weight = FEATURE_WEIGHTS[featurePrefix(feature)] || 1;
    score += weight * Math.min(deficit, available) / target;
  }
  return score;
}

export function selectShardIds(candidates, shardInfo, { lessonCount, maxShards, pinnedShardIds = [] }) {
  const targets = buildFeatureTargets(candidates, lessonCount);
  const groups = new Map();
  for (const candidate of candidates) {
    if (!groups.has(candidate.sourceShardId)) groups.set(candidate.sourceShardId, []);
    groups.get(candidate.sourceShardId).push(candidate);
  }
  const infoById = new Map(shardInfo.map((item) => [item.id, item]));
  const selected = [];
  const coverage = new Map();
  for (const id of pinnedShardIds) {
    if (!groups.has(id) || selected.includes(id)) continue;
    selected.push(id);
    addCoverage(coverage, groups.get(id));
  }

  const limit = Math.min(Math.max(1, maxShards), groups.size);
  while (selected.length < limit) {
    let best = null;
    for (const [id, lessons] of groups) {
      if (selected.includes(id)) continue;
      const bytes = infoById.get(id)?.bytes || 0;
      const score = marginalScore(lessons, coverage, targets) / (1 + bytes / 4_000_000);
      if (!best || score > best.score || (score === best.score && id < best.id)) best = { id, score, lessons };
    }
    if (!best) break;
    selected.push(best.id);
    addCoverage(coverage, best.lessons);
  }
  return selected;
}

function candidateScore(candidate, coverage, targets) {
  let score = 0;
  for (const feature of lessonFeatures(candidate)) {
    const target = targets.get(feature) || 1;
    const deficit = Math.max(0, target - (coverage.get(feature) || 0));
    const weight = FEATURE_WEIGHTS[featurePrefix(feature)] || 1;
    score += weight * deficit / target;
  }
  score += Math.min(20, candidate.difficultyScore || 0) / 1000;
  return score;
}

export function selectLessons(candidates, lessonCount, { pinnedRoots = [] } = {}) {
  if (candidates.length < lessonCount) throw new Error(`Need ${lessonCount} candidates, received ${candidates.length}`);
  const targets = buildFeatureTargets(candidates, lessonCount);
  const pinned = new Set(pinnedRoots);
  const selected = candidates.filter((candidate) => pinned.has(candidate.root));
  const selectedRoots = new Set(selected.map((candidate) => candidate.root));
  const coverage = new Map();
  addCoverage(coverage, selected);

  while (selected.length < lessonCount) {
    let best = null;
    for (const candidate of candidates) {
      if (selectedRoots.has(candidate.root)) continue;
      const score = candidateScore(candidate, coverage, targets);
      if (!best || score > best.score || (score === best.score && candidate.root.localeCompare(best.candidate.root) < 0)) {
        best = { candidate, score };
      }
    }
    if (!best) throw new Error('Unable to fill lesson selection');
    selected.push(best.candidate);
    selectedRoots.add(best.candidate.root);
    addCoverage(coverage, [best.candidate]);
  }
  return selected;
}

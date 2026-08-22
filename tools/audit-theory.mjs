import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExactTeachingSession } from '../src/core/session.js';
import { analyzeTurn } from '../src/core/teaching.js';
import { NativeBalancedDag } from '../src/data/native-balanced-dag.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(await readFile(path.join(root, 'data', 'release-manifest.json'), 'utf8'));
const dags = new Map();
const primaryCounts = new Map();
const familyCounts = new Map();
const result = {
  lessons: release.lessons.length,
  top1Balanced: 0,
  top3ContainsBalanced: 0,
  top4ContainsAllBalanced: 0,
  blindStrongRecommendations: 0,
  blindStrongRecommendationFailures: 0,
  safeSelectionErrors: 0,
  noPositiveTheory: 0
};

for (const lesson of release.lessons) {
  let dag = dags.get(lesson.shardId);
  if (!dag) {
    const filename = `shard-${String(lesson.shardId).padStart(6, '0')}.otbdag`;
    dag = new NativeBalancedDag(await readFile(path.join(root, 'data', 'shards', filename)));
    dags.set(lesson.shardId, dag);
  }
  const session = new ExactTeachingSession(dag, dag.root(lesson.rootIndex), { control: 'both' });
  const analysis = analyzeTurn(session);
  const ranked = analysis.theory.ranked;
  if (ranked[0]?.balanced) result.top1Balanced += 1;
  if (ranked.slice(0, 3).some((fact) => fact.balanced)) result.top3ContainsBalanced += 1;
  if (analysis.balanced.every((fact) => ranked.slice(0, 4).includes(fact))) result.top4ContainsAllBalanced += 1;
  if (analysis.theory.blindStrongRecommendation) {
    result.blindStrongRecommendations += 1;
    if (!ranked[0]?.balanced) result.blindStrongRecommendationFailures += 1;
  }
  if (!analysis.theory.selected?.balanced) result.safeSelectionErrors += 1;
  const primary = analysis.theory.primaryTheory;
  if (!primary) {
    result.noPositiveTheory += 1;
  } else {
    primaryCounts.set(primary.id, (primaryCounts.get(primary.id) || 0) + 1);
    familyCounts.set(primary.family, (familyCounts.get(primary.family) || 0) + 1);
  }
}

const percent = (count) => `${(count * 100 / result.lessons).toFixed(1)}%`;
console.log(JSON.stringify({
  ...result,
  top1Rate: percent(result.top1Balanced),
  top3Coverage: percent(result.top3ContainsBalanced),
  top4AllBalancedCoverage: percent(result.top4ContainsAllBalanced),
  blindStrongRecommendationFailureRate: result.blindStrongRecommendations === 0
    ? '0.0%'
    : `${(result.blindStrongRecommendationFailures * 100 / result.blindStrongRecommendations).toFixed(1)}%`,
  primaryTheories: Object.fromEntries([...primaryCounts].sort((left, right) => right[1] - left[1])),
  primaryFamilies: Object.fromEntries([...familyCounts].sort((left, right) => right[1] - left[1]))
}, null, 2));

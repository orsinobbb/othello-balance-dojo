import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExactTeachingSession } from '../src/core/session.js';
import { analyzeTurn } from '../src/core/teaching.js';
import { THEORY_CATALOG_VERSION } from '../src/core/theory-catalog.js';
import { NativeBalancedDag } from '../src/data/native-balanced-dag.js';
import { selectLessons, selectShardIds } from '../src/curriculum/selector.js';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(name, fallback) {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function difficultyFor(analysis) {
  const unique = analysis.balanced.length === 1;
  const score = analysis.legalCount
    + analysis.failures.length * 1.5
    + (unique ? 3 : 0)
    + (analysis.theory.calculationRequired ? 8 : 0)
    + Math.min(4, analysis.regions.length);
  return { difficulty: null, difficultyScore: round(score, 1) };
}

function quantile(sorted, fraction) {
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function calibrateDifficulty(catalog) {
  const scores = catalog.map((item) => item.difficultyScore).sort((left, right) => left - right);
  const foundationMaximum = quantile(scores, 0.25);
  const intermediateMaximum = quantile(scores, 0.70);
  for (const item of catalog) {
    item.difficulty = item.difficultyScore <= foundationMaximum
      ? 'foundation'
      : item.difficultyScore <= intermediateMaximum ? 'intermediate' : 'advanced';
  }
  return { foundationMaximum, intermediateMaximum };
}

function summarizeRoot(sourceShard, rootIndex, root, dag) {
  const session = new ExactTeachingSession(dag, dag.root(rootIndex), { control: 'both' });
  const analysis = analyzeTurn(session);
  const primary = analysis.theory.primaryTheory;
  const { difficulty, difficultyScore } = difficultyFor(analysis);
  return {
    root,
    sourceShardId: sourceShard.id,
    sourceGraph: sourceShard.graph,
    rootIndex,
    rootNodeId: dag.root(rootIndex),
    analyzedNodeId: session.nodeId,
    empties: session.empties,
    legalMoveCount: analysis.legalCount,
    balancedMoveCount: analysis.balanced.length,
    failureMoveCount: analysis.failures.length,
    regionSizes: analysis.regions.map((region) => region.size),
    primaryTheoryId: primary?.id || null,
    primaryTheoryFamily: primary?.family || null,
    primaryTheoryTitle: primary?.title || null,
    theoryIds: analysis.theory.explanatoryTheories.slice(0, 5).map((theory) => theory.id),
    heuristicAgreement: analysis.theory.heuristicAgreement,
    calculationRequired: analysis.theory.calculationRequired,
    difficulty,
    difficultyScore
  };
}

function countBy(values, key) {
  const result = {};
  for (const value of values) {
    const label = typeof key === 'function' ? key(value) : value[key];
    result[label ?? 'none'] = (result[label ?? 'none'] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.resolve(projectRoot, argument('--source', '../../data/e20-balanced/v1'));
const catalogRoot = path.resolve(projectRoot, argument('--catalog-output', '../../data/e20-teaching-curriculum/v1'));
const lessonCount = positiveInteger('--lessons', 100);
const maxShards = positiveInteger('--max-shards', 10);
const sourceManifestPath = path.join(sourceRoot, 'manifest.json');
const sourceManifestBytes = await readFile(sourceManifestPath);
const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
const sourceManifestSha256 = createHash('sha256').update(sourceManifestBytes).digest('hex');

const catalog = [];
for (let index = 0; index < sourceManifest.shards.length; index += 1) {
  const sourceShard = sourceManifest.shards[index];
  const graphPath = path.join(sourceRoot, ...sourceShard.graph.split('/'));
  const bytes = await readFile(graphPath);
  const dag = new NativeBalancedDag(bytes);
  if (dag.rootCount !== sourceShard.roots.length) throw new Error(`Root mismatch in source shard ${sourceShard.id}`);
  sourceShard.roots.forEach((root, rootIndex) => catalog.push(summarizeRoot(sourceShard, rootIndex, root, dag)));
  if ((index + 1) % 200 === 0) process.stderr.write(`Analyzed ${index + 1}/${sourceManifest.shards.length} shards\n`);
}
const difficultyThresholds = calibrateDifficulty(catalog);

const pinnedRoot = sourceManifest.shards[0].roots[0];
const requiredRoots = [pinnedRoot];
const primaryTheories = [...new Set(catalog.map((item) => item.primaryTheoryId || 'none'))].sort();
for (const theoryId of primaryTheories) {
  const representative = catalog
    .filter((item) => (item.primaryTheoryId || 'none') === theoryId)
    .sort((left, right) => left.difficultyScore - right.difficultyScore || left.root.localeCompare(right.root))[0];
  if (representative && !requiredRoots.includes(representative.root)) requiredRoots.push(representative.root);
}
const requiredShardIds = [...new Set(requiredRoots.map((root) => catalog.find((item) => item.root === root).sourceShardId))];
if (requiredShardIds.length > maxShards) {
  throw new Error(`--max-shards ${maxShards} cannot cover ${requiredShardIds.length} required primary theories`);
}
const selectedShardIds = selectShardIds(catalog, sourceManifest.shards, {
  lessonCount,
  maxShards,
  pinnedShardIds: requiredShardIds
});
const selectedShardSet = new Set(selectedShardIds);
const selected = selectLessons(
  catalog.filter((lesson) => selectedShardSet.has(lesson.sourceShardId)),
  lessonCount,
  { pinnedRoots: requiredRoots }
);
const difficultyOrder = { foundation: 0, intermediate: 1, advanced: 2 };
selected.sort((left, right) => {
  if (left.root === pinnedRoot) return -1;
  if (right.root === pinnedRoot) return 1;
  return difficultyOrder[left.difficulty] - difficultyOrder[right.difficulty]
    || Number(left.calculationRequired) - Number(right.calculationRequired)
    || left.difficultyScore - right.difficultyScore
    || left.root.localeCompare(right.root);
});

await mkdir(catalogRoot, { recursive: true });
await writeFile(path.join(catalogRoot, 'lessons.jsonl'), `${catalog.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
const catalogManifest = {
  format: 'OTHELLO_CURRICULUM_CATALOG_V1',
  sourceManifestSha256,
  theoryCatalogVersion: THEORY_CATALOG_VERSION,
  generatedAt: new Date().toISOString(),
  roots: catalog.length,
  sourceShards: sourceManifest.shards.length,
  difficultyThresholds,
  distributions: {
    difficulty: countBy(catalog, 'difficulty'),
    primaryTheoryFamily: countBy(catalog, 'primaryTheoryFamily'),
    calculationRequired: countBy(catalog, (item) => String(item.calculationRequired)),
    balancedMoveCount: countBy(catalog, (item) => String(item.balancedMoveCount))
  }
};
await writeFile(path.join(catalogRoot, 'manifest.json'), `${JSON.stringify(catalogManifest, null, 2)}\n`, 'utf8');

const outputRoot = path.join(projectRoot, 'data');
const outputShards = path.join(outputRoot, 'shards');
await mkdir(outputShards, { recursive: true });
const shards = [];
for (const shardId of selectedShardIds.sort((left, right) => left - right)) {
  const sourceShard = sourceManifest.shards.find((item) => item.id === shardId);
  const sourceGraph = path.join(sourceRoot, ...sourceShard.graph.split('/'));
  const bytes = await readFile(sourceGraph);
  const padded = String(shardId).padStart(6, '0');
  const outputName = `shard-${padded}.otbdag`;
  await copyFile(sourceGraph, path.join(outputShards, outputName));
  shards.push({
    id: shardId,
    url: `shards/${outputName}`,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    roots: sourceShard.roots
  });
}

const lessons = selected.map((item, index) => ({
  id: `e20-${item.root}`,
  number: index + 1,
  shardId: item.sourceShardId,
  rootIndex: item.rootIndex,
  root: item.root,
  empties: item.empties,
  phase: 'endgame',
  evidence: 'exact-e20-to-terminal',
  title: index === 0 ? 'C1 搶手數' : item.primaryTheoryTitle || undefined,
  pedagogy: {
    difficulty: item.difficulty,
    difficultyScore: item.difficultyScore,
    legalMoveCount: item.legalMoveCount,
    balancedMoveCount: item.balancedMoveCount,
    failureMoveCount: item.failureMoveCount,
    primaryTheoryId: item.primaryTheoryId,
    primaryTheoryFamily: item.primaryTheoryFamily,
    theoryIds: item.theoryIds,
    heuristicAgreement: item.heuristicAgreement,
    calculationRequired: item.calculationRequired,
    regionSizes: item.regionSizes
  }
}));
const releaseFingerprint = createHash('sha256').update(lessons.map((lesson) => lesson.id).join('\n')).digest('hex').slice(0, 12);
const manifest = {
  format: 'OTHELLO_TEACHING_RELEASE_V1',
  datasetId: `e20-curriculum-${lessonCount}-${releaseFingerprint}`,
  graphFormat: 'OTBDAG01',
  evidence: 'exact-e20-to-terminal',
  selection: {
    strategy: 'diverse-v1',
    catalogRoots: catalog.length,
    theoryCatalogVersion: THEORY_CATALOG_VERSION,
    sourceManifestSha256,
    maxShards,
    difficultyThresholds
  },
  lessonCount,
  generatedAt: new Date().toISOString(),
  distributions: {
    difficulty: countBy(selected, 'difficulty'),
    primaryTheoryFamily: countBy(selected, 'primaryTheoryFamily'),
    primaryTheory: countBy(selected, 'primaryTheoryId'),
    calculationRequired: countBy(selected, (item) => String(item.calculationRequired)),
    balancedMoveCount: countBy(selected, (item) => String(item.balancedMoveCount))
  },
  lessons,
  shards
};
await writeFile(path.join(outputRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  datasetId: manifest.datasetId,
  catalogRoots: catalog.length,
  lessons: lessons.length,
  shards: shards.length,
  bytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
  distributions: manifest.distributions
}));

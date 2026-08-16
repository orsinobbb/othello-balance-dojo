import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.resolve(projectRoot, argument('--source', '../../data/e20-balanced/v1'));
const lessonCount = Number(argument('--lessons', '100'));
if (!Number.isInteger(lessonCount) || lessonCount < 1) throw new Error('--lessons 必須是正整數');

const outputRoot = path.join(projectRoot, 'data');
const outputShards = path.join(outputRoot, 'shards');
await mkdir(outputShards, { recursive: true });

const shards = [];
const lessons = [];
let remaining = lessonCount;
let shardId = 1;

while (remaining > 0) {
  const padded = String(shardId).padStart(6, '0');
  const sourceDir = path.join(sourceRoot, 'shards', `shard-${padded}`);
  const status = JSON.parse(await readFile(path.join(sourceDir, 'status.json'), 'utf8'));
  if (status.state !== 'completed') throw new Error(`shard-${padded} 尚未完成`);

  const roots = (await readFile(path.join(sourceDir, 'roots.txt'), 'utf8'))
    .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const sourceGraph = path.join(sourceDir, `graph-round-${String(status.round).padStart(5, '0')}.otbdag`);
  const outputName = `shard-${padded}.otbdag`;
  const outputGraph = path.join(outputShards, outputName);
  const bytes = await readFile(sourceGraph);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await copyFile(sourceGraph, outputGraph);

  shards.push({ id: shardId, url: `shards/${outputName}`, bytes: bytes.byteLength, sha256, roots });
  const take = Math.min(remaining, roots.length);
  for (let rootIndex = 0; rootIndex < take; rootIndex += 1) {
    const root = roots[rootIndex];
    lessons.push({
      id: `e20-${root}`,
      number: lessons.length + 1,
      shardId,
      rootIndex,
      root,
      empties: 20,
      phase: 'endgame',
      evidence: 'exact-e20-to-terminal',
      ...(lessons.length === 0 ? { title: 'C1 搶手數' } : {})
    });
  }
  remaining -= take;
  shardId += 1;
}

const releaseFingerprint = createHash('sha256')
  .update(lessons.map((lesson) => lesson.id).join('\n'))
  .digest('hex').slice(0, 12);
const manifest = {
  format: 'OTHELLO_TEACHING_RELEASE_V1',
  datasetId: `e20-lessons-${lessonCount}-${releaseFingerprint}`,
  graphFormat: 'OTBDAG01',
  evidence: 'exact-e20-to-terminal',
  lessonCount,
  generatedAt: new Date().toISOString(),
  lessons,
  shards
};
await writeFile(path.join(outputRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ datasetId: manifest.datasetId, lessons: lessons.length, shards: shards.length, bytes: shards.reduce((sum, shard) => sum + shard.bytes, 0) }));

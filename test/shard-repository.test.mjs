import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ShardRepository } from '../src/data/shard-repository.js';

const projectRoot = new URL('../', import.meta.url);

async function localFetch(url) {
  const pathname = new URL(url, 'http://local/').pathname.replace(/^\//, '');
  try {
    const bytes = await readFile(new URL(pathname, projectRoot));
    return new Response(bytes, { status: 200 });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

test('lesson catalog loads shards only when a lesson needs them', async () => {
  const repository = new ShardRepository(localFetch);
  const release = await repository.loadRelease('http://local/data/release-manifest.json');
  assert.equal(release.lessonCount, 100);
  assert.equal(repository.loadedShardCount(release), 0);

  const first = await repository.loadLesson(release, release.lessons[0]);
  assert.equal(first.shard.id, 1);
  assert.equal(repository.loadedShardCount(release), 1);

  const seventeenth = await repository.loadLesson(release, release.lessons[16]);
  assert.equal(seventeenth.shard.id, 2);
  assert.equal(repository.loadedShardCount(release), 2);
  await repository.loadLesson(release, release.lessons[17]);
  assert.equal(repository.loadedShardCount(release), 2);
});

import { NativeBalancedDag } from './native-balanced-dag.js';

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) throw new Error('此瀏覽器不支援 Web Crypto SHA-256');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export class ShardRepository {
  constructor(fetchFn = (...args) => globalThis.fetch(...args)) {
    this.fetchFn = fetchFn;
    this.cache = new Map();
  }

  async loadRelease(manifestUrl) {
    const response = await this.fetchFn(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`無法載入資料清單：HTTP ${response.status}`);
    const manifest = await response.json();
    if (manifest.format !== 'OTHELLO_TEACHING_RELEASE_V1') {
      throw new Error(`不支援的資料格式：${manifest.format || 'unknown'}`);
    }
    const pageUrl = globalThis.location ? globalThis.location.href : 'http://localhost/';
    manifest.baseUrl = new URL('.', new URL(manifestUrl, pageUrl)).href;
    return manifest;
  }

  async loadShard(release, shard) {
    const key = `${release.datasetId}:${shard.id}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const url = new URL(shard.url, release.baseUrl).href;
    const response = await this.fetchFn(url);
    if (!response.ok) throw new Error(`無法載入分片：HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== shard.bytes) {
      throw new Error(`分片大小不符：預期 ${shard.bytes}，實際 ${buffer.byteLength}`);
    }
    const digest = await sha256Hex(buffer);
    if (digest !== shard.sha256.toLowerCase()) throw new Error('分片 SHA-256 完整性驗證失敗');
    const dag = new NativeBalancedDag(buffer);
    if (dag.rootCount !== shard.roots.length) throw new Error('分片起始盤數與清單不符');
    const loaded = { dag, shard, url };
    this.cache.set(key, loaded);
    return loaded;
  }
}

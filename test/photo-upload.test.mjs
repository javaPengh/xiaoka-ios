import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../src/offline/repository.mjs';

async function device(t, remote) {
  const states = new Map(), blobs = new Map();
  const storage = {
    async load(key) { return structuredClone(states.get(key) || null); },
    async save(key, value) { states.set(key, structuredClone(value)); },
    async putBlob(partition, id, blob) { blobs.set(partition + id, blob); },
    async getBlob(partition, id) { return blobs.get(partition + id) || null; },
  };
  const repo = new LocalRepository({ storage, partition: 'photo-upload-test', remote });
  repo.schedule = () => {};
  t.after(() => repo.close());
  await repo.ready;
  const { photoId } = await repo.storePhoto('data:image/jpeg;base64,' + btoa('synthetic-photo-test-bytes'));
  return { repo, photoId };
}

test('后台同步与开始分析共用同一照片上传，成功回执后才调用模型', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const uploadStarted = new Promise(resolve => { started = resolve; });
  const calls = [];
  const { repo, photoId } = await device(t, async (route, options) => {
    calls.push(route);
    if (route === 'sync/photos') {
      started();
      await gate;
      return { photoId: JSON.parse(options.body).photoId };
    }
    assert.equal(route, 'ai/recognize');
    assert.equal(repo.state.photos[photoId].confirmed, true);
    return { summary: '测试结果', date: '2026-11-13', meal: 'lunch', items: [] };
  });
  const background = repo.uploadPhotos();
  await uploadStarted;
  const recognition = repo.request('ai/recognize', { method: 'POST', body: JSON.stringify({ photoId, date: '2026-11-13', meal: 'lunch' }) });
  try {
    await new Promise(setImmediate);
    assert.deepEqual(calls, ['sync/photos']);
    assert.equal(repo.state.photos[photoId].confirmed, false);
  } finally {
    release();
    await Promise.allSettled([background, recognition]);
  }
  await Promise.all([background, recognition]);
  assert.deepEqual(calls, ['sync/photos', 'ai/recognize']);
  assert.equal(repo.status().pending, 0);
  await repo.ensurePhoto(photoId);
  assert.equal(calls.length, 2);
});

test('共用上传失败时保留原图且不调用模型，手动重试可以恢复', async t => {
  let release, started, fail = true;
  const gate = new Promise(resolve => { release = resolve; });
  const uploadStarted = new Promise(resolve => { started = resolve; });
  const calls = [], failure = new Error('模拟上传超时');
  const { repo, photoId } = await device(t, async (route) => {
    calls.push(route);
    if (route === 'sync/photos') {
      started();
      await gate;
      if (fail) throw failure;
      return { photoId };
    }
    assert.equal(route, 'ai/recognize');
    return { summary: '重试成功', date: '2026-11-13', meal: 'lunch', items: [] };
  });
  const background = repo.uploadPhotos();
  await uploadStarted;
  const recognition = repo.request('ai/recognize', { method: 'POST', body: JSON.stringify({ photoId, date: '2026-11-13', meal: 'lunch' }) });
  const settled = Promise.allSettled([background, recognition]);
  await new Promise(setImmediate);
  release();
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure));
  assert.deepEqual(calls, ['sync/photos']);
  assert.equal(repo.state.photos[photoId].confirmed, false);
  assert.equal(repo.status().pending, 1);
  assert.ok(await repo.storage.getBlob(repo.partition, photoId));
  assert.equal((await repo.request('backup')).photos.length, 1);
  fail = false;
  await repo.request('ai/recognize', { method: 'POST', body: JSON.stringify({ photoId, date: '2026-11-13', meal: 'lunch' }) });
  assert.deepEqual(calls, ['sync/photos', 'sync/photos', 'ai/recognize']);
  assert.equal(repo.state.photos[photoId].confirmed, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runDetectors } from '../server/detectors/index.js';
import sightengine from '../server/detectors/sightengine.js';
import aiornot from '../server/detectors/aiornot.js';
import huggingface, { scoreFromLabels } from '../server/detectors/huggingface.js';
import { firstNumber, classifyStatus } from '../server/detectors/shared.js';

const imageFile = { buffer: Buffer.from('fake-image'), filename: 'a.png', mimetype: 'image/png', kind: 'image' };
const audioFile = { buffer: Buffer.from('fake-audio'), filename: 'a.mp3', mimetype: 'audio/mpeg', kind: 'audio' };

/** Replace global fetch for the duration of one call. */
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (body, status = 200) =>
  async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('unconfigured tools report why, and score nothing', async () => {
  const results = await runDetectors(imageFile, {});
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(result.status, 'not_configured');
    assert.equal(result.score, null);
    assert.match(result.message, /Not configured/);
  }
});

test('image-only tools are skipped for audio, not scored zero', async () => {
  const results = await runDetectors(audioFile, { AIORNOT_API_KEY: 'k', HUGGINGFACE_API_KEY: 'k' });
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId.sightengine.status, 'unsupported');
  assert.equal(byId.sightengine.score, null);
  assert.notEqual(byId.aiornot.status, 'unsupported');
  assert.notEqual(byId.huggingface.status, 'unsupported', 'Hugging Face covers audio too');
});

test('demo mode fills unconfigured tools with labelled, deterministic scores', async () => {
  const first = await runDetectors(imageFile, { DEMO_MODE: 'true' });
  const second = await runDetectors(imageFile, { DEMO_MODE: 'true' });
  for (const result of first) {
    assert.equal(result.status, 'demo');
    assert.equal(result.demo, true);
    assert.ok(result.score >= 0 && result.score <= 100);
  }
  assert.deepEqual(first.map((r) => r.score), second.map((r) => r.score), 'same file scores the same every run');

  const other = await runDetectors({ ...imageFile, buffer: Buffer.from('different') }, { DEMO_MODE: 'true' });
  assert.notDeepEqual(first.map((r) => r.score), other.map((r) => r.score));
});

test('a failing tool does not fail the batch', async () => {
  const results = await withFetch(
    async () => new Response('nope', { status: 500 }),
    () => runDetectors(imageFile, { SIGHTENGINE_API_USER: 'u', SIGHTENGINE_API_SECRET: 's' }),
  );
  const sight = results.find((r) => r.id === 'sightengine');
  assert.equal(sight.status, 'error');
  assert.equal(sight.score, null);
  assert.equal(results.length, 3);
});

test('sightengine reads type.ai_generated', async () => {
  const { raw } = await withFetch(
    jsonResponse({ status: 'success', type: { ai_generated: 0.93 } }),
    () => sightengine.analyze(imageFile, { SIGHTENGINE_API_USER: 'u', SIGHTENGINE_API_SECRET: 's' }, {}),
  );
  assert.equal(raw, 0.93);
});

test('sightengine surfaces a 200-with-failure body as a quota error', async () => {
  await assert.rejects(
    () => withFetch(
      jsonResponse({ status: 'failure', error: { message: 'Not enough credits for this operation' } }),
      () => sightengine.analyze(imageFile, { SIGHTENGINE_API_USER: 'u', SIGHTENGINE_API_SECRET: 's' }, {}),
    ),
    (error) => error.code === 'quota',
  );
});

test('ai or not reads a nested confidence, and falls back to the verdict', async () => {
  const scored = await withFetch(
    jsonResponse({ report: { ai: { confidence: 0.12 } } }),
    () => aiornot.analyze(audioFile, { AIORNOT_API_KEY: 'k' }, {}),
  );
  assert.equal(scored.raw, 0.12);

  const coarse = await withFetch(
    jsonResponse({ report: { verdict: 'ai' } }),
    () => aiornot.analyze(audioFile, { AIORNOT_API_KEY: 'k' }, {}),
  );
  assert.equal(coarse.raw, 1);
  assert.equal(coarse.coarse, true);
});

test('hugging face reads the AI label out of a classification list', async () => {
  const { raw, model } = await withFetch(
    jsonResponse([{ label: 'artificial', score: 0.91 }, { label: 'human', score: 0.09 }]),
    () => huggingface.analyze(imageFile, { HUGGINGFACE_API_KEY: 'k' }, {}),
  );
  assert.equal(raw, 0.91);
  assert.equal(model, 'Organika/sdxl-detector');
});

test('hugging face posts a raw binary body with the media type, not multipart', async () => {
  let seen;
  await withFetch(
    async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify([{ label: 'fake', score: 0.5 }]), { status: 200 });
    },
    () => huggingface.analyze(audioFile, { HUGGINGFACE_API_KEY: 'k' }, {}),
  );
  assert.match(seen.url, /router\.huggingface\.co\/hf-inference\/models\/MelodyMachine/);
  assert.equal(seen.init.headers['Content-Type'], 'audio/mpeg');
  assert.equal(seen.init.headers.Authorization, 'Bearer k');
  assert.ok(Buffer.isBuffer(seen.init.body), 'the file is the body itself');
});

test('hugging face accepts HF_TOKEN as well as HUGGINGFACE_API_KEY', () => {
  assert.equal(huggingface.isConfigured({ HF_TOKEN: 'k' }), true);
  assert.equal(huggingface.isConfigured({ HUGGINGFACE_API_KEY: 'k' }), true);
  assert.equal(huggingface.isConfigured({}), false);
});

test('hugging face models are configurable per media type', () => {
  const env = { HUGGINGFACE_IMAGE_MODEL: 'me/my-image-model', HUGGINGFACE_AUDIO_MODEL: 'me/my-audio-model' };
  assert.equal(huggingface.modelFor(env, 'image'), 'me/my-image-model');
  assert.equal(huggingface.modelFor(env, 'audio'), 'me/my-audio-model');
  assert.equal(huggingface.modelFor({}, 'image'), 'Organika/sdxl-detector');
});

test('hugging face waits out a cold model and retries once', async () => {
  let calls = 0;
  const { raw } = await withFetch(
    async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ error: 'Model is currently loading', estimated_time: 0.01 }), { status: 503 })
        : new Response(JSON.stringify([{ label: 'artificial', score: 0.6 }]), { status: 200 });
    },
    () => huggingface.analyze(imageFile, { HUGGINGFACE_API_KEY: 'k' }, {}),
  );
  assert.equal(calls, 2);
  assert.equal(raw, 0.6);
});

test('scoreFromLabels handles each label vocabulary', () => {
  assert.equal(scoreFromLabels([{ label: 'artificial', score: 0.8 }, { label: 'human', score: 0.2 }]), 0.8);
  assert.equal(scoreFromLabels([{ label: 'fake', score: 0.7 }, { label: 'real', score: 0.3 }]), 0.7);
  assert.equal(scoreFromLabels([{ label: 'Spoof', score: 0.9 }, { label: 'bonafide', score: 0.1 }]), 0.9);
  assert.equal(scoreFromLabels([{ label: 'AI-Generated', score: 0.4 }, { label: 'Real', score: 0.6 }]), 0.4);
});

test('scoreFromLabels infers AI as the remainder when only the human label is known', () => {
  assert.equal(scoreFromLabels([{ label: 'human', score: 0.25 }, { label: 'nsfw', score: 0.75 }]), 0.75);
});

test('scoreFromLabels refuses to guess at unrecognizable labels', () => {
  assert.throws(
    () => scoreFromLabels([{ label: 'LABEL_0', score: 0.9 }, { label: 'LABEL_1', score: 0.1 }], 'audio'),
    (error) => error.code === 'parse' && /LABEL_0/.test(error.message) && /HUGGINGFACE_AUDIO_MODEL/.test(error.message),
  );
});

test('firstNumber walks the known paths in order', () => {
  assert.equal(firstNumber({ report: { confidence: 0.5 } }, ['report.ai.confidence', 'report.confidence']), 0.5);
  assert.equal(firstNumber({ score: '0.7' }, ['score']), 0.7);
  assert.equal(firstNumber({ score: null }, ['score']), undefined);
});

test('HTTP statuses map to the reason a user cares about', () => {
  assert.equal(classifyStatus(401, '').code, 'auth');
  assert.equal(classifyStatus(429, '').code, 'rate_limit');
  assert.equal(classifyStatus(402, '').code, 'quota');
  assert.equal(classifyStatus(200, 'monthly quota exceeded').code, 'quota');
  assert.equal(classifyStatus(500, 'boom').code, 'upstream');
});

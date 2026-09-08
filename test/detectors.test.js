import test from 'node:test';
import assert from 'node:assert/strict';
import { runDetectors } from '../server/detectors/index.js';
import sightengine from '../server/detectors/sightengine.js';
import aiornot from '../server/detectors/aiornot.js';
import illuminarty from '../server/detectors/illuminarty.js';
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
  const results = await runDetectors(audioFile, { AIORNOT_API_KEY: 'k' });
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId.sightengine.status, 'unsupported');
  assert.equal(byId.sightengine.score, null);
  assert.equal(byId.illuminarty.status, 'unsupported');
  assert.notEqual(byId.aiornot.status, 'unsupported');
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

test('illuminarty reads its AI probability', async () => {
  const { raw } = await withFetch(
    jsonResponse({ ai: 0.44 }),
    () => illuminarty.analyze(imageFile, { ILLUMINARTY_API_KEY: 'k' }, {}),
  );
  assert.equal(raw, 0.44);
});

test('an unreadable response is a parse error, not a silent zero', async () => {
  await assert.rejects(
    () => withFetch(
      jsonResponse({ unexpected: true }),
      () => illuminarty.analyze(imageFile, { ILLUMINARTY_API_KEY: 'k' }, {}),
    ),
    (error) => error.code === 'parse',
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

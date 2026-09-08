import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'true';
const { default: app } = await import('../server/index.js');

/** Boot the real app on an ephemeral port for each test file run. */
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 3)]);

async function analyze(buffer, filename, type) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() };
}

test('GET /api/config describes every tool and its coverage', async () => {
  const response = await fetch(`${base}/api/config`);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.detectors.length, 3);
  assert.equal(config.demoMode, true);
  assert.ok(config.detectors.every((d) => Array.isArray(d.supports) && 'configured' in d));
  assert.ok(config.reverseSearch.length >= 3);
});

test('GET / serves the frontend', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Is&nbsp;It&nbsp;AI\?/);
});

test('an image is analyzed by every image tool and averaged', async () => {
  const { status, body } = await analyze(PNG, 'photo.png', 'image/png');
  assert.equal(status, 200);
  assert.equal(body.file.kind, 'image');
  assert.equal(body.perTool.length, 3);
  assert.equal(body.contributingTools, 3);
  assert.equal(body.average, Math.round(body.perTool.reduce((sum, t) => sum + t.score, 0) / 3));
  assert.ok(['Likely real', 'Uncertain', 'Likely AI-generated'].includes(body.verdict));
  assert.ok(body.contentCredentials);
  assert.equal(body.reverseSearch.length >= 3, true);
  assert.match(body.disclaimer, /probabilistic/);
});

test('audio skips the image-only tools and says so', async () => {
  const { status, body } = await analyze(MP3, 'clip.mp3', 'audio/mpeg');
  assert.equal(status, 200);
  assert.equal(body.file.kind, 'audio');

  const byId = Object.fromEntries(body.perTool.map((t) => [t.id, t]));
  assert.equal(byId.sightengine.status, 'unsupported');
  assert.equal(byId.illuminarty.status, 'unsupported');
  assert.equal(byId.aiornot.score, body.average, 'the average is the one supporting tool alone');
  assert.equal(body.contributingTools, 1);
  assert.equal(body.singleSource, true, 'thin audio coverage is flagged to the UI');
  assert.equal(body.contentCredentials, null);
  assert.deepEqual(body.reverseSearch, []);
});

test('an unsupported file type is rejected with 415', async () => {
  const { status, body } = await analyze(Buffer.from('%PDF-1.7 junk'), 'doc.pdf', 'application/pdf');
  assert.equal(status, 415);
  assert.match(body.error, /Unsupported file type/);
});

test('a request with no file is rejected with 400', async () => {
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: new FormData() });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /No file uploaded/);
});

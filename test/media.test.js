import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMediaKind, humanSize } from '../server/lib/media.js';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]);
const M4A = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(8)]);

test('magic bytes identify each accepted format', () => {
  const cases = [[PNG, 'image', 'png'], [JPEG, 'image', 'jpeg'], [WEBP, 'image', 'webp'],
                 [WAV, 'audio', 'wav'], [MP3, 'audio', 'mp3'], [M4A, 'audio', 'm4a']];
  for (const [buffer, kind, format] of cases) {
    assert.deepEqual(detectMediaKind({ buffer, originalname: 'f', mimetype: '' }), { kind, format });
  }
});

test('magic bytes win over a wrong declared MIME type', () => {
  const result = detectMediaKind({ buffer: PNG, originalname: 'song.mp3', mimetype: 'audio/mpeg' });
  assert.equal(result.kind, 'image');
});

test('falls back to extension when bytes are unrecognized', () => {
  const result = detectMediaKind({ buffer: Buffer.alloc(4), originalname: 'clip.m4a', mimetype: 'application/octet-stream' });
  assert.equal(result.kind, 'audio');
});

test('rejects types we do not accept', () => {
  assert.equal(detectMediaKind({ buffer: Buffer.from('%PDF-1.7'), originalname: 'a.pdf', mimetype: 'application/pdf' }), null);
});

test('humanSize is readable at each scale', () => {
  assert.equal(humanSize(512), '512 B');
  assert.equal(humanSize(2048), '2.0 KB');
  assert.equal(humanSize(5 * 1024 * 1024), '5.0 MB');
});

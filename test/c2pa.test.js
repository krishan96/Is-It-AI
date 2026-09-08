import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectContentCredentials } from '../server/lib/c2pa.js';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/** Assemble a PNG with the given chunks, so the chunk walk has real input. */
function png(chunks) {
  const parts = [PNG_SIGNATURE];
  for (const [type, data] of chunks) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    parts.push(length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)); // CRC unchecked
  }
  return Buffer.concat(parts);
}

test('reports absence without overclaiming', () => {
  const result = inspectContentCredentials(png([['IHDR', Buffer.alloc(13)], ['IDAT', Buffer.alloc(8)]]), 'png');
  assert.equal(result.present, false);
  assert.equal(result.aiGeneratorDetected, false);
  assert.match(result.note, /proves nothing/i);
});

test('finds a C2PA chunk ahead of the image data', () => {
  const manifest = Buffer.from('jumbc2pa some manifest bytes');
  const result = inspectContentCredentials(
    png([['IHDR', Buffer.alloc(13)], ['caBX', manifest], ['IDAT', Buffer.alloc(8)]]),
    'png',
  );
  assert.equal(result.present, true);
});

test('flags a manifest that names an AI generator', () => {
  const manifest = Buffer.from('jumbc2pa\x00claim_generator\x00Adobe Firefly 3.0\x00');
  const result = inspectContentCredentials(
    png([['IHDR', Buffer.alloc(13)], ['caBX', manifest], ['IDAT', Buffer.alloc(8)]]),
    'png',
  );
  assert.equal(result.present, true);
  assert.equal(result.aiGeneratorDetected, true);
  assert.match(result.generator, /Firefly/);
});

test('a manifest from an ordinary camera is present but not flagged', () => {
  const manifest = Buffer.from('jumbc2pa\x00claim_generator\x00Leica M11 Firmware\x00');
  const result = inspectContentCredentials(
    png([['IHDR', Buffer.alloc(13)], ['caBX', manifest], ['IDAT', Buffer.alloc(8)]]),
    'png',
  );
  assert.equal(result.present, true);
  assert.equal(result.aiGeneratorDetected, false);
});

test('a JPEG APP11 segment carrying JUMBF is detected', () => {
  const payload = Buffer.from('\x00\x00JP jumb c2pa manifest');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  const jpeg = Buffer.concat([
    Buffer.from('ffd8', 'hex'),
    Buffer.from('ffeb', 'hex'), length, payload,
    Buffer.from('ffda', 'hex'),
  ]);
  assert.equal(inspectContentCredentials(jpeg, 'jpeg').present, true);
});

test('malformed input never throws', () => {
  assert.doesNotThrow(() => inspectContentCredentials(Buffer.from([0x89, 0x50]), 'png'));
  assert.doesNotThrow(() => inspectContentCredentials(Buffer.alloc(0), 'webp'));
});

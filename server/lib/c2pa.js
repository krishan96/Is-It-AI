/**
 * Content Credentials (C2PA) presence check — free, local, no third-party call.
 *
 * This is deliberately a *presence* check, not a verification: it walks the
 * container for a C2PA manifest and reports whether provenance data is
 * embedded, plus the claim generator when it can be read. Cryptographically
 * validating the manifest chain needs the full `c2pa` toolkit; what we can say
 * for free is "this file carries provenance data, here is what it names".
 *
 * Signal, both ways:
 *  - A manifest naming an AI generator is strong evidence the file is AI-made.
 *  - Absence proves nothing — most pipelines strip metadata on re-encode.
 */

const C2PA_LABEL = Buffer.from('c2pa', 'latin1');
const JUMB_BOX = Buffer.from('jumb', 'latin1');

/** Generators whose names in a manifest imply the content was AI-generated. */
const AI_GENERATOR_HINTS = [
  'dall-e', 'dalle', 'openai', 'midjourney', 'stable diffusion', 'stability',
  'firefly', 'adobe firefly', 'imagen', 'gemini', 'veo', 'sora', 'runway',
  'leonardo', 'ideogram', 'flux', 'grok', 'copilot', 'designer', 'gpt-',
];

/** Walk PNG chunks looking for the C2PA container chunk (`caBX`). */
function pngHasManifest(buffer) {
  let offset = 8; // past the PNG signature
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    if (type === 'caBX') return true;
    if (type === 'IDAT' || type === 'IEND') return false; // manifests precede image data
    offset += 12 + length; // length + type + data + CRC
    if (length < 0 || offset <= 0) return false;
  }
  return false;
}

/** Walk JPEG segments looking for an APP11 segment carrying a JUMBF box. */
function jpegHasManifest(buffer) {
  let offset = 2; // past SOI
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xda) break; // start of scan — metadata is behind us
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xeb) {
      const segment = buffer.subarray(offset + 4, offset + 2 + length);
      if (segment.includes(JUMB_BOX) || segment.includes(C2PA_LABEL)) return true;
    }
    offset += 2 + length;
  }
  return false;
}

/** Walk RIFF chunks looking for a `C2PA` chunk in a WebP file. */
function webpHasManifest(buffer) {
  let offset = 12; // past 'RIFF' + size + 'WEBP'
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('latin1');
    const size = buffer.readUInt32LE(offset + 4);
    if (type === 'C2PA') return true;
    offset += 8 + size + (size % 2); // chunks are padded to even lengths
  }
  return false;
}

/**
 * Best-effort read of the claim generator string out of the manifest's CBOR.
 * The value follows the `claim_generator` key as a readable UTF-8 run.
 */
function readClaimGenerator(buffer) {
  for (const key of ['claim_generator_info', 'claim_generator']) {
    const at = buffer.indexOf(Buffer.from(key, 'latin1'));
    if (at === -1) continue;
    const window = buffer.subarray(at + key.length, at + key.length + 256).toString('utf8');
    const match = window.match(/[A-Za-z][\w .\-+/()]{3,80}/);
    if (match) return match[0].trim();
  }
  return null;
}

export function inspectContentCredentials(buffer, format) {
  let present = false;
  try {
    if (format === 'png') present = pngHasManifest(buffer);
    else if (format === 'jpeg') present = jpegHasManifest(buffer);
    else if (format === 'webp') present = webpHasManifest(buffer);
    // Container walk can miss unusual layouts; the raw label is the backstop.
    if (!present) present = buffer.includes(JUMB_BOX) && buffer.includes(C2PA_LABEL);
  } catch {
    present = buffer.includes(JUMB_BOX) && buffer.includes(C2PA_LABEL);
  }

  if (!present) {
    return {
      present: false,
      generator: null,
      aiGeneratorDetected: false,
      note: 'No Content Credentials found. This proves nothing on its own — most uploads and re-encodes strip provenance metadata.',
    };
  }

  const generator = readClaimGenerator(buffer);
  const haystack = (generator ?? '').toLowerCase();
  const aiGeneratorDetected = AI_GENERATOR_HINTS.some((hint) => haystack.includes(hint));

  return {
    present: true,
    generator,
    aiGeneratorDetected,
    note: aiGeneratorDetected
      ? `Content Credentials name an AI generator${generator ? ` (${generator})` : ''}. That is direct provenance, stronger than any detector score.`
      : `Content Credentials are embedded${generator ? ` (${generator})` : ''}. Presence is reported here, not cryptographically verified.`,
  };
}

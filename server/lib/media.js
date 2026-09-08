/**
 * Deciding what kind of file we were handed.
 *
 * Browsers lie about MIME types (and some send application/octet-stream for
 * .m4a), so extension and magic bytes both get a vote.
 */

export const ACCEPTED = {
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  audio: {
    extensions: ['.mp3', '.wav', '.m4a'],
    mimeTypes: [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
      'audio/mp4', 'audio/x-m4a', 'audio/m4a',
    ],
  },
};

export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED.image.extensions,
  ...ACCEPTED.audio.extensions,
  ...ACCEPTED.image.mimeTypes,
  ...ACCEPTED.audio.mimeTypes,
].join(',');

function extensionOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/** Sniff the leading bytes for the formats we accept. */
function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const ascii = (start, end) => buffer.subarray(start, end).toString('latin1');

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { kind: 'image', format: 'jpeg' };
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return { kind: 'image', format: 'png' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', format: 'webp' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { kind: 'audio', format: 'wav' };
  if (ascii(0, 3) === 'ID3') return { kind: 'audio', format: 'mp3' };
  // MPEG audio frame sync (a bare .mp3 with no ID3 tag).
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return { kind: 'audio', format: 'mp3' };
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand.startsWith('M4A') || brand.startsWith('mp4') || brand.startsWith('iso')) {
      return { kind: 'audio', format: 'm4a' };
    }
  }
  return null;
}

/**
 * Resolve a file to 'image' | 'audio', or null when we do not accept it.
 * Magic bytes win when they disagree with the declared MIME type.
 */
export function detectMediaKind({ buffer, mimetype = '', originalname = '' }) {
  const sniffed = sniff(buffer);
  if (sniffed) return sniffed;

  const ext = extensionOf(originalname);
  const mime = mimetype.toLowerCase().split(';')[0].trim();
  for (const [kind, spec] of Object.entries(ACCEPTED)) {
    if (spec.mimeTypes.includes(mime) || spec.extensions.includes(ext)) {
      return { kind, format: ext.replace('.', '') || mime.split('/')[1] || 'unknown' };
    }
  }
  return null;
}

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

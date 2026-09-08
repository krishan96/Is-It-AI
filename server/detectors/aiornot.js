import { postMultipart, firstNumber, at, DetectorError } from './shared.js';

/**
 * AI or Not — the one free-tier option here that covers audio as well as images.
 * Docs: https://docs.aiornot.com
 *
 * Image and audio go to different endpoints; both take the file as multipart
 * with a bearer key. The response has carried the confidence under several
 * different keys across API versions, so we try the ones we know and fall back
 * to the coarse verdict string when no number is present.
 */
const ENDPOINTS = {
  image: 'https://api.aiornot.com/v1/reports/image',
  audio: 'https://api.aiornot.com/v1/reports/audio',
};

const SCORE_PATHS = [
  'report.ai.confidence',
  'report.confidence',
  'report.ai_confidence',
  'ai.confidence',
  'confidence',
  'score',
];

export default {
  id: 'aiornot',
  name: 'AI or Not',
  supports: ['image', 'audio'],
  docsUrl: 'https://docs.aiornot.com',
  signupUrl: 'https://www.aiornot.com',
  configHint: 'Set AIORNOT_API_KEY',

  isConfigured(env) {
    return Boolean(env.AIORNOT_API_KEY);
  },

  async analyze(file, env, { signal }) {
    const url = (file.kind === 'audio' ? env.AIORNOT_AUDIO_URL : env.AIORNOT_IMAGE_URL) || ENDPOINTS[file.kind];
    if (!url) throw new DetectorError(`No AI or Not endpoint for ${file.kind}.`, 'unsupported');

    const body = await postMultipart(url, {
      fileField: env.AIORNOT_FILE_FIELD || 'object',
      file,
      headers: { Authorization: `Bearer ${env.AIORNOT_API_KEY}` },
      signal,
    });

    const raw = firstNumber(body, SCORE_PATHS);
    if (raw !== undefined) return { raw, response: body };

    // No numeric confidence — fall back to the verdict label, flagged as coarse.
    const verdict = String(at(body, 'report.verdict') ?? at(body, 'verdict') ?? '').toLowerCase();
    if (verdict === 'ai' || verdict === 'human') {
      return { raw: verdict === 'ai' ? 1 : 0, response: body, coarse: true };
    }
    throw new DetectorError('Response did not contain a confidence score or verdict.', 'parse');
  },
};

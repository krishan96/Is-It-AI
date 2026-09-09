import { postBinary, DetectorError } from './shared.js';

/**
 * Hugging Face Inference — free tier, and the only detector here that covers
 * both images and audio through the same interface.
 * Docs: https://huggingface.co/docs/inference-providers
 *
 * Unlike the commercial detectors, this is not one vendor's opinion: it runs
 * whichever community classifier you point it at. The defaults below are
 * well-used detectors, but the model IDs are configuration, not a fixed choice
 * — swap them as better ones appear.
 */

const DEFAULT_BASE_URL = 'https://router.huggingface.co/hf-inference/models';
const DEFAULT_MODELS = {
  image: 'Organika/sdxl-detector',
  audio: 'MelodyMachine/Deepfake-audio-detection-V2',
};

/**
 * Classifier label vocabularies vary per model, so map both sides by meaning
 * rather than assuming one naming scheme.
 */
const AI_LABELS = ['artificial', 'ai', 'ai_generated', 'aigenerated', 'fake', 'spoof', 'synthetic', 'generated', 'deepfake', 'machine'];
const HUMAN_LABELS = ['human', 'real', 'authentic', 'bonafide', 'genuine', 'natural'];

const normalizeLabel = (label) => String(label).toLowerCase().replace(/[\s-]+/g, '_');

/** Wait out a cold model, without outliving the caller's timeout. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DetectorError('Timed out waiting for this tool to respond.', 'timeout'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DetectorError('Timed out while the model was loading.', 'timeout'));
    }, { once: true });
  });
}

/**
 * Turn a label/score list into a single AI probability.
 *
 * The scores are a softmax over the model's classes, so the AI-side classes are
 * summed. When neither side is recognizable the labels are reported back rather
 * than guessed at — picking a side at random would produce a confident number
 * with nothing behind it.
 */
export function scoreFromLabels(predictions, kind = 'image') {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw new DetectorError('Model returned no predictions.', 'parse');
  }

  let aiScore = 0;
  let matchedAi = false;
  let matchedHuman = false;

  for (const entry of predictions) {
    const label = normalizeLabel(entry?.label ?? '');
    const score = Number(entry?.score);
    if (!Number.isFinite(score)) continue;
    if (AI_LABELS.includes(label)) {
      aiScore += score;
      matchedAi = true;
    } else if (HUMAN_LABELS.includes(label)) {
      matchedHuman = true;
    }
  }

  if (matchedAi) return aiScore;
  // Only the human side was recognized, so AI is the remainder.
  if (matchedHuman) {
    const humanScore = predictions
      .filter((entry) => HUMAN_LABELS.includes(normalizeLabel(entry?.label ?? '')))
      .reduce((total, entry) => total + (Number(entry.score) || 0), 0);
    return Math.max(0, 1 - humanScore);
  }

  const seen = predictions.map((entry) => entry?.label).filter(Boolean).join(', ');
  const setting = kind === 'audio' ? 'HUGGINGFACE_AUDIO_MODEL' : 'HUGGINGFACE_IMAGE_MODEL';
  throw new DetectorError(
    `Could not tell which of this model's labels means "AI-generated" (it returned: ${seen}). ` +
    `Point ${setting} at a model with clearer labels.`,
    'parse',
  );
}

export default {
  id: 'huggingface',
  name: 'Hugging Face',
  supports: ['image', 'audio'],
  docsUrl: 'https://huggingface.co/docs/inference-providers',
  signupUrl: 'https://huggingface.co/settings/tokens',
  configHint: 'Set HUGGINGFACE_API_KEY',

  isConfigured(env) {
    return Boolean(env.HUGGINGFACE_API_KEY || env.HF_TOKEN);
  },

  modelFor(env, kind) {
    const configured = kind === 'audio' ? env.HUGGINGFACE_AUDIO_MODEL : env.HUGGINGFACE_IMAGE_MODEL;
    return configured || DEFAULT_MODELS[kind];
  },

  async analyze(file, env, { signal }) {
    const model = this.modelFor(env, file.kind);
    if (!model) throw new DetectorError(`No Hugging Face model configured for ${file.kind}.`, 'unsupported');

    const base = (env.HUGGINGFACE_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const url = `${base}/${model}`;
    const headers = { Authorization: `Bearer ${env.HUGGINGFACE_API_KEY || env.HF_TOKEN}` };

    let body;
    try {
      body = await postBinary(url, { file, headers, signal });
    } catch (error) {
      // A cold model answers 503 with how long it needs. Wait once, then retry.
      const wait = coldStartSeconds(error);
      if (wait === null) throw error;
      await sleep(Math.min(wait, 20) * 1000, signal);
      body = await postBinary(url, { file, headers, signal });
    }

    // Some errors arrive with a 200 and an `error` field instead of a status.
    if (body && !Array.isArray(body) && body.error) {
      throw new DetectorError(`${model}: ${body.error}`, 'upstream');
    }

    return { raw: scoreFromLabels(body, file.kind), response: body, model };
  },
};

/** Seconds to wait if this failure is a model cold start, else null. */
function coldStartSeconds(error) {
  const detail = error?.body;
  const message = typeof detail === 'object' ? detail?.error ?? '' : String(detail ?? error?.message ?? '');
  if (error?.status !== 503 && !/loading/i.test(String(message))) return null;
  const estimate = Number(typeof detail === 'object' ? detail?.estimated_time : NaN);
  return Number.isFinite(estimate) ? estimate : 10;
}

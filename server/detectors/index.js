import { createHash } from 'node:crypto';
import sightengine from './sightengine.js';
import aiornot from './aiornot.js';
import huggingface from './huggingface.js';
import { toPercent } from '../lib/scoring.js';

export const DETECTORS = [sightengine, aiornot, huggingface];

const DEFAULT_TIMEOUT_MS = 30_000;

/** What the UI needs to render a tool's row before any file is uploaded. */
export function describeDetectors(env) {
  return DETECTORS.map((tool) => ({
    id: tool.id,
    name: tool.name,
    supports: tool.supports,
    docsUrl: tool.docsUrl,
    signupUrl: tool.signupUrl,
    configHint: tool.configHint,
    configured: tool.isConfigured(env),
  }));
}

/**
 * A stable stand-in score so the app is runnable before any keys exist.
 *
 * Derived from the file's own hash, so the same file always scores the same and
 * different files differ — enough to exercise the averaging and the UI. It is
 * labelled `demo` everywhere it surfaces; it is not a detection.
 */
function demoScore(buffer, toolId) {
  const digest = createHash('sha256').update(buffer).update(toolId).digest();
  return digest.readUInt16BE(0) % 101;
}

/** Run one detector and normalize both its success and its failure shapes. */
async function runOne(tool, file, env, demoMode) {
  const base = { id: tool.id, name: tool.name, docsUrl: tool.docsUrl, supports: tool.supports };

  if (!tool.supports.includes(file.kind)) {
    return {
      ...base,
      status: 'unsupported',
      score: null,
      // Skipped, not zero — an image-only tool must not drag an audio average down.
      message: `Does not analyze ${file.kind} files`,
    };
  }

  if (!tool.isConfigured(env)) {
    if (demoMode) {
      return {
        ...base,
        status: 'demo',
        score: demoScore(file.buffer, tool.id),
        demo: true,
        message: 'Simulated score (DEMO_MODE) — not a real detection',
      };
    }
    return { ...base, status: 'not_configured', score: null, message: `Not configured. ${tool.configHint} in .env` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.DETECTOR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const { raw, coarse } = await tool.analyze(file, env, { signal: controller.signal });
    return {
      ...base,
      status: 'ok',
      score: toPercent(raw),
      coarse: Boolean(coarse),
      message: coarse ? 'Tool returned a verdict only, not a confidence score' : null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      score: null,
      errorCode: error.code || 'upstream',
      message: error.message || 'Detector failed',
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fan out to every detector in parallel; one tool failing never fails the batch. */
export function runDetectors(file, env) {
  const demoMode = String(env.DEMO_MODE ?? '').toLowerCase() === 'true';
  return Promise.all(DETECTORS.map((tool) => runOne(tool, file, env, demoMode)));
}

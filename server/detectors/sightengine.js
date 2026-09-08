import { postMultipart, firstNumber, DetectorError } from './shared.js';

/**
 * Sightengine — image only, ~2,000 operations/month on the free tier.
 * Docs: https://sightengine.com/docs/ai-generated-image-detection
 * The `genai` model returns response.type.ai_generated as a 0..1 probability.
 */
export default {
  id: 'sightengine',
  name: 'Sightengine',
  supports: ['image'],
  docsUrl: 'https://sightengine.com/docs/ai-generated-image-detection',
  signupUrl: 'https://dashboard.sightengine.com/signup',
  configHint: 'Set SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET',

  isConfigured(env) {
    return Boolean(env.SIGHTENGINE_API_USER && env.SIGHTENGINE_API_SECRET);
  },

  async analyze(file, env, { signal }) {
    const body = await postMultipart(
      env.SIGHTENGINE_API_URL || 'https://api.sightengine.com/1.0/check.json',
      {
        fileField: 'media',
        file,
        fields: {
          models: 'genai',
          api_user: env.SIGHTENGINE_API_USER,
          api_secret: env.SIGHTENGINE_API_SECRET,
        },
        signal,
      },
    );

    // Sightengine reports failures with HTTP 200 and status: 'failure'.
    if (body?.status === 'failure') {
      const message = body?.error?.message || 'Sightengine rejected the request.';
      const code = /credit|quota|usage/i.test(message) ? 'quota' : 'upstream';
      throw new DetectorError(message, code);
    }

    const raw = firstNumber(body, ['type.ai_generated', 'type.ai_generated.prob', 'ai_generated']);
    if (raw === undefined) {
      throw new DetectorError('Response did not contain an ai_generated score.', 'parse');
    }
    return { raw, response: body };
  },
};

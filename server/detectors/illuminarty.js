import { postMultipart, firstNumber, DetectorError } from './shared.js';

/**
 * Illuminarty — image only, free tier with an API key.
 * Docs: https://illuminarty.ai/en/api-docs
 *
 * Endpoint and field names have moved around more than the others here, so both
 * are overridable from the environment without a code change.
 */
export default {
  id: 'illuminarty',
  name: 'Illuminarty',
  supports: ['image'],
  docsUrl: 'https://illuminarty.ai/en/api-docs',
  signupUrl: 'https://illuminarty.ai',
  configHint: 'Set ILLUMINARTY_API_KEY',

  isConfigured(env) {
    return Boolean(env.ILLUMINARTY_API_KEY);
  },

  async analyze(file, env, { signal }) {
    const body = await postMultipart(
      env.ILLUMINARTY_API_URL || 'https://api.illuminarty.ai/v1/image/detectimage',
      {
        fileField: env.ILLUMINARTY_FILE_FIELD || 'image',
        file,
        headers: { 'X-API-KEY': env.ILLUMINARTY_API_KEY },
        signal,
      },
    );

    const raw = firstNumber(body, ['ai', 'result.ai', 'data.ai', 'ai_probability', 'probability', 'score']);
    if (raw === undefined) {
      throw new DetectorError('Response did not contain an AI probability.', 'parse');
    }
    return { raw, response: body };
  },
};

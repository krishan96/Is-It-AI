/** Plumbing shared by every detector adapter: uploads, timeouts, error mapping. */

/** An upstream failure we can describe to the user in plain language. */
export class DetectorError extends Error {
  constructor(message, code = 'upstream', { status = null, detail = null } = {}) {
    super(message);
    this.name = 'DetectorError';
    this.code = code; // auth | quota | rate_limit | unsupported | timeout | upstream | parse
    this.status = status;
    this.detail = detail;
  }
}

/** Turn an HTTP status into the reason the user actually cares about. */
export function classifyStatus(status, body) {
  const text = typeof body === 'string' ? body.toLowerCase() : JSON.stringify(body ?? '').toLowerCase();
  if (status === 401 || status === 403) {
    return new DetectorError('API key rejected — check the credentials in your .env file.', 'auth', { status });
  }
  if (status === 429) {
    return new DetectorError('Rate limit hit — this tool is throttling requests. Try again shortly.', 'rate_limit', { status });
  }
  if (status === 402 || text.includes('quota') || text.includes('insufficient') || text.includes('credit')) {
    return new DetectorError('Free-tier quota exhausted for this tool.', 'quota', { status });
  }
  if (status === 413) {
    return new DetectorError('File rejected as too large by this tool.', 'unsupported', { status });
  }
  return new DetectorError(`Upstream returned HTTP ${status}.`, 'upstream', { status, detail: String(text).slice(0, 200) });
}

/** Send one request and normalize the response and its failure modes. */
async function send(url, { body, headers, signal }) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', body, headers, signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new DetectorError('Timed out waiting for this tool to respond.', 'timeout');
    }
    throw new DetectorError(`Could not reach this tool: ${error.message}`, 'upstream');
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const error = classifyStatus(response.status, parsed);
    error.body = parsed; // some providers put actionable detail in the body
    throw error;
  }
  return parsed;
}

/**
 * POST a multipart form with the uploaded file attached.
 * `signal` carries the per-request timeout from the caller.
 */
export async function postMultipart(url, { fileField, file, fields = {}, headers = {}, signal }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append(fileField, new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }), file.filename);
  return send(url, { body: form, headers, signal });
}

/**
 * POST the file as a raw binary body — what Hugging Face's inference API wants,
 * with the media type in Content-Type rather than a multipart wrapper.
 */
export async function postBinary(url, { file, headers = {}, signal }) {
  return send(url, {
    body: file.buffer,
    headers: { 'Content-Type': file.mimetype || 'application/octet-stream', ...headers },
    signal,
  });
}

/** Read a value out of a nested object by dotted path, tolerating gaps. */
export function at(object, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object);
}

/**
 * Pull the first usable number out of a response.
 *
 * Providers rename and re-nest these fields between versions, so each adapter
 * lists the paths it knows and we take the first one that is actually a number.
 */
export function firstNumber(body, paths) {
  for (const path of paths) {
    const value = at(body, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

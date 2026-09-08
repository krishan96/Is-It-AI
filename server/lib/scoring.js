/**
 * Normalizing detector output and turning a set of scores into a verdict.
 *
 * Every detector reports differently (0..1 floats, 0..100 ints, nested JSON with
 * its own field names). Each adapter digs the raw AI-probability out of its own
 * response shape, then hands it here to become a 0-100 percentage.
 */

export const VERDICT_BANDS = [
  { max: 35, verdict: 'Likely real', level: 'real' },
  { max: 65, verdict: 'Uncertain', level: 'uncertain' },
  { max: 100, verdict: 'Likely AI-generated', level: 'ai' },
];

/**
 * Convert a raw AI probability to a 0-100 integer percentage.
 * Accepts either a 0..1 float or an already-scaled 0..100 number.
 */
export function toPercent(rawProbability) {
  const value = Number(rawProbability);
  if (!Number.isFinite(value)) {
    throw new Error(`Detector returned a non-numeric probability: ${rawProbability}`);
  }
  const scaled = value <= 1 ? value * 100 : value;
  return Math.round(Math.min(100, Math.max(0, scaled)));
}

/**
 * Average the tools that actually returned a score.
 *
 * Unsupported and errored tools are skipped rather than counted as 0 — a tool
 * that cannot read audio should not drag an audio file's average down.
 */
export function averageScores(results) {
  const scored = results.filter((r) => typeof r.score === 'number');
  if (scored.length === 0) return null;
  const sum = scored.reduce((total, r) => total + r.score, 0);
  return Math.round(sum / scored.length);
}

export function bandFor(average) {
  if (average === null || average === undefined) {
    return { verdict: 'No result', level: 'none' };
  }
  const band = VERDICT_BANDS.find((b) => average <= b.max) ?? VERDICT_BANDS.at(-1);
  return { verdict: band.verdict, level: band.level };
}

/** Build the full analysis payload from a list of per-tool results. */
export function summarize(results) {
  const average = averageScores(results);
  const { verdict, level } = bandFor(average);
  const contributing = results.filter((r) => typeof r.score === 'number').length;
  return {
    perTool: results,
    average,
    verdict,
    level,
    contributingTools: contributing,
    // One source is an opinion, not a consensus — the UI says so out loud.
    singleSource: contributing === 1,
  };
}

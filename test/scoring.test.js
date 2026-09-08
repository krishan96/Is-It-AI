import test from 'node:test';
import assert from 'node:assert/strict';
import { toPercent, averageScores, bandFor, summarize } from '../server/lib/scoring.js';

test('toPercent scales 0..1 floats', () => {
  assert.equal(toPercent(0.87), 87);
  assert.equal(toPercent(0), 0);
  assert.equal(toPercent(1), 100);
});

test('toPercent passes through already-scaled values', () => {
  assert.equal(toPercent(87), 87);
  assert.equal(toPercent(99.6), 100);
});

test('toPercent clamps and rejects nonsense', () => {
  assert.equal(toPercent(140), 100);
  assert.equal(toPercent(-3), 0);
  assert.throws(() => toPercent('not a number'));
  assert.throws(() => toPercent(undefined));
});

test('averageScores skips unsupported and errored tools rather than counting them as zero', () => {
  const average = averageScores([
    { score: 80 },
    { score: null },       // unsupported
    { score: undefined },  // errored
    { score: 60 },
  ]);
  assert.equal(average, 70);
});

test('averageScores is null when nothing scored', () => {
  assert.equal(averageScores([{ score: null }, { score: null }]), null);
});

test('verdict bands follow the spec boundaries', () => {
  assert.equal(bandFor(0).verdict, 'Likely real');
  assert.equal(bandFor(35).verdict, 'Likely real');
  assert.equal(bandFor(36).verdict, 'Uncertain');
  assert.equal(bandFor(65).verdict, 'Uncertain');
  assert.equal(bandFor(66).verdict, 'Likely AI-generated');
  assert.equal(bandFor(100).verdict, 'Likely AI-generated');
  assert.equal(bandFor(null).verdict, 'No result');
});

test('summarize flags a single-source average', () => {
  const one = summarize([{ score: 90 }, { score: null }]);
  assert.equal(one.singleSource, true);
  assert.equal(one.contributingTools, 1);
  assert.equal(one.average, 90);

  const two = summarize([{ score: 90 }, { score: 10 }]);
  assert.equal(two.singleSource, false);
  assert.equal(two.average, 50);
  assert.equal(two.verdict, 'Uncertain');
});

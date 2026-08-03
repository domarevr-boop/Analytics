/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCxi, calculateEvaluativeShare, calculateProblemIndex, calculateTopicContribution, calculateTopicScore, calculateTopicWeight,
} from './cxCalculations.ts';

test('tonality excludes neutral mentions', () => {
  assert.equal(calculateTopicScore({ positive: 6, neutral: 20, negative: 2 }), 75);
  assert.equal(calculateTopicScore({ positive: 0, neutral: 4, negative: 0 }), null);
  assert.equal(calculateEvaluativeShare({ positive: 6, neutral: 2, negative: 2 }), 80);
});

test('topic contribution combines dynamic weight and score', () => {
  assert.equal(calculateTopicWeight(25, 100), 0.25);
  assert.equal(calculateTopicContribution(80, 0.25), 20);
});

test('CXI is recalculated when topic weights change', () => {
  const baseline = calculateCxi([
    { mentions: 50, positive: 40, neutral: 5, negative: 5 },
    { mentions: 50, positive: 10, neutral: 10, negative: 30 },
  ]);
  const shifted = calculateCxi([
    { mentions: 80, positive: 64, neutral: 8, negative: 8 },
    { mentions: 20, positive: 4, neutral: 4, negative: 12 },
  ]);
  assert.ok(baseline !== null && shifted !== null && shifted > baseline);
  assert.equal(calculateCxi([{ mentions: 10, positive: 0, neutral: 10, negative: 0 }]), null);
});

test('Problem Index uses centralized configurable weights', () => {
  const result = calculateProblemIndex({
    topicMentionShare: 0.15, negativeMentions: 30, allTopicMentions: 60, negativeShareIncrease: 0.4,
  }, {
    exposureThreshold: 0.15, confidentMentionsThreshold: 30,
    exposureWeight: 0.4, negativityWeight: 0.35, accelerationWeight: 0.15, confidenceWeight: 0.1,
  });
  assert.equal(result, 73.5);
});

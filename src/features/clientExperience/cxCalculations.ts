export interface TopicCounts {
  positive: number;
  neutral: number;
  negative: number;
}

export interface ProblemIndexConfig {
  exposureThreshold: number;
  confidentMentionsThreshold: number;
  exposureWeight: number;
  negativityWeight: number;
  accelerationWeight: number;
  confidenceWeight: number;
}

export interface CxiTopicInput extends TopicCounts {
  mentions: number;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

export function calculateTopicScore(counts: TopicCounts) {
  const evaluativeMentions = counts.positive + counts.negative;
  if (evaluativeMentions <= 0) return null;
  return 100 * counts.positive / evaluativeMentions;
}

export function calculateEvaluativeShare(counts: TopicCounts) {
  const mentions = counts.positive + counts.neutral + counts.negative;
  return mentions > 0 ? 100 * (counts.positive + counts.negative) / mentions : 0;
}

export function calculateTopicWeight(topicMentions: number, allTopicMentions: number) {
  return allTopicMentions > 0 ? clamp(topicMentions / allTopicMentions) : 0;
}

export function calculateTopicContribution(topicScore: number | null, topicWeight: number) {
  if (topicScore === null) return 0;
  return clamp(topicWeight) * clamp(topicScore, 0, 100);
}

export function calculateCxi(topics: CxiTopicInput[]) {
  const evaluativeMentions = topics.map(topic => Math.max(0, topic.positive + topic.negative));
  const allMentions = evaluativeMentions.reduce((sum, mentions) => sum + mentions, 0);
  if (allMentions <= 0) return null;
  return topics.reduce((sum, topic) => {
    const score = calculateTopicScore(topic);
    const weight = calculateTopicWeight(topic.positive + topic.negative, allMentions);
    return sum + calculateTopicContribution(score, weight);
  }, 0);
}

export function calculateProblemIndex(input: {
  topicMentionShare: number;
  negativeMentions: number;
  allTopicMentions: number;
  negativeShareIncrease: number;
}, config: ProblemIndexConfig) {
  const exposure = clamp(input.topicMentionShare / Math.max(config.exposureThreshold, Number.EPSILON));
  const negativity = input.allTopicMentions > 0 ? clamp(input.negativeMentions / input.allTopicMentions) : 0;
  const acceleration = clamp(input.negativeShareIncrease);
  const confidence = clamp(input.allTopicMentions / Math.max(config.confidentMentionsThreshold, 1));
  const weighted = (
    config.exposureWeight * exposure
    + config.negativityWeight * negativity
    + config.accelerationWeight * acceleration
    + config.confidenceWeight * confidence
  );
  const configuredWeight = config.exposureWeight + config.negativityWeight + config.accelerationWeight + config.confidenceWeight;
  return configuredWeight > 0 ? 100 * clamp(weighted / configuredWeight) : 0;
}

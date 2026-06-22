const REVIEW_TOPICS = [
  { value: 'quality', label: 'Product quality' },
  { value: 'value', label: 'Value for money' },
  { value: 'packaging', label: 'Packaging & delivery' },
  { value: 'as_described', label: 'Matches description' },
  { value: 'size_fit', label: 'Size / fit' },
  { value: 'customer_service', label: 'Customer service' }
];

const TOPIC_VALUES = new Set(REVIEW_TOPICS.map((t) => t.value));

function normalizeReviewTopic(value) {
  const topic = String(value || '')
    .trim()
    .toLowerCase();
  return TOPIC_VALUES.has(topic) ? topic : '';
}

function reviewTopicLabel(value) {
  const topic = normalizeReviewTopic(value);
  if (!topic) return '';
  return REVIEW_TOPICS.find((t) => t.value === topic)?.label || topic;
}

module.exports = {
  REVIEW_TOPICS,
  normalizeReviewTopic,
  reviewTopicLabel
};

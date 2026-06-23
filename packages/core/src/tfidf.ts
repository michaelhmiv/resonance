/**
 * TF-IDF keyword extraction — pure JavaScript, no platform dependencies.
 * Used by the patterns service for cluster labeling when the LLM is not loaded.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
  'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
  'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'am', 'if', 'because', 'while', 'any', 'now', 'one',
  'really', 'feel', 'feeling', 'felt', 'like', 'know', 'think', 'thought',
  'want', 'need', 'go', 'going', 'went', 'get', 'got', 'come', 'came',
  'good', 'bad', 'well', 'even', 'still', 'back', 'way', 'thing', 'things',
  'much', 'many', 'lot', 'kind', 'sort', 'ever', 'never', 'always',
]);

export function extractTopKeywords(texts: string[], maxKeywords = 8): string[] {
  const termFreq = new Map<string, number>();
  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w));
    for (const word of words) {
      termFreq.set(word, (termFreq.get(word) ?? 0) + 1);
    }
  }
  return Array.from(termFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

// One item per feed. Edit this list to add or remove sources.
// window = how far back (hours) to look, max = most items taken from that source per day.
const FEEDS = [
  // section, source, url, window, max
  ['news', 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 24, 6],
  ['news', 'BBC Africa', 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', 24, 4],
  ['news', 'BBC Business', 'https://feeds.bbci.co.uk/news/business/rss.xml', 24, 4],

  ['labs', 'OpenAI', 'https://openai.com/news/rss.xml', 72, 4],
  ['labs', 'Anthropic', 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml', 72, 4],
  ['labs', 'Google DeepMind', 'https://deepmind.google/blog/rss.xml', 72, 4],
  ['labs', 'Google AI', 'https://blog.google/technology/ai/rss/', 72, 4],
  ['labs', 'Meta AI', 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml', 72, 3],
  ['labs', 'Mistral', 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_mistral.xml', 72, 3],
  ['labs', 'xAI', 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_xainews.xml', 72, 3],
  ['labs', 'Hugging Face', 'https://huggingface.co/blog/feed.xml', 72, 3],
  ['labs', 'NVIDIA', 'https://blogs.nvidia.com/feed/', 72, 3],
  ['labs', 'Microsoft', 'https://blogs.microsoft.com/feed/', 72, 3],

  ['builders', 'Simon Willison', 'https://simonwillison.net/atom/everything/', 48, 6],
  ['builders', 'Latent Space', 'https://www.latent.space/feed', 72, 3],
  ['builders', "Ben's Bites", 'https://www.bensbites.com/feed', 72, 3],
  ['builders', 'Greg Isenberg (YouTube)', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCPjNBjflYl0-HQtUvOx0Ibw', 72, 3],
  ['builders', "Lenny's Newsletter", 'https://www.lennysnewsletter.com/feed', 72, 3],

  ['saas', 'SaaStr', 'https://feeds.feedburner.com/SaaStr', 72, 4],

  ['tech', 'The New Stack', 'https://thenewstack.io/feed/', 36, 5],
  ['tech', 'TechCrunch', 'https://techcrunch.com/feed/', 24, 6],
  ['tech', 'The Verge AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 36, 4],
  ['tech', 'Hacker News (best)', 'https://hnrss.org/best', 24, 6],
];

return FEEDS.map(([section, source, url, window, max]) => ({ json: { section, source, url, window, max } }));

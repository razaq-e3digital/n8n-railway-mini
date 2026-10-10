// Keeps recent, unseen items per feed and builds the prompt for the summariser.
const feeds = $('Feed List').all().map(i => i.json);
const now = Date.now();
const seen = $getWorkflowStaticData('global').seen || {};

const clean = s => String(s || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#8217;|&rsquo;/g, "'")
  .replace(/&#8230;|&hellip;/g, '...').replace(/&#82(20|21);|&[lr]dquo;/g, '"').replace(/&#?[a-z0-9]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

const keyOf = link => {
  try {
    const u = new URL(link);
    [...u.searchParams.keys()].filter(k => /^utm_|^ref$|^source$/.test(k)).forEach(k => u.searchParams.delete(k));
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + (u.search || '')).toLowerCase();
  } catch (e) { return String(link).toLowerCase(); }
};

const perFeed = feeds.map(() => []);
const failed = new Set();
const feedIndex = new Map(feeds.map((f, i) => [f.url, i]));
const anyFromFeed = new Set();

const input = $input.all();
for (let n = 0; n < input.length; n++) {
  const item = input[n];
  // Trace each article back to the Feed List entry that produced it.
  let idx = -1;
  try { idx = feedIndex.get($('Feed List').itemMatching(n).json.url); } catch (e) { idx = -1; }
  const f = feeds[idx];
  if (!f) continue;
  anyFromFeed.add(idx);
  const j = item.json || {};
  if (j.error) { failed.add(f.source); continue; }
  if (!j.title || !j.link || /bbc\.co\.uk\/sounds\//.test(j.link)) continue;
  const ts = Date.parse(j.isoDate || j.pubDate || '') || null;
  if (ts && now - ts > f.window * 3600 * 1000) continue;
  const key = keyOf(j.link);
  if (seen[key]) continue;
  let text = clean(j.contentSnippet || j.summary || j.content || j['content:encodedSnippet'] || '')
    .replace(/\s*The post .{0,200} appeared first on .*$/i, '');
  let meta = '';
  // Hacker News snippets are just URLs and counts, so turn them into a meta line instead.
  const hn = text.match(/Comments URL:\s*(\S+)\s*Points:\s*(\d+)\s*# Comments:\s*(\d+)/);
  if (hn) { meta = `${hn[2]} points · [${hn[3]} comments](${hn[1]})`; text = ''; }
  perFeed[idx].push({
    section: f.section,
    source: f.source,
    title: clean(j.title),
    link: j.link,
    key,
    ts,
    meta,
    text: text.slice(0, 450),
  });
}

// Feeds that returned nothing at all also count as failed, so we notice silent breakage.
feeds.forEach((f, i) => { if (!anyFromFeed.has(i)) failed.add(f.source); });

const items = [];
const keys = new Set();
perFeed.forEach((list, i) => {
  list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  for (const it of list.slice(0, feeds[i].max)) {
    if (keys.has(it.key)) continue;
    keys.add(it.key);
    items.push({ id: items.length, ...it });
  }
});

const lines = items.map(it => JSON.stringify({ id: it.id, section: it.section, source: it.source, title: it.title, text: it.text }));

const prompt = `Today is ${$now.toFormat('cccc d LLLL yyyy')}. Below are ${items.length} candidate items for a morning brief, one JSON object per line.

The reader is a UK-based founder who builds AI-powered SaaS products and automation tools. They care most about: new models and pricing, AI product launches, developer tooling, agents, AI safety incidents, SaaS growth and go-to-market, plus genuinely major world and business news.

For EVERY item return an object with:
- "id": the item id
- "summary": 1 to 2 factual sentences (max 45 words) on what happened or what the piece argues. Use ONLY the title and text given. Never invent facts, numbers, names or quotes. If the text is thin, restate the title plainly.
- "why": one short clause (max 20 words) on why it matters to an AI or SaaS builder. Use "" unless the link is direct and obvious. Never stretch a general news story to fit.
- "score": integer 1 to 5 for importance to this reader.
    5 = major model or product launch, pricing change, acquisition, big funding round, serious incident, or major world event
    4 = notable development a builder should know about
    3 = useful or interesting
    2 = minor, niche or promotional (customer case studies, vendor marketing, podcasts recaps, quote posts)
    1 = irrelevant (sport, celebrity, lifestyle, gaming)
- "same_as": if this item covers the SAME story as an earlier item in the list, that item's id, otherwise null.

Also return "top": the ids of the 5 most important distinct stories, best first. Never pick two items about the same story. Prefer concrete news over opinion, and stories that several sources cover.

Write in British English. Never use em-dashes. Respond with JSON only, exactly this shape:
{"top":[3,7,1,12,5],"items":[{"id":0,"summary":"...","why":"","score":3,"same_as":null}]}

ITEMS:
${lines.join('\n')}`;

return [{ json: { items, failed: [...failed], prompt } }];

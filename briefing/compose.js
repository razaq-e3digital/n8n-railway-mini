// Turns the summaries into Discord embeds (one message per section) and records what was sent.
const cfg = $('Config').first().json;
const prep = $('Select Items').first().json;
const items = prep.items || [];
const now = Date.now();
const DAY = 86400000;

// ---- Parse the summariser's JSON, tolerating code fences or stray text.
let llm = {};
try {
  const raw = (($input.first().json.choices || [])[0] || {}).message?.content || '';
  const m = raw.replace(/```(json)?/gi, '').match(/\{[\s\S]*\}/);
  if (m) llm = JSON.parse(m[0]);
} catch (e) { llm = {}; }
const llmOk = Array.isArray(llm.items) && llm.items.length > 0;
const byId = {};
for (const x of (llm.items || [])) if (x && x.id !== undefined) byId[Number(x.id)] = x;

const noDash = s => String(s || '').replace(/\s*[—–]\s*/g, ', ').trim();
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...' : s);
const linkTitle = t => t.replace(/\[/g, '(').replace(/\]/g, ')');
const linkUrl = u => String(u).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
const ago = ts => {
  if (!ts) return '';
  const h = Math.max(0, Math.round((now - ts) / 3600000));
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

for (const it of items) {
  const s = byId[it.id] || {};
  it.summary = noDash(s.summary) || trunc(it.text || '', 220);
  it.why = noDash(s.why);
  it.score = llmOk ? (Number(s.score) || 2) : 3;
  it.also = [];
}

// ---- Merge items the summariser flagged as the same story into the first one.
const rootOf = it => {
  let cur = it;
  for (let hops = 0; hops < 10; hops++) {
    const s = byId[cur.id] || {};
    const t = s.same_as === null || s.same_as === undefined || s.same_as === '' ? null : items[Number(s.same_as)];
    // Only follow links to an earlier item, which also rules out cycles (a -> b -> a).
    if (!t || t.id >= cur.id) return cur;
    cur = t;
  }
  return cur;
};
for (const it of items) {
  const root = rootOf(it);
  if (root.id !== it.id) {
    it.dup = true;
    root.also.push(it);
    root.score = Math.max(root.score, it.score);
  }
}

// ---- Weather
const w = $('Weather').first().json || {};
const wmo = {0:'clear sky',1:'mainly clear',2:'partly cloudy',3:'overcast',45:'fog',48:'rime fog',51:'light drizzle',53:'drizzle',55:'dense drizzle',61:'light rain',63:'rain',65:'heavy rain',71:'light snow',73:'snow',75:'heavy snow',80:'rain showers',81:'rain showers',82:'heavy rain showers',95:'thunderstorm',96:'thunderstorm with hail',99:'thunderstorm with hail'};
const cur = w.current_weather || {};
const d = w.daily || {};
const first = a => (Array.isArray(a) ? a[0] : '?');
const weather = cur.temperature !== undefined
  ? `**${cfg.location}:** ${Math.round(cur.temperature)}°C and ${wmo[cur.weathercode] || 'mixed'} now. High ${Math.round(first(d.temperature_2m_max))}°C, low ${Math.round(first(d.temperature_2m_min))}°C, ${first(d.precipitation_probability_max)}% chance of rain.`
  : `**${cfg.location}:** weather unavailable today.`;

// ---- Top stories
const ranked = items.filter(i => !i.dup).sort((a, b) => b.score - a.score || b.also.length - a.also.length || (b.ts || 0) - (a.ts || 0));
let topIds = (Array.isArray(llm.top) ? llm.top : []).map(Number).filter(id => items[id]).map(id => rootOf(items[id]).id);
topIds = [...new Set(topIds)];
for (const it of ranked) { if (topIds.length >= 5) break; if (!topIds.includes(it.id) && it.score >= 4) topIds.push(it.id); }
topIds = topIds.slice(0, 5);
const topSet = new Set(topIds);

const fmt = (it, withWhy) => {
  let s = `**[${trunc(linkTitle(it.title), 150)}](${linkUrl(it.link)})**\n*${it.source}${it.ts ? ' · ' + ago(it.ts) : ''}*${it.meta ? ' · ' + it.meta : ''}`;
  if (it.summary) s += `\n${trunc(it.summary, 320)}`;
  if (withWhy && it.why) s += `\n> ${trunc(it.why, 160)}`;
  const also = it.also.filter(a => a.source !== it.source || a.link !== it.link).slice(0, 4);
  if (also.length) s += `\nAlso covered by: ${also.map(a => `[${a.source}](${linkUrl(a.link)})`).join(', ')}`;
  return s;
};

// ---- Pack lines into embeds of at most ~3900 characters (Discord limit is 4096).
const embeds = [];
const pack = (title, color, header, blocks, footer) => {
  let desc = header ? header + '\n\n' : '';
  let part = 0;
  const flush = () => {
    embeds.push({ title: part === 0 ? title : `${title} (continued)`, description: desc.trim(), color });
    part++; desc = '';
  };
  for (const b of blocks) {
    if ((desc + b).length > 3900 && desc) flush();
    desc += b + '\n\n';
  }
  if (desc.trim() || part === 0) flush();
  if (footer) embeds[embeds.length - 1].footer = { text: footer };
};

const dateTitle = `Daily Briefing · ${$now.toFormat('cccc d LLLL yyyy')}`;
pack(dateTitle, 5814783, weather + (topIds.length ? '\n\n__**Top stories**__' : ''), topIds.map(id => fmt(items[id], true)));

const SECTIONS = [
  ['news', 'World and business news', 15158332, 8],
  ['labs', 'AI labs and vendors', 10181046, 8],
  ['builders', 'Builders and commentary', 3066993, 8],
  ['saas', 'SaaS and growth', 15844367, 4],
  ['tech', 'Tech and infrastructure', 3447003, 8],
];
for (const [key, title, color, cap] of SECTIONS) {
  const list = items
    // News is always shown (ranked by score); other sections drop items scored 1 (irrelevant).
    .filter(i => i.section === key && !i.dup && !topSet.has(i.id) && (!llmOk || key === 'news' || i.score >= 2))
    .sort((a, b) => b.score - a.score || (b.ts || 0) - (a.ts || 0))
    .slice(0, cap);
  if (list.length) pack(title, color, '', list.map(i => fmt(i, false)));
}

// ---- OpenRouter free models
const models = (($('OpenRouter Models').first().json || {}).data) || [];
const free = models.filter(m => m && m.pricing && String(m.pricing.prompt) === '0' && String(m.pricing.completion) === '0' && !String(m.id).startsWith('openrouter/'));
if (free.length) {
  const ctx = n => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}K`) + ' context';
  const blurb = m => trunc(noDash(String(m.description || '').replace(/\s+/g, ' ').split(/(?<=\.)\s/)[0]), 160);
  const line = m => {
    const mods = ((m.architecture || {}).input_modalities || ['text']).join(' + ');
    const added = m.created ? `added ${ago(m.created * 1000)}` : '';
    return `**[${linkTitle(m.name || m.id)}](https://openrouter.ai/${m.id})**\n\`${m.id}\` · ${ctx(m.context_length || 0)} · ${mods}${added ? ' · ' + added : ''}\n${blurb(m)}`;
  };
  const byNew = [...free].sort((a, b) => (b.created || 0) - (a.created || 0));
  const fresh = byNew.filter(m => m.created && now - m.created * 1000 <= 7 * DAY);
  const rest = byNew.filter(m => !fresh.includes(m)).slice(0, Math.max(0, 5 - fresh.length));
  const leaving = free.filter(m => m.expiration_date && Date.parse(m.expiration_date) - now <= 21 * DAY && Date.parse(m.expiration_date) > now);
  const blocks = [];
  blocks.push(fresh.length ? '__**New this week**__' : '__**New this week**__\nNo new free models in the last 7 days.');
  fresh.forEach(m => blocks.push(line(m)));
  if (rest.length) { blocks.push('__**Latest free models**__'); rest.forEach(m => blocks.push(line(m))); }
  if (leaving.length) blocks.push('__**Free access ending soon**__\n' + leaving.map(m => `\`${m.id}\` ends ${m.expiration_date}`).join('\n'));
  pack('Free models on OpenRouter', 6570404, `${free.length} free models available in total.`, blocks);
}

// ---- Footer on the last embed: sources that failed today and whether summaries fell back.
const notes = [];
const servedBy = String($input.first().json.model || '');
if (!llmOk) notes.push('Summariser unavailable, showing feed excerpts');
else if (servedBy && !/nemotron-3-ultra/.test(servedBy)) notes.push(`Summarised by fallback model ${servedBy}`);
if ((prep.failed || []).length) notes.push('Feeds unavailable: ' + prep.failed.join(', '));
if (notes.length) embeds[embeds.length - 1].footer = { text: trunc(notes.join(' | '), 2000) };

// ---- Remember what was considered so it is not repeated tomorrow. Keep 14 days of history.
const store = $getWorkflowStaticData('global');
const seen = store.seen || {};
for (const it of items) seen[it.key] = now;
for (const k of Object.keys(seen)) if (now - seen[k] > 14 * DAY) delete seen[k];
store.seen = seen;

return embeds.map(e => ({ json: { payload: { embeds: [e] } } }));

// Runs select.js (and optionally compose.js) locally against a saved execution.
// Usage: node harness.js <exec.json> [compose]
const fs = require('fs');
const path = require('path');
const exec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''));
const rd = exec.data.resultData.runData;
const out = name => rd[name][0].data.main[0];
const store = {};
const $now = { toFormat: () => 'Saturday 10 October 2026' };
const run = (file, input, extra = {}) => {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const nodeOut = Object.assign({}, extra);
  const $ = name => ({
    all: () => nodeOut[name] || out(name),
    first: () => (nodeOut[name] || out(name))[0],
    // Mimics n8n: follow the input item's recorded pairedItem back to this node.
    itemMatching: n => { const p = input[n].pairedItem; return (nodeOut[name] || out(name))[(Array.isArray(p) ? p[0] : p).item]; },
  });
  const $input = { all: () => input, first: () => input[0] };
  return new Function('$', '$input', '$now', '$getWorkflowStaticData', src)($, $input, $now, () => store);
};
const sel = run('select.js', out('Read Feeds'));
const s = sel[0].json;
console.log('candidates', s.items.length, 'failed', s.failed);
for (const it of s.items) console.log(it.id, it.section, it.source, '|', it.title.slice(0, 70), '|', it.link.slice(0, 60));
if (process.argv[3] === 'compose') {
  const msgs = run('compose.js', out(['Summarise (Fallback)', 'Summarise (Ultra retry)', 'Summarise (Ultra)', 'Summarise (OpenRouter)'].find(n => rd[n])), { 'Select Items': sel });
  for (const m of msgs) { const e = m.json.payload.embeds[0]; console.log('\n####', e.title, `[${e.description.length}]`, e.footer ? 'footer=' + e.footer.text : ''); console.log(e.description); }
}

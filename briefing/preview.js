// Re-runs select + compose on a saved execution and writes:
//   payloads.json (Discord messages) and seen.json (static data to seed production).
const fs = require('fs');
const path = require('path');
const [, , execPath, outDir] = process.argv;
const exec = JSON.parse(fs.readFileSync(execPath, 'utf8').replace(/^﻿/, ''));
const rd = exec.data.resultData.runData;
const out = name => rd[name][0].data.main[0];
const store = {};
// Stub for n8n's Luxon $now: the date the saved execution ran, as compose.js formats it.
const runDate = new Date(exec.startedAt || Date.now()).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).replace(',', '');
const $now = { toFormat: () => runDate };
const run = (file, input, extra = {}) => {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const $ = name => ({
    all: () => extra[name] || out(name),
    first: () => (extra[name] || out(name))[0],
    itemMatching: n => { const p = input[n].pairedItem; return (extra[name] || out(name))[(Array.isArray(p) ? p[0] : p).item]; },
  });
  return new Function('$', '$input', '$now', '$getWorkflowStaticData', src)($, { all: () => input, first: () => input[0] }, $now, () => store);
};
const sel = run('select.js', out('Read Feeds'));
const summNode = ['Summarise (Fallback)', 'Summarise (Ultra retry)', 'Summarise (Ultra)', 'Summarise (OpenRouter)'].find(n => rd[n]);
if (!summNode) throw new Error('preview.js: no summariser node in this execution. Did the run finish?');
const msgs = run('compose.js', out(summNode), { 'Select Items': sel });
fs.writeFileSync(path.join(outDir, 'payloads.json'), JSON.stringify(msgs.map(m => m.json.payload)));
fs.writeFileSync(path.join(outDir, 'seen.json'), JSON.stringify({ global: { seen: store.seen } }));
console.log('messages', msgs.length, 'seen', Object.keys(store.seen).length);

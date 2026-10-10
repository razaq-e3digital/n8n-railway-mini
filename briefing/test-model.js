// Benchmarks a summariser model against the prompt from a saved execution.
// Usage: node briefing/test-model.js <exec.json> <model> [reasoning: off|medium|high]
// Reads OPENROUTER_API_KEY from secrets.local. Writes the raw reply next to the exec file.
const fs = require('fs');
const path = require('path');
const [, , execPath, model, reasoning = 'off'] = process.argv;
const secrets = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', 'secrets.local'), 'utf8')
  .split('\n').map(l => l.match(/^([A-Z_0-9]+)=(\S+)/)).filter(Boolean).map(m => [m[1], m[2]]));
const exec = JSON.parse(fs.readFileSync(execPath, 'utf8').replace(/^﻿/, ''));
const sel = exec.data.resultData.runData['Select Items'][0].data.main[0][0].json;

(async () => {
  const body = {
    model, temperature: 0.3, max_tokens: 16000,
    response_format: { type: 'json_object' },
    reasoning: reasoning === 'off' ? { enabled: false } : { effort: reasoning },
    messages: [
      { role: 'system', content: 'You are the editor of a daily intelligence brief. You summarise accurately from the supplied text only, in British English, never using em-dashes, and you reply with valid JSON only.' },
      { role: 'user', content: sel.prompt },
    ],
  };
  const t0 = Date.now();
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${secrets.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  const secs = Math.round((Date.now() - t0) / 1000);
  if (!r.ok || !j.choices) { console.log(`${model} [${reasoning}] HTTP ${r.status} after ${secs}s:`, JSON.stringify(j).slice(0, 400)); return; }
  const c = j.choices[0].message.content || '';
  fs.writeFileSync(execPath.replace(/\.json$/, `.${model.replace(/[/:]/g, '_')}.${reasoning}.txt`), c);
  let p = null; try { p = JSON.parse(c.replace(/```(json)?/g, '').match(/\{[\s\S]*\}/)[0]); } catch (e) {}
  console.log(`${model} [${reasoning}] served=${j.model} ${secs}s finish=${j.choices[0].finish_reason} tokens=${j.usage.prompt_tokens}/${j.usage.completion_tokens} json=${!!p} items=${p ? p.items.length : 0}/${sel.items.length}`);
  if (!p) return;
  const byId = Object.fromEntries(p.items.map(x => [x.id, x]));
  console.log('  TOP:', (p.top || []).map(id => sel.items[id] && `${sel.items[id].source}: ${sel.items[id].title.slice(0, 60)}`).join('\n       '));
  const dups = p.items.filter(x => x.same_as !== null && x.same_as !== undefined).map(x => `${x.id}->${x.same_as}`);
  console.log('  same_as:', dups.join(' '));
  console.log('  scores:', JSON.stringify(p.items.reduce((a, x) => (a[x.score] = (a[x.score] || 0) + 1, a), {})));
  const whyCount = p.items.filter(x => x.why).length;
  console.log(`  items with a "why": ${whyCount}`);
  for (const id of [0, 3, 13, 27, 47].filter(i => sel.items[i])) console.log(`  #${id} ${sel.items[id].title.slice(0, 60)}\n     S: ${byId[id]?.summary}\n     W: ${byId[id]?.why} | score ${byId[id]?.score}`);
})();

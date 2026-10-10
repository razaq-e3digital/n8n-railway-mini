// Test or deploy the Daily Briefing workflow from the files in this folder.
//
//   node briefing/deploy.js test     Runs the new version as a temporary copy (no Discord post)
//                                    and prints the brief it would send.
//   node briefing/deploy.js prod     Updates the live workflow in place (keeps its schedule,
//                                    credentials, Discord webhook and "seen links" memory).
//   node briefing/deploy.js post     Like test, but the copy also posts to Discord.
//
// Credentials come from secrets.local (gitignored). Node 18+ is required for fetch.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const mode = process.argv[2];
if (!['test', 'prod', 'post'].includes(mode)) { console.error('usage: node briefing/deploy.js test|prod|post'); process.exit(1); }

const root = path.join(__dirname, '..');
const secrets = Object.fromEntries(fs.readFileSync(path.join(root, 'secrets.local'), 'utf8')
  .split('\n').map(l => l.match(/^([A-Z_0-9]+)=(\S+)/)).filter(Boolean).map(m => [m[1], m[2]]));
const BASE = secrets.N8N_BASE_URL;
const PROD_ID = secrets.WF_DAILY_BRIEFING;
const TEST_NAME = 'Daily Briefing TEST (temporary)';
const tmp = path.join(require('os').tmpdir(), 'daily-briefing');
fs.mkdirSync(tmp, { recursive: true });

const api = async (method, url, body) => {
  const r = await fetch(`${BASE}/api/v1${url}`, {
    method, headers: { 'X-N8N-API-KEY': secrets.N8N_API_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1. Export the live workflow: build.js takes the schedule, Config, Weather, credentials and
  //    Discord webhook from it, so nothing secret has to live in this folder.
  const live = await api('GET', `/workflows/${PROD_ID}`);
  fs.writeFileSync(path.join(tmp, 'live.json'), JSON.stringify(live));
  fs.writeFileSync(path.join(tmp, `backup-${Date.now()}.json`), JSON.stringify(live));

  const buildMode = mode === 'prod' ? 'prod' : mode === 'post' ? 'test' : 'test-nopost';
  const outFile = path.join(tmp, `${buildMode}.json`);
  execFileSync(process.execPath, [path.join(__dirname, 'build.js'), path.join(tmp, 'live.json'), outFile, buildMode], { stdio: 'inherit' });
  const wf = JSON.parse(fs.readFileSync(outFile, 'utf8'));

  if (mode === 'prod') {
    wf.staticData = live.staticData; // keep the "seen links" memory so nothing repeats
    const res = await api('PUT', `/workflows/${PROD_ID}`, wf);
    if (!res.active) await api('POST', `/workflows/${PROD_ID}/activate`, {});
    const chk = await api('GET', `/workflows/${PROD_ID}`);
    console.log(`Deployed "${chk.name}": active=${chk.active}, ${chk.nodes.length} nodes, updated ${chk.updatedAt}`);
    return;
  }

  // 2. Test: reuse one temporary copy (deleting workflows soon after they run wedges n8n's
  //    insights writer, so the copy is left inactive between tests instead).
  const list = await api('GET', '/workflows?limit=250');
  let test = (list.data || []).find(w => w.name === TEST_NAME);
  wf.staticData = { global: { seen: {} } }; // fresh memory so the test sees a full day of items
  if (test) {
    if (test.active) await api('POST', `/workflows/${test.id}/deactivate`, {});
    await api('PUT', `/workflows/${test.id}`, wf);
  } else {
    test = await api('POST', '/workflows', wf);
  }
  await api('POST', `/workflows/${test.id}/activate`, {});
  const before = (await api('GET', `/executions?workflowId=${test.id}&limit=1`)).data?.[0]?.id;
  const hook = wf.nodes.find(n => n.type === 'n8n-nodes-base.webhook').parameters.path;
  const t = await fetch(`${BASE}/webhook/${hook}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  console.log(`Triggered test run (${t.status}). Waiting for it to finish, this can take several minutes...`);

  let ex;
  for (let i = 0; i < 120; i++) {
    await sleep(10000);
    ex = (await api('GET', `/executions?workflowId=${test.id}&limit=1`)).data?.[0];
    if (ex && ex.id !== before && !['running', 'new', 'waiting'].includes(ex.status)) break;
  }
  await api('POST', `/workflows/${test.id}/deactivate`, {});
  const full = await api('GET', `/executions/${ex.id}?includeData=true`);
  fs.writeFileSync(path.join(tmp, 'last-test-execution.json'), JSON.stringify(full));
  const rd = full.data.resultData.runData;
  console.log(`\nExecution ${ex.id}: ${ex.status} (${Math.round((Date.parse(ex.stoppedAt) - Date.parse(ex.startedAt)) / 1000)}s)`);
  for (const [name, runs] of Object.entries(rd)) {
    const r = runs[0];
    console.log(`  ${name.padEnd(24)} ${String(r.executionTime).padStart(7)}ms  items=${r.data?.main?.[0]?.length ?? 0}${r.error ? '  ERROR ' + r.error.message : ''}`);
  }
  const ran = ['Summarise (Ultra)', 'Summarise (Ultra retry)', 'Summarise (Fallback)'].filter(n => rd[n]);
  console.log(`\nSummariser attempts: ${ran.join(' -> ')}`);
  const llm = rd[ran[ran.length - 1]]?.[0]?.data?.main?.[0]?.[0]?.json || {};
  console.log(`\nSummariser: served by ${llm.model || 'none'}${llm.error ? ', error ' + JSON.stringify(llm.error).slice(0, 200) : ''}`);
  const sel = rd['Select Items']?.[0]?.data?.main?.[0]?.[0]?.json || {};
  console.log(`Candidates: ${(sel.items || []).length}; failed feeds: ${(sel.failed || []).join(', ') || 'none'}`);
  for (const m of rd['Build Messages']?.[0]?.data?.main?.[0] || []) {
    const e = m.json.payload.embeds[0];
    console.log(`\n######## ${e.title} [${e.description.length} chars]${e.footer ? ' footer: ' + e.footer.text : ''}\n${e.description}`);
  }
  console.log(`\nFull execution saved to ${path.join(tmp, 'last-test-execution.json')}`);
})().catch(e => { console.error(e.message); process.exit(1); });

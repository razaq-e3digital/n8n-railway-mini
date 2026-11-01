// Create or update the "Exposure Radar notifications" workflow on the n8n instance.
//
//   node exposure-radar/deploy.js
//
// Receives run notifications from the Exposure Radar engine on a Header Auth protected webhook
// and posts them to Discord. Credentials are referenced by id only, so nothing secret is written
// into the workflow: the webhook secret is the n8n credential "Exposure Radar webhook secret"
// (created by hand), and the Discord webhook is the n8n credential "Exposure Radar Discord
// webhook", created here from DISCORD_WEBHOOK in secrets.local if it does not exist yet.
//
// After deploying, the live workflow is exported (without static data or secret values) to
// exposure-radar/workflow.json, with credentials referenced by name only. Node 18+ is required
// for fetch.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const secrets = Object.fromEntries(fs.readFileSync(path.join(root, 'secrets.local'), 'utf8')
  .split('\n').map(l => l.match(/^([A-Z_0-9]+)=(\S+)/)).filter(Boolean).map(m => [m[1], m[2]]));
const BASE = (secrets.N8N_BASE_URL || '').replace(/\/+$/, '');
if (!BASE || !secrets.N8N_API_KEY) throw new Error('N8N_BASE_URL and N8N_API_KEY must be set in secrets.local.');
const NAME = 'Exposure Radar notifications';
const PATH = 'exposure-radar-events';
const AUTH_CRED = 'Exposure Radar webhook secret';
const DISCORD_CRED = 'Exposure Radar Discord webhook';
const ERROR_WORKFLOW = 'OMoMbuuxco4fVwWc'; // Watchdog, the same error workflow the Daily Briefing uses

const api = async (method, url, body) => {
  const r = await fetch(`${BASE}/api/v1${url}`, {
    method, headers: { 'X-N8N-API-KEY': secrets.N8N_API_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

// Lists every item of a collection, following n8n's cursor pages (each page holds at most 250).
const listAll = async url => {
  const items = [];
  let cursor;
  do {
    const page = await api('GET', `${url}?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...(page.data || []));
    cursor = page.nextCursor;
  } while (cursor);
  return items;
};

// Formats the Discord message. Runs inside the n8n Code node, so it is kept as a string.
const formatCode = `const KNOWN = ['run_started', 'run_finished', 'prospect_failed', 'llm_cap_reached'];
return $input.all().map(item => {
  const b = item.json.body || {};
  const event = typeof b.event === 'string' ? b.event : '';
  const message = typeof b.message === 'string' && b.message.trim()
    ? b.message.trim()
    : 'Event "' + (event || 'unknown') + '" received with no message.';
  let lines;
  if (!KNOWN.includes(event)) {
    lines = [message]; // unknown events are posted as they are, so new events still show up
  } else {
    lines = ['Exposure Radar: ' + message];
    if (event === 'prospect_failed') {
      const err = b.error == null || b.error === '' ? 'unknown' : typeof b.error === 'string' ? b.error : JSON.stringify(b.error);
      lines.push('Error: ' + err);
    }
    if (event === 'llm_cap_reached') lines.push('Reports will need a closer review today.');
  }
  // Stop engine text from pinging anyone (@everyone, @here, <@user>, <@&role>), and keep within
  // Discord's 2000 character limit.
  let content = lines.join('\\n').replace(/@(everyone|here)/g, '@\\u200b$1').replace(/<@/g, '<@\\u200b');
  if (content.length > 2000) content = content.slice(0, 1997) + '...';
  return { json: { content } };
});`;

(async () => {
  const creds = await listAll('/credentials');
  const auth = creds.find(c => c.name === AUTH_CRED && c.type === 'httpHeaderAuth');
  if (!auth) throw new Error(`No Header Auth credential named "${AUTH_CRED}" on the instance.`);
  let discord = creds.find(c => c.name === DISCORD_CRED && c.type === 'discordWebhookApi');
  if (!discord) {
    if (!secrets.DISCORD_WEBHOOK) throw new Error('DISCORD_WEBHOOK is missing from secrets.local.');
    const made = await api('POST', '/credentials', { name: DISCORD_CRED, type: 'discordWebhookApi', data: { webhookUri: secrets.DISCORD_WEBHOOK } });
    discord = { id: made.id, name: made.name };
    console.log(`Created credential "${DISCORD_CRED}" (${discord.id}).`);
  }

  const existing = (await listAll('/workflows')).find(w => w.name === NAME);
  const webhookId = existing
    ? (((await api('GET', `/workflows/${existing.id}`)).nodes || []).find(n => n.type === 'n8n-nodes-base.webhook') || {}).webhookId
    : undefined;

  const wf = {
    name: NAME,
    nodes: [
      {
        id: 'a3b1c6e0-0001-4e52-9a10-000000000001', name: 'Exposure Radar Webhook',
        type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300],
        webhookId: webhookId || crypto.randomUUID(),
        parameters: { httpMethod: 'POST', path: PATH, authentication: 'headerAuth', responseMode: 'onReceived', responseCode: 200, options: {} },
        credentials: { httpHeaderAuth: { id: auth.id, name: auth.name } },
      },
      {
        id: 'a3b1c6e0-0002-4e52-9a10-000000000002', name: 'Format Message',
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 300],
        parameters: { jsCode: formatCode },
      },
      {
        id: 'a3b1c6e0-0003-4e52-9a10-000000000003', name: 'Post to Discord',
        type: 'n8n-nodes-base.discord', typeVersion: 2, position: [480, 300],
        parameters: { authentication: 'webhook', content: '={{ $json.content }}', options: {} },
        credentials: { discordWebhookApi: { id: discord.id, name: discord.name } },
      },
    ],
    connections: {
      'Exposure Radar Webhook': { main: [[{ node: 'Format Message', type: 'main', index: 0 }]] },
      'Format Message': { main: [[{ node: 'Post to Discord', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', errorWorkflow: ERROR_WORKFLOW },
  };

  const saved = existing ? await api('PUT', `/workflows/${existing.id}`, wf) : await api('POST', '/workflows', wf);
  const id = saved.id;
  if (!saved.active) await api('POST', `/workflows/${id}/activate`);

  // Export with credentials referenced by name only: the ids are specific to this instance, and
  // this script looks the credentials up by name anyway.
  const live = await api('GET', `/workflows/${id}`);
  const exported = {
    name: live.name,
    nodes: live.nodes.map(n => n.credentials
      ? { ...n, credentials: Object.fromEntries(Object.entries(n.credentials).map(([type, c]) => [type, { name: c.name }])) }
      : n),
    connections: live.connections,
    settings: live.settings,
  };
  const out = path.join(__dirname, 'workflow.json');
  fs.writeFileSync(out, JSON.stringify(exported, null, 2) + '\n');
  console.log(`${existing ? 'Updated' : 'Created'} "${live.name}" (${id}): active=${live.active}, ${live.nodes.length} nodes.`);
  console.log(`Exported to ${out}`);
  console.log(`Production URL: ${BASE}/webhook/${PATH}`);
})().catch(e => { console.error(e.message); process.exit(1); });

// Usage: node build.js <live.json> <out.json> <prod|test>
const fs = require('fs');
const path = require('path');
const [, , livePath, outPath, mode] = process.argv;
const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
const code = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const old = name => live.nodes.find(n => n.name === name);

const discordUrl = old('Post to Discord').parameters.url;
// The OpenRouter credential is referenced by id, taken from whichever summariser node the live workflow has.
const orCreds = live.nodes.find(n => n.credentials && n.credentials.httpHeaderAuth && /openrouter/i.test(n.parameters.url || '')).credentials;

// Summariser. Ultra (550B) is the strongest free model on OpenRouter as of Oct 2026 but is
// sometimes overloaded, so OpenRouter falls through this list in order on provider errors.
const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const FALLBACKS = [MODEL, 'nvidia/nemotron-3-super-120b-a12b:free', 'openrouter/free'];

const x = i => i * 220;
const nodes = [];
const add = n => { nodes.push({ id: n.id || require('crypto').randomUUID(), ...n }); return n.name; };

const trigger = mode.startsWith('test')
  ? add({ name: 'Test Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [x(0), 300], webhookId: '6f0c2a9e-4b1d-4c7a-9e55-0b1d2b7e4a11',
      parameters: { httpMethod: 'POST', path: 'daily-brief-test-run', options: {} } })
  : add({ ...old('Every day 06:00') });

add({ ...old('Config'), position: [x(1), 300] });
add({ ...old('Weather'), position: [x(2), 300], onError: 'continueRegularOutput' });
add({ name: 'OpenRouter Models', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x(3), 300], onError: 'continueRegularOutput',
  parameters: { url: 'https://openrouter.ai/api/v1/models', options: { timeout: 30000 } } });
add({ name: 'Feed List', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x(4), 300], parameters: { jsCode: code('feeds.js') } });
add({ name: 'Read Feeds', type: 'n8n-nodes-base.rssFeedRead', typeVersion: 1.1, position: [x(5), 300], onError: 'continueRegularOutput',
  parameters: { url: '={{ $json.url }}', options: {} } });
add({ name: 'Select Items', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x(6), 300], parameters: { jsCode: code('select.js') } });
// Summariser: Ultra, then Ultra again after a pause, then the fallback list. OpenRouter reports an
// overloaded model as HTTP 200 with an "error" body, which n8n does not treat as a failure, so
// each attempt is followed by an explicit "did we get a summary?" check.
const summariser = (name, col, models) => add({
  name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x(col), 300],
  credentials: orCreds, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 15000,
  parameters: {
    method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ {
  ${models.length === 1 ? `model: "${models[0]}"` : `model: "${models[0]}",\n  models: ${JSON.stringify(models)}`},
  temperature: 0.3,
  max_tokens: 12000,
  reasoning: { enabled: false },
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: "You are the editor of a daily intelligence brief. You summarise accurately from the supplied text only, in British English, never using em-dashes, and you reply with valid JSON only." },
    { role: "user", content: $('Select Items').first().json.prompt }
  ]
} }}`,
    options: { timeout: 420000 },
  },
});
const gotSummary = (name, col) => add({
  name, type: 'n8n-nodes-base.if', typeVersion: 2, position: [x(col), 300],
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{
        id: require('crypto').randomUUID(),
        leftValue: '={{ !!($json.choices && $json.choices[0] && $json.choices[0].message && $json.choices[0].message.content) }}',
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  },
});

summariser('Summarise (Ultra)', 7, [MODEL]);
gotSummary('Got Summary?', 8);
add({ name: 'Pause Before Retry', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [x(9), 450], webhookId: require('crypto').randomUUID(),
  parameters: { amount: 45, unit: 'seconds' } });
summariser('Summarise (Ultra retry)', 10, [MODEL]);
gotSummary('Got Summary on Retry?', 11);
summariser('Summarise (Fallback)', 12, FALLBACKS.slice(1));
add({ name: 'Build Messages', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x(13), 300], parameters: { jsCode: code('compose.js') } });
add({ name: 'Post to Discord', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x(14), 300],
  disabled: mode === 'test-nopost',
  parameters: {
    method: 'POST', url: discordUrl, sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.payload }}',
    options: { batching: { batch: { batchSize: 1, batchInterval: 1500 } } },
  } });

const link = (from, to, output = 0) => {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node: to, type: 'main', index: 0 });
};
const connections = {};
const linear = [trigger, 'Config', 'Weather', 'OpenRouter Models', 'Feed List', 'Read Feeds', 'Select Items', 'Summarise (Ultra)', 'Got Summary?'];
for (let i = 0; i < linear.length - 1; i++) link(linear[i], linear[i + 1]);
link('Got Summary?', 'Build Messages', 0);
link('Got Summary?', 'Pause Before Retry', 1);
link('Pause Before Retry', 'Summarise (Ultra retry)');
link('Summarise (Ultra retry)', 'Got Summary on Retry?');
link('Got Summary on Retry?', 'Build Messages', 0);
link('Got Summary on Retry?', 'Summarise (Fallback)', 1);
link('Summarise (Fallback)', 'Build Messages');
link('Build Messages', 'Post to Discord');
const chain = nodes.map(n => n.name);
const out = {
  name: mode === 'prod' ? live.name : 'Daily Briefing TEST (temporary)',
  nodes, connections,
  settings: mode === 'prod' ? { executionOrder: 'v1', errorWorkflow: live.settings.errorWorkflow } : { executionOrder: 'v1' },
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${outPath}: ${chain.join(' -> ')}`);

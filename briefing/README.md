# Daily Briefing

This folder is the source of truth for the **Daily Briefing (Discord)** workflow on the n8n
instance (workflow id `WF_DAILY_BRIEFING` in `secrets.local`). It runs every day at 06:00
Europe/London and posts one Discord message per section.

Do not edit the workflow in the n8n editor and leave it there: the next deploy from this folder
overwrites it. Make changes here, test, deploy, commit.

## Where to change things

| To change | Edit |
|---|---|
| **Sources in the feed** (add, remove, look-back window, items per source) | `feeds.js` |
| Section names, colours and how many items each section shows | `SECTIONS` in `compose.js` |
| How items are summarised and scored (reader profile, scoring rules) | the `prompt` in `select.js` |
| Summariser model and fallback order | `MODEL` and `FALLBACKS` in `build.js` |
| Discord formatting, top stories, OpenRouter free-models section | `compose.js` |
| Schedule, location for weather | in the n8n editor (`Every day 06:00` and `Config` nodes). `build.js` copies these from the live workflow, so edits made there survive a deploy. |

### Adding a source

Add one line to `FEEDS` in `feeds.js`:

```js
['labs', 'Source name', 'https://example.com/feed.xml', 72, 3],
// section  label shown    RSS or Atom URL               window (hours)  max items per day
```

Sections: `news`, `labs` (AI labs and vendors), `builders`, `saas`, `tech`. Check the URL
returns RSS or Atom first. Sites without a feed can sometimes be covered by the community feeds
at `github.com/Olshansk/rss-feeds` (used for Anthropic, Meta AI, Mistral and xAI) or a YouTube
channel feed (`https://www.youtube.com/feeds/videos.xml?channel_id=...`).

## Test and deploy

Requires Node 18+ and `secrets.local` in the repo root.

```bash
node briefing/deploy.js test   # run a temporary copy (no Discord post) and print the brief
node briefing/deploy.js post   # same, but the copy also posts to Discord
node briefing/deploy.js prod   # update the live workflow in place
```

`prod` keeps the live workflow's schedule, Config, Weather, credentials, Discord webhook, error
workflow and its "seen links" memory. A backup of the live workflow is written to
`%TEMP%/daily-briefing/` before every run.

Other tools:

- `node briefing/test-model.js <execution.json> <model> [off|medium|high]` benchmarks a
  summariser model against the prompt from a saved execution.
- `node briefing/harness.js <execution.json> compose` re-runs `select.js` and `compose.js`
  locally against a saved execution, so formatting changes can be checked without n8n.

## How it works

```
Every day 06:00 -> Config -> Weather -> OpenRouter Models -> Feed List -> Read Feeds
  -> Select Items -> Summarise (Ultra) -> Got Summary? --yes--> Build Messages -> Post to Discord
                                              |no
                     Pause Before Retry (45s) -> Summarise (Ultra retry) -> Got Summary on Retry?
                                                                 |no
                                                 Summarise (Fallback) -> Build Messages
```

- **Select Items** keeps items inside each feed's window that have not been sent before (links
  are remembered in workflow static data for 14 days), caps each source and builds the prompt.
- The summariser returns JSON (summary, why it matters, score 1 to 5, duplicate-of id, top 5).
  Links are inserted by code, never by the model.
- OpenRouter reports an overloaded model as HTTP 200 with an `error` body, which n8n does not
  treat as a failure. That is why each attempt is followed by an explicit check.
- If every model fails, the brief still posts with feed excerpts and says so in the footer. The
  footer also names any fallback model used and any feeds that failed.

## Gotchas

- In a Code node, `$input.all()[n].pairedItem` is rewritten to the item's own index. Use
  `$('Feed List').itemMatching(n)` to trace an article back to its feed.
- Nemotron models spend their whole token budget on reasoning unless the request sends
  `reasoning: { enabled: false }`.
- Ultra with reasoning off takes roughly 1 to 4 minutes for about 60 items; with reasoning on it
  took over 7 minutes, so it stays off.
- Free models on OpenRouter allow 1,000 requests a day on this key; one brief uses 1 to 4.

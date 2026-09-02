# poliaule-cron

Cloudflare Worker that replaces the GitHub Actions `schedule:` trigger for the
occupancy fetch. GitHub's scheduler fired hours late (or skipped runs under
load); this Worker's Cron Triggers fire a `workflow_dispatch` via the GitHub REST
API instead, which GitHub queues within seconds.

## Setup

```bash
npm install

# Fine-grained PAT with "Actions: write" on SummaCristian/poliaule
wrangler secret put GITHUB_TOKEN

# Optional: enable the manual POST trigger (any random string). Without it,
# the HTTP endpoint is disabled and only the Cron Triggers can fire the workflow.
wrangler secret put TRIGGER_SECRET

# Optional: alert on Telegram if the dispatch call itself fails
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID

npm run deploy
```

Schedule and repo coordinates live in `wrangler.toml` (`[triggers].crons` and
`[vars]`). The crons mirror what used to be in `fetch-occupancy.yml`.

## Manual trigger

```bash
curl -X POST -H "Authorization: Bearer $TRIGGER_SECRET" \
  https://poliaule-cron.<subdomain>.workers.dev/

# skip the script's inter-call delays (faster; manual only):
curl -X POST -H "Authorization: Bearer $TRIGGER_SECRET" \
  "https://poliaule-cron.<subdomain>.workers.dev/?no_delay=true"
```

`no_delay` is only honoured on this manual endpoint. Scheduled (cron) runs always
keep the delays — that's `scripts/fetch.py`'s default and the polite thing to do
against PoliMi's API.

Or just run the workflow from the GitHub Actions tab — `workflow_dispatch` is
still enabled there.

## Extending

To drive `fetch-opening-hours.yml` or `fetch-photos.yml` the same way, either add
their crons here and branch on `event.cron` in `scheduled()`, or stand up a
second Worker. Those workflows still use `schedule:` today.

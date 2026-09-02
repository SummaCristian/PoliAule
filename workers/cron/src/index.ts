export interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_REF: string;
  WORKFLOW_FILE: string;
  GITHUB_TOKEN: string;
  TRIGGER_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/**
 * Fire a workflow_dispatch on the occupancy workflow. GitHub queues the run
 * within seconds, so this lands far closer to the intended time than the old
 * `schedule:` trigger did.
 */
async function dispatchWorkflow(env: Env, noDelay = false): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "poliaule-cron",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: env.GITHUB_REF,
      inputs: { no_delay: String(noDelay) },
    }),
  });

  // 204 No Content = accepted.
  if (res.status !== 204) {
    const detail = await res.text();
    throw new Error(`GitHub dispatch failed: ${res.status} ${res.statusText} — ${detail}`);
  }
}

async function notifyTelegram(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
}

async function run(env: Env): Promise<void> {
  try {
    await dispatchWorkflow(env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    await notifyTelegram(env, `❌ PoliAule cron could not trigger the occupancy fetch\n${msg}`);
    throw err;
  }
}

export default {
  // Cron Triggers.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env));
  },

  // Manual trigger: `curl -X POST -H "Authorization: Bearer <secret>" \
  //   "https://<worker-url>/?no_delay=true"`.
  // no_delay is manual-only; scheduled runs always keep the script's delays.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("POST to trigger the occupancy fetch.\n", { status: 405 });
    }
    // Manual trigger is gated by a shared secret. Cron runs don't go through here.
    if (!env.TRIGGER_SECRET) {
      return new Response("manual trigger disabled\n", { status: 403 });
    }
    if (request.headers.get("authorization") !== `Bearer ${env.TRIGGER_SECRET}`) {
      return new Response("forbidden\n", { status: 403 });
    }
    const noDelay = new URL(request.url).searchParams.get("no_delay") === "true";
    try {
      await dispatchWorkflow(env, noDelay);
      return new Response(`dispatched${noDelay ? " (no_delay)" : ""}\n`, { status: 202 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`${msg}\n`, { status: 502 });
    }
  },
};

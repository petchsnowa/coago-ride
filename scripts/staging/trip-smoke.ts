import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { withDatabase } from "@coago/db";
import { postgresAuthStore } from "../../apps/api/src/auth/store";
import { hash } from "../../apps/api/src/auth/crypto";
import { parseTestOrigin } from "../remote/config";
import { tripSmoke, type SmokeActor } from "../trip-smoke";
async function main() {
  const app = process.env.COAGO_STAGING_URL;
  assert.equal(
    app,
    "https://coago-line-test.akkarapatchara.workers.dev",
    "STAGING_ORIGIN_INVALID",
  );
  const database = process.env.COAGO_TEST_DATABASE_URL ?? "";
  parseTestOrigin(database);
  const direct = new URL(database);
  direct.searchParams.delete("channel_binding");
  direct.searchParams.set("sslmode", "verify-full");
  const url = direct.href,
    store = postgresAuthStore(url),
    ids: string[] = [];
  const actors: SmokeActor[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const token = randomBytes(32).toString("hex"),
        csrfToken = randomBytes(32).toString("hex");
      // No tokens/cookies or connection strings are printed, even on assertion failure.
      const now = new Date();
      const user = await store.createSession(
        {
          subject: "U" + randomBytes(16).toString("hex"),
          displayName: "Synthetic trip smoke tester",
        },
        await hash(token),
        csrfToken,
        new Date(now.getTime() + 600000),
        now,
      );
      ids.push(user.id);
      actors.push({ cookie: `__Host-coago_session=${token}`, csrfToken });
    }
    await tripSmoke(
      async (path, method, actor, body, origin = app) => {
        return fetch(new URL(path, app), {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            ...(actor
              ? { Cookie: actor.cookie, "X-CSRF-Token": actor.csrfToken }
              : {}),
            ...(method !== "GET"
              ? { Origin: origin!, "Content-Type": "application/json" }
              : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      },
      actors[0],
      actors[1],
    );
    console.log(
      "PASS remote Workers -> Hyperdrive -> Neon: trip CRUD, pending/cancelled ride requests and anonymous public search/detail, ownership, privacy projection, CSRF, replay and version conflict (synthetic sessions)",
    );
  } finally {
    if (ids.length)
      await withDatabase(url, async (_db, client) => {
        await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
          ids,
        ]);
        const result = await client.query(
          "SELECT count(*)::int AS count FROM users WHERE id = ANY($1::uuid[])",
          [ids],
        );
        assert.equal(result.rows[0].count, 0);
      });
    console.log("SYNTHETIC_TRIP_ACCOUNTS_CLEANED");
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      "\n## Phase 2B remote trip verification\n\nReal HTTPS Workers → Hyperdrive → Neon CRUD, pending/cancelled ride requests (one-seat, no capacity mutation, private actor lists, ownership/CSRF, retry/resubmit) and anonymous discovery passed using two disposable synthetic sessions: public route/Thai-date search, safe detail projection, updated-seat visibility, cancelled detail/search exclusion, owner-only list/edit/cancel, CSRF rejection, duplicate create retry, stale version rejection and immutable cancelled trip. Synthetic accounts and their trips/sessions removed. Real LINE login was previously owner-tested; this smoke test does not replace a new manual trip walkthrough.\n",
    );
}
main().catch(() => {
  console.error("REMOTE_TRIP_SMOKE_FAILED (sensitive details suppressed)");
  process.exitCode = 1;
});

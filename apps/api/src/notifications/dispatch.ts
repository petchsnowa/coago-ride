import { withDatabase } from "@coago/db";
import { databaseUrl, type Bindings } from "../bindings";
import { transaction } from "../community/shared";
import {
  messagingReady,
  remainingQuota,
  pushNotification,
  notificationConsent,
} from "./provider";
export async function dispatchNotification(
  env: Bindings,
  request: typeof fetch = fetch,
) {
  if (!messagingReady(env)) return "disabled";
  const token = env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN!;
  try {
    if ((await remainingQuota(token, request)) < 1) return "quota";
  } catch {
    return "quota_unavailable";
  }
  const url = databaseUrl(env);
  const job = await transaction(url, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(71934682)");
    await c.query(
      "UPDATE notification_outbox SET status='skipped',error_code='expired' WHERE status IN ('pending','processing') AND created_at<now()-interval '23 hours'",
    );
    await c.query(
      "UPDATE notification_outbox SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,error_code='worker_interrupted' WHERE status='processing' AND claimed_at<now()-interval '5 minutes'",
    );
    const budget = (
      await c.query(
        "SELECT count(*) FILTER(WHERE first_attempt_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')::int AS daily,count(*) FILTER(WHERE first_attempt_at >= date_trunc('month',now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')::int AS monthly FROM notification_outbox",
      )
    ).rows[0];
    const row = (
      await c.query(
        "SELECT o.*,i.subject FROM notification_outbox o JOIN users u ON u.id=o.user_id JOIN notification_preferences p ON p.user_id=o.user_id JOIN external_identities i ON i.user_id=o.user_id AND i.provider='line' WHERE o.status='pending' AND o.next_attempt_at<=now() AND o.attempts<3 AND u.status='active' AND p.enabled AND p.consent_version=$1 AND (o.first_attempt_at IS NOT NULL OR ($2::int<5 AND $3::int<50)) ORDER BY o.created_at,o.id LIMIT 1 FOR UPDATE OF o,u,p SKIP LOCKED",
        [notificationConsent, budget.daily, budget.monthly],
      )
    ).rows[0];
    if (!row) return null;
    await c.query(
      "UPDATE notification_outbox SET status='processing',attempts=attempts+1,claimed_at=now(),first_attempt_at=coalesce(first_attempt_at,now()) WHERE id=$1",
      [row.id],
    );
    return { ...row, attempts: row.attempts + 1 };
  });
  if (!job) return "idle";
  const result = await pushNotification(
    token,
    job.subject,
    job.kind,
    job.retry_key,
    request,
  );
  await withDatabase(url, async (_db, c) => {
    const status =
      result === "retry" ? (job.attempts >= 3 ? "failed" : "pending") : result;
    await c.query(
      "UPDATE notification_outbox SET status=$2,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END,next_attempt_at=now()+($3::int*interval '5 minutes'),error_code=$4 WHERE id=$1 AND status='processing' AND attempts=$5",
      [
        job.id,
        status,
        2 ** (job.attempts - 1),
        result === "sent"
          ? null
          : result === "retry"
            ? "provider_unavailable"
            : "provider_rejected",
        job.attempts,
      ],
    );
  });
  return result;
}

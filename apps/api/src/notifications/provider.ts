import type { Bindings } from "../bindings";
export const notificationConsent = "2026-11-12";
export function messagingReady(env: Bindings) {
  return (
    env.LINE_MESSAGING_ENABLED === "true" &&
    env.LINE_MESSAGING_PROVIDER_CONFIRMED === "true" &&
    !!env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN &&
    env.APP_ORIGIN === "https://coago.space"
  );
}
export const notificationText: Record<string, string> = {
  request_created: "มีคำขอร่วมเดินทางใหม่",
  request_accepted: "คำขอร่วมเดินทางของคุณได้รับการตอบรับแล้ว",
  request_rejected: "คำขอร่วมเดินทางของคุณไม่ได้รับการตอบรับ",
  request_cancelled: "ผู้ร่วมทางยกเลิกคำขอแล้ว",
  trip_cancelled: "เที่ยวเดินทางที่คุณขอร่วมถูกยกเลิกแล้ว",
  journey_updated: "สถานะการเดินทางของคุณมีการอัปเดต",
};
export async function remainingQuota(
  token: string,
  request: typeof fetch = fetch,
) {
  const read = async (path: string) => {
    const r = await request(`https://api.line.me/v2/bot/message/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw Error("LINE_QUOTA_UNAVAILABLE");
    return (await r.json()) as Record<string, unknown>;
  };
  const [q, c] = await Promise.all([read("quota"), read("quota/consumption")]);
  if (
    q.type !== "limited" ||
    !Number.isSafeInteger(q.value) ||
    !Number.isSafeInteger(c.totalUsage) ||
    Number(q.value) < 0 ||
    Number(c.totalUsage) < 0
  )
    throw Error("LINE_QUOTA_UNCONFIRMED");
  return Math.max(0, Number(q.value) - Number(c.totalUsage));
}
export async function pushNotification(
  token: string,
  recipient: string,
  kind: string,
  retryKey: string,
  request: typeof fetch = fetch,
) {
  if (!/^U[0-9a-f]{32}$/.test(recipient) || !notificationText[kind])
    return "failed" as const;
  try {
    const r = await request("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": retryKey,
      },
      body: JSON.stringify({
        to: recipient,
        messages: [
          {
            type: "text",
            text: `COAGO: ${notificationText[kind]}\nดูรายละเอียดในบัญชีของคุณ https://coago.space/#my-journeys`,
          },
        ],
      }),
    });
    if (
      r.ok ||
      (r.status === 409 && r.headers.has("x-line-accepted-request-id"))
    )
      return "sent" as const;
    return r.status >= 500 ? ("retry" as const) : ("failed" as const);
  } catch {
    return "retry" as const;
  }
}

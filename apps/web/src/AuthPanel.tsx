import { useEffect, useState } from "react";
import { authStateSchema, type AuthState } from "@coago/contracts";
export default function AuthPanel() {
  const [account, setAccount] = useState<AuthState | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 8000);
    setError(false);
    fetch("/api/auth/me", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const data = authStateSchema.parse(await response.json());
        if (active) setAccount(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);
  async function logout() {
    if (!account?.csrfToken || busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": account.csrfToken },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("unavailable");
      setAccount({ user: null, csrfToken: null, loginAvailable: true });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const failed =
    new URLSearchParams(window.location.search).get("auth") === "failed";
  return (
    <section className="account" aria-labelledby="account-title">
      <div>
        <p className="eyebrow">บัญชีของฉัน</p>
        <h2 id="account-title">เริ่มต้นด้วยบัญชี LINE</h2>
        <p>ระบบทดสอบสำหรับ COAGO Test · ยังไม่เปิดรับจอง</p>
      </div>
      <div className="account-actions">
        {account?.user ? (
          <>
            <p className="welcome">สวัสดี {account.user.displayName}</p>
            <button onClick={logout} disabled={busy}>
              {busy ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}
            </button>
          </>
        ) : account?.loginAvailable ? (
          <a className="line-login" href="/api/auth/line/start">
            เข้าสู่ระบบด้วย LINE
          </a>
        ) : !error ? (
          <p>{account ? "ระบบเข้าสู่ระบบยังไม่พร้อม" : "กำลังตรวจสอบบัญชี…"}</p>
        ) : null}
        {(error || failed) && (
          <p role="alert">
            {failed
              ? "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง"
              : "โหลดข้อมูลบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง"}
          </p>
        )}
        {error && (
          <button
            className="secondary"
            onClick={() => setAttempt((v) => v + 1)}
          >
            ลองโหลดบัญชีอีกครั้ง
          </button>
        )}
      </div>
    </section>
  );
}

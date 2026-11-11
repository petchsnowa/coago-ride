import { useEffect, useState } from "react";
import { authStateSchema, type AuthState } from "@coago/contracts";
export default function AdminLogin({
  onAccountChange,
}: {
  onAccountChange: (v: AuthState | null) => void;
}) {
  const [account, setAccount] = useState<AuthState | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [otp, setOtp] = useState(""),
    [name, setName] = useState(""),
    [enabled, setEnabled] = useState(false),
    [mode, setMode] = useState<
      "login" | "register" | "verify" | "forgot" | "reset"
    >(new URLSearchParams(location.search).has("token") ? "reset" : "login"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/admin-auth/config", { signal: controller.signal }).then((r) =>
        r.json(),
      ),
      fetch("/api/admin-auth/me", { signal: controller.signal }).then((r) =>
        r.json(),
      ),
    ])
      .then(([config, data]) => {
        if (!controller.signal.aborted) {
          setEnabled(config.enabled === true);
          setAccount(authStateSchema.parse(data));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage("ระบบเข้าสู่ระบบผู้ดูแลไม่พร้อม");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => onAccountChange(account), [account, onAccountChange]);
  async function submit(action: string = mode) {
    setBusy(true);
    setMessage("");
    try {
      const body =
        action === "login"
          ? { email, password }
          : action === "register"
            ? { email, password, name }
            : action === "verify"
              ? { email, otp }
              : action === "reset"
                ? {
                    token: new URLSearchParams(location.search).get("token"),
                    newPassword: password,
                  }
                : action === "logout"
                  ? {}
                  : { email };
      const response = await fetch(`/api/admin-auth/${action}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(account?.csrfToken
              ? { "X-CSRF-Token": account.csrfToken }
              : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        }),
        data = await response.json().catch(() => null);
      if (!response.ok)
        throw Error(
          data?.error === "account_exists_or_registration_failed"
            ? "ตั้งบัญชีไม่ได้ หากเคยตั้งบัญชีแล้วให้ใช้ลืมรหัสผ่าน"
            : data?.error === "email_limit"
              ? "ส่งอีเมลถึงขีดจำกัด กรุณาลองภายหลัง"
              : data?.error === "too_many_attempts"
                ? "ลองหลายครั้งเกินไป กรุณารอ 10 นาที"
                : data?.error === "invalid_verification"
                  ? "รหัสยืนยันไม่ถูกต้องหรือหมดอายุ"
                  : "ทำรายการไม่ได้ ตรวจอีเมล รหัสผ่าน และการยืนยันอีเมล",
        );
      if (action === "login") setAccount(authStateSchema.parse(data));
      if (action === "logout")
        setAccount({ user: null, csrfToken: null, loginAvailable: true });
      setPassword("");
      if (action === "register") setMode("verify");
      if (action === "reset")
        setAccount({ user: null, csrfToken: null, loginAvailable: true });
      if (action === "verify" || action === "reset") {
        setMode("login");
        history.replaceState({}, "", location.pathname);
      }
      setMessage(
        data?.message ??
          (action === "verify"
            ? "ยืนยันอีเมลแล้ว กรุณาเข้าสู่ระบบ"
            : "ทำรายการสำเร็จ"),
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account">
      <h2>เข้าสู่ระบบผู้ดูแล</h2>
      <p>
        ใช้อีเมลเป็นชื่อผู้ใช้ พร้อมรหัสผ่านและอีเมลที่ยืนยันแล้ว ไม่ใช้ LINE
      </p>
      {!enabled ? (
        <p role="status">กำลังเตรียมช่องทางเข้าสู่ระบบอีเมลสำหรับผู้ดูแล</p>
      ) : account?.user && mode !== "reset" ? (
        <div>
          <p>สวัสดี {account.user.displayName}</p>
          <button disabled={busy} onClick={() => void submit("logout")}>
            ออกจากระบบผู้ดูแล
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            อีเมล / ชื่อผู้ใช้
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {mode === "register" && (
            <label>
              ชื่อผู้ดูแล
              <input
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {["login", "register", "reset"].includes(mode) && (
            <label>
              รหัสผ่าน (อย่างน้อย 12 ตัวอักษร)
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {mode === "verify" && (
            <label>
              รหัสยืนยันอีเมล 6 หลัก
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </label>
          )}
          <button disabled={busy}>
            {busy
              ? "กำลังดำเนินการ…"
              : {
                  login: "เข้าสู่ระบบ",
                  register: "ตั้งบัญชีตามคำเชิญ",
                  verify: "ยืนยันอีเมล",
                  forgot: "ส่งอีเมลตั้งรหัสผ่านใหม่",
                  reset: "บันทึกรหัสผ่านใหม่",
                }[mode]}
          </button>
          <div className="admin-tabs">
            {(["login", "register", "verify", "forgot"] as const)
              .filter((v) => v !== mode)
              .map((v) => (
                <button
                  type="button"
                  className="secondary"
                  key={v}
                  onClick={() => {
                    setMode(v);
                    setMessage("");
                  }}
                >
                  {
                    {
                      login: "กลับเข้าสู่ระบบ",
                      register: "ตั้งบัญชีตามคำเชิญ",
                      verify: "กรอกรหัสยืนยัน",
                      forgot: "ลืมรหัสผ่าน",
                    }[v]
                  }
                </button>
              ))}
            {mode === "verify" && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void submit("resend")}
              >
                ส่งรหัสใหม่
              </button>
            )}
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

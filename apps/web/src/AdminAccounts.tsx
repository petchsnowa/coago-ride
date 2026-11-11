import { useState } from "react";
export default function AdminAccounts({
  csrf,
  onChange,
}: {
  csrf: string;
  onChange: () => void;
}) {
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function invite() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ email, name, reason }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok)
        throw Error(
          "เพิ่มบัญชีไม่ได้ ตรวจสิทธิ์ อีเมลซ้ำ หรือการตั้งค่าผู้ดูแล",
        );
      setEmail("");
      setName("");
      setReason("");
      setMessage(
        "เพิ่มสิทธิ์แล้ว ให้ผู้ดูแลเปิด /admin เลือกตั้งบัญชีตามคำเชิญ ตั้งรหัสผ่าน และยืนยันอีเมลก่อนใช้",
      );
      onChange();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Root เพิ่มบัญชี Admin ด้วยอีเมล</h3>
      <p>
        บัญชีสมาชิก LINE ไม่ถูกเปลี่ยนเป็นบัญชีผู้ดูแล
        ผู้ได้รับสิทธิ์ต้องตั้งรหัสผ่านและยืนยันอีเมลเอง
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <label>
          ชื่อผู้ดูแล
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          อีเมล Admin
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          เหตุผลแต่งตั้ง
          <input
            required
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button disabled={busy}>เพิ่มสิทธิ์บัญชี Admin</button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

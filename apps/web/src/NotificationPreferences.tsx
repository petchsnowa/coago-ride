import { useEffect, useState } from "react";
import { notificationPreferenceSchema as schema } from "@coago/contracts";
export default function NotificationPreferences({ csrf }: { csrf: string }) {
  const [value, setValue] = useState<ReturnType<typeof schema.parse> | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void fetch("/api/notifications", {
      signal: AbortSignal.any([c.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return schema.parse(await r.json());
      })
      .then((d) => {
        if (!c.signal.aborted) setValue(d);
      })
      .catch(() => {
        if (!c.signal.aborted) setMessage("ยังโหลดการตั้งค่าแจ้งเตือนไม่ได้");
      });
    return () => c.abort();
  }, []);
  async function change(enabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ enabled, consentVersion: "2026-11-12" }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw Error();
      setValue(schema.parse(await r.json()));
      setMessage(enabled ? "เปิดการแจ้งเตือนแล้ว" : "ปิดการแจ้งเตือนแล้ว");
    } catch {
      setMessage("บันทึกไม่ได้ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-card">
      <h2>การแจ้งเตือน LINE</h2>
      <p>
        รับข้อความเมื่อมีคำขอ การตอบรับ การยกเลิก หรืออัปเดตการเดินทาง
        ต้องเพิ่มเพื่อนบัญชี LINE Official ของ COAGO ก่อน
        ข้อความแจ้งเตือนไม่รับประกันว่าจะส่งถึง กรุณาตรวจรายการในเว็บด้วย
      </p>
      {value && !value.available && (
        <p role="status">
          ระบบยังไม่เปิดส่งข้อความ คุณยังใช้งานและตรวจสถานะในเว็บได้
        </p>
      )}
      <label className="consent-field">
        <input
          type="checkbox"
          checked={value?.enabled ?? false}
          disabled={!value || busy || (!value.available && !value.enabled)}
          onChange={(e) => void change(e.target.checked)}
        />
        ยินยอมรับการแจ้งเตือนผ่าน LINE (ปิดได้ทุกเมื่อ)
      </label>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

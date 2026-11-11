import { useEffect, useState } from "react";
export default function MemberStatus() {
  const [status, setStatus] = useState<string | null>(null),
    [reason, setReason] = useState("");
  useEffect(() => {
    const control = new AbortController();
    fetch("/api/membership/status", { signal: control.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const d = await r.json();
        if (!control.signal.aborted) {
          setStatus(d.profile?.status ?? "incomplete");
          setReason(d.profile?.reviewReason ?? "");
        }
      })
      .catch(() => {
        if (!control.signal.aborted) setStatus("unavailable");
      });
    return () => control.abort();
  }, []);
  return (
    <section className="member-status">
      <h2>สถานะสมาชิก</h2>
      <p>
        {status === null
          ? "กำลังตรวจสถานะสมาชิก…"
          : {
              approved: "ผ่านการตรวจข้อมูลสมาชิกแล้ว",
              pending: "ส่งข้อมูลแล้ว กำลังรอผู้ดูแลตรวจ",
              rejected: "กรุณาแก้ไขข้อมูลตามผลตรวจ",
              incomplete:
                "กรอกข้อมูลสมาชิกและส่งหลักฐานก่อนประกาศเที่ยวหรือส่งคำขอ",
              unavailable: "ยังตรวจสถานะสมาชิกไม่ได้ กรุณาลองโหลดหน้าใหม่",
            }[status]}{" "}
        {reason}
      </p>
      <a href="/account">กรอกหรือแก้ไขข้อมูลสมาชิกและรถ</a>
    </section>
  );
}

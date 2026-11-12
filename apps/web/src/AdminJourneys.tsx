import { useEffect, useRef, useState } from "react";
import { journeyListSchema, journeyLabels } from "@coago/contracts";
import JourneyButton from "./JourneyButton";
import { tripTime } from "./TripSummaryCard";
export default function AdminJourneys({ csrf }: { csrf: string }) {
  const [rows, setRows] = useState<
      ReturnType<typeof journeyListSchema.parse>["items"]
    >([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const active = useRef(true),
    sequence = useRef(0),
    controls = useRef(new Set<AbortController>());
  async function load(after?: string) {
    const current = ++sequence.current,
      control = new AbortController();
    controls.current.add(control);
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        `/api/admin/journeys${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
        {
          signal: AbortSignal.any([control.signal, AbortSignal.timeout(12000)]),
        },
      );
      if (!r.ok) throw Error("โหลดรายการติดตามการเดินทางไม่ได้");
      const d = journeyListSchema.parse(await r.json());
      if (!active.current || current !== sequence.current) return;
      setRows((p) =>
        after
          ? [
              ...p,
              ...d.items.filter((x) => !p.some((y) => y.tripId === x.tripId)),
            ]
          : d.items,
      );
      setCursor(d.nextCursor);
    } catch (e) {
      if (active.current && current === sequence.current)
        setMessage(
          e instanceof Error && /[\u0e00-\u0e7f]/.test(e.message)
            ? e.message
            : "โหลดรายการติดตามการเดินทางไม่ได้ กรุณาลองใหม่",
        );
    } finally {
      controls.current.delete(control);
      if (active.current && current === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      for (const c of controls.current) c.abort();
    };
  }, []);
  return (
    <section className="admin-panel">
      <h2>ติดตามสถานะการเดินทาง</h2>
      <p>
        สถานะรายงานโดยผู้ขับ กดดูรายละเอียดเพื่ออ่านประวัติและดูแผนที่จุดรับ–ส่ง
        ไม่ใช่ GPS สด
      </p>
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        โหลดการเดินทางล่าสุด
      </button>
      {message && <p role="status">{message}</p>}
      {!busy && !rows.length && <p>ยังไม่มีเที่ยวในระบบ</p>}
      {rows.map((r) => (
        <article className="journey-event" key={r.tripId}>
          <h3>
            {r.originProvince} → {r.destinationProvince}
          </h3>
          <p>
            ผู้ขับ: {r.ownerName} · {tripTime(r.departureAt)} น.
          </p>
          <p>
            <strong>{journeyLabels[r.status]}</strong>
            {r.issue ? " · มีเหตุขัดข้อง" : ""} · อัปเดต {tripTime(r.updatedAt)}{" "}
            น.
          </p>
          <JourneyButton tripId={r.tripId} csrf={csrf} staff />
        </article>
      ))}
      {cursor && (
        <button
          disabled={busy}
          className="secondary"
          onClick={() => void load(cursor)}
        >
          ดูการเดินทางเพิ่มเติม
        </button>
      )}
    </section>
  );
}

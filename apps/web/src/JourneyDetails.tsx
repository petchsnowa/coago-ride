import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  journeyStateSchema,
  journeyLabels,
  journeyStages,
  type JourneyState,
} from "@coago/contracts";
import { tripTime } from "./TripSummaryCard";
const RouteMap = lazy(() => import("./RouteMap"));
export default function JourneyDetails({
  tripId,
  csrf,
  staff = false,
  onClose,
}: {
  tripId: string;
  csrf: string;
  staff?: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<JourneyState | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [status, setStatus] = useState<JourneyState["status"]>("not_started"),
    [issue, setIssue] = useState(false),
    [note, setNote] = useState(""),
    [map, setMap] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    key = useRef(crypto.randomUUID()),
    active = useRef(true),
    controls = useRef(new Set<AbortController>());
  async function api(body?: unknown) {
    const control = new AbortController();
    controls.current.add(control);
    try {
      const r = await fetch(
        `${staff ? "/api/admin/journeys" : "/api/journeys"}/${tripId}`,
        {
          method: body ? "POST" : "GET",
          headers: body
            ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
            : {},
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.any([control.signal, AbortSignal.timeout(12000)]),
        },
      );
      const d = await r.json();
      if (!r.ok)
        throw Error(
          (
            {
              conflict: "สถานะเปลี่ยน กรุณาโหลดล่าสุดก่อนอัปเดต",
              driver_license_required:
                "ต้องอนุมัติใบขับขี่และข้อมูลผู้ขับก่อนเริ่มเที่ยว",
              journey_too_early:
                "เริ่มอัปเดตการเดินทางได้ก่อนออกเดินทาง24ชั่วโมง",
              resolve_issue_first:
                "กรุณาบันทึกว่าแก้ไขเหตุขัดข้องแล้วก่อนเปลี่ยนขั้นตอน",
              issue_reason_required:
                "กรุณาระบุรายละเอียดเหตุขัดข้องหรือการแก้ไขอย่างน้อย5ตัวอักษร",
              invalid_transition: "เปลี่ยนสถานะได้ตามขั้นตอนเท่านั้น",
              not_found: "ไม่พบการเดินทางหรือคุณไม่มีสิทธิ์ดู",
              trip_cancelled: "เที่ยวนี้ถูกยกเลิกแล้ว",
            } as Record<string, string>
          )[d.error] ?? "ติดต่อระบบสถานะเดินทางไม่ได้",
        );
      return journeyStateSchema.parse(d);
    } finally {
      controls.current.delete(control);
    }
  }
  function apply(d: JourneyState) {
    setData(d);
    setIssue(d.issue);
    setNote("");
    setStatus(
      d.issue
        ? d.status
        : journeyStages[Math.min(journeyStages.indexOf(d.status) + 1, 5)],
    );
    key.current = crypto.randomUUID();
  }
  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const d = await api();
      if (active.current) apply(d);
    } catch (e) {
      if (active.current)
        setMessage(
          e instanceof Error && /[\u0e00-\u0e7f]/.test(e.message)
            ? e.message
            : "ติดต่อระบบสถานะเดินทางไม่ได้ กรุณาลองใหม่",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    void load();
    return () => {
      active.current = false;
      for (const c of controls.current) c.abort();
    };
  }, [tripId]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const d = await api({
        requestId: key.current,
        version: data.version,
        status,
        issue,
        note: note.trim(),
      });
      if (active.current) {
        apply(d);
        setMessage("บันทึกสถานะการเดินทางแล้ว");
      }
    } catch (e) {
      if (active.current)
        setMessage(
          e instanceof Error && /[\u0e00-\u0e7f]/.test(e.message)
            ? e.message
            : "ติดต่อระบบสถานะเดินทางไม่ได้ กรุณาลองใหม่",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="trip-dialog journey-dialog"
      aria-labelledby="journey-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="trip-card-top">
        <h2 id="journey-dialog-title">สถานะการเดินทาง</h2>
        <button className="secondary" onClick={onClose}>
          ปิดสถานะการเดินทาง
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {!data && busy && <p>กำลังโหลดสถานะ…</p>}
      {data && (
        <>
          <h3>
            {data.trip.originProvince} → {data.trip.destinationProvince}
          </h3>
          <p>{tripTime(data.trip.departureAt)} น. (เวลาไทย)</p>
          <p>
            <strong>
              {data.trip.status === "cancelled"
                ? "เที่ยวยกเลิกแล้ว"
                : journeyLabels[data.status]}
            </strong>
            {data.issue && (
              <span className="request-status pending"> มีเหตุขัดข้อง</span>
            )}
          </p>
          <p>
            รายงานโดยผู้ขับ ·{" "}
            {data.updatedAt
              ? `อัปเดต ${tripTime(data.updatedAt)} น.`
              : "ยังไม่มีการรายงาน"}{" "}
            · ไม่ใช่ตำแหน่ง GPS สด
          </p>
          <p>
            จุดรับ: {data.trip.pickupPoint} · จุดส่ง: {data.trip.dropoffPoint}
          </p>
          {!data.driverEligible && data.status !== "completed" && (
            <p>
              ข้อมูลหรือใบขับขี่ของผู้ขับยังไม่พร้อมสำหรับการเริ่มเที่ยว
              กรุณาติดต่อผู้ดูแล
            </p>
          )}
          <details
            onToggle={(e) => {
              if (e.currentTarget.open) setMap(true);
            }}
          >
            <summary>ดูแผนที่จุดรับ–ส่ง</summary>
            {map && data.trip.route ? (
              <Suspense fallback={<p>กำลังโหลดแผนที่…</p>}>
                <RouteMap
                  origin={data.trip.route.origin}
                  destination={data.trip.route.destination}
                />
              </Suspense>
            ) : (
              <p>เที่ยวนี้ยังไม่ได้บันทึกพิกัด</p>
            )}
            <p className="field-help">
              แสดงจุดรับและจุดส่งที่บันทึก ไม่ใช่ตำแหน่งปัจจุบันของรถ
            </p>
          </details>
          {data.canUpdate && (
            <form className="journey-form" onSubmit={(e) => void save(e)}>
              <label>
                อัปเดตขั้นตอน
                <select
                  value={status}
                  disabled={busy || issue || data.issue}
                  onChange={(e) =>
                    setStatus(e.target.value as JourneyState["status"])
                  }
                >
                  {journeyStages
                    .filter(
                      (_, i) =>
                        i === journeyStages.indexOf(data.status) ||
                        i === journeyStages.indexOf(data.status) + 1,
                    )
                    .map((s) => (
                      <option key={s} value={s}>
                        {journeyLabels[s]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={issue}
                  onChange={(e) => {
                    setIssue(e.target.checked);
                    setStatus(data.status);
                  }}
                />
                มีเหตุขัดข้องที่ต้องแจ้งผู้ร่วมทาง
              </label>
              <label>
                {data.issue && !issue
                  ? "รายละเอียดการแก้ไขเหตุขัดข้อง"
                  : "รายละเอียดเพิ่มเติมสำหรับผู้ร่วมทางและผู้ดูแล"}
                <textarea
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น ถึงจุดรับแล้ว หรือรายละเอียดเหตุขัดข้อง"
                />
              </label>
              <button disabled={busy}>บันทึกสถานะการเดินทาง</button>
            </form>
          )}
          <h3>ประวัติรายงานล่าสุด</h3>
          {!data.events.length && <p>ยังไม่มีประวัติรายงาน</p>}
          {data.events.map((e) => (
            <article className="journey-event" key={e.id}>
              <strong>
                {journeyLabels[e.status]} {e.issue ? "· มีเหตุขัดข้อง" : ""}
              </strong>
              <p>{e.note || "อัปเดตขั้นตอนเดินทาง"}</p>
              <p className="field-help">{tripTime(e.createdAt)} น. (เวลาไทย)</p>
            </article>
          ))}
        </>
      )}
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        โหลดสถานะการเดินทางล่าสุด
      </button>
    </dialog>
  );
}

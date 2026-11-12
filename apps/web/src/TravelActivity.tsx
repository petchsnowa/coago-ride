import { useEffect, useRef, useState } from "react";
import { publicActivitySchema, type PublicActivity } from "@coago/contracts";
export default function TravelActivity({
  enabled,
  revision,
  onTripSelect,
}: {
  enabled: boolean;
  revision: number;
  onTripSelect: (id: string) => void;
}) {
  const [data, setData] = useState<PublicActivity | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [expanded, setExpanded] = useState(false);
  const current = useRef(0);
  useEffect(() => {
    const request = ++current.current;
    setData(null);
    setError(false);
    setLoading(false);
    if (!enabled) return;
    const control = new AbortController();
    setLoading(true);
    void fetch("/api/discovery/trips/activity", {
      cache: "no-store",
      signal: AbortSignal.any([control.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return publicActivitySchema.parse(await r.json());
      })
      .then((value) => {
        if (!control.signal.aborted && current.current === request)
          setData(value);
      })
      .catch(() => {
        if (!control.signal.aborted && current.current === request)
          setError(true);
      })
      .finally(() => {
        if (!control.signal.aborted && current.current === request)
          setLoading(false);
      });
    return () => control.abort();
  }, [enabled, revision, attempt]);
  return (
    <section className="travel-activity" aria-labelledby="activity-title">
      <header className="activity-heading">
        <div>
          <p className="eyebrow">เส้นทางที่กำลังมีเพื่อนร่วมทาง</p>
          <h2 id="activity-title">ภาพรวมการร่วมเดินทาง</h2>
          <p>เที่ยวในอนาคตที่ยังเปิดรับและมีที่นั่งว่าง</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!enabled || loading}
          onClick={() => setAttempt((v) => v + 1)}
        >
          {" "}
          {loading ? "กำลังโหลดภาพรวม…" : "อัปเดตภาพรวม"}
        </button>
      </header>
      {!enabled ? (
        <p role="status">เปิดดูภาพรวมได้เมื่อระบบเปิดบริการ</p>
      ) : error ? (
        <p role="status">ยังโหลดภาพรวมไม่ได้ กรุณากดอัปเดตอีกครั้ง</p>
      ) : loading || !data ? (
        <p role="status">กำลังตรวจรายการเดินทางในระบบ…</p>
      ) : (
        <>
          <div className="activity-totals">
            <div>
              <strong>{data.totals.vehicles.toLocaleString("th-TH")}</strong>
              <span>รถเปิดแชร์ (คัน)</span>
            </div>
            <div>
              <strong>{data.totals.trips.toLocaleString("th-TH")}</strong>
              <span>เที่ยวที่ยังเปิดรับ</span>
            </div>
            <div>
              <strong>{data.totals.seats.toLocaleString("th-TH")}</strong>
              <span>ที่นั่งว่าง</span>
            </div>
            <div>
              <strong>
                {data.totals.pendingRequests.toLocaleString("th-TH")}
              </strong>
              <span>คำขอร่วมทางรอตอบรับ</span>
            </div>
          </div>
          <p className="field-help">
            คำขอเป็นคำขอร่วมเที่ยวที่มีอยู่
            ยังไม่ใช่ประกาศหารถอิสระหรือจำนวนคนที่ไม่ซ้ำกัน
          </p>
          {data.destinations.length === 0 ? (
            <p>ยังไม่มีเที่ยวเปิดรับในขณะนี้</p>
          ) : (
            <div className="activity-destinations">
              {(expanded
                ? data.destinations
                : data.destinations.slice(0, 6)
              ).map((d) => (
                <article key={d.province}>
                  <div>
                    <h3>ไป{d.province}</h3>
                    <p>
                      {d.trips} เที่ยว · {d.vehicles} คัน · ว่าง {d.seats}{" "}
                      ที่นั่ง
                    </p>
                    <p className="activity-demand">
                      คำขอรอร่วมทางไป{d.province} {d.pendingRequests} คำขอ
                    </p>
                    <p className="field-help">
                      เที่ยวถัดไป{" "}
                      {new Intl.DateTimeFormat("th-TH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Bangkok",
                      }).format(new Date(d.nextDepartureAt))}{" "}
                      น. (เวลาไทย)
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onTripSelect(d.nextTripId)}
                  >
                    ดูเที่ยวถัดไป{d.province}
                  </button>
                </article>
              ))}
            </div>
          )}
          {data.destinations.length > 6 && (
            <button
              className="secondary"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? "แสดงจังหวัดน้อยลง"
                : `ดูทั้งหมด ${data.destinations.length} จังหวัด`}
            </button>
          )}
          <p className="field-help">
            อัปเดต{" "}
            {new Intl.DateTimeFormat("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Bangkok",
            }).format(new Date(data.updatedAt))}{" "}
            น. (เวลาไทย) · จำนวนรถนับจากข้อมูลรถที่บันทึกไว้
            ไม่นับรถคันเดียวซ้ำหลายเที่ยว และอาจปรากฏได้ในหลายจังหวัด ·
            ไม่ใช่ตำแหน่งรถสด
          </p>
        </>
      )}
    </section>
  );
}

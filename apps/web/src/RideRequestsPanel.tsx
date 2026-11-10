import { useEffect, useRef, useState } from "react";
import {
  rideRequestListSchema,
  rideRequestResponseSchema,
  type AuthState,
  type RideRequest,
} from "@coago/contracts";
import { rideApi, RideApiError, requestStatusLabel } from "./rideRequestsApi";
import { tripTime } from "./TripSummaryCard";
export default function RideRequestsPanel({
  account,
  revision,
  onChange,
}: {
  account: AuthState | null;
  revision: number;
  onChange: () => void;
}) {
  return account?.user ? (
    <PrivateRequests
      key={account.user.id}
      csrf={account.csrfToken}
      revision={revision}
      onChange={onChange}
    />
  ) : null;
}
function PrivateRequests({
  csrf,
  revision,
  onChange,
}: {
  csrf: string;
  revision: number;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<"mine" | "incoming">("mine"),
    [items, setItems] = useState<RideRequest[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<string | null>(null);
  const active = useRef(false),
    controller = useRef<AbortController | null>(null),
    sequence = useRef(0);
  async function load(after?: string) {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    if (!after) {
      setItems([]);
      setCursor(null);
    }
    try {
      const data = rideRequestListSchema.parse(
        await rideApi(
          `/api/ride-requests/${mode}${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
          controller.current!.signal,
        ),
      );
      if (active.current && current === sequence.current) {
        setItems((prev) =>
          after
            ? [
                ...prev,
                ...data.requests.filter(
                  (r) => !prev.some((p) => p.id === r.id),
                ),
              ]
            : data.requests,
        );
        setCursor(data.nextCursor);
      }
    } catch (e) {
      if (active.current && current === sequence.current)
        setError(
          e instanceof RideApiError ? e.message : "โหลดรายการคำขอไม่สำเร็จ",
        );
    } finally {
      if (active.current && current === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    controller.current = new AbortController();
    setConfirm(null);
    void load();
    return () => {
      active.current = false;
      ++sequence.current;
      controller.current?.abort();
    };
  }, [mode, revision]);
  async function cancel(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = rideRequestResponseSchema.parse(
        await rideApi(
          `/api/ride-requests/${id}/cancel`,
          controller.current!.signal,
          { method: "POST", csrf, body: {} },
        ),
      );
      if (active.current) {
        setItems((prev) => prev.map((r) => (r.id === id ? data.request : r)));
        setConfirm(null);
        onChange();
      }
    } catch (e) {
      if (active.current)
        setError(
          e instanceof RideApiError
            ? e.message
            : "ไม่ทราบผลการยกเลิก กรุณาโหลดล่าสุดก่อนลองอีกครั้ง",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="ride-requests" aria-labelledby="requests-title">
      <p className="eyebrow">บัญชีของคุณเท่านั้น</p>
      <h2 id="requests-title">คำขอร่วมเดินทาง</h2>
      <p>คำขอรอตอบรับยังไม่ใช่การได้ที่นั่ง · ขั้นตอนตอบรับจะเพิ่มรอบถัดไป</p>
      <div className="request-tabs">
        <button
          className="secondary"
          aria-pressed={mode === "mine"}
          disabled={busy}
          onClick={() => setMode("mine")}
        >
          คำขอของฉัน
        </button>
        <button
          className="secondary"
          aria-pressed={mode === "incoming"}
          disabled={busy}
          onClick={() => setMode("incoming")}
        >
          คำขอที่เข้ามา
        </button>
        <button
          className="secondary"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          โหลดคำขอล่าสุด
        </button>
      </div>
      {error && (
        <div role="alert" className="trip-alert">
          {error}
        </div>
      )}
      {loading && <p role="status">กำลังโหลดคำขอ…</p>}
      {!loading && !error && !items.length && (
        <p className="trip-empty">
          {mode === "mine"
            ? "ยังไม่มีคำขอร่วมเดินทางของคุณ"
            : "ยังไม่มีคำขอสำหรับเที่ยวของคุณ"}
        </p>
      )}
      <div className="request-list">
        {items.map((request) => (
          <article className="ride-request-card" key={request.id}>
            <div className="trip-card-top">
              <h3>
                {request.trip.originProvince} →{" "}
                {request.trip.destinationProvince}
              </h3>
              <span className={`request-status ${request.status}`}>
                {requestStatusLabel(request)}
              </span>
            </div>
            <p>{tripTime(request.trip.departureAt)} น. (เวลาไทย)</p>
            <p>
              ขอร่วมเดินทาง {request.seatsRequested} ที่นั่ง ·{" "}
              {new Intl.NumberFormat("th-TH", {
                minimumFractionDigits: 2,
              }).format(request.trip.contributionSatang / 100)}{" "}
              บาท/คน
            </p>
            {mode === "incoming" && <p>ผู้ส่งคำขอ: {request.passengerName}</p>}
            <p className="field-help">ส่งเมื่อ {tripTime(request.createdAt)}</p>
            {request.tripChanged && (
              <p className="request-changed">
                รายละเอียดเที่ยวเปลี่ยนหลังส่งคำขอ กรุณาตรวจวันเวลาและราคาใหม่
              </p>
            )}
            {mode === "mine" &&
              request.status === "pending" &&
              (confirm === request.id ? (
                <div className="request-confirm">
                  <p>
                    ยืนยันยกเลิกคำขอนี้หรือไม่? ยังไม่มีการจองหรือหักที่นั่ง
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => void cancel(request.id)}
                  >
                    ยืนยันยกเลิกคำขอ
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setConfirm(null)}
                  >
                    กลับ
                  </button>
                </div>
              ) : (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirm(request.id)}
                >
                  ยกเลิกคำขอ
                </button>
              ))}
          </article>
        ))}
      </div>
      {cursor && (
        <button
          className="secondary"
          disabled={loading || busy}
          onClick={() => void load(cursor)}
        >
          ดูคำขอเพิ่มเติม
        </button>
      )}
    </section>
  );
}

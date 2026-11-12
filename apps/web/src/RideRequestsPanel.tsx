import JourneyButton from "./JourneyButton";
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
    [confirm, setConfirm] = useState<string | null>(null),
    [decision, setDecision] = useState<{
      id: string;
      value: "accept" | "reject";
    } | null>(null),
    [reason, setReason] = useState("");
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
    setDecision(null);
    setReason("");
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
  async function decide(id: string, value: "accept" | "reject") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = rideRequestResponseSchema.parse(
        await rideApi(
          `/api/ride-requests/${id}/decision`,
          controller.current!.signal,
          {
            method: "POST",
            csrf,
            body: {
              decision: value,
              reason: value === "reject" ? reason.trim() : "",
            },
          },
        ),
      );
      if (active.current) {
        setItems((prev) => prev.map((r) => (r.id === id ? data.request : r)));
        setDecision(null);
        setReason("");
        onChange();
      }
    } catch (e) {
      if (active.current) {
        await load();
        if (active.current)
          setError(
            e instanceof RideApiError
              ? e.message
              : "ไม่ทราบผลการตัดสินใจ กรุณาโหลดล่าสุดก่อนลองอีกครั้ง",
          );
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="ride-requests" aria-labelledby="requests-title">
      <p className="eyebrow">บัญชีของคุณเท่านั้น</p>
      <h2 id="requests-title">คำขอร่วมเดินทาง</h2>
      <p>คำขอรอตอบรับยังไม่ใช่การได้ที่นั่ง · เมื่อตอบรับระบบจะหักที่นั่งให้</p>
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
            {mode === "mine" && request.status === "accepted" && (
              <JourneyButton tripId={request.trip.id} csrf={csrf} />
            )}
            <div className="trip-card-top">
              <h3>
                {request.offeredTrip.originProvince} →{" "}
                {request.offeredTrip.destinationProvince}
              </h3>
              <span className={`request-status ${request.status}`}>
                {requestStatusLabel(request)}
              </span>
            </div>
            <p>{tripTime(request.offeredTrip.departureAt)} น. (เวลาไทย)</p>
            <p>
              ขอร่วมเดินทาง {request.seatsRequested} ที่นั่ง ·{" "}
              {new Intl.NumberFormat("th-TH", {
                minimumFractionDigits: 2,
              }).format(request.offeredTrip.contributionSatang / 100)}{" "}
              บาท/คน
            </p>
            <p>ที่นั่งว่างล่าสุด: {request.trip.seats} ที่นั่ง</p>
            {mode === "incoming" && <p>ผู้ส่งคำขอ: {request.passengerName}</p>}
            {request.decidedAt && (
              <p className="field-help">
                ตัดสินเมื่อ {tripTime(request.decidedAt)}
              </p>
            )}
            {request.rejectionReason && (
              <p className="request-changed">
                เหตุผลปฏิเสธ: {request.rejectionReason}
              </p>
            )}
            <details className="request-offer">
              <summary>รายละเอียดที่ส่งคำขอ</summary>
              <p>จุดรับ: {request.offeredTrip.pickupPoint}</p>
              <p>จุดส่ง: {request.offeredTrip.dropoffPoint}</p>
              <p>
                รถ: {request.offeredTrip.vehicleModel} ·{" "}
                {request.offeredTrip.vehicleColor}
              </p>
              <p>สัมภาระ: {request.offeredTrip.luggageNotes || "ไม่ได้ระบุ"}</p>
              <p>เงื่อนไข: {request.offeredTrip.conditions || "ไม่ได้ระบุ"}</p>
            </details>
            <p className="field-help">ส่งเมื่อ {tripTime(request.createdAt)}</p>
            {request.tripChanged && (
              <p className="request-changed">
                รายละเอียดเที่ยวเปลี่ยนหลังส่งคำขอ
                หากยังรอตอบรับต้องยกเลิกแล้วส่งคำขอใหม่ก่อนตอบรับ
              </p>
            )}
            {mode === "mine" &&
              (request.status === "pending" ||
                (request.status === "accepted" &&
                  request.trip.status === "active" &&
                  Date.parse(request.trip.departureAt) > Date.now())) &&
              (confirm === request.id ? (
                <div className="request-confirm">
                  <p>
                    {request.status === "accepted"
                      ? "ยืนยันยกเลิกที่นั่งที่ตอบรับแล้ว? ระบบจะคืน 1 ที่นั่ง"
                      : "ยืนยันยกเลิกคำขอนี้หรือไม่? คำขอนี้ยังไม่หักที่นั่ง"}
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
            {mode === "incoming" &&
              request.status === "pending" &&
              request.trip.status === "active" && (
                <div className="decision-actions">
                  {decision?.id === request.id ? (
                    <div className="request-confirm">
                      <p>
                        {decision.value === "accept"
                          ? `ตอบรับ 1 ที่นั่งสำหรับเที่ยว ${request.offeredTrip.originProvince} ไป ${request.offeredTrip.destinationProvince} เวลา ${tripTime(request.offeredTrip.departureAt)}?`
                          : "ยืนยันปฏิเสธคำขอนี้?"}
                      </p>
                      {decision.value === "reject" && (
                        <label className="trip-field">
                          เหตุผลปฏิเสธ (ไม่บังคับ)
                          <input
                            value={reason}
                            maxLength={300}
                            disabled={busy}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                      )}
                      <button
                        disabled={busy || loading}
                        onClick={() => void decide(request.id, decision.value)}
                      >
                        {decision.value === "accept"
                          ? "ยืนยันตอบรับ 1 ที่นั่ง"
                          : "ยืนยันปฏิเสธ"}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => setDecision(null)}
                      >
                        กลับ
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        disabled={
                          busy ||
                          loading ||
                          request.tripChanged ||
                          request.trip.seats < 1 ||
                          Date.parse(request.trip.departureAt) <= Date.now()
                        }
                        onClick={() => {
                          setDecision({ id: request.id, value: "accept" });
                          setReason("");
                        }}
                      >
                        ตอบรับ 1 ที่นั่ง
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || loading}
                        onClick={() => {
                          setDecision({ id: request.id, value: "reject" });
                          setReason("");
                        }}
                      >
                        ปฏิเสธคำขอ
                      </button>
                    </>
                  )}
                </div>
              )}
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

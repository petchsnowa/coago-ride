import { useEffect, useRef, useState } from "react";
import {
  rideRequestContextSchema,
  rideRequestResponseSchema,
  type AuthState,
  type RideRequestContext,
} from "@coago/contracts";
import { rideApi, RideApiError, requestStatusLabel } from "./rideRequestsApi";
export default function RideRequestAction({
  account,
  tripId,
  onChange,
}: {
  account: AuthState | null;
  tripId: string;
  onChange: () => void;
}) {
  return account?.user ? (
    <AuthenticatedRequest
      key={`${account.user.id}:${tripId}`}
      csrf={account.csrfToken}
      tripId={tripId}
      onChange={onChange}
    />
  ) : (
    <div className="request-action">
      <p>เข้าสู่ระบบด้วย LINE เพื่อส่งคำขอร่วมเดินทาง 1 ที่นั่ง</p>
      <a href="/api/auth/line/start">เข้าสู่ระบบเพื่อส่งคำขอ</a>
    </div>
  );
}
function AuthenticatedRequest({
  csrf,
  tripId,
  onChange,
}: {
  csrf: string;
  tripId: string;
  onChange: () => void;
}) {
  const [context, setContext] = useState<RideRequestContext | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    active = useRef(false),
    requestId = useRef(crypto.randomUUID());
  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = rideRequestContextSchema.parse(
        await rideApi(
          `/api/ride-requests/for-trip/${tripId}`,
          controller.current!.signal,
        ),
      );
      if (active.current) setContext(data);
    } catch (e) {
      if (active.current) {
        if (
          e instanceof RideApiError &&
          ["trip_not_found", "unauthorized"].includes(e.code)
        )
          setContext(null);
        setError(
          e instanceof RideApiError ? e.message : "โหลดสถานะคำขอไม่สำเร็จ",
        );
      }
    } finally {
      if (active.current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    controller.current = new AbortController();
    void load();
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  async function send() {
    if (busy || !context?.canRequest) return;
    setBusy(true);
    setError("");
    try {
      const result = rideRequestResponseSchema.parse(
        await rideApi("/api/ride-requests", controller.current!.signal, {
          method: "POST",
          csrf,
          body: { tripId, requestId: requestId.current },
        }),
      );
      if (active.current) {
        setContext({ ...context, canRequest: false, request: result.request });
        onChange();
      }
    } catch (e) {
      if (active.current) {
        setError(
          e instanceof RideApiError
            ? e.message
            : "ไม่ทราบผลการส่ง ลองข้อมูลเดิมซ้ำได้โดยไม่สร้างคำขอซ้ำ",
        );
        if (
          e instanceof RideApiError &&
          ["trip_unavailable", "trip_not_found"].includes(e.code)
        )
          setContext({ ...context, canRequest: false });
        if (e instanceof RideApiError && e.code === "already_requested")
          await load();
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="request-action" aria-label="ส่งคำขอร่วมเดินทาง">
      {loading ? (
        <p role="status">กำลังตรวจสถานะคำขอ…</p>
      ) : context?.isOwner ? (
        <p>
          คุณเป็นเจ้าของเที่ยวนี้ ดูคำขอที่เข้ามาได้ใน «คำขอร่วมเดินทาง»
          หลังปิดรายละเอียด
        </p>
      ) : context?.request?.status === "pending" ? (
        <div>
          <strong
            className={`request-status ${requestStatusLabel(context.request) === "รอตอบรับ" ? "pending" : "cancelled"}`}
          >
            {requestStatusLabel(context.request)}
          </strong>
          <p role="status">
            {requestStatusLabel(context.request) === "รอตอบรับ"
              ? "ส่งคำขอ 1 ที่นั่งแล้ว · ยังไม่ได้ยืนยันที่นั่ง"
              : "คำขอยังอยู่ในประวัติ แต่เที่ยวไม่พร้อมให้ร่วมเดินทางแล้ว"}
          </p>
          <p>ดูและยกเลิกได้ใน «คำขอของฉัน» หลังปิดรายละเอียด</p>
        </div>
      ) : context?.canRequest ? (
        <div>
          <p>
            ส่งคำขอร่วมเดินทาง <strong>1 ที่นั่ง</strong>{" "}
            ชื่อแสดงของคุณจะให้เจ้าของเที่ยวเห็นเพื่อพิจารณา
          </p>
          <p className="field-help">
            คำขอยังไม่ใช่การได้ที่นั่ง และยังไม่มีการชำระเงิน
          </p>
          <button onClick={() => void send()} disabled={busy}>
            {busy ? "กำลังส่งคำขอ…" : "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง"}
          </button>
        </div>
      ) : context ? (
        <p>เที่ยวนี้ไม่เปิดรับคำขอใหม่แล้ว</p>
      ) : null}
      {error && (
        <div role="alert" className="trip-alert">
          {error}
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            โหลดสถานะคำขอล่าสุด
          </button>
        </div>
      )}
    </div>
  );
}

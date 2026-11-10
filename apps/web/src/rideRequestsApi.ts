import type { RideRequest } from "@coago/contracts";
export const requestMessages: Record<string, string> = {
  unauthorized: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  forbidden: "สิทธิ์เปลี่ยน กรุณารีเฟรชหน้าแล้วลองใหม่",
  own_trip: "คุณเป็นเจ้าของเที่ยวนี้ จึงส่งคำขอให้ตนเองไม่ได้",
  trip_unavailable: "เที่ยวนี้ไม่เปิดรับคำขอแล้ว",
  already_requested: "คุณมีคำขอรอตอบรับในเที่ยวนี้แล้ว",
  request_reused: "คำขอนี้เคยใช้แล้ว กรุณาโหลดข้อมูลล่าสุด",
  trip_not_found: "ไม่พบเที่ยวที่พร้อมให้ส่งคำขอ",
  request_not_found: "ไม่พบคำขอของคุณ",
  trip_changed:
    "รายละเอียดเที่ยวเปลี่ยน กรุณาให้ผู้โดยสารยกเลิกแล้วส่งคำขอใหม่ก่อนตอบรับ",
  request_not_pending: "คำขอเปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลล่าสุด",
  cancellation_closed: "คำขอที่ตอบรับแล้ว ยกเลิกได้เฉพาะก่อนออกเดินทาง",
  service_unavailable: "ระบบยังไม่พร้อม กรุณาลองอีกครั้ง",
};
export class RideApiError extends Error {
  constructor(public code: string) {
    super(
      requestMessages[code] ??
        "ติดต่อระบบไม่สำเร็จ หากเพิ่งส่งคำขอให้ตรวจรายการก่อนลองซ้ำ",
    );
  }
}
export async function rideApi(
  path: string,
  signal: AbortSignal,
  options: { method?: string; body?: unknown; csrf?: string } = {},
) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    ...(options.body !== undefined
      ? {
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": options.csrf ?? "",
          },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new RideApiError(
      typeof data?.error === "string" ? data.error : "network",
    );
  return data;
}

export function requestStatusLabel(request: RideRequest, now = Date.now()) {
  return request.status === "cancelled"
    ? "ยกเลิกคำขอแล้ว"
    : request.status === "rejected"
      ? "ปฏิเสธแล้ว"
      : request.trip.status === "cancelled"
        ? "เที่ยวยกเลิกแล้ว"
        : Date.parse(request.trip.departureAt) <= now
          ? "เที่ยวออกเดินทางแล้ว"
          : request.status === "accepted"
            ? "ตอบรับแล้ว"
            : "รอตอบรับ";
}

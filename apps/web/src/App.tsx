import RideRequestsPanel from "./RideRequestsPanel";
import { useCallback } from "react";
import { useEffect, useRef, useState } from "react";
import { readySchema, type AuthState } from "@coago/contracts";
import AuthPanel from "./AuthPanel";
import TripsPanel from "./TripsPanel";
import SearchTrips from "./SearchTrips";
export default function App() {
  const production = import.meta.env.VITE_APP_MODE === "production";
  const [requestRevision, setRequestRevision] = useState(0);
  const requestsChanged = useCallback(
    () => setRequestRevision((value) => value + 1),
    [],
  );
  const [account, setAccount] = useState<AuthState | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function check() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const timer = setTimeout(() => request.abort(), 8000);
    setStatus("loading");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ""}/health/ready`,
        { signal: request.signal },
      );
      const data = readySchema.parse(await response.json());
      if (!response.ok || data.status !== "ready")
        throw new Error("unavailable");
      setStatus("ready");
    } catch {
      if (controller.current === request) setStatus("error");
    } finally {
      clearTimeout(timer);
      if (controller.current === request) controller.current = null;
    }
  }
  return (
    <main>
      <nav aria-label="ชื่อบริการ">
        <a href="/">
          COAGO<span>ไปด้วยกัน</span>
        </a>
        <div className="header-links">
          <a href="#search-form">ค้นหาเที่ยว</a>
          <a href="#trips-title">เที่ยวของฉัน</a>
          <span className="badge">
            {production ? "ร่วมเดินทาง" : "เว็บทดสอบ"}
          </span>
        </div>
      </nav>
      <SearchTrips
        account={account}
        onRequestChange={requestsChanged}
        revision={requestRevision}
      />
      <AuthPanel onAccountChange={setAccount} />
      <RideRequestsPanel
        account={account}
        revision={requestRevision}
        onChange={requestsChanged}
      />
      <TripsPanel account={account} revision={requestRevision} />
      <section className="system" aria-labelledby="system-title">
        <div>
          <p className="eyebrow">เริ่มต้นไปด้วยกัน</p>
          <h2 id="system-title">
            {production ? "สถานะระบบ COAGO" : "เรากำลังเตรียม COAGO ให้พร้อม"}
          </h2>
          <p>
            {production
              ? "ประกาศเที่ยวและจัดการคำขอร่วมเดินทาง"
              : "ทดสอบส่งคำขอ ตอบรับ และยกเลิกที่นั่ง"}
          </p>
        </div>
        <div className="check">
          <button onClick={check} disabled={status === "loading"}>
            {status === "loading"
              ? "กำลังตรวจสอบ…"
              : status === "error"
                ? "ลองอีกครั้ง"
                : "ตรวจสถานะระบบ"}
          </button>
          <p role="status" aria-live="polite">
            {
              {
                idle: "กดเพื่อตรวจความพร้อมของระบบ",
                loading: "กำลังเชื่อมต่อระบบ",
                ready: production
                  ? "เชื่อมต่อระบบสำเร็จ"
                  : "ระบบพร้อมสำหรับการพัฒนาต่อ",
                error: "ระบบยังไม่พร้อม กรุณาลองอีกครั้ง",
              }[status]
            }
          </p>
        </div>
      </section>
      <footer>COAGO · ทุกที่นั่งว่าง อาจเป็นการเดินทางของใครอีกคน</footer>
    </main>
  );
}

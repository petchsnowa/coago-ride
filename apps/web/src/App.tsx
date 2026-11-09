import { useEffect, useRef, useState } from "react";
import { readySchema } from "@coago/contracts";
export default function App() {
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
        <span className="badge">กำลังพัฒนา</span>
      </nav>
      <section className="hero">
        <p className="eyebrow">เส้นทางเดียวกัน ไปด้วยกันได้</p>
        <h1>
          ต่างจังหวัด
          <br />
          ใกล้กันกว่าเดิม<span>.</span>
        </h1>
        <p className="intro">
          เชื่อมคนที่อยากเดินทาง กับคนที่มีที่นั่งว่าง
          <br />
          ให้ทุกเส้นทางมีเพื่อนร่วมทาง
        </p>
        <div className="road" aria-hidden="true">
          <span>ต้นทาง</span>
          <i>➜</i>
          <span>จุดหมายเดียวกัน</span>
        </div>
      </section>
      <section className="system" aria-labelledby="system-title">
        <div>
          <p className="eyebrow">เริ่มต้นไปด้วยกัน</p>
          <h2 id="system-title">เรากำลังเตรียม COAGO ให้พร้อม</h2>
          <p>ระยะที่ 1: วางฐานระบบ ยังไม่เปิดรับจองหรือเข้าสู่ระบบ</p>
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
                ready: "ระบบพร้อมสำหรับการพัฒนาต่อ",
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

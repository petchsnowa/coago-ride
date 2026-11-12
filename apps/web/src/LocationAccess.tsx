import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
type State = "prompt" | "checking" | "granted" | "denied" | "unavailable";
type Access = { state: State; message: string; ensure: () => Promise<boolean> };
const Context = createContext<Access>({
  state: "prompt",
  message: "",
  ensure: async () => true,
});
export const useLocationAccess = () => useContext(Context);
export default function LocationAccess({
  children,
  required = true,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  const [state, setState] = useState<State>("prompt"),
    [message, setMessage] = useState("");
  const alive = useRef(true),
    pending = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    alive.current = true;
    let permission: PermissionStatus | undefined;
    const update = () => {
      if (!alive.current || !permission) return;
      setState(
        permission.state === "granted"
          ? "granted"
          : permission.state === "denied"
            ? "denied"
            : "prompt",
      );
      setMessage(
        permission.state === "denied"
          ? "กรุณาอนุญาตตำแหน่งในตั้งค่าเว็บไซต์ และเปิด Location Services ของอุปกรณ์ แล้วลองอีกครั้ง"
          : "",
      );
    };
    void navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (!alive.current) return;
        permission = p;
        update();
        p.addEventListener("change", update);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      permission?.removeEventListener("change", update);
    };
  }, []);
  const ensure = useCallback((): Promise<boolean> => {
    if (!required) return Promise.resolve(true);
    if (pending.current) return pending.current;
    if (!window.isSecureContext || !navigator.geolocation) {
      setState("unavailable");
      setMessage(
        "อุปกรณ์นี้ยังใช้ตำแหน่งไม่ได้ กรุณาเปิดเว็บด้วย HTTPS และเบราว์เซอร์ที่รองรับ",
      );
      return Promise.resolve(false);
    }
    setState("checking");
    setMessage("");
    const request = new Promise<boolean>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          if (alive.current) {
            setState("granted");
            setMessage(
              "พร้อมใช้ตำแหน่งแล้ว · ยังไม่มีการติดตามหรือส่งตำแหน่งปัจจุบันให้ผู้อื่น",
            );
          }
          resolve(alive.current);
        },
        (error) => {
          if (alive.current) {
            setState(error.code === 1 ? "denied" : "unavailable");
            setMessage(
              error.code === 1
                ? "กรุณาอนุญาตตำแหน่งในตั้งค่าเว็บไซต์ และเปิด Location Services ของอุปกรณ์ แล้วลองอีกครั้ง"
                : "ยังหาตำแหน่งไม่ได้ กรุณาตรวจสัญญาณและการตั้งค่าตำแหน่ง แล้วลองอีกครั้ง",
            );
          }
          resolve(false);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
      );
    });
    pending.current = request;
    void request.finally(() => {
      if (pending.current === request) pending.current = null;
    });
    return request;
  }, [required]);
  return (
    <Context.Provider value={{ state, message, ensure }}>
      {children}
    </Context.Provider>
  );
}
export function LocationCard() {
  const { state, message, ensure } = useLocationAccess();
  return (
    <section
      className="location-card"
      id="location-settings"
      aria-labelledby="location-title"
    >
      <div>
        <p className="eyebrow">พร้อมเดินทางอย่างมั่นใจ</p>
        <h2 id="location-title">เปิดตำแหน่งก่อนใช้บริการ</h2>
        <p>
          อนุญาตตำแหน่งก่อนบันทึกประกาศเที่ยวหรือส่งคำขอร่วมทาง
          ค้นหาและดูข้อมูลได้ก่อนอนุญาต
        </p>
        <p className="field-help">
          ตรวจความพร้อมของตำแหน่งเฉพาะเมื่อกดใช้งาน ยังไม่ติดตาม GPS สด
          และไม่บันทึกพิกัดปัจจุบัน
        </p>
      </div>
      <div>
        <button
          type="button"
          onClick={() => void ensure()}
          disabled={state === "checking"}
        >
          {state === "checking"
            ? "กำลังตรวจตำแหน่ง…"
            : state === "granted"
              ? "ตรวจตำแหน่งอีกครั้ง"
              : "เปิดใช้ตำแหน่ง"}
        </button>
        <p role="status">
          {message ||
            (state === "granted"
              ? "อนุญาตตำแหน่งแล้ว"
              : state === "denied"
                ? "ยังไม่ได้อนุญาตตำแหน่ง"
                : "รออนุญาตจากคุณ")}
        </p>
      </div>
    </section>
  );
}

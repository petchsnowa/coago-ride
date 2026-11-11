import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
export type Point = { lat: number; lng: number };
export default function RouteMap({
  origin,
  destination,
  onPick,
  coordinates = [],
}: {
  origin: Point;
  destination: Point;
  onPick?: (p: Point, kind: "origin" | "destination") => void;
  coordinates?: number[][];
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null),
    callback = useRef(onPick),
    mode = useRef<"origin" | "destination">("origin"),
    [select, setSelect] = useState<"origin" | "destination">("origin");
  callback.current = onPick;
  useEffect(() => {
    const instance = L.map(node.current!, { scrollWheelZoom: false }).setView(
      [origin.lat, origin.lng],
      6,
    );
    map.current = instance;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    instance.on("click", (e) =>
      callback.current?.(
        {
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6)),
        },
        mode.current,
      ),
    );
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(node.current!);
    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    for (const [p, label] of [
      [origin, "จุดรับ"],
      [destination, "จุดส่ง"],
    ] as const)
      L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color: label === "จุดรับ" ? "#17513f" : "#975817",
      })
        .bindTooltip(label, { permanent: true })
        .addTo(group);
    if (coordinates.length)
      L.polyline(
        coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
        { color: "#17513f" },
      ).addTo(group);
    map.current?.fitBounds(
      L.latLngBounds([
        [origin.lat, origin.lng],
        [destination.lat, destination.lng],
      ]),
      { padding: [35, 35], maxZoom: 13 },
    );
  }, [origin, destination, coordinates]);
  return (
    <section className="route-map">
      {onPick && (
        <div>
          <label>
            คลิกแผนที่เพื่อเลือก
            <select
              value={select}
              onChange={(e) => {
                const value = e.target.value as typeof select;
                setSelect(value);
                mode.current = value;
              }}
            >
              <option value="origin">จุดรับ</option>
              <option value="destination">จุดส่ง</option>
            </select>
          </label>
          <p>เลือกจุดนัดรับ–ส่งสาธารณะ ไม่ใช้ที่อยู่บ้านส่วนตัว</p>
        </div>
      )}
      <div
        ref={node}
        style={{ height: 320, width: "100%" }}
        aria-label="แผนที่จุดรับและจุดส่ง"
      />
      <p className="field-help">
        แผนที่: OpenStreetMap · ผู้ให้บริการแผนที่อาจได้รับ IP
        และพื้นที่ที่คุณเปิดดู
      </p>
    </section>
  );
}

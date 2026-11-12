import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LocationAccess, {
  LocationCard,
  useLocationAccess,
} from "../apps/web/src/LocationAccess";
function Action({ send }: { send: () => void }) {
  const location = useLocationAccess();
  return (
    <button
      onClick={async () => {
        if (await location.ensure()) send();
      }}
    >
      บันทึกเที่ยวทดสอบ
    </button>
  );
}
function mock(get: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: get },
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { geolocation?: unknown }).geolocation;
});
it("never requests location on load and blocks a new action when permission is denied", async () => {
  const get = vi.fn((_success, fail) => fail({ code: 1 })),
    send = vi.fn();
  mock(get);
  render(
    <LocationAccess>
      <LocationCard />
      <Action send={send} />
    </LocationAccess>,
  );
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("บันทึกเที่ยวทดสอบ"));
  await screen.findByText(/กรุณาอนุญาตตำแหน่งในตั้งค่าเว็บไซต์/);
  expect(send).not.toHaveBeenCalled();
});
it("checks position again for each action and does not store coordinates", async () => {
  const get = vi.fn((success) =>
      success({ coords: { latitude: 13.7, longitude: 100.5 } }),
    ),
    send = vi.fn();
  mock(get);
  const storage = vi.spyOn(Storage.prototype, "setItem");
  render(
    <LocationAccess>
      <Action send={send} />
    </LocationAccess>,
  );
  fireEvent.click(screen.getByText("บันทึกเที่ยวทดสอบ"));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText("บันทึกเที่ยวทดสอบ"));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(get).toHaveBeenCalledTimes(2);
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});
it("a timeout blocks submission and offers another explicit attempt", async () => {
  const get = vi.fn((_success, fail) => fail({ code: 3 })),
    send = vi.fn();
  mock(get);
  render(
    <LocationAccess>
      <LocationCard />
      <Action send={send} />
    </LocationAccess>,
  );
  fireEvent.click(screen.getByText("บันทึกเที่ยวทดสอบ"));
  await screen.findByText(/ยังหาตำแหน่งไม่ได้/);
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "เปิดใช้ตำแหน่ง" })).toBeEnabled();
});
it("ignores a delayed position after leaving the page", async () => {
  let success!: (value: unknown) => void;
  const get = vi.fn((ok) => {
      success = ok;
    }),
    send = vi.fn();
  mock(get);
  const view = render(
    <LocationAccess>
      <Action send={send} />
    </LocationAccess>,
  );
  fireEvent.click(screen.getByText("บันทึกเที่ยวทดสอบ"));
  view.unmount();
  success({});
  await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
});

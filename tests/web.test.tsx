import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../apps/web/src/App";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("shows loading, failure and successful retry", async () => {
  let resolve!: (r: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ready" })));
  vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
    url.includes("/api/auth/me")
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              user: null,
              csrfToken: null,
              loginAvailable: false,
            }),
          ),
        )
      : fetch(url, init),
  );
  render(<App />);
  fireEvent.click(
    screen.getByRole("button", { name: /ตรวจสถานะระบบ|ลองอีกครั้ง/ }),
  );
  expect(screen.getByRole("button", { name: "กำลังตรวจสอบ…" })).toBeDisabled();
  resolve(
    new Response(JSON.stringify({ status: "unavailable" }), { status: 503 }),
  );
  await screen.findByRole("button", { name: "ลองอีกครั้ง" });
  fireEvent.click(
    screen.getByRole("button", { name: /ตรวจสถานะระบบ|ลองอีกครั้ง/ }),
  );
  await waitFor(() =>
    expect(screen.getByText("ระบบพร้อมสำหรับการพัฒนาต่อ")).toHaveTextContent(
      "ระบบพร้อม",
    ),
  );
});
it("times out and re-enables retry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", (_url: unknown, init: RequestInit) =>
    String(_url).includes("/api/auth/me")
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              user: null,
              csrfToken: null,
              loginAvailable: false,
            }),
          ),
        )
      : new Promise((_r, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
  );
  render(<App />);
  fireEvent.click(
    screen.getByRole("button", { name: /ตรวจสถานะระบบ|ลองอีกครั้ง/ }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(screen.getByRole("button", { name: "ลองอีกครั้ง" })).toBeEnabled();
});

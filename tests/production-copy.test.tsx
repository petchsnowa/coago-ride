import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../apps/web/src/App";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("shows production service copy while preview login stays unavailable", async () => {
  vi.stubEnv("VITE_APP_MODE", "production");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      Response.json(
        input.includes("/api/auth/me")
          ? { user: null, csrfToken: null, loginAvailable: false }
          : input.includes("/health/ready")
            ? { status: "ready" }
            : { trips: [], nextCursor: null },
      ),
    ),
  );
  render(<App />);
  expect(screen.getByText("สถานะระบบ COAGO")).toBeInTheDocument();
  expect(screen.queryByText(/COAGO Test/)).not.toBeInTheDocument();
  expect(screen.queryByText("เว็บทดสอบ")).not.toBeInTheDocument();
  await screen.findByText("ระบบเข้าสู่ระบบยังไม่พร้อม");
  expect(
    screen.queryByRole("link", { name: "เข้าสู่ระบบด้วย LINE" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ตรวจสถานะระบบ" }));
  await screen.findByText("เชื่อมต่อระบบสำเร็จ");
});

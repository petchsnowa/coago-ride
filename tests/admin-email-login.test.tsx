import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import AdminLogin from "../apps/web/src/AdminLogin";
afterEach(() => vi.unstubAllGlobals());
function mock(enabled = true) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return Response.json(
      path.endsWith("/config")
        ? { enabled }
        : path.endsWith("/login")
          ? {
              user: {
                id: "11111111-1111-4111-8111-111111111111",
                displayName: "Root",
              },
              csrfToken: "a".repeat(64),
              loginAvailable: true,
            }
          : path.endsWith("/me")
            ? { user: null, csrfToken: null, loginAvailable: true }
            : { message: "ตรวจอีเมลยืนยัน" },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("staff sign-in uses email/password and never offers LINE", async () => {
  const fetch = mock(),
    changed = vi.fn();
  render(<AdminLogin onAccountChange={changed} />);
  await screen.findByRole("button", { name: "เข้าสู่ระบบ" });
  expect(
    screen.queryByRole("link", { name: "เข้าสู่ระบบด้วย LINE" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("อีเมล / ชื่อผู้ใช้"), {
    target: { value: "root@example.invalid" },
  });
  fireEvent.change(screen.getByLabelText("รหัสผ่าน (อย่างน้อย 12 ตัวอักษร)"), {
    target: { value: "fixture-passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
  await screen.findByText("สวัสดี Root");
  const call = fetch.mock.calls.find(([p]) => p.endsWith("/login"));
  expect(JSON.parse(call![1]!.body as string)).toEqual({
    email: "root@example.invalid",
    password: "fixture-passphrase",
  });
  expect(window.localStorage.length).toBe(0);
});
it("fails closed before staff auth is configured", async () => {
  mock(false);
  render(<AdminLogin onAccountChange={() => {}} />);
  await screen.findByText("กำลังเตรียมช่องทางเข้าสู่ระบบอีเมลสำหรับผู้ดูแล");
  expect(
    screen.queryByRole("button", { name: "เข้าสู่ระบบ" }),
  ).not.toBeInTheDocument();
});
it("invited staff can request email verification before sign-in", async () => {
  const fetch = mock();
  render(<AdminLogin onAccountChange={() => {}} />);
  await screen.findByRole("button", { name: "ตั้งบัญชีตามคำเชิญ" });
  fireEvent.click(screen.getByRole("button", { name: "ตั้งบัญชีตามคำเชิญ" }));
  fireEvent.change(screen.getByLabelText("อีเมล / ชื่อผู้ใช้"), {
    target: { value: "admin@example.invalid" },
  });
  fireEvent.change(screen.getByLabelText("ชื่อผู้ดูแล"), {
    target: { value: "Administrator" },
  });
  fireEvent.change(screen.getByLabelText("รหัสผ่าน (อย่างน้อย 12 ตัวอักษร)"), {
    target: { value: "fixture-passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ตั้งบัญชีตามคำเชิญ" }));
  await screen.findByLabelText("รหัสยืนยันอีเมล 6 หลัก");
  await waitFor(() =>
    expect(fetch.mock.calls.some(([p]) => p.endsWith("/register"))).toBe(true),
  );
});

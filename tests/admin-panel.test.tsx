import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import AdminPanel from "../apps/web/src/AdminPanel";
const id = "11111111-1111-4111-8111-111111111111",
  target = "22222222-2222-4222-8222-222222222222",
  csrf = "a".repeat(64);
const account = {
  user: { id, displayName: "Owner" },
  csrfToken: csrf,
  loginAvailable: true as const,
};
const settings = { serviceOpen: false, registrationsOpen: false, version: 1 };
function mock(role = "root") {
  const fetch = vi.fn(async (path: string, options?: RequestInit) => {
    let data: unknown = {};
    if (path.endsWith("/me")) data = { role };
    else if (path.endsWith("/overview"))
      data = {
        users: 2,
        suspended: 0,
        active_trips: 1,
        cancelled_trips: 0,
        pending_requests: 0,
        accepted_requests: 0,
      };
    else if (path.endsWith("/settings"))
      data =
        options?.method === "PUT"
          ? { ...JSON.parse(options.body as string), version: 2 }
          : settings;
    else if (path.endsWith("/users"))
      data = {
        items: [
          {
            id,
            displayName: "Owner",
            status: "active",
            version: 1,
            createdAt: new Date().toISOString(),
            isRoot: true,
          },
          {
            id: target,
            displayName: "Member",
            status: "active",
            version: 1,
            createdAt: new Date().toISOString(),
            isRoot: false,
          },
        ],
        nextCursor: null,
      };
    return new Response(JSON.stringify(data));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
it("hides root controls from ordinary users and anonymous users", async () => {
  const fetch = mock("user"),
    role = vi.fn();
  const view = render(
    <AdminPanel account={account} onRole={role} onChange={() => {}} />,
  );
  await waitFor(() => expect(role).toHaveBeenCalledWith(false));
  expect(
    screen.queryByRole("heading", { name: "Root Admin" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <AdminPanel account={null} onRole={role} onChange={() => {}} />,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("protects root in the UI and requires a reason before a CSRF-protected suspension", async () => {
  const fetch = mock(),
    changed = vi.fn();
  render(<AdminPanel account={account} onRole={() => {}} onChange={changed} />);
  await screen.findByText("ผู้ใช้ทั้งหมด");
  fireEvent.click(screen.getByRole("button", { name: "ผู้ใช้" }));
  await screen.findByText("Member");
  expect(screen.getAllByRole("button", { name: "ระงับผู้ใช้" })).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: "ระงับผู้ใช้" }));
  expect(
    screen.getByRole("button", { name: "ยืนยันและบันทึกประวัติ" }),
  ).toBeDisabled();
  fireEvent.change(
    screen.getByRole("textbox", { name: "เหตุผลการจัดการ (จำเป็น)" }),
    { target: { value: "ตรวจสอบบัญชี" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "ยืนยันและบันทึกประวัติ" }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const call = fetch.mock.calls.find(([p]) => p.endsWith("/status"));
  expect(call?.[1]).toMatchObject({
    method: "PUT",
    headers: { "X-CSRF-Token": csrf },
  });
  expect(JSON.parse(call![1]!.body as string)).toEqual({
    status: "suspended",
    version: 1,
    reason: "ตรวจสอบบัญชี",
  });
});
it("requires confirmation and a reason before opening service", async () => {
  const fetch = mock();
  render(
    <AdminPanel account={account} onRole={() => {}} onChange={() => {}} />,
  );
  await screen.findByText("ผู้ใช้ทั้งหมด");
  fireEvent.click(screen.getByRole("button", { name: "เปิด–ปิดบริการ" }));
  const toggle = await screen.findByRole("checkbox", {
    name: "เปิดบริการเที่ยวและคำขอสำหรับผู้ใช้ทั่วไป",
  });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(
    screen.getByRole("button", { name: "ตรวจและยืนยันการเปิด–ปิดบริการ" }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "เหตุผลการจัดการ (จำเป็น)" }),
    {
      target: { value: "พร้อมทดสอบ" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "ยืนยันและบันทึกประวัติ" }),
  );
  await waitFor(() =>
    expect(fetch.mock.calls.some(([, o]) => o?.method === "PUT")).toBe(true),
  );
});
it("removes private root content on logout", async () => {
  mock();
  const view = render(
    <AdminPanel account={account} onRole={() => {}} onChange={() => {}} />,
  );
  await screen.findByText("ผู้ใช้ทั้งหมด");
  view.rerender(
    <AdminPanel account={null} onRole={() => {}} onChange={() => {}} />,
  );
  expect(
    screen.queryByRole("heading", { name: "Root Admin" }),
  ).not.toBeInTheDocument();
});
it("admin sees operations but cannot change roles or site settings", async () => {
  mock("admin");
  render(
    <AdminPanel account={account} onRole={() => {}} onChange={() => {}} />,
  );
  await screen.findByRole("heading", { name: "Admin" });
  expect(
    screen.queryByRole("button", { name: "เปิด–ปิดบริการ" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ผู้ใช้" }));
  await screen.findByText("Member");
  expect(
    screen.queryByRole("button", { name: "แต่งตั้ง Admin" }),
  ).not.toBeInTheDocument();
});
it("root appointment requires a reason and sends role/version with CSRF", async () => {
  const fetch = mock();
  render(
    <AdminPanel account={account} onRole={() => {}} onChange={() => {}} />,
  );
  await screen.findByText("ผู้ใช้ทั้งหมด");
  fireEvent.click(screen.getByRole("button", { name: "ผู้ใช้" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "แต่งตั้ง Admin" }),
  );
  expect(
    screen.getByRole("button", { name: "ยืนยันและบันทึกประวัติ" }),
  ).toBeDisabled();
  fireEvent.change(
    screen.getByRole("textbox", { name: "เหตุผลการจัดการ (จำเป็น)" }),
    {
      target: { value: "Trusted administrator" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "ยืนยันและบันทึกประวัติ" }),
  );
  await waitFor(() =>
    expect(fetch.mock.calls.some(([p]) => p.endsWith("/role"))).toBe(true),
  );
  const call = fetch.mock.calls.find(([p]) => p.endsWith("/role"));
  expect(JSON.parse(call![1]!.body as string)).toEqual({
    role: "admin",
    version: 1,
    reason: "Trusted administrator",
  });
});

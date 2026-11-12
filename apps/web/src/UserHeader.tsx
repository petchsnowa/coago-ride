import { useEffect, useRef, useState } from "react";
import type { AuthState } from "@coago/contracts";
import AuthPanel from "./AuthPanel";
import MemberStatus from "./MemberStatus";
import { LocationCard } from "./LocationAccess";
export default function UserHeader({
  account,
  onAccountChange,
  serviceOpen,
  registrationsOpen,
  memberStatus,
  children,
}: {
  account: AuthState | null;
  onAccountChange: (account: AuthState | null) => void;
  serviceOpen: boolean;
  registrationsOpen: boolean;
  memberStatus: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    function reveal(hash: string) {
      if (!hash.startsWith("#") || hash.length < 2) return;
      let id: string;
      try {
        id = decodeURIComponent(hash.slice(1));
      } catch {
        return;
      }
      const target = document.getElementById(id),
        detail = target?.closest("details");
      if (!detail || !header.current?.contains(detail)) return;
      detail.open = true;
      setExpanded(true);
      requestAnimationFrame(() => {
        if (detail.open && header.current?.contains(detail))
          detail.scrollIntoView?.({ block: "nearest", behavior: "auto" });
      });
      return true;
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open =
        header.current?.querySelector<HTMLDetailsElement>("details[open]");
      if (open) {
        open.open = false;
        open.querySelector<HTMLElement>("summary")?.focus();
      }
      setExpanded(false);
    };
    const hashChanged = () => reveal(location.hash);
    const clicked = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      const a =
        event.target instanceof Element ? event.target.closest("a") : null;
      const hash = a?.getAttribute("href");
      if (hash?.startsWith("#") && reveal(hash)) {
        // Native fragment navigation would dispatch hashchange a second time,
        // potentially reopening a menu immediately after Escape.
        event.preventDefault();
        if (location.hash !== hash) history.pushState({}, "", hash);
      }
    };
    document.addEventListener("keydown", escape);
    hashChanged();
    window.addEventListener("hashchange", hashChanged);
    document.addEventListener("click", clicked);
    return () => {
      document.removeEventListener("keydown", escape);
      window.removeEventListener("hashchange", hashChanged);
      document.removeEventListener("click", clicked);
    };
  }, []);
  return (
    <header className="user-header" ref={header}>
      <nav className="top-navigation" aria-label="เมนูหลักด้านบน">
        <a className="brand" href="/">
          COAGO<span>ไปด้วยกัน</span>
        </a>
        <button
          type="button"
          className="menu-toggle secondary"
          aria-expanded={expanded}
          aria-controls="user-navigation"
          onClick={() => setExpanded((v) => !v)}
        >
          เมนู {expanded ? "−" : "+"}
        </button>
        <div
          className="top-menu-items"
          id="user-navigation"
          data-expanded={expanded}
        >
          <a href="#find-trips">ค้นหาเที่ยว</a>
          <a
            href={
              serviceOpen && account?.user
                ? "#my-journeys"
                : serviceOpen
                  ? "#my-account"
                  : "#closed-title"
            }
          >
            การเดินทางของฉัน
          </a>
          <a href="#wanted-board">ประกาศหารถ</a>
          <a href="/account">ข้อมูลสมาชิก</a>
          <a href="/account#my-vehicles">รถของฉัน</a>
          <details className="top-menu-tool" name="user-header-tools">
            <summary>ตำแหน่ง</summary>
            <div className="top-menu-panel">
              <LocationCard />
            </div>
          </details>
          <details
            className="top-menu-tool"
            name="user-header-tools"
            id="my-account"
            open={
              new URLSearchParams(location.search).get("auth") === "failed" ||
              undefined
            }
          >
            <summary>บัญชีของฉัน</summary>
            <div className="top-menu-panel">
              <AuthPanel
                onAccountChange={onAccountChange}
                serviceOpen={serviceOpen}
                registrationsOpen={registrationsOpen}
              />
              {memberStatus && account?.user && (
                <MemberStatus key={account.user.id} />
              )}
            </div>
          </details>
          <details className="top-menu-tool" name="user-header-tools">
            <summary>สถานะระบบ</summary>
            <div className="top-menu-panel">{children}</div>
          </details>
        </div>
      </nav>
    </header>
  );
}

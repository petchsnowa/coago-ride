import { discoveryCursorSchema, type DiscoveryCursor } from "@coago/contracts";
export function encodeDiscoveryCursor(value: DiscoveryCursor) {
  return btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function decodeDiscoveryCursor(value: string): DiscoveryCursor {
  if (!value || value.length > 600 || !/^[\w-]+$/.test(value))
    throw new Error("invalid_cursor");
  const bytes = Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );
  return discoveryCursorSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ),
  );
}

import { Buffer } from "node:buffer";
function bytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}
export async function dataKey(secret?: string) {
  if (!secret) throw new Error("MEMBER_STORAGE_NOT_CONFIGURED");
  const value = bytes(secret);
  if (value.length !== 32) throw new Error("MEMBER_STORAGE_NOT_CONFIGURED");
  return crypto.subtle.importKey("raw", value, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const b64 = (v: Uint8Array) => Buffer.from(v).toString("base64");
export async function seal(key: CryptoKey, value: Uint8Array, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new Uint8Array(value),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
export async function unseal(key: CryptoKey, value: string, context: string) {
  const [version, iv, cipher] = value.split(".");
  if (version !== "v1" || !iv || !cipher)
    throw new Error("INVALID_PRIVATE_DATA");
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(iv),
        additionalData: new TextEncoder().encode(context),
      },
      key,
      bytes(cipher),
    ),
  );
}
export const encode = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v));
export async function decode<T>(
  key: CryptoKey,
  value: string,
  context: string,
): Promise<T> {
  return JSON.parse(
    new TextDecoder().decode(await unseal(key, value, context)),
  );
}

export type Origin = {
  scheme: "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};
export function parseTestOrigin(value: string): Origin {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL_INVALID");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech") ||
    url.hostname.includes("-pooler") ||
    !url.username ||
    !url.password ||
    url.pathname === "/" ||
    !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
  ) {
    throw new Error("EXPECTED_NEON_DIRECT_TEST_DATABASE_WITH_TLS");
  }
  try {
    return {
      scheme: "postgres",
      host: url.hostname,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    throw new Error("TEST_DATABASE_URL_INVALID_ENCODING");
  }
}
export function resourceName(run: string, attempt: string) {
  if (!/^\d+$/.test(run) || !/^\d+$/.test(attempt))
    throw new Error("GITHUB_RUN_ID_REQUIRED");
  return `coago-hd-test-${run}-${attempt}`;
}
export async function cloudflareRequest<T>(
  account: string,
  token: string,
  path: string,
  init: RequestInit = {},
  request: typeof fetch = fetch,
): Promise<T> {
  if (!/^[a-f\d]{32}$/.test(account))
    throw new Error("CLOUDFLARE_ACCOUNT_ID_INVALID");
  if (!path.startsWith("/hyperdrive/configs"))
    throw new Error("UNEXPECTED_CLOUDFLARE_RESOURCE");
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  let payload: { success?: boolean; result?: T; errors?: { code?: number }[] };
  try {
    payload = await response.json();
  } catch {
    throw new Error(`CLOUDFLARE_HTTP_${response.status}`);
  }
  if (!response.ok || !payload.success) {
    const codes = (payload.errors ?? [])
      .map((e) => Number(e.code))
      .filter(Number.isFinite)
      .join(",");
    // Do not include provider messages: they can contain connection strings/credentials.
    throw new Error(
      `CLOUDFLARE_HTTP_${response.status}_CODES_${codes || "UNKNOWN"}`,
    );
  }
  return payload.result as T;
}

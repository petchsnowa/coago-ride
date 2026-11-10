import { parseTestOrigin } from "../remote/config";

async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f\d]{32}$/.test(account) || !token)
    throw new Error("CLOUDFLARE_CREDENTIALS_MISSING");
  const expected = parseTestOrigin(process.env.COAGO_TEST_DATABASE_URL ?? "");
  async function get(path: string) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
      {
        method: "GET",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = (await response.json()) as {
      success: boolean;
      result: unknown;
      errors?: { code: number }[];
    };
    if (!response.ok || !data.success) {
      const codes = (data.errors ?? [])
        .map((e) => Number(e.code))
        .filter(Number.isFinite)
        .join("_");
      throw new Error(
        `CLOUDFLARE_HTTP_${response.status}_${codes || "UNKNOWN"}`,
      );
    }
    return data.result;
  }
  const settings = (await get("/workers/scripts/coago-line-test/settings")) as {
    bindings: { name: string; type: string; id?: string }[];
  };
  const binding = settings.bindings.find((b) => b.name === "HYPERDRIVE");
  if (!binding?.id || !/^[a-f\d]{32}$/.test(binding.id))
    throw new Error("STAGING_HYPERDRIVE_BINDING_MISSING");
  const config = (await get(`/hyperdrive/configs/${binding.id}`)) as {
    name: string;
    origin: { host: string; database: string; user: string };
    caching?: { disabled?: boolean };
  };
  const matches =
    config.name === "coago-line-test" &&
    config.origin.host === expected.host &&
    config.origin.database === expected.database &&
    config.origin.user === expected.user;
  console.log(
    "STAGING_BINDING_REPORT",
    JSON.stringify({
      bindingPresent: true,
      originMatchesTestSecret: matches,
      cachingDisabled: config.caching?.disabled === true,
    }),
  );
  if (!matches) throw new Error("STAGING_HYPERDRIVE_ORIGIN_MISMATCH");
  if (!config.caching?.disabled)
    throw new Error("STAGING_HYPERDRIVE_CACHING_ENABLED");
  console.log(
    "PASS staging binding metadata (GET only; password validity not verified by metadata)",
  );
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  console.error(
    /^[A-Z][A-Z0-9_]{1,120}$/.test(message)
      ? message
      : "STAGING_BINDING_CHECK_FAILED",
  );
  process.exitCode = 1;
});

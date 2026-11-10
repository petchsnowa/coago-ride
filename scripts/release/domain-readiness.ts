// Inspect only the user-selected domain. Never print origin IPs or alter DNS/routes.
async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_CREDENTIALS_MISSING");
  async function get(path: string) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4${path}`,
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
        `DOMAIN_AUDIT_HTTP_${response.status}_${codes || "UNKNOWN"}`,
      );
    }
    return data.result;
  }
  const zones = (await get("/zones?name=coago.space")) as {
    id: string;
    name: string;
    status: string;
  }[];
  const zone = zones.find((z) => z.name === "coago.space");
  if (!zone || !/^[a-f\d]{32}$/.test(zone.id))
    throw new Error("DOMAIN_ZONE_NOT_VISIBLE");
  console.log(
    "DOMAIN_ZONE_REPORT",
    JSON.stringify({ name: zone.name, status: zone.status }),
  );
  for (const hostname of ["coago.space", "www.coago.space"]) {
    const records = (await get(
      `/zones/${zone.id}/dns_records?name=${hostname}`,
    )) as { name: string; type: string; proxied?: boolean }[];
    console.log(
      "DOMAIN_DNS_REPORT",
      JSON.stringify({
        hostname,
        records: records
          .filter((r) => r.name === hostname)
          .map((r) => ({ type: r.type, proxied: r.proxied === true })),
      }),
    );
  }
  const routes = (await get(`/zones/${zone.id}/workers/routes`)) as {
    pattern: string;
    script?: string;
  }[];
  console.log(
    "DOMAIN_ROUTE_REPORT",
    JSON.stringify({
      routes: routes
        .filter((r) => r.pattern.includes("coago.space"))
        .map((r) => ({ pattern: r.pattern, workerAssigned: !!r.script })),
    }),
  );
  console.log(
    "PASS domain metadata inspection (GET only; no origin IPs or DNS changes)",
  );
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  console.error(
    /^[A-Z][A-Z0-9_]{1,120}$/.test(message) ? message : "DOMAIN_AUDIT_FAILED",
  );
  process.exitCode = 1;
});

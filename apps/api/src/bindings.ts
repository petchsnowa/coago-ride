export type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  PRIVATE_DOCUMENTS?: {
    put(
      key: string,
      value: string,
      options?: { httpMetadata: { contentType: string } },
    ): Promise<unknown>;
    get(key: string): Promise<{ text(): Promise<string> } | null>;
    delete(key: string): Promise<unknown>;
  };
  MEMBER_DATA_KEY?: string;
  ORS_API_KEY?: string;
  LINE_MESSAGING_ENABLED?: string;
  LINE_MESSAGING_PROVIDER_CONFIRMED?: string;
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?: string;
  NEON_ADMIN_AUTH_URL?: string;
  ROOT_ADMIN_EMAIL?: string;
  HYPERDRIVE?: { connectionString: string };
  ALLOWED_ORIGINS?: string;
  APP_ORIGIN?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_CALLBACK_URL?: string;
  RELEASE_COMMIT?: string;
  ROOT_ADMIN_LINE_SUBJECT?: string;
  SITE_ACCESS_ENFORCED?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};
export function databaseUrl(env: Bindings): string {
  const url =
    env.HYPERDRIVE?.connectionString ??
    (["local", "test"].includes(env.ENVIRONMENT ?? "")
      ? env.DATABASE_URL
      : undefined);
  if (!url) throw new Error("DATABASE_CONFIGURATION_MISSING");
  return url;
}

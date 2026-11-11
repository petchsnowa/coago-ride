export type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  ALLOWED_ORIGINS?: string;
  APP_ORIGIN?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_CALLBACK_URL?: string;
  RELEASE_COMMIT?: string;
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

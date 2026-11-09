export function testDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Set DATABASE_URL for an isolated test database");
  const url = new URL(value);
  if (
    !["localhost", "127.0.0.1", "db"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw new Error("Only local databases ending in _test are permitted");
  return value;
}

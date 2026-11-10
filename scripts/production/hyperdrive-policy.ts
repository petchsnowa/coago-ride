import type { Origin } from "../remote/config";
export const hyperdriveName = "coago-production-db";
export type HyperdriveConfig = {
  id: string;
  name: string;
  origin?: Origin;
  caching?: { disabled?: boolean };
};
export function selectHyperdrive(
  configs: HyperdriveConfig[],
  pinnedId: string,
) {
  if (pinnedId && !/^[a-f\d]{32}$/.test(pinnedId))
    throw new Error("PRODUCTION_HYPERDRIVE_ID_INVALID");
  const matches = configs.filter((c) => c.name === hyperdriveName);
  if (matches.length > 1)
    throw new Error("PRODUCTION_HYPERDRIVE_NAME_CONFLICT");
  if (!matches.length) {
    if (pinnedId) throw new Error("PRODUCTION_HYPERDRIVE_PIN_NOT_FOUND");
    return null;
  }
  if (matches[0].id !== pinnedId)
    throw new Error("PRODUCTION_HYPERDRIVE_PIN_REQUIRED");
  return pinnedId;
}
export function verifyHyperdrive(
  config: HyperdriveConfig,
  origin: Origin,
  id: string,
) {
  if (
    config.id !== id ||
    config.name !== hyperdriveName ||
    config.origin?.host !== origin.host ||
    config.origin.database !== origin.database ||
    config.origin.user !== origin.user ||
    config.origin.port !== origin.port ||
    config.origin.scheme !== origin.scheme ||
    config.caching?.disabled !== true
  )
    throw new Error("PRODUCTION_HYPERDRIVE_CONFIGURATION_MISMATCH");
}
export function probeName(run: string, attempt: string) {
  if (!/^\d+$/.test(run) || !/^\d+$/.test(attempt))
    throw new Error("PRODUCTION_PROBE_RUN_REQUIRED");
  return `coago-prod-probe-${run}-${attempt}`;
}

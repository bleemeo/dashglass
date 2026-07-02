import { CURRENT_API_VERSION } from "../schema/dashboard";

/**
 * Brings a raw (decoded, not yet validated) document to the current
 * apiVersion. Runs before schema validation so that documents written for
 * older schema versions keep loading.
 *
 * v1 is the first version: the only migration is injecting the apiVersion
 * on documents that predate the field. Future versions chain steps here.
 */
export function migrateDashboard(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    !("apiVersion" in raw)
  ) {
    return { apiVersion: CURRENT_API_VERSION, ...raw };
  }
  return raw;
}

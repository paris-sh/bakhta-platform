// Deterministic JSON serialization (object keys sorted recursively) so hashing the same
// logical rule payload always produces the same bytes, regardless of the key insertion
// order used when constructing it in TypeScript. This intentionally does NOT need to match
// Postgres's own `jsonb::text` output — rules_hash is an application-maintained integrity
// fingerprint of what the app validated and submitted, not a value the database
// independently recomputes or checks against.
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

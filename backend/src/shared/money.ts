// Toman amounts are BIGINT in Postgres and arrive from `pg` as strings (never as JS
// `number`, which cannot safely represent integers beyond 2^53). Every arithmetic operation
// on a toman amount must go through these helpers, which use bigint, never floating point.

export type Toman = bigint;

export function tomanFromColumn(value: string): Toman {
  return BigInt(value);
}

export function tomanToColumn(value: Toman): string {
  return value.toString();
}

export function addToman(...values: Toman[]): Toman {
  return values.reduce((sum, v) => sum + v, 0n);
}

export function subtractToman(a: Toman, b: Toman): Toman {
  return a - b;
}

export function isNonNegativeToman(value: Toman): boolean {
  return value >= 0n;
}

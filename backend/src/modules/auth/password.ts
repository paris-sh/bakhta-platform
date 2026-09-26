import { argon2id, argon2Verify } from "hash-wasm";
import { randomBytes } from "node:crypto";

// hash-wasm is a pure WebAssembly implementation with zero native (.node) bindings. This is
// a deliberate choice, not a style preference: this project's environment has a Windows
// Application Control policy that blocks native addon binaries outright (confirmed by
// trying `argon2` and `@node-rs/argon2` first — both failed to load with "An Application
// Control policy has blocked this file"). Do not replace this with a native Argon2
// binding without first confirming the target environment allows native addons.

// OWASP-recommended baseline parameters for Argon2id (m=19MiB, t=2-3, p=1). Encoded into
// the PHC-format hash string itself, so a future parameter change doesn't invalidate
// existing hashes — verification always reads the parameters from the hash, never these
// constants.
const ITERATIONS = 3;
const MEMORY_SIZE_KIB = 19456;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  return argon2id({
    password,
    salt,
    iterations: ITERATIONS,
    memorySize: MEMORY_SIZE_KIB,
    parallelism: PARALLELISM,
    hashLength: HASH_LENGTH,
    outputType: "encoded",
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    // Malformed/foreign hash string — treat as a failed verification, never throw out of
    // a login attempt.
    return false;
  }
}

// A fixed, precomputed hash of an arbitrary password, used ONLY to keep the login
// endpoint's timing profile similar when the identifier doesn't exist — so an attacker
// can't distinguish "no such account" from "wrong password" by measuring response time.
// This is a hash of a throwaway string; it does not protect any real account.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=3,p=1$KdyTcIyvAExKbAjxqIbZEg$gBDf0r+BM8sXxyVUxLJhYdFOc7krWvl1rWj1l6YkjmA";

export async function verifyDummyPassword(): Promise<void> {
  await verifyPassword(DUMMY_HASH, "irrelevant");
}

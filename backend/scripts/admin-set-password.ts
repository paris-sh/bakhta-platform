// Sets or resets a SUPER_ADMIN's password (Argon2id), interactively and one-shot:
//
//   npm run admin:set-password                      # uses BAKHTA_BOOTSTRAP_ADMIN_EMAIL
//   npm run admin:set-password -- --email ops@x.y   # any admin holding an active SUPER_ADMIN role
//
// This is the "separate, secure admin-init command" the bootstrap seed hands off to (see the
// root README): the seed creates the identity, only this writes its credential.
//
// Secret handling, deliberately:
//   * The password is read ONLY from an interactive terminal with echo off. It is never
//     accepted as an argument, environment variable, file or piped stdin, so it can't land
//     in shell history, process listings, .env files, seeds, logs or Git.
//   * Only the Argon2id hash (same parameters as the app, via hashPassword) is stored; the
//     raw password and the hash are never printed or logged.
//   * Credential upsert, auth_version bump and revocation of the admin's active sessions
//     happen in one transaction, with a SYSTEM audit entry that records no secret material.
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { credentialExists, findActiveSuperAdmin, passwordProblem, storeAdminPassword } from "./lib/admin-password.js";

function parseEmailArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--email");
  if (i !== -1) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith("--email="));
  return inline?.slice("--email=".length);
}

/** Reads one line from the TTY without echoing it. Ctrl+C aborts. */
function readHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") return done(new Error("Aborted."));
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env"); // DATABASE_URL etc.; never holds the password
  } catch {
    /* no .env: rely on the real environment */
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Run this in an interactive terminal. The password is only accepted from hidden " +
        "keyboard input — never from pipes, arguments, environment variables or files.",
    );
  }

  const email = (parseEmailArg(process.argv.slice(2)) ?? process.env.BAKHTA_BOOTSTRAP_ADMIN_EMAIL)?.trim();
  if (!email) {
    throw new Error("Pass --email <admin email> or set BAKHTA_BOOTSTRAP_ADMIN_EMAIL.");
  }

  const env = loadEnv();
  const db = createDb(env);
  try {
    const admin = await findActiveSuperAdmin(db, email);
    if (!admin) throw new Error(`No admin with an active SUPER_ADMIN role has the email ${email}.`);
    if (admin.status !== "ACTIVE") throw new Error(`Admin ${email} is ${admin.status}; refusing to set a password.`);

    const hasCredential = await credentialExists(db, admin.id);
    console.log(`${hasCredential ? "Resetting" : "Setting"} the password for ${admin.email}.`);
    if (hasCredential) console.log("Their existing admin sessions will be signed out.");

    const password = await readHidden("New password: ");
    const problem = passwordProblem(password, admin.email);
    if (problem) throw new Error(problem);
    if ((await readHidden("Repeat password: ")) !== password) throw new Error("Passwords do not match.");

    const { revokedSessions: revoked } = await storeAdminPassword(db, admin.id, password);

    console.log(
      `Done. ${admin.email} can sign in at /admin/login` +
        (revoked > 0 ? ` (${revoked} active session${revoked === 1 ? "" : "s"} signed out).` : "."),
    );
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  // Messages only: never dump objects that could carry query parameters.
  console.error(`admin:set-password failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exit(1);
});

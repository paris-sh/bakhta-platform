import { spawn } from "node:child_process";

// Every script in this directory shells out to the real `psql` binary rather than executing
// SQL over the app's own `pg`/Kysely connection. This is deliberate, not a shortcut: the
// seed scripts under ../../seeds use psql-only meta-commands (\if, \echo, :'var'
// interpolation) that a raw driver connection cannot interpret — variable interpolation in
// particular does not work the same way inside a dollar-quoted ($$...$$) body over a plain
// driver connection as it does through the real psql client. Keeping one execution path
// (the real psql binary) avoids two subtly-divergent ways of running the same .sql files.

export interface PsqlOptions {
  file: string;
  databaseUrl: string;
  variables?: Record<string, string>;
}

export function runPsqlFile({ file, databaseUrl, variables }: PsqlOptions): Promise<void> {
  const args = ["-v", "ON_ERROR_STOP=1", "-f", file];
  for (const [key, value] of Object.entries(variables ?? {})) {
    args.push("-v", `${key}=${value}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("psql", [databaseUrl, ...args], { stdio: "inherit" });
    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to launch psql — is it installed and on PATH? (${err.message})`,
        ),
      );
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`psql exited with code ${code} while running ${file}`));
      }
    });
  });
}

/** Runs a file and returns its combined stdout, for scripts that need to inspect output. */
export function runPsqlFileCapture(opts: PsqlOptions): Promise<{ code: number; output: string }> {
  const args = ["-v", "ON_ERROR_STOP=1", "-f", opts.file];
  for (const [key, value] of Object.entries(opts.variables ?? {})) {
    args.push("-v", `${key}=${value}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("psql", [opts.databaseUrl, ...args]);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to launch psql — is it installed and on PATH? (${err.message})`,
        ),
      );
    });
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

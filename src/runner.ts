// src/runner.ts — Sandboxed Deno subprocess runner

export interface RunPermissions {
  read: string[];
  write: string[];
  network: string[];
  env: string[];
}

export interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  fitnessOutput?: Record<string, unknown>;
}

// No API key needed — mutator uses claude CLI, not direct API calls
export const SEVO_PERMISSIONS: RunPermissions = {
  read: ["./graph", "./blueprints", "./goal.jsonld", "./src"],
  write: ["./graph"],
  network: [],
  env: [],
};

export const APP_PERMISSIONS = (appEnvVars: string[]): RunPermissions => ({
  read: ["./graph", "./blueprints", "./goal.jsonld"],
  write: ["./graph/staging"],
  network: [],
  env: [...appEnvVars],
});

export async function run(
  blueprint: string,
  permissions: RunPermissions = SEVO_PERMISSIONS,
  timeoutMs = 300_000,
  taskContext?: string
): Promise<RunResult> {
  const start = Date.now();

  const args: string[] = ["run"];

  if (permissions.read.length) {
    args.push(`--allow-read=${permissions.read.join(",")}`);
  }
  if (permissions.write.length) {
    args.push(`--allow-write=${permissions.write.join(",")}`);
  }
  if (permissions.network.length) {
    args.push(`--allow-net=${permissions.network.join(",")}`);
  } else {
    args.push("--deny-net");
  }
  if (permissions.env.length) {
    args.push(`--allow-env=${permissions.env.join(",")}`);
  }
  args.push(blueprint);

  const cmd = new Deno.Command("deno", {
    args,
    stdout: "piped",
    stderr: "piped",
    stdin: taskContext ? "piped" : "null",
    signal: AbortSignal.timeout(timeoutMs),
  });

  let result: Deno.CommandOutput;
  try {
    const process = cmd.spawn();
    if (taskContext && process.stdin) {
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(taskContext));
      await writer.close();
    }
    result = await process.output();
  } catch (e) {
    return {
      success: false,
      stdout: "",
      stderr: e instanceof Error ? e.message : "Unknown error",
      exitCode: 1,
      durationMs: Date.now() - start,
    };
  }

  const stdout = new TextDecoder().decode(result.stdout);

  // Try to parse fitness output from last line of stdout
  let fitnessOutput: Record<string, unknown> | undefined;
  try {
    const lastLine = stdout.trim().split("\n").at(-1) ?? "";
    fitnessOutput = JSON.parse(lastLine);
  } catch {
    // not JSON, that's ok
  }

  return {
    success: result.code === 0,
    stdout,
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.code,
    durationMs: Date.now() - start,
    fitnessOutput,
  };
}

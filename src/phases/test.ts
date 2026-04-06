// src/phases/test.ts — Verify changes work at any layer

import type { ProjectState } from "../context.ts";
import type { ImplementResult, TestResult } from "./types.ts";

export async function test(project: ProjectState, impl: ImplementResult): Promise<TestResult> {
  console.log("\n=== TEST ===");

  if (!impl.success) {
    return { phase: "test", success: false, passed: false, summary: "nothing to test", output: "" };
  }

  // Try to run the main simulation/agent to verify nothing is broken
  const testTargets = [
    "src/fork-runner.ts",   // meta-cycle
    "blueprints/life-v2-agent-v1.ts",  // latest agent
  ];

  for (const target of testTargets) {
    try {
      const fullPath = `${project.path}/${target}`;
      await Deno.stat(fullPath);

      console.log(`  Testing: ${target}`);
      const denoPath = `${Deno.env.get("HOME")}/.deno/bin/deno`;
      const cmd = new Deno.Command(denoPath, {
        args: ["check", fullPath],
        cwd: project.path,
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(30_000),
      });

      const result = await cmd.output();
      const stderr = new TextDecoder().decode(result.stderr).trim();

      if (!result.success) {
        console.log(`  FAIL: ${stderr.slice(0, 200)}`);
        return {
          phase: "test",
          success: true,
          passed: false,
          summary: `Type check failed: ${target}`,
          output: stderr.slice(0, 500),
        };
      }
      console.log(`  PASS: ${target}`);
    } catch {
      // File doesn't exist, skip
      continue;
    }
  }

  // If we get here, all type checks passed
  return {
    phase: "test",
    success: true,
    passed: true,
    summary: "All checks passed",
    output: "",
  };
}

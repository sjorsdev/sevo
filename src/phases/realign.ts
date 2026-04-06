// src/phases/realign.ts — Check if work still serves the goal

import type { ProjectState } from "../context.ts";
import type { PhaseResult, ReflectResult } from "./types.ts";

export async function realign(
  project: ProjectState,
  reflectResult: ReflectResult,
): Promise<PhaseResult> {
  console.log("\n=== REALIGN ===");

  const goalName = (project.goal as Record<string, string>).name ?? "unknown";
  console.log(`  Goal: ${goalName}`);
  console.log(`  Layer: ${reflectResult.layer}`);
  console.log(`  Trend: ${reflectResult.trend}`);
  console.log(`  Agents: ${project.agentCount}`);
  console.log(`  Learnings: ${project.learnings.length}`);

  return {
    phase: "realign",
    success: true,
    summary: `Goal: ${goalName}, Layer ${reflectResult.layer}, ${reflectResult.trend}`,
  };
}

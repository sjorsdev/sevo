// src/phases/reflect.ts — Analyze fitness trends, detect which layer is stuck

import type { ProjectState } from "../context.ts";
import type { ReflectResult } from "./types.ts";

export async function reflect(project: ProjectState): Promise<ReflectResult> {
  console.log("\n=== REFLECT ===");

  // Check if there are unimplemented ideas waiting
  // Learnings are stored as "[priority] observation → suggestion"
  const unimplementedIdeas = project.learnings.filter(l =>
    l.includes("IDEA") || l.includes("Proposal") || l.includes("thinking") ||
    l.includes("Orchestrator THINK") || l.includes("brainstorm") ||
    l.includes("ideas generated") || parseInt(l.match(/^\[(\d+)\]/)?.[1] ?? "0") >= 8
  ).length;

  const hasOrganismV2 = project.srcFiles.includes("organism-v2.ts");
  const hasSim = project.srcFiles.includes("sim.ts");

  // Real assessment: is the simulation actually producing better results?
  // If PROGRESS.md mentions "plateau" or fitness is stuck, that's real
  const progressMentionsPlateau = project.progress.toLowerCase().includes("plateau") ||
    project.progress.toLowerCase().includes("stuck") ||
    project.progress.toLowerCase().includes("rebuild");

  // Check if there's code that's been built but not integrated
  const hasUnintegratedCode = hasOrganismV2 && project.progress.includes("needs integration");

  // Layer detection — be aggressive about implementing
  let layer: 1 | 2 | 3 = 1;

  // If there are unimplemented ideas AND the system has been running a while → Layer 2
  if (unimplementedIdeas > 5) layer = 2;

  // If PROGRESS says plateau or rebuild needed → Layer 2
  if (progressMentionsPlateau) layer = 2;

  // If there's unintegrated code waiting → Layer 2
  if (hasUnintegratedCode) layer = 2;

  // If many cycles with no structural change → Layer 3
  if (unimplementedIdeas > 20 && progressMentionsPlateau) layer = 3;

  const summary = `${unimplementedIdeas} unimplemented ideas. ` +
    `${hasUnintegratedCode ? "organism-v2 NOT integrated. " : ""}` +
    `${progressMentionsPlateau ? "PLATEAU detected in PROGRESS.md. " : ""}` +
    `→ Layer ${layer}`;

  console.log(`  ${summary}`);

  return {
    phase: "reflect",
    success: true,
    summary,
    layer,
    plateauing: layer >= 2,
    trend: layer === 1 ? "improving" : "plateau",
    delta: 0,
  };
}

// src/phases/reflect.ts — Analyze fitness trends, detect which layer is stuck

import { callClaude, extractJSON } from "../claude-cli.ts";
import { buildContext, type ProjectState } from "../context.ts";
import type { ReflectResult } from "./types.ts";

export async function reflect(project: ProjectState): Promise<ReflectResult> {
  console.log("\n=== REFLECT ===");

  const history = project.fitnessHistory;
  const recent = history.slice(-10);
  const older = history.slice(-20, -10);

  const recentAvg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : 0;
  const delta = recentAvg - olderAvg;

  const plateauing = recent.length >= 5 && Math.abs(delta) < 0.5;
  const trend = delta > 1 ? "improving" : delta < -1 ? "declining" : "plateau";

  // Detect which layer to evolve at
  let layer: 1 | 2 | 3 = 1;
  if (plateauing && history.length > 20) layer = 2;
  if (plateauing && history.length > 50) {
    // Check if engine-level changes have been attempted
    const engineAttempts = project.learnings.filter(l => l.includes("implement") || l.includes("redesign")).length;
    if (engineAttempts >= 3) layer = 3;
  }

  const summary = `Trend: ${trend} (recent: ${recentAvg.toFixed(1)}, delta: ${delta.toFixed(2)}). ` +
    `${history.length} cycles. ${plateauing ? `PLATEAU → Layer ${layer}` : `Layer 1 (improving)`}`;

  console.log(`  ${summary}`);

  return {
    phase: "reflect",
    success: true,
    summary,
    layer,
    plateauing,
    trend,
    delta,
  };
}

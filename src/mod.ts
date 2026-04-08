// src/mod.ts — SEVO public API
// Import from this file in fork projects: import { writeNode } from "sevo/mod.ts"

export { loadGoal, goalFilename } from "./goal.ts";
export type { Goal } from "./goal.ts";
export { writeNode, readNode, queryNodes, archiveNode } from "./graph.ts";
export { git } from "./git.ts";
export { run, SEVO_PERMISSIONS } from "./runner.ts";
export type { RunResult, RunPermissions } from "./runner.ts";
export { score } from "./scorer.ts";
export { select } from "./selector.ts";
export { computeSevoScore } from "./sevoscore.ts";
export { reportDiscovery, pullLearnings, formatLearnings } from "./reporter.ts";
export { callClaude, callClaudeEdit, extractJSON } from "./claude-cli.ts";
export type * from "./types.ts";

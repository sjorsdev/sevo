// src/context.ts — Assemble context from a sevo project's repo state
// Each phase gets only what it needs. The repo IS the memory.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface ProjectState {
  path: string;
  progress: string;                // PROGRESS.md contents
  goal: Record<string, unknown>;   // goal.jsonld parsed
  domain: string;
  gitLog: string;                  // last 20 commits
  learnings: string[];             // seedimprovement summaries
  fitnessHistory: number[];        // from sevoscores
  agentCount: number;
  srcFiles: string[];              // list of src/*.ts files
}

/** Detect and load a sevo project's state */
export async function loadProject(projectPath: string): Promise<ProjectState> {
  const abs = projectPath.startsWith("/") ? projectPath : join(Deno.cwd(), projectPath);

  // PROGRESS.md
  let progress = "";
  try { progress = await Deno.readTextFile(join(abs, "PROGRESS.md")); } catch { /* none */ }

  // goal.jsonld
  let goal: Record<string, unknown> = {};
  let domain = "unknown";
  try {
    goal = JSON.parse(await Deno.readTextFile(join(abs, "goal.jsonld")));
    domain = (goal["@id"] as string)?.replace("goal:", "") ?? "unknown";
  } catch { /* none */ }

  // git log
  let gitLog = "";
  try {
    const r = await new Deno.Command("git", {
      args: ["log", "--oneline", "-20"],
      cwd: abs, stdout: "piped",
    }).output();
    gitLog = new TextDecoder().decode(r.stdout).trim();
  } catch { /* not a git repo */ }

  // Learnings from seedimprovements
  const learnings: string[] = [];
  try {
    const dir = join(abs, "graph", "seedimprovements");
    for (const entry of await Array.fromAsync(Deno.readDir(dir))) {
      if (!entry.name.endsWith(".jsonld")) continue;
      const node = JSON.parse(await Deno.readTextFile(join(dir, entry.name)));
      learnings.push(`[${node.priority ?? 0}] ${(node.observation ?? "").slice(0, 100)} → ${(node.suggestion ?? "").slice(0, 150)}`);
    }
    learnings.sort().reverse(); // highest priority first
  } catch { /* no learnings */ }

  // Fitness history from sevoscores
  const fitnessHistory: number[] = [];
  try {
    const dir = join(abs, "graph", "sevoscores");
    const scores: Array<{ timestamp: string; score: number }> = [];
    for (const entry of await Array.fromAsync(Deno.readDir(dir))) {
      if (!entry.name.endsWith(".jsonld")) continue;
      const node = JSON.parse(await Deno.readTextFile(join(dir, entry.name)));
      scores.push({ timestamp: node.timestamp, score: node.score });
    }
    scores.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (const s of scores) fitnessHistory.push(s.score);
  } catch { /* no scores */ }

  // Count agents
  let agentCount = 0;
  try {
    const dir = join(abs, "graph", "agents");
    for (const entry of await Array.fromAsync(Deno.readDir(dir))) {
      if (!entry.name.endsWith(".jsonld")) continue;
      const node = JSON.parse(await Deno.readTextFile(join(dir, entry.name)));
      if (node.status === "active") agentCount++;
    }
  } catch { /* no agents */ }

  // src/ files list
  const srcFiles: string[] = [];
  try {
    const dir = join(abs, "src");
    for (const entry of await Array.fromAsync(Deno.readDir(dir))) {
      if (entry.name.endsWith(".ts")) srcFiles.push(entry.name);
    }
  } catch { /* no src */ }

  return { path: abs, progress, goal, domain, gitLog, learnings, fitnessHistory, agentCount, srcFiles };
}

/** Build context string for a specific phase */
export function buildContext(
  project: ProjectState,
  phase: string,
  extras?: Record<string, string>,
): string {
  const sections: string[] = [];

  sections.push(`PROJECT: ${project.domain}`);
  sections.push(`GOAL: ${(project.goal as Record<string, string>).name ?? "unknown"}`);

  if (project.progress) {
    sections.push(`\nPROGRESS:\n${project.progress.slice(0, 2000)}`);
  }

  if (phase === "reflect" || phase === "realign") {
    sections.push(`\nFITNESS HISTORY (${project.fitnessHistory.length} scores):`);
    sections.push(project.fitnessHistory.slice(-20).map((s, i) => `  ${i}: ${s.toFixed(1)}`).join("\n"));
  }

  if (phase === "think" || phase === "implement" || phase === "redesign") {
    sections.push(`\nLEARNINGS (${project.learnings.length} total, top 15):`);
    sections.push(project.learnings.slice(0, 15).join("\n"));
  }

  if (phase === "implement" || phase === "redesign") {
    sections.push(`\nSRC FILES: ${project.srcFiles.join(", ")}`);
  }

  sections.push(`\nGIT LOG:\n${project.gitLog}`);
  sections.push(`\nACTIVE AGENTS: ${project.agentCount}`);

  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      sections.push(`\n${key.toUpperCase()}:\n${value}`);
    }
  }

  return sections.join("\n");
}

/** Read a specific src file from the project */
export async function readSrcFile(project: ProjectState, filename: string): Promise<string> {
  try {
    return await Deno.readTextFile(join(project.path, "src", filename));
  } catch {
    return "";
  }
}

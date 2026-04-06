// src/phases/implement.ts — L2: give claude edit access to modify src/ files
// This is the key missing piece that closes the loop:
// THINK proposes → IMPLEMENT builds → TEST verifies

import { callClaudeEdit } from "../claude-cli.ts";
import { buildContext, readSrcFile, type ProjectState } from "../context.ts";
import type { ThinkResult, ImplementResult } from "./types.ts";

export async function implement(
  project: ProjectState,
  thinkResult: ThinkResult,
): Promise<ImplementResult> {
  console.log("\n=== IMPLEMENT (L2) ===");

  if (thinkResult.ideas.length === 0) {
    return { phase: "implement", success: false, summary: "no proposals", branch: "", filesModified: [], merged: false };
  }

  // Pick the most actionable idea
  const idea = thinkResult.ideas[0];
  console.log(`  Implementing: ${idea.idea.slice(0, 100)}`);

  // Create implementation branch
  const branchName = `implement-${Date.now()}`;
  try {
    await new Deno.Command("git", {
      args: ["checkout", "-b", branchName],
      cwd: project.path,
    }).output();
  } catch {
    // Branch might already exist, try checkout
    await new Deno.Command("git", {
      args: ["checkout", branchName],
      cwd: project.path,
    }).output();
  }

  // Build implementation prompt with relevant src files
  const context = buildContext(project, "implement", {
    "PROPOSAL TO IMPLEMENT": `${idea.idea}\nMath: ${idea.math}\nTestable: ${idea.testable}`,
  });

  // Read relevant src files for context
  const srcContents: string[] = [];
  for (const file of project.srcFiles.slice(0, 5)) {
    const content = await readSrcFile(project, file);
    if (content) {
      srcContents.push(`\n--- ${file} ---\n${content.slice(0, 3000)}`);
    }
  }

  const prompt = `You are implementing a change to a sevo project.

${context}

SOURCE FILES:
${srcContents.join("\n")}

TASK: Implement the proposal above. Modify the relevant src/ files.
After making changes:
1. Make sure the code compiles (no syntax errors)
2. Git add and commit your changes with a descriptive message
3. Be minimal — only change what's needed for the proposal

Do NOT modify graph/ files or PROGRESS.md. Only modify src/ and blueprints/.`;

  const result = await callClaudeEdit({
    prompt,
    model: "sonnet",
    projectDir: project.path,
    timeoutMs: 300_000,
  });

  // Check what changed
  let filesModified: string[] = [];
  try {
    const diff = await new Deno.Command("git", {
      args: ["diff", "main", "--name-only"],
      cwd: project.path,
      stdout: "piped",
    }).output();
    filesModified = new TextDecoder().decode(diff.stdout).trim().split("\n").filter(Boolean);
  } catch { /* no diff */ }

  if (filesModified.length === 0) {
    console.log("  No changes made. Abandoning branch.");
    await new Deno.Command("git", { args: ["checkout", "main"], cwd: project.path }).output();
    await new Deno.Command("git", { args: ["branch", "-D", branchName], cwd: project.path }).output().catch(() => {});
    return { phase: "implement", success: false, summary: "no changes", branch: branchName, filesModified: [], merged: false };
  }

  console.log(`  Modified: ${filesModified.join(", ")}`);
  return {
    phase: "implement",
    success: true,
    summary: `Implemented on ${branchName}: ${filesModified.length} files`,
    branch: branchName,
    filesModified,
    merged: false, // TEST phase decides
  };
}

/** Merge implementation branch to main (called after TEST passes) */
export async function mergeImplementation(project: ProjectState, branch: string): Promise<boolean> {
  try {
    await new Deno.Command("git", { args: ["checkout", "main"], cwd: project.path }).output();
    await new Deno.Command("git", { args: ["merge", branch], cwd: project.path }).output();
    console.log(`  Merged ${branch} to main`);
    return true;
  } catch (e) {
    console.error(`  Merge failed: ${(e as Error).message.slice(0, 100)}`);
    // Abort merge and go back to main
    await new Deno.Command("git", { args: ["merge", "--abort"], cwd: project.path }).output().catch(() => {});
    await new Deno.Command("git", { args: ["checkout", "main"], cwd: project.path }).output().catch(() => {});
    return false;
  }
}

/** Abandon implementation branch */
export async function abandonImplementation(project: ProjectState, branch: string): Promise<void> {
  await new Deno.Command("git", { args: ["checkout", "main"], cwd: project.path }).output().catch(() => {});
  await new Deno.Command("git", { args: ["branch", "-D", branch], cwd: project.path }).output().catch(() => {});
  console.log(`  Abandoned ${branch}`);
}

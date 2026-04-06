#!/usr/bin/env -S deno run --allow-all
// src/orchestrator.ts — SEVO autonomous orchestrator
//
// Runs the full meta-cycle on any sevo project:
//   EVOLVE → REFLECT → THINK → IMPLEMENT → TEST → REALIGN
//
// Each phase = fresh claude -p call with clean context from the repo.
// The git repo IS the memory. No conversation state to lose.
//
// Usage:
//   deno run --allow-all src/orchestrator.ts /path/to/sevo-project
//   deno run --allow-all src/orchestrator.ts .  # current directory

import { loadProject, type ProjectState } from "./context.ts";
import { reflect } from "./phases/reflect.ts";
import { think } from "./phases/think.ts";
import { implement, mergeImplementation, abandonImplementation } from "./phases/implement.ts";
import { test } from "./phases/test.ts";
import { realign } from "./phases/realign.ts";

async function updateProgress(project: ProjectState, cycle: number, summary: string): Promise<void> {
  const content = `# PROGRESS

## Cycle: ${cycle}
## Status: ${summary}
## Agents: ${project.agentCount}
## Learnings: ${project.learnings.length}
## Timestamp: ${new Date().toISOString()}
`;
  await Deno.writeTextFile(`${project.path}/PROGRESS.md`, content);

  // Commit progress
  try {
    await new Deno.Command("git", { args: ["add", "PROGRESS.md"], cwd: project.path }).output();
    await new Deno.Command("git", { args: ["commit", "-m", `orchestrator: cycle ${cycle} — ${summary.slice(0, 60)}`], cwd: project.path }).output();
  } catch { /* may have nothing to commit */ }
}

async function runMetaCycle(projectPath: string, cycle: number): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  META-CYCLE ${cycle}`);
  console.log(`${"=".repeat(60)}`);

  // Load fresh project state each cycle (repo IS the memory)
  const project = await loadProject(projectPath);
  console.log(`Project: ${project.domain}`);
  console.log(`Agents: ${project.agentCount}, Learnings: ${project.learnings.length}`);

  // REFLECT — analyze trends, detect which layer
  const reflectResult = await reflect(project);

  // THINK — always, creative reasoning drives breakthroughs
  const thinkResult = await think(project, reflectResult.summary);

  // IMPLEMENT — when Layer 2+, OR every 5 cycles if there are accumulated ideas
  const shouldImplement = reflectResult.layer >= 2 || (cycle % 5 === 0 && project.learnings.length > 10);
  if (shouldImplement && thinkResult.ideas.length > 0) {
    console.log(`\n  Implementing (layer=${reflectResult.layer}, cycle=${cycle}, accumulated=${project.learnings.length})`);

    // Try each idea — if implementation fails test, try to fix it before moving on
    let implemented = false;
    for (let ideaIdx = 0; ideaIdx < thinkResult.ideas.length && !implemented; ideaIdx++) {
      const singleIdeaThink = { ...thinkResult, ideas: [thinkResult.ideas[ideaIdx]] };
      console.log(`  Trying idea ${ideaIdx + 1}/${thinkResult.ideas.length}: ${thinkResult.ideas[ideaIdx].idea?.slice(0, 80)}`);

      const implResult = await implement(project, singleIdeaThink);

      if (implResult.success) {
        // TEST — verify changes work, retry fix if test fails
        const MAX_FIX_ATTEMPTS = 20;
        let testResult = await test(project, implResult);
        let lastTestError = "";
        let sameTestErrorCount = 0;

        for (let fixAttempt = 1; fixAttempt <= MAX_FIX_ATTEMPTS && !testResult.passed; fixAttempt++) {
          // Detect loops: if same error 3 times in a row, stop
          const currentError = testResult.output.slice(0, 300);
          if (currentError === lastTestError) { sameTestErrorCount++; } else { sameTestErrorCount = 0; lastTestError = currentError; }
          if (sameTestErrorCount >= 3) { console.log(`  Same error 3x in a row — stuck.`); break; }

          console.log(`  Test failed (fix attempt ${fixAttempt}), asking LLM to fix...`);

          // Feed the error back to implement phase to fix it
          const fixThink = {
            ...singleIdeaThink,
            ideas: [{
              ...singleIdeaThink.ideas[0],
              idea: `FIX THE PREVIOUS IMPLEMENTATION. It failed type checking with:\n${testResult.output}\n\nOriginal idea: ${singleIdeaThink.ideas[0].idea}`,
            }],
          };
          // Re-implement on the same branch (already checked out)
          await implement(project, fixThink);
          testResult = await test(project, implResult);
        }

        if (testResult.passed) {
          await mergeImplementation(project, implResult.branch);
          console.log("  Implementation MERGED — engine evolved.");
          implemented = true;
        } else {
          await abandonImplementation(project, implResult.branch);
          console.log(`  Idea ${ideaIdx + 1} unfixable (loop detected or max retries) — trying next idea...`);
        }
      } else {
        console.log(`  Idea ${ideaIdx + 1} produced no changes — trying next idea...`);
      }
    }
    if (!implemented) {
      console.log("  All ideas failed to implement. Will retry next cycle.");
    }
  } else if (reflectResult.layer === 1) {
    console.log("\n  Layer 1: Agent evolution (run simulation loop separately)");
  }

  // REALIGN — check goal alignment
  await realign(project, reflectResult);

  // Update PROGRESS.md
  await updateProgress(project, cycle, `L${reflectResult.layer} ${reflectResult.trend} — ${thinkResult.ideas.length} ideas`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const projectPath = Deno.args[0] ?? ".";
console.log(`SEVO Orchestrator starting on: ${projectPath}`);
console.log(`Meta-cycle: EVOLVE → REFLECT → THINK → IMPLEMENT → TEST → REALIGN`);

let cycle = 0;
while (true) {
  cycle++;
  try {
    await runMetaCycle(projectPath, cycle);
  } catch (e) {
    console.error(`\nMeta-cycle ${cycle} failed: ${(e as Error).message}`);
    console.error("Continuing to next cycle...");
  }

  // Pause between meta-cycles
  const pauseMs = parseInt(Deno.env.get("SEVO_PAUSE_MS") ?? "5000");
  await new Promise((r) => setTimeout(r, pauseMs));
}

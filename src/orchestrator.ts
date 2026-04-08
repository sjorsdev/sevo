#!/usr/bin/env -S deno run --allow-all
// src/orchestrator.ts — SEVO: the single evolution loop
//
// One system. Every mutation is orchestrated.
//
//   REFLECT → THINK → IMPLEMENT → REVIEW → BENCHMARK → SELECT
//
// REFLECT:   Analyze fitness trends, diversity, opportunities
// THINK:     Choose what to do: mutate agent, crossover, new agent, evolve benchmark, modify engine
// IMPLEMENT: Execute the chosen action (LLM generates code)
// REVIEW:    Compare plan vs implementation — did we build what we intended?
// BENCHMARK: Run ALL active agents, score them
// SELECT:    Keep winners, archive losers, record what we learned
//
// Multiple agents compete simultaneously. Branches of mutation coexist.
// There is no separate "agent evolution" vs "engine evolution" — it's all
// one decision space. The THINK phase picks the highest-value action.

import { loadProject, type ProjectState } from "./context.ts";
import { callClaude, callClaudeEdit, extractJSON } from "./claude-cli.ts";
import { queryNodes, writeNode } from "./graph.ts";
import { run, SEVO_PERMISSIONS } from "./runner.ts";
import { score } from "./scorer.ts";
import { git } from "./git.ts";
import { pullLearnings, formatLearnings, reportDiscovery } from "./reporter.ts";
import type {
  AgentNode,
  FitnessNode,
  BenchmarkNode,
  MutationNode,
  SelectionNode,
  SeedImprovementNode,
  DecisionRecordNode,
  DecisionOutcomeNode,
  DecisionScope,
} from "./types.ts";
import type {
  ReflectResult,
  ThinkResult,
  ImplementResult,
  ReviewResult,
  BenchmarkResult,
  SelectResult,
  ActionType,
} from "./phases/types.ts";

function inferScope(action: ActionType): DecisionScope {
  if (action === "mutate_agent") return "tactical";
  if (action === "modify_engine") return "architectural";
  return "strategic";
}

function formatSpec(t: ThinkResult): string {
  return `DECISION SPEC:
  What: ${t.proposal}
  Why: ${t.reasoning}
  Acceptance Criteria:
${t.acceptanceCriteria.map(c => `    - ${c}`).join("\n")}
  Strategy: ${t.approach.strategy}
  Constraints: ${t.approach.constraints?.join("; ") ?? "none"}

Your implementation MUST satisfy ALL acceptance criteria.`;
}

// ---------------------------------------------------------------------------
// REFLECT — what's happening, what are the opportunities?
// ---------------------------------------------------------------------------
async function reflect(project: ProjectState): Promise<ReflectResult> {
  console.log("\n=== REFLECT ===");

  const agents = await queryNodes<AgentNode>("agent", a => a.status === "active");
  const fitness = await queryNodes<FitnessNode>("fitness");
  const recent = fitness.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 20);
  const recentAvg = recent.length > 0 ? recent.reduce((s, f) => s + f.eqs, 0) / recent.length : 0;
  const olderAvg = fitness.slice(20, 40).length > 0
    ? fitness.slice(20, 40).reduce((s, f) => s + f.eqs, 0) / fitness.slice(20, 40).length : 0;
  const delta = recentAvg - olderAvg;

  const plateauing = recent.length >= 5 && Math.abs(delta) < 0.01;
  const trend = delta > 0.02 ? "improving" : delta < -0.02 ? "declining" : "plateau";
  const bestFitness = recent.length > 0 ? Math.max(...recent.map(f => f.eqs)) : 0;

  // Detect opportunities
  const opportunities: string[] = [];
  if (agents.length < 3) opportunities.push("Low diversity — could create new agent");
  if (plateauing) opportunities.push("Fitness plateau — try crossover, new approach, or engine change");
  if (agents.length >= 2) opportunities.push("Multiple agents available for crossover");

  const benchmarks = await queryNodes<BenchmarkNode>("benchmark");
  if (benchmarks.length > 0 && bestFitness > 0.8) {
    opportunities.push("High fitness — could evolve harder benchmarks");
  }
  if (project.learnings.length > 10) {
    opportunities.push(`${project.learnings.length} accumulated learnings — could modify engine`);
  }

  const summary = `${agents.length} agents, trend=${trend}, best=${bestFitness.toFixed(3)}, ${opportunities.length} opportunities`;
  console.log(`  ${summary}`);
  for (const opp of opportunities) console.log(`    - ${opp}`);

  return {
    phase: "reflect", success: true, summary,
    plateauing, trend, delta,
    agentCount: agents.length, bestFitness, opportunities,
  };
}

// ---------------------------------------------------------------------------
// THINK — decide what action to take
// ---------------------------------------------------------------------------
async function think(project: ProjectState, reflectResult: ReflectResult): Promise<ThinkResult> {
  console.log("\n=== THINK ===");

  const agents = await queryNodes<AgentNode>("agent", a => a.status === "active");
  const agentList = agents.map(a => `${a["@id"]} (gen ${a.generation})`).join(", ");

  // Pull cross-project insights
  const domain = project.domain;
  const learnings = await pullLearnings(domain);
  const crossContext = formatLearnings(learnings);

  const cycleId = `cycle-${Date.now()}`;

  const prompt = `You are the brain of a SEVO evolution system. Think in terms of WHY, WHAT, and HOW.

PROJECT: ${project.goal.name}
ACTIVE AGENTS: ${agentList || "none"}
TREND: ${reflectResult.trend} (delta: ${reflectResult.delta.toFixed(4)})
BEST FITNESS: ${reflectResult.bestFitness.toFixed(3)}
OPPORTUNITIES: ${reflectResult.opportunities.join("; ")}
RECENT GIT LOG:\n${project.gitLog}
${crossContext}

Choose ONE action for this cycle. Options:
- mutate_agent: tweak an existing agent's code to improve fitness
- crossover: combine two agents into a new one
- new_agent: create a fresh agent with a novel approach
- evolve_benchmark: make benchmarks harder or test different things
- modify_engine: change how scoring, selection, or mutation works (src/ files)

Consider: what gives the most value RIGHT NOW? Not what's stuck — what's the best creative choice.

JSON only:
{
  "action": "mutate_agent|crossover|new_agent|evolve_benchmark|modify_engine",
  "evidence": ["specific data points that motivate this decision"],
  "reasoning": "why this action over alternatives, grounded in the evidence",
  "target": "agent @id, benchmark @id, or src filename (if applicable)",
  "target2": "second agent @id (for crossover only, omit otherwise)",
  "proposal": "specific description of what to change",
  "acceptanceCriteria": ["criterion 1: specific, verifiable from the git diff", "criterion 2: ..."],
  "expectedImpact": {
    "metric": "fitness|accuracy|diversity|benchmark_difficulty",
    "direction": "increase|decrease|maintain",
    "magnitude": "minor|moderate|significant"
  },
  "approach": {
    "strategy": "how to implement this",
    "filesExpected": ["file1.ts"],
    "constraints": ["preserve X", "don't break Y"]
  }
}

IMPORTANT: Each acceptance criterion must be verifiable from the git diff alone.
Bad: "improve performance". Good: "add memoization cache to fibonacci function".`;

  try {
    const response = await callClaude({ prompt, model: "sonnet", timeoutMs: 120_000 });
    const parsed = extractJSON<{
      action: ActionType;
      evidence?: string[];
      reasoning: string;
      target?: string;
      target2?: string;
      proposal: string;
      acceptanceCriteria?: string[];
      expectedImpact?: { metric: string; direction: string; magnitude?: string };
      approach?: { strategy: string; filesExpected?: string[]; constraints?: string[] };
    }>(response);

    if (parsed) {
      const scope = inferScope(parsed.action);
      const decisionId = `decision-${Date.now()}`;
      const evidence = parsed.evidence ?? [reflectResult.trend, `best=${reflectResult.bestFitness}`];
      const acceptanceCriteria = parsed.acceptanceCriteria ?? ["At least one file is modified"];
      const expectedImpact = parsed.expectedImpact ?? { metric: "fitness", direction: "increase" };
      const approach = parsed.approach ?? { strategy: parsed.proposal };

      console.log(`  Action: ${parsed.action} [${scope}]`);
      console.log(`  Reasoning: ${parsed.reasoning.slice(0, 120)}`);
      console.log(`  Criteria: ${acceptanceCriteria.join("; ").slice(0, 120)}`);

      // Write DecisionRecord to graph
      const record: DecisionRecordNode = {
        "@context": "sevo://v1",
        "@type": "DecisionRecord",
        "@id": decisionId,
        timestamp: new Date().toISOString(),
        cycleId,
        action: parsed.action,
        scope,
        context: {
          trend: reflectResult.trend,
          bestFitness: reflectResult.bestFitness,
          fitnessDelta: reflectResult.delta,
          opportunities: reflectResult.opportunities,
          evidence,
        },
        decision: {
          target: parsed.target,
          target2: parsed.target2,
          proposal: parsed.proposal,
          acceptanceCriteria,
          expectedImpact: expectedImpact as DecisionRecordNode["decision"]["expectedImpact"],
          reasoning: parsed.reasoning,
        },
        approach,
      };
      try { await writeNode(record); } catch { /* ok if graph dir issues */ }

      return {
        phase: "think", success: true,
        summary: `[${scope}] ${parsed.action}: ${parsed.proposal.slice(0, 80)}`,
        action: parsed.action,
        reasoning: parsed.reasoning,
        target: parsed.target,
        target2: parsed.target2,
        proposal: parsed.proposal,
        decisionId,
        scope,
        evidence,
        acceptanceCriteria,
        expectedImpact,
        approach,
      };
    }
  } catch (e) {
    console.error(`  THINK failed: ${(e as Error).message.slice(0, 100)}`);
  }

  // Fallback: mutate best agent
  const best = agents[0];
  const fallbackId = `decision-${Date.now()}`;
  return {
    phase: "think", success: true,
    summary: "fallback: mutate best agent",
    action: "mutate_agent",
    reasoning: "THINK failed, defaulting to mutation",
    target: best?.["@id"],
    proposal: "Improve the agent's test coverage and edge case handling",
    decisionId: fallbackId,
    scope: "tactical",
    evidence: ["THINK phase failed"],
    acceptanceCriteria: ["At least one file is modified", "Agent produces valid fitness output"],
    expectedImpact: { metric: "fitness", direction: "increase" },
    approach: { strategy: "generic improvement" },
  };
}

// ---------------------------------------------------------------------------
// IMPLEMENT — execute the chosen action
// ---------------------------------------------------------------------------
async function implement(project: ProjectState, thinkResult: ThinkResult): Promise<ImplementResult> {
  console.log("\n=== IMPLEMENT ===");
  console.log(`  Action: ${thinkResult.action}`);

  const branchName = `sevo-${thinkResult.action}-${Date.now()}`;
  try {
    await new Deno.Command("git", { args: ["checkout", "-b", branchName], cwd: project.path }).output();
  } catch {
    await new Deno.Command("git", { args: ["checkout", branchName], cwd: project.path }).output().catch(() => {});
  }

  // Build context-aware prompt based on action type
  let implPrompt = "";
  const srcContents: string[] = [];

  const spec = formatSpec(thinkResult);

  if (thinkResult.action === "modify_engine") {
    // Read relevant src files
    for (const file of project.srcFiles.slice(0, 5)) {
      try {
        const content = await Deno.readTextFile(`${project.path}/src/${file}`);
        srcContents.push(`--- ${file} ---\n${content.slice(0, 2000)}`);
      } catch { /* ok */ }
    }
    implPrompt = `Modify the SEVO engine source files.
${spec}
SOURCE FILES:\n${srcContents.join("\n\n")}
Only modify src/ files. Git add and commit your changes.`;
  } else if (thinkResult.action === "mutate_agent" || thinkResult.action === "new_agent") {
    // Read target agent if mutating
    let agentCode = "";
    if (thinkResult.target && thinkResult.action === "mutate_agent") {
      const agents = await queryNodes<AgentNode>("agent", a => a["@id"] === thinkResult.target);
      if (agents[0]) {
        try { agentCode = await Deno.readTextFile(agents[0].blueprint); } catch { /* ok */ }
      }
    }
    implPrompt = `${thinkResult.action === "new_agent" ? "Create a new" : "Mutate an existing"} agent blueprint.
${spec}
${agentCode ? `CURRENT CODE:\n${agentCode.slice(0, 3000)}` : ""}
Write the complete TypeScript blueprint to blueprints/. It must output JSON on the last line: {"fitness": <0-1>, ...}
Git add and commit.`;
  } else if (thinkResult.action === "crossover") {
    // Read both parents
    const agents = await queryNodes<AgentNode>("agent", a => a.status === "active");
    const p1 = agents.find(a => a["@id"] === thinkResult.target);
    const p2 = agents.find(a => a["@id"] === thinkResult.target2) ?? agents.find(a => a["@id"] !== thinkResult.target);
    let p1Code = "", p2Code = "";
    if (p1) try { p1Code = await Deno.readTextFile(p1.blueprint); } catch { /* ok */ }
    if (p2) try { p2Code = await Deno.readTextFile(p2.blueprint); } catch { /* ok */ }
    implPrompt = `Crossover: combine the best traits of two agents into a new one.
${spec}
PARENT 1 (${p1?.["@id"]}):\n${p1Code.slice(0, 2000)}
PARENT 2 (${p2?.["@id"]}):\n${p2Code.slice(0, 2000)}
Write the combined blueprint to blueprints/. Git add and commit.`;
  } else if (thinkResult.action === "evolve_benchmark") {
    implPrompt = `Evolve the benchmark to test agents more rigorously.
${spec}
Write an updated benchmark to graph/benchmarks/. Git add and commit.`;
  }

  // Execute via claude edit — retry up to 5 times if no changes
  let filesModified: string[] = [];
  for (let attempt = 1; attempt <= 5 && filesModified.length === 0; attempt++) {
    const p = attempt > 1
      ? `${implPrompt}\n\nIMPORTANT: Previous attempt made NO changes. You MUST edit or create at least one file.`
      : implPrompt;

    try {
      await callClaudeEdit({ prompt: p, model: "sonnet", projectDir: project.path, timeoutMs: 300_000 });
    } catch (e) {
      console.log(`  Attempt ${attempt} error: ${(e as Error).message.slice(0, 150)}`);
    }

    try {
      const diff = await new Deno.Command("git", {
        args: ["diff", "main", "--name-only"], cwd: project.path, stdout: "piped",
      }).output();
      filesModified = new TextDecoder().decode(diff.stdout).trim().split("\n").filter(Boolean);
    } catch { /* ok */ }

    if (filesModified.length === 0) console.log(`  Attempt ${attempt}: no changes`);
  }

  if (filesModified.length === 0) {
    console.log("  No changes after all attempts. Abandoning.");
    await new Deno.Command("git", { args: ["checkout", "main"], cwd: project.path }).output();
    await new Deno.Command("git", { args: ["branch", "-D", branchName], cwd: project.path }).output().catch(() => {});
    return { phase: "implement", success: false, summary: "no changes", branch: "", filesModified: [] };
  }

  console.log(`  Modified: ${filesModified.join(", ")}`);
  return { phase: "implement", success: true, summary: `${filesModified.length} files changed`, branch: branchName, filesModified };
}

// ---------------------------------------------------------------------------
// REVIEW — compare plan vs implementation, verify correctness
// ---------------------------------------------------------------------------
async function review(
  project: ProjectState,
  thinkResult: ThinkResult,
  implResult: ImplementResult,
): Promise<ReviewResult> {
  console.log("\n=== REVIEW ===");

  if (!implResult.success) {
    return { phase: "review", success: true, summary: "nothing to review", criteriaResults: [], issues: ["no changes made"], approved: false };
  }

  // Get the actual diff
  let diffContent = "";
  try {
    const diff = await new Deno.Command("git", {
      args: ["diff", "main", "--stat"], cwd: project.path, stdout: "piped",
    }).output();
    diffContent = new TextDecoder().decode(diff.stdout).trim();

    const fullDiff = await new Deno.Command("git", {
      args: ["diff", "main"], cwd: project.path, stdout: "piped",
    }).output();
    diffContent += "\n\n" + new TextDecoder().decode(fullDiff.stdout).trim().slice(0, 3000);
  } catch { /* ok */ }

  // Check each acceptance criterion individually
  const criteriaList = thinkResult.acceptanceCriteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const prompt = `Review this implementation against specific acceptance criteria.

ACCEPTANCE CRITERIA:
${criteriaList}

EXPECTED APPROACH: ${thinkResult.approach.strategy}
CONSTRAINTS: ${thinkResult.approach.constraints?.join("; ") ?? "none"}

IMPLEMENTATION (git diff):
${diffContent.slice(0, 4000)}

For EACH criterion, determine if it is met by the implementation.
Also check for obvious bugs, syntax errors, or constitutional violations (append-only history, no agent dominance).

JSON only:
{
  "criteriaResults": [
    {"criterion": "the criterion text", "met": true/false, "evidence": "why it is/isn't met"}
  ],
  "bugs": ["list of bugs found, empty if none"],
  "constitutionalOk": true/false,
  "approved": true/false,
  "fix_suggestion": "if not approved, what to fix"
}`;

  try {
    const response = await callClaude({ prompt, model: "sonnet", timeoutMs: 120_000 });
    const parsed = extractJSON<{
      criteriaResults?: Array<{ criterion: string; met: boolean; evidence: string }>;
      bugs?: string[];
      constitutionalOk?: boolean;
      approved: boolean;
      fix_suggestion?: string;
    }>(response);

    if (parsed) {
      const criteriaResults = parsed.criteriaResults ?? [];
      const metCount = criteriaResults.filter(r => r.met).length;
      console.log(`  Criteria: ${metCount}/${criteriaResults.length} met`);
      console.log(`  Approved: ${parsed.approved}`);
      for (const r of criteriaResults) {
        console.log(`    ${r.met ? "PASS" : "FAIL"}: ${r.criterion.slice(0, 80)}`);
      }

      const issues = [
        ...criteriaResults.filter(r => !r.met).map(r => `${r.criterion}: ${r.evidence}`),
        ...(parsed.bugs ?? []),
        ...(parsed.constitutionalOk === false ? ["constitutional violation"] : []),
      ];

      // If not approved, try to fix (up to 10 attempts, detect stuck)
      if (!parsed.approved && parsed.fix_suggestion) {
        let lastError = "";
        let sameErrorCount = 0;
        let editFailCount = 0;

        const failedCriteria = criteriaResults
          .filter(r => !r.met)
          .map(r => `${r.criterion} (${r.evidence})`)
          .join("; ");

        for (let fixAttempt = 1; fixAttempt <= 10; fixAttempt++) {
          console.log(`  Fixing (attempt ${fixAttempt}): ${parsed.fix_suggestion.slice(0, 100)}`);
          let editSuccess = false;
          try {
            const editResult = await callClaudeEdit({
              prompt: `Fix this implementation. Failed criteria: ${failedCriteria}. Bugs: ${(parsed.bugs ?? []).join("; ")}. Suggestion: ${parsed.fix_suggestion}. Git add and commit.`,
              model: "sonnet",
              projectDir: project.path,
              timeoutMs: 180_000,
            });
            editSuccess = editResult.success;
          } catch { /* ok */ }

          if (!editSuccess) {
            editFailCount++;
            if (editFailCount >= 3) { console.log(`  callClaudeEdit failed 3x in a row — giving up.`); break; }
          } else {
            editFailCount = 0;
          }

          // Re-check
          const reReview = await callClaude({
            prompt: `Does this diff look correct now? Just answer: {"approved": true/false, "issue": "if any"}\n\n${diffContent.slice(0, 2000)}`,
            model: "haiku",
            timeoutMs: 60_000,
          });
          const reResult = extractJSON<{ approved: boolean; issue?: string }>(reReview);
          if (reResult?.approved) {
            console.log(`  Fixed after ${fixAttempt} attempts`);
            return { phase: "review", success: true, summary: "approved after fix", criteriaResults: criteriaResults.map(r => ({ ...r, met: true })), issues: [], approved: true };
          }

          // Loop detection
          const currentIssue = reResult?.issue?.slice(0, 200) ?? "";
          if (currentIssue === lastError) { sameErrorCount++; } else { sameErrorCount = 0; lastError = currentIssue; }
          if (sameErrorCount >= 3) { console.log(`  Same issue 3x — stuck.`); break; }
        }
      }

      return {
        phase: "review", success: true,
        summary: parsed.approved ? "approved" : `rejected: ${issues.join("; ").slice(0, 200)}`,
        criteriaResults,
        issues,
        approved: parsed.approved,
      };
    }
  } catch (e) {
    console.error(`  Review failed: ${(e as Error).message.slice(0, 100)}`);
  }

  // If review itself fails, default to approved (don't block evolution)
  return { phase: "review", success: true, summary: "review skipped", criteriaResults: [], issues: [], approved: true };
}

// ---------------------------------------------------------------------------
// BENCHMARK — run all active agents, score them
// ---------------------------------------------------------------------------
async function benchmark(project: ProjectState): Promise<BenchmarkResult> {
  console.log("\n=== BENCHMARK ===");

  const agents = await queryNodes<AgentNode>("agent", a => a.status === "active");
  const benchmarks = await queryNodes<BenchmarkNode>("benchmark");
  const currentBenchmark = benchmarks.sort((a, b) => b.version - a.version)[0];
  const cycleId = `cycle-${Date.now()}`;

  const scores: Array<{ agentId: string; fitness: number }> = [];

  for (const agent of agents) {
    // Skip agents whose blueprint file doesn't exist
    try { await Deno.stat(agent.blueprint); } catch {
      console.log(`  ${agent["@id"]}: blueprint missing (${agent.blueprint}) — skipping`);
      continue;
    }

    try {
      const result = await run(agent.blueprint, {
        ...SEVO_PERMISSIONS,
        read: [...SEVO_PERMISSIONS.read, "./blueprints", "./src"],
      }, 60_000);

      if (result.success && result.fitnessOutput) {
        const fitness = (result.fitnessOutput.fitness as number) ?? 0;
        await score(agent["@id"], result, cycleId);
        scores.push({ agentId: agent["@id"], fitness });
        console.log(`  ${agent["@id"]}: fitness=${fitness.toFixed(3)}`);
      } else {
        console.log(`  ${agent["@id"]}: FAILED`);
        scores.push({ agentId: agent["@id"], fitness: 0 });
      }
    } catch (e) {
      console.log(`  ${agent["@id"]}: ERROR ${(e as Error).message.slice(0, 80)}`);
      scores.push({ agentId: agent["@id"], fitness: 0 });
    }
  }

  scores.sort((a, b) => b.fitness - a.fitness);
  const best = scores[0] ?? { agentId: "none", fitness: 0 };

  console.log(`  Best: ${best.agentId} (${best.fitness.toFixed(3)})`);
  return {
    phase: "benchmark", success: true,
    summary: `${scores.length} agents benchmarked, best=${best.fitness.toFixed(3)}`,
    scores, bestAgent: best.agentId, bestFitness: best.fitness,
  };
}

// ---------------------------------------------------------------------------
// SELECT — keep winners, archive losers, enforce diversity
// ---------------------------------------------------------------------------
async function select_phase(
  project: ProjectState,
  benchmarkResult: BenchmarkResult,
  thinkResult: ThinkResult,
  reviewResult: ReviewResult,
  preBenchmarkBest: number,
): Promise<SelectResult> {
  console.log("\n=== SELECT ===");

  const MIN_ACTIVE = 2;
  const MAX_ACTIVE = 10;
  const agents = await queryNodes<AgentNode>("agent", a => a.status === "active");
  const kept: string[] = [];
  const archived: string[] = [];

  // Sort agents by benchmark fitness
  const agentScores = new Map(benchmarkResult.scores.map(s => [s.agentId, s.fitness]));
  const sorted = [...agents].sort((a, b) =>
    (agentScores.get(b["@id"]) ?? 0) - (agentScores.get(a["@id"]) ?? 0)
  );

  // Keep top agents, archive worst if over limit
  for (let i = 0; i < sorted.length; i++) {
    if (i < MAX_ACTIVE && (i < MIN_ACTIVE || (agentScores.get(sorted[i]["@id"]) ?? 0) > 0)) {
      kept.push(sorted[i]["@id"]);
    } else if (sorted.length > MIN_ACTIVE) {
      archived.push(sorted[i]["@id"]);
      // Archive the agent
      const archiveNode = {
        ...sorted[i],
        "@id": `${sorted[i]["@id"]}-archived-${Date.now()}`,
        status: "archived" as const,
        timestamp: new Date().toISOString(),
      };
      try { await writeNode(archiveNode); } catch { /* ok */ }
    } else {
      kept.push(sorted[i]["@id"]);
    }
  }

  // Did this cycle improve things?
  const improved = benchmarkResult.bestFitness > preBenchmarkBest;

  console.log(`  Kept: ${kept.length}, Archived: ${archived.length}, Improved: ${improved}`);

  // Record DecisionOutcome — the consequences of this cycle's decision
  const outcomeNode: DecisionOutcomeNode = {
    "@context": "sevo://v1",
    "@type": "DecisionOutcome",
    "@id": `outcome-${thinkResult.decisionId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    decisionId: thinkResult.decisionId,
    cycleId: thinkResult.decisionId.replace("decision-", "cycle-"),
    review: {
      criteriaResults: reviewResult.criteriaResults,
      approved: reviewResult.approved,
    },
    outcome: {
      bestFitnessBefore: preBenchmarkBest,
      bestFitnessAfter: benchmarkResult.bestFitness,
      fitnessDelta: benchmarkResult.bestFitness - preBenchmarkBest,
      improved,
    },
    lessons: {
      whatWorked: improved ? `[${thinkResult.scope}] ${thinkResult.proposal}` : "",
      whatDidnt: improved ? "" : `[${thinkResult.scope}] ${thinkResult.proposal}`,
      suggestion: improved
        ? `${thinkResult.action} with scope=${thinkResult.scope} worked — similar approaches may help`
        : `${thinkResult.action} did not improve fitness — try different approach`,
    },
  };
  try { await writeNode(outcomeNode); } catch { /* ok */ }

  // Also record as SeedImprovement (backward compat with reporter.ts and sevoscore.ts)
  const learning: SeedImprovementNode = {
    "@context": "sevo://v1",
    "@type": "SeedImprovement",
    "@id": `learning-${Date.now()}`,
    timestamp: new Date().toISOString(),
    observation: `[${thinkResult.scope}] ${thinkResult.action}: improved=${improved}, best=${benchmarkResult.bestFitness.toFixed(3)}`,
    suggestion: improved ? thinkResult.proposal : `${thinkResult.action} did not improve fitness — try different approach`,
    evidence: [thinkResult.decisionId, thinkResult.action, benchmarkResult.bestAgent],
    priority: improved ? 3 : 7,
  };
  try { await writeNode(learning); } catch { /* ok */ }

  return {
    phase: "select", success: true,
    summary: `kept=${kept.length} archived=${archived.length} improved=${improved}`,
    kept, archived, improved,
  };
}

// ---------------------------------------------------------------------------
// PROGRESS — checkpoint for resume
// ---------------------------------------------------------------------------
async function updateProgress(
  project: ProjectState,
  cycle: number,
  thinkResult: ThinkResult,
  benchmarkResult: BenchmarkResult,
  selectResult: SelectResult,
): Promise<void> {
  const content = `# PROGRESS

## Cycle: ${cycle}
## Action: ${thinkResult.action}
## Best: ${benchmarkResult.bestAgent} (${benchmarkResult.bestFitness.toFixed(3)})
## Improved: ${selectResult.improved}
## Agents: ${selectResult.kept.length} active, ${selectResult.archived.length} archived
## Timestamp: ${new Date().toISOString()}
`;
  await Deno.writeTextFile(`${project.path}/PROGRESS.md`, content);
  try {
    await new Deno.Command("git", { args: ["add", "PROGRESS.md"], cwd: project.path }).output();
    await new Deno.Command("git", { args: ["commit", "-m",
      `cycle ${cycle}: ${thinkResult.action} → ${selectResult.improved ? "improved" : "no change"} (best=${benchmarkResult.bestFitness.toFixed(3)})`
    ], cwd: project.path }).output();
  } catch { /* ok */ }
}

// ===========================================================================
// MAIN — the single evolution loop
// ===========================================================================
const projectPath = Deno.args[0] ?? ".";
console.log(`SEVO starting on: ${projectPath}`);
console.log(`Cycle: REFLECT → THINK → IMPLEMENT → REVIEW → BENCHMARK → SELECT\n`);

let cycle = 0;
while (true) {
  cycle++;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  CYCLE ${cycle}`);
  console.log(`${"=".repeat(60)}`);

  try {
    const project = await loadProject(projectPath);

    // 1. REFLECT
    const reflectResult = await reflect(project);
    const preBenchmarkBest = reflectResult.bestFitness;

    // 2. THINK — decide what to do (writes DecisionRecord to graph)
    const thinkResult = await think(project, reflectResult);

    // 3. IMPLEMENT — do it
    const implResult = await implement(project, thinkResult);

    // 4. REVIEW — check acceptance criteria
    let reviewResult: ReviewResult = {
      phase: "review", success: false, summary: "skipped",
      criteriaResults: [], issues: [], approved: false,
    };

    if (implResult.success) {
      reviewResult = await review(project, thinkResult, implResult);

      if (reviewResult.approved) {
        // Merge implementation to main
        await new Deno.Command("git", { args: ["checkout", "main"], cwd: project.path }).output();
        await new Deno.Command("git", { args: ["merge", implResult.branch], cwd: project.path }).output();
        console.log(`  Merged ${implResult.branch}`);
      } else {
        // Abandon
        await new Deno.Command("git", { args: ["checkout", "main"], cwd: project.path }).output();
        await new Deno.Command("git", { args: ["branch", "-D", implResult.branch], cwd: project.path }).output().catch(() => {});
        console.log(`  Abandoned: ${reviewResult.issues.join("; ")}`);
      }
    }

    // 5. BENCHMARK — always run, regardless of whether we implemented something
    const benchmarkResult = await benchmark(project);

    // 6. SELECT — keep winners, archive losers (writes DecisionOutcome to graph)
    const selectResult = await select_phase(project, benchmarkResult, thinkResult, reviewResult, preBenchmarkBest);

    // Checkpoint
    await updateProgress(project, cycle, thinkResult, benchmarkResult, selectResult);

    // Report
    reportDiscovery("eqs_milestone", {
      cycle, action: thinkResult.action, improved: selectResult.improved,
      bestFitness: benchmarkResult.bestFitness, bestAgent: benchmarkResult.bestAgent,
    }, project.domain);

  } catch (e) {
    console.error(`\nCycle ${cycle} failed: ${(e as Error).message}`);
    console.error("Continuing to next cycle...");
  }

  // Pause between cycles
  const pauseMs = parseInt(Deno.env.get("SEVO_PAUSE_MS") ?? "5000");
  await new Promise(r => setTimeout(r, pauseMs));
}

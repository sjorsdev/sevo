// src/fork-runner.ts — Fork experiment runner
// Runs evolution on a fork domain, measures learning transfer to core
// Tests whether domain-specific evolution insights improve core EQS

import { queryNodes, writeNode } from "./graph.ts";
import { run, SEVO_PERMISSIONS } from "./runner.ts";
import { score } from "./scorer.ts";
import { git } from "./git.ts";
import type {
  AgentNode,
  FitnessNode,
  BenchmarkNode,
  MutationNode,
  SeedImprovementNode,
} from "./types.ts";

// ---------------------------------------------------------------------------
// LLM helper
// ---------------------------------------------------------------------------
async function callClaude(prompt: string): Promise<string> {
  const cmd = new Deno.Command("claude", {
    args: ["-p", prompt, "--output-format", "text"],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`claude CLI failed: ${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

// ---------------------------------------------------------------------------
// Fork-specific benchmark loading
// ---------------------------------------------------------------------------
async function getForkBenchmark(forkPath: string): Promise<BenchmarkNode | null> {
  const dir = `${forkPath}/graph/benchmarks`;
  try {
    const benchmarks: BenchmarkNode[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.endsWith(".jsonld")) continue;
      const text = await Deno.readTextFile(`${dir}/${entry.name}`);
      benchmarks.push(JSON.parse(text) as BenchmarkNode);
    }
    if (!benchmarks.length) return null;
    return benchmarks.sort((a, b) => b.version - a.version)[0];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fork-specific agent loading
// ---------------------------------------------------------------------------
async function getForkAgents(forkPath: string): Promise<AgentNode[]> {
  const dir = `${forkPath}/graph/agents`;
  const agents: AgentNode[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.endsWith(".jsonld")) continue;
      const text = await Deno.readTextFile(`${dir}/${entry.name}`);
      const agent = JSON.parse(text) as AgentNode;
      if (agent.status === "active") agents.push(agent);
    }
  } catch { /* ok */ }
  return agents;
}

// ---------------------------------------------------------------------------
// Run a fork evolution cycle and extract domain-specific insights
// ---------------------------------------------------------------------------
async function runForkCycle(
  forkPath: string,
  forkName: string,
  cycle: number
): Promise<{ improvements: string[]; forkFitness: number }> {
  const cycleId = `fork-${forkName}-cycle-${Date.now()}`;
  const improvements: string[] = [];

  console.log(`\n--- Fork ${forkName}: Cycle ${cycle} ---`);

  // Get fork agents and benchmark
  const agents = await getForkAgents(forkPath);
  const benchmark = await getForkBenchmark(forkPath);

  if (!agents.length || !benchmark) {
    console.log("  No agents or benchmark in fork.");
    return { improvements: [], forkFitness: 0 };
  }

  // Benchmark fork agents
  let bestFitness = 0;
  let bestAgent: AgentNode | null = null;

  for (const agent of agents) {
    console.log(`  Testing fork agent ${agent["@id"]}...`);
    const forkPerms = { ...SEVO_PERMISSIONS, read: [...SEVO_PERMISSIONS.read, forkPath] };
    const runResult = await run(agent.blueprint, forkPerms);

    if (runResult.success) {
      const fitness = (runResult.fitnessOutput?.fitness as number) ?? 0;
      console.log(`    fitness=${fitness.toFixed(3)}`);
      if (fitness > bestFitness) {
        bestFitness = fitness;
        bestAgent = agent;
      }
    } else {
      console.log(`    FAILED: ${runResult.stderr.slice(0, 150)}`);
    }
  }

  if (!bestAgent) {
    return { improvements: [], forkFitness: 0 };
  }

  // Mutate the best fork agent
  console.log(`  Mutating fork best: ${bestAgent["@id"]}...`);
  const blueprint = await Deno.readTextFile(bestAgent.blueprint);

  try {
    const prompt = `You are evolving an agent in a FORK of a self-evolving system.
This fork's domain: ${forkName} — expression evaluation.

CURRENT BLUEPRINT:
\`\`\`typescript
${blueprint}
\`\`\`

BENCHMARK (difficulty ${benchmark.difficulty}):
${benchmark.task}

RULES:
1. Output ONLY the complete new TypeScript file. No markdown fences. No explanation.
2. Self-contained — no imports from other files.
3. Must output JSON on last line: {"fitness": <0-1>, "branches": N, "correct": N, "total": N}
4. Add MORE tests, edge cases, and evaluation strategies.
5. All tests must pass.

Also, at the end before the JSON output, write a comment with INSIGHTS — what patterns or strategies
from this domain could improve general-purpose evolution. Format:
// INSIGHT: <description>`;

    const response = await callClaude(prompt);
    let code = response;
    const fenceMatch = response.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (fenceMatch) code = fenceMatch[1];

    // Extract insights from the generated code
    const insightMatches = code.matchAll(/\/\/\s*INSIGHT:\s*(.+)/g);
    for (const match of insightMatches) {
      improvements.push(match[1].trim());
    }

    // Write the mutant
    const gen = bestAgent.generation + 1;
    const mutantPath = `${forkPath}/blueprints/calc-agent-v${gen}.ts`;
    await Deno.writeTextFile(mutantPath, code);

    // Test it
    const forkPerms = { ...SEVO_PERMISSIONS, read: [...SEVO_PERMISSIONS.read, forkPath] };
    const testResult = await run(mutantPath, forkPerms);

    if (testResult.success) {
      const mutantFitness = (testResult.fitnessOutput?.fitness as number) ?? 0;
      console.log(`  Fork mutant fitness: ${mutantFitness.toFixed(3)}`);

      if (mutantFitness >= bestFitness) {
        // Register the mutant
        const agentNode: AgentNode = {
          "@context": "sevo://v1",
          "@type": "Agent",
          "@id": `agent:calc-v${gen}`,
          timestamp: new Date().toISOString(),
          blueprint: mutantPath,
          parent: bestAgent["@id"],
          generation: gen,
          status: "active",
          domain: forkName,
        };

        const agentPath = `${forkPath}/graph/agents/agent-calc-v${gen}.jsonld`;
        await Deno.writeTextFile(agentPath, JSON.stringify(agentNode, null, 2));
        await git.add(agentPath);
        await git.add(mutantPath);
        await git.commit(`fork(${forkName}): register calc-agent-v${gen}`);
        console.log(`  Registered fork agent: calc-v${gen}`);
        bestFitness = mutantFitness;
      } else {
        console.log(`  Fork mutant rejected (${mutantFitness.toFixed(3)} < ${bestFitness.toFixed(3)})`);
        try { await Deno.remove(mutantPath); } catch { /* ok */ }
      }
    } else {
      console.log(`  Fork mutant failed to run`);
      try { await Deno.remove(mutantPath); } catch { /* ok */ }
    }
  } catch (e) {
    console.log(`  Fork mutation failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return { improvements, forkFitness: bestFitness };
}

// ---------------------------------------------------------------------------
// Extract learnings from fork and record as SeedImprovement
// ---------------------------------------------------------------------------
async function recordForkLearnings(
  forkName: string,
  improvements: string[],
  forkFitness: number,
  cycle: number
): Promise<void> {
  if (improvements.length === 0) return;

  const seedImprovement: SeedImprovementNode = {
    "@context": "sevo://v1",
    "@type": "SeedImprovement",
    "@id": `fork-learning-${forkName}-cycle-${cycle}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    observation: `Fork ${forkName} (fitness ${forkFitness.toFixed(3)}) generated ${improvements.length} domain insights`,
    suggestion: improvements.join("; "),
    evidence: [`fork:${forkName}`, `cycle:${cycle}`],
    priority: 5,
  };

  await writeNode(seedImprovement);
  console.log(`  Recorded ${improvements.length} fork learnings as SeedImprovement`);
}

// ===========================================================================
// MAIN — Run fork experiment
// ===========================================================================

const forkPath = "./forks/sevo-calc";
const forkName = "sevo-calc";

console.log(`\nSEVO Fork Experiment: ${forkName}`);
console.log("Testing domain-specific evolution and learning transfer");

for (let cycle = 1; cycle <= 3; cycle++) {
  const { improvements, forkFitness } = await runForkCycle(forkPath, forkName, cycle);

  if (improvements.length > 0) {
    console.log(`\n  Fork insights discovered:`);
    for (const insight of improvements) {
      console.log(`    - ${insight}`);
    }
    await recordForkLearnings(forkName, improvements, forkFitness, cycle);
  }
}

console.log("\nFork experiment complete.");

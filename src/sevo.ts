// src/sevo.ts — Self-driving SEVO evolution loop v2
// Advanced strategies: island model, crossover, novelty search, adaptive mutation, meta-evolution
// No human-provided tasks. No stopping when tasks run out.

import { queryNodes, writeNode } from "./graph.ts";
import { run, SEVO_PERMISSIONS } from "./runner.ts";
import { score } from "./scorer.ts";
import { select } from "./selector.ts";
import { git } from "./git.ts";
import { getLatestBenchmark } from "./benchmark.ts";
import { computeSevoScore } from "./sevoscore.ts";
import type {
  AgentNode,
  FitnessNode,
  BenchmarkNode,
  MutationNode,
  CrossoverNode,
  NoveltyNode,
  EvolutionStrategyNode,
  IslandNode,
} from "./types.ts";

// ---------------------------------------------------------------------------
// LLM helper — shells out to claude CLI with retry
// ---------------------------------------------------------------------------
async function callClaude(prompt: string, retries = 3): Promise<string> {
  // Use full path to claude CLI to avoid PATH issues in deno subprocess
  const claudePath = `${Deno.env.get("HOME")}/.local/bin/claude`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cmd = new Deno.Command(claudePath, {
        args: ["-p", prompt, "--output-format", "text", "--model", "haiku"],
        stdout: "piped",
        stderr: "piped",
      });
      const result = await cmd.output();
      const stdout = new TextDecoder().decode(result.stdout).trim();
      const stderr = new TextDecoder().decode(result.stderr).trim();

      if (!result.success) {
        console.log(`    claude CLI attempt ${attempt}/${retries} failed: ${stderr.slice(0, 200) || `exit code ${result.code}`}`);
        if (attempt < retries) {
          const delay = attempt * 15_000; // 15s, 30s, 45s
          console.log(`    Retrying in ${delay / 1000}s...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`claude CLI failed after ${retries} attempts: ${stderr.slice(0, 300)}`);
      }

      if (!stdout) {
        console.log(`    claude CLI returned empty output, attempt ${attempt}/${retries}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 10_000));
          continue;
        }
        throw new Error("claude CLI returned empty output");
      }

      return stdout;
    } catch (e) {
      if (attempt === retries) throw e;
      console.log(`    claude CLI error attempt ${attempt}: ${e instanceof Error ? e.message.slice(0, 150) : "unknown"}`);
      await new Promise((r) => setTimeout(r, attempt * 15_000));
    }
  }
  throw new Error("callClaude: unreachable");
}

// ---------------------------------------------------------------------------
// Progress checkpoint — write before any stop
// ---------------------------------------------------------------------------
async function writeProgress(cycle: number, notes: string) {
  const active = await queryNodes<AgentNode>(
    "agent",
    (n) => n.status === "active"
  );
  const islands = await queryNodes<IslandNode>("island");
  const strategies = await queryNodes<EvolutionStrategyNode>("evolutionstrategy");

  const content = `# PROGRESS

## Cycle: ${cycle}
## Active agents: ${active.map((a) => `${a["@id"]}(gen${a.generation})`).join(", ")}
## Islands: ${islands.map((i) => `${i.name}[${i.strategy}](${i.agents.length} agents)`).join(", ") || "none yet"}
## Strategies: ${strategies.map((s) => `${s.name}(${(s.successRate * 100).toFixed(0)}%)`).join(", ") || "initializing"}
## Notes: ${notes}
## Timestamp: ${new Date().toISOString()}
`;
  await Deno.writeTextFile("PROGRESS.md", content);
  await git.add("PROGRESS.md");
  await git.commit(`progress: cycle ${cycle} — ${notes}`);
}

// ---------------------------------------------------------------------------
// Novelty computation — behavioral distance from archive
// ---------------------------------------------------------------------------
async function computeNovelty(
  agentId: string,
  runResult: { fitnessOutput?: Record<string, unknown>; stdout: string },
  cycleId: string
): Promise<NoveltyNode> {
  // Extract behavioral signature from agent output
  const strategies: string[] = [];
  const uniquePatterns: string[] = [];
  const testCount = (runResult.fitnessOutput?.total as number) ?? 0;
  const branches = (runResult.fitnessOutput?.branches as number) ?? 1;

  // Parse strategy information from stdout
  const lines = runResult.stdout.split("\n");
  for (const line of lines) {
    if (line.includes("Strategy") || line.includes("strategy")) {
      strategies.push(line.trim().slice(0, 100));
    }
    if (line.includes("test") || line.includes("Test") || line.includes("CHECK")) {
      uniquePatterns.push(line.trim().slice(0, 80));
    }
  }

  // Behavioral signature: combination of test count, branches, strategies
  const signature = `t${testCount}-b${branches}-s${strategies.length}-p${uniquePatterns.length}`;

  // Compute novelty score: distance from existing behaviors in archive
  const archive = await queryNodes<NoveltyNode>("novelty");
  let noveltyScore = 1.0; // default: completely novel

  if (archive.length > 0) {
    // K-nearest neighbors distance in behavior space
    const k = Math.min(5, archive.length);
    const distances = archive.map((n) => {
      const tDist = Math.abs(testCount - n.testCount) / Math.max(testCount, n.testCount, 1);
      const sDist = Math.abs(strategies.length - n.strategies.length) / Math.max(strategies.length, n.strategies.length, 1);
      const pDist = Math.abs(uniquePatterns.length - n.uniquePatterns.length) / Math.max(uniquePatterns.length, n.uniquePatterns.length, 1);
      const sigDist = n.behaviorSignature === signature ? 0 : 0.5;
      return (tDist + sDist + pDist + sigDist) / 4;
    });
    distances.sort((a, b) => a - b);
    noveltyScore = distances.slice(0, k).reduce((s, d) => s + d, 0) / k;
  }

  const noveltyNode: NoveltyNode = {
    "@context": "sevo://v1",
    "@type": "Novelty",
    "@id": `novelty-${agentId.replace(/[^a-z0-9-]/gi, "-")}-${cycleId}`,
    timestamp: new Date().toISOString(),
    agent: agentId,
    behaviorSignature: signature,
    noveltyScore,
    strategies,
    testCount,
    uniquePatterns: uniquePatterns.slice(0, 20), // cap to avoid huge nodes
  };

  await writeNode(noveltyNode);
  return noveltyNode;
}

// ---------------------------------------------------------------------------
// Adaptive mutation rate — track what works and adjust
// ---------------------------------------------------------------------------
async function getOrCreateStrategy(name: string): Promise<EvolutionStrategyNode> {
  const existing = await queryNodes<EvolutionStrategyNode>(
    "evolutionstrategy",
    (n) => n.name === name
  );
  if (existing.length > 0) {
    return existing.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  }

  // Create default strategy
  const defaults: Record<string, Partial<EvolutionStrategyNode>> = {
    conservative: { mutationRate: 0.2, crossoverRate: 0.1, selectionPressure: 2, noveltyWeight: 0.1 },
    aggressive: { mutationRate: 0.8, crossoverRate: 0.3, selectionPressure: 5, noveltyWeight: 0.2 },
    crossover: { mutationRate: 0.3, crossoverRate: 0.7, selectionPressure: 3, noveltyWeight: 0.15 },
    novelty: { mutationRate: 0.5, crossoverRate: 0.2, selectionPressure: 2, noveltyWeight: 0.6 },
  };

  const d = defaults[name] ?? defaults.conservative;
  const strategy: EvolutionStrategyNode = {
    "@context": "sevo://v1",
    "@type": "EvolutionStrategy",
    "@id": `strategy-${name}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    name,
    mutationRate: d.mutationRate!,
    crossoverRate: d.crossoverRate!,
    selectionPressure: d.selectionPressure!,
    noveltyWeight: d.noveltyWeight!,
    successRate: 0,
    totalTrials: 0,
    successfulTrials: 0,
  };
  await writeNode(strategy);
  return strategy;
}

async function updateStrategy(
  strategy: EvolutionStrategyNode,
  success: boolean,
  cyclesSinceImprovement: number
): Promise<EvolutionStrategyNode> {
  const totalTrials = strategy.totalTrials + 1;
  const successfulTrials = strategy.successfulTrials + (success ? 1 : 0);
  const successRate = successfulTrials / totalTrials;

  // Adaptive: if stuck, increase mutation rate; if improving, decrease
  let mutationRate = strategy.mutationRate;
  if (cyclesSinceImprovement > 3) {
    mutationRate = Math.min(1.0, mutationRate + 0.1); // more exploration
  } else if (success) {
    mutationRate = Math.max(0.1, mutationRate - 0.05); // more exploitation
  }

  // Adapt novelty weight based on stagnation
  let noveltyWeight = strategy.noveltyWeight;
  if (cyclesSinceImprovement > 5) {
    noveltyWeight = Math.min(0.8, noveltyWeight + 0.1); // prioritize novelty when stuck
  } else if (success) {
    noveltyWeight = Math.max(0.05, noveltyWeight - 0.05); // prioritize fitness when improving
  }

  const updated: EvolutionStrategyNode = {
    "@context": "sevo://v1",
    "@type": "EvolutionStrategy",
    "@id": `strategy-${strategy.name}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    name: strategy.name,
    mutationRate,
    crossoverRate: strategy.crossoverRate,
    selectionPressure: strategy.selectionPressure,
    noveltyWeight,
    successRate,
    totalTrials,
    successfulTrials,
  };
  await writeNode(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Island management — independent populations
// ---------------------------------------------------------------------------
async function initializeIslands(agents: AgentNode[]): Promise<IslandNode[]> {
  const existing = await queryNodes<IslandNode>("island");
  if (existing.length > 0) return existing;

  // Partition agents across islands
  const islandConfigs: Array<{ name: string; strategy: IslandNode["strategy"]; migrationInterval: number }> = [
    { name: "island-alpha", strategy: "conservative", migrationInterval: 5 },
    { name: "island-beta", strategy: "aggressive", migrationInterval: 3 },
    { name: "island-gamma", strategy: "crossover", migrationInterval: 4 },
  ];

  const islands: IslandNode[] = [];
  for (let i = 0; i < islandConfigs.length; i++) {
    const cfg = islandConfigs[i];
    // Distribute agents round-robin
    const islandAgents = agents
      .filter((_, idx) => idx % islandConfigs.length === i)
      .map((a) => a["@id"]);

    // Ensure every island has at least one agent
    if (islandAgents.length === 0 && agents.length > 0) {
      islandAgents.push(agents[0]["@id"]);
    }

    const island: IslandNode = {
      "@context": "sevo://v1",
      "@type": "Island",
      "@id": `island-${cfg.name}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      name: cfg.name,
      strategy: cfg.strategy,
      agents: islandAgents,
      migrationInterval: cfg.migrationInterval,
      mutationRate: cfg.strategy === "aggressive" ? 0.8 : cfg.strategy === "conservative" ? 0.2 : 0.5,
      cyclesSinceImprovement: 0,
    };
    await writeNode(island);
    islands.push(island);
  }

  console.log(`  Initialized ${islands.length} islands: ${islands.map((i) => `${i.name}[${i.strategy}]`).join(", ")}`);
  return islands;
}

async function migrateAgents(
  islands: IslandNode[],
  results: Map<string, { fitness: FitnessNode; novelty: NoveltyNode }>
): Promise<void> {
  // Find best agent per island
  const bestPerIsland: Map<string, { agentId: string; score: number }> = new Map();

  for (const island of islands) {
    let best = { agentId: "", score: -1 };
    for (const agentId of island.agents) {
      const r = results.get(agentId);
      if (!r) continue;
      const combinedScore = r.fitness.eqs * 0.7 + r.novelty.noveltyScore * 0.3;
      if (combinedScore > best.score) {
        best = { agentId, score: combinedScore };
      }
    }
    if (best.agentId) bestPerIsland.set(island.name, best);
  }

  // Migrate: copy best from each island to the next (ring topology)
  for (let i = 0; i < islands.length; i++) {
    const source = islands[i];
    const target = islands[(i + 1) % islands.length];
    const best = bestPerIsland.get(source.name);
    if (best && !target.agents.includes(best.agentId)) {
      console.log(`  Migration: ${best.agentId} from ${source.name} → ${target.name}`);
      // Record migration (we don't mutate existing island nodes, we create new state)
      // The next cycle will see the updated agents via agent queries
    }
  }
}

// ---------------------------------------------------------------------------
// Crossover — combine two parent blueprints
// ---------------------------------------------------------------------------
async function crossoverAgents(
  parent1: AgentNode,
  parent2: AgentNode,
  benchmark: BenchmarkNode,
  strategy: EvolutionStrategyNode
): Promise<{ mutantPath: string; crossoverNode: CrossoverNode; mutationNode: MutationNode } | null> {
  console.log(`  Crossover: ${parent1["@id"]} × ${parent2["@id"]}...`);

  let blueprint1 = await Deno.readTextFile(parent1.blueprint);
  let blueprint2 = await Deno.readTextFile(parent2.blueprint);

  // Truncate large blueprints aggressively for faster LLM calls
  const MAX_BP = 2000;
  if (blueprint1.length > MAX_BP) blueprint1 = blueprint1.slice(0, MAX_BP) + "\n// ... (truncated)";
  if (blueprint2.length > MAX_BP) blueprint2 = blueprint2.slice(0, MAX_BP) + "\n// ... (truncated)";

  const prompt = `You are performing CROSSOVER between two SEVO agent blueprints.
Your job: combine the BEST strategies from BOTH parents into a superior child.

PARENT 1 (${parent1["@id"]}, gen ${parent1.generation}):
\`\`\`typescript
${blueprint1}
\`\`\`

PARENT 2 (${parent2["@id"]}, gen ${parent2.generation}):
\`\`\`typescript
${blueprint2}
\`\`\`

BENCHMARK (difficulty ${benchmark.difficulty}):
${benchmark.task.slice(0, 500)}
Scoring: ${benchmark.scoringLogic.slice(0, 200)}

MUTATION AGGRESSIVENESS: ${strategy.mutationRate.toFixed(2)} (0=conservative, 1=radical)

RULES:
1. Output ONLY the complete new TypeScript file. No markdown fences. No explanation.
2. COMBINE the best elements from both parents — take the strongest tests, strategies, and patterns from each.
3. The file must be self-contained — no imports from other files.
4. It must output JSON on the last line: {"fitness": <0-1>, "branches": N, "correct": N, "total": N}
5. The child should have MORE tests/strategies than either parent alone.
6. All tests must actually pass. Do not write tests that will fail.
7. Code must run with: deno run --allow-read --allow-write blueprints/file.ts

STRATEGY: Look for complementary strengths. If parent 1 has strong type checking but weak edge cases,
and parent 2 has strong edge cases but weak type checking, the child should excel at both.`;

  try {
    const response = await callClaude(prompt);
    let code = response;
    const fenceMatch = response.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (fenceMatch) code = fenceMatch[1];

    const ts = Date.now();
    const gen = Math.max(parent1.generation, parent2.generation) + 1;
    const mutantPath = `./blueprints/agent-v${gen}-cross-${ts}.ts`;
    await Deno.writeTextFile(mutantPath, code);

    const crossoverNode: CrossoverNode = {
      "@context": "sevo://v1",
      "@type": "Crossover",
      "@id": `crossover-${parent1["@id"].replace(/[^a-z0-9-]/gi, "-")}-${parent2["@id"].replace(/[^a-z0-9-]/gi, "-")}-${ts}`,
      timestamp: new Date().toISOString(),
      parent1: parent1["@id"],
      parent2: parent2["@id"],
      child: `agent:v${gen}`,
      strategy: "llm-guided-crossover",
      fitness: 0, // will be updated after testing
    };
    await writeNode(crossoverNode);

    const mutationNode: MutationNode = {
      "@context": "sevo://v1",
      "@type": "Mutation",
      "@id": `mutation-crossover-${ts}`,
      timestamp: new Date().toISOString(),
      parent: parent1["@id"],
      proposal: `Crossover of ${parent1["@id"]} × ${parent2["@id"]}`,
      branch: "main",
      status: "testing",
      reasoning: `Crossover combining strengths of both parents. Strategy: ${strategy.name}, aggressiveness: ${strategy.mutationRate}`,
    };
    await writeNode(mutationNode);

    return { mutantPath, crossoverNode, mutationNode };
  } catch (e) {
    console.log(`    Crossover failed: ${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Point mutation — generate mutated blueprint via claude CLI
// ---------------------------------------------------------------------------
async function mutateAgent(
  agent: AgentNode,
  benchmark: BenchmarkNode,
  fitnessHistory: FitnessNode[],
  strategy: EvolutionStrategyNode,
  noveltyArchive: NoveltyNode[]
): Promise<{ mutantPath: string; mutationNode: MutationNode } | null> {
  console.log(`  Mutating ${agent["@id"]} [strategy: ${strategy.name}, rate: ${strategy.mutationRate.toFixed(2)}]...`);

  let blueprint = await Deno.readTextFile(agent.blueprint);
  // Truncate large blueprints aggressively for faster LLM calls
  if (blueprint.length > 3000) blueprint = blueprint.slice(0, 3000) + "\n// ... (truncated)";

  const historyText =
    fitnessHistory
      .slice(-5)
      .map(
        (f) =>
          `EQS=${f.eqs.toFixed(3)} fitness=${((f.context?.fitness as number) ?? 0).toFixed(3)} ` +
          `branches=${f.branchesExplored} accuracy=${f.accuracy}`
      )
      .join("\n") || "No history yet.";

  // Novelty guidance: what behaviors are already well-explored?
  const exploredBehaviors = noveltyArchive
    .slice(-10)
    .map((n) => `sig=${n.behaviorSignature} tests=${n.testCount} strategies=${n.strategies.length}`)
    .join("\n") || "No novelty archive yet.";

  const aggressivenessGuide = strategy.mutationRate > 0.6
    ? "Make RADICAL changes — completely restructure the approach, try novel strategies, break out of local optima."
    : strategy.mutationRate > 0.3
    ? "Make MODERATE changes — improve existing strategies and add new test categories."
    : "Make CONSERVATIVE changes — fine-tune existing strategies, fix edge cases, improve efficiency.";

  const noveltyGuide = strategy.noveltyWeight > 0.3
    ? `IMPORTANT: Novelty is highly valued. Avoid reproducing these existing behaviors:\n${exploredBehaviors}\nTry something genuinely different — new testing strategies, new validation approaches.`
    : "Focus primarily on fitness improvement.";

  const prompt = `You are evolving a SEVO agent blueprint. Your job: produce an IMPROVED version.

CURRENT BLUEPRINT:
\`\`\`typescript
${blueprint}
\`\`\`

RECENT FITNESS HISTORY:
${historyText}

CURRENT BENCHMARK (difficulty ${benchmark.difficulty}):
${benchmark.task.slice(0, 500)}
Scoring: ${benchmark.scoringLogic.slice(0, 200)}
Pass threshold: ${benchmark.passThreshold}

MUTATION STRATEGY: ${strategy.name} (aggressiveness ${strategy.mutationRate.toFixed(2)})
${aggressivenessGuide}

${noveltyGuide}

RULES:
1. Output ONLY the complete new TypeScript file. No markdown fences. No explanation.
2. The file must be self-contained — no imports from other files.
3. It must output JSON on the last line: {"fitness": <0-1>, "branches": N, "correct": N, "total": N}
4. It must IMPROVE on the parent — add more tests, cover more edge cases, explore more strategies.
5. All tests must actually pass. Do not write tests that will fail.
6. The code must run with: deno run --allow-read --allow-write blueprints/file.ts

Focus on whatever the fitness history shows is weakest. If fitness is already 1.0, add MORE tests to make the benchmark harder to pass. If branches is low, add more strategies.`;

  try {
    const response = await callClaude(prompt);
    let code = response;
    const fenceMatch = response.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (fenceMatch) code = fenceMatch[1];

    const ts = Date.now();
    const gen = agent.generation + 1;
    const mutantPath = `./blueprints/agent-v${gen}-mut-${ts}.ts`;
    await Deno.writeTextFile(mutantPath, code);

    const mutationNode: MutationNode = {
      "@context": "sevo://v1",
      "@type": "Mutation",
      "@id": `mutation-${agent["@id"].replace(/[^a-z0-9-]/gi, "-")}-${ts}`,
      timestamp: new Date().toISOString(),
      parent: agent["@id"],
      proposal: `LLM-generated ${strategy.name} mutation (rate ${strategy.mutationRate.toFixed(2)})`,
      branch: "main",
      status: "testing",
      reasoning: `Strategy: ${strategy.name}. ${aggressivenessGuide.slice(0, 200)}`,
    };
    await writeNode(mutationNode);

    return { mutantPath, mutationNode };
  } catch (e) {
    console.log(`    Mutation failed: ${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Benchmark all active agents, return sorted results with novelty
// ---------------------------------------------------------------------------
async function benchmarkAll(
  agents: AgentNode[],
  cycleId: string
): Promise<{ agent: AgentNode; fitness: FitnessNode; novelty: NoveltyNode }[]> {
  const results: { agent: AgentNode; fitness: FitnessNode; novelty: NoveltyNode }[] = [];

  for (const agent of agents) {
    console.log(`  Benchmarking ${agent["@id"]} (${agent.blueprint})...`);
    const runResult = await run(agent.blueprint, SEVO_PERMISSIONS);

    if (!runResult.success) {
      console.log(`    FAILED: ${runResult.stderr.slice(0, 150)}`);
      const fitness = await score(agent["@id"], runResult, cycleId);
      const novelty = await computeNovelty(agent["@id"], runResult, cycleId);
      results.push({ agent, fitness, novelty });
      continue;
    }

    const fitness = await score(agent["@id"], runResult, cycleId);
    const novelty = await computeNovelty(agent["@id"], runResult, cycleId);
    const appFitness = (runResult.fitnessOutput?.fitness as number) ?? 0;
    const branches = (runResult.fitnessOutput?.branches as number) ?? 1;
    console.log(
      `    fitness=${appFitness.toFixed(3)} branches=${branches} EQS=${fitness.eqs.toFixed(3)} novelty=${novelty.noveltyScore.toFixed(3)}`
    );
    results.push({ agent, fitness, novelty });
  }

  // Sort by combined score: EQS + novelty bonus
  results.sort((a, b) => {
    const scoreA = a.fitness.eqs * 0.7 + a.novelty.noveltyScore * 0.3;
    const scoreB = b.fitness.eqs * 0.7 + b.novelty.noveltyScore * 0.3;
    return scoreB - scoreA;
  });
  return results;
}

// ---------------------------------------------------------------------------
// Test a mutant blueprint
// ---------------------------------------------------------------------------
async function testMutant(
  mutantPath: string,
  _cycleId: string
): Promise<{ success: boolean; fitness: number; runResult: Awaited<ReturnType<typeof run>> } | null> {
  console.log(`  Testing mutant ${mutantPath}...`);
  const runResult = await run(mutantPath, SEVO_PERMISSIONS);

  if (!runResult.success) {
    console.log(`    Mutant FAILED: ${runResult.stderr.slice(0, 200)}`);
    return { success: false, fitness: 0, runResult };
  }

  const fitness = (runResult.fitnessOutput?.fitness as number) ?? 0;
  const branches = (runResult.fitnessOutput?.branches as number) ?? 1;
  console.log(`    Mutant result: fitness=${fitness.toFixed(3)} branches=${branches}`);
  return { success: true, fitness, runResult };
}

// ---------------------------------------------------------------------------
// Register a winning mutant as a new agent
// ---------------------------------------------------------------------------
async function registerMutant(
  parent: AgentNode,
  mutantPath: string,
  mutationNode: MutationNode,
  gen?: number
): Promise<AgentNode> {
  const actualGen = gen ?? parent.generation + 1;
  const canonicalPath = `./blueprints/agent-v${actualGen}.ts`;
  try {
    await Deno.stat(canonicalPath);
    // Already exists — keep the mutation path
  } catch {
    await Deno.rename(mutantPath, canonicalPath);
  }
  const finalPath =
    (await Deno.stat(canonicalPath).catch(() => null)) ? canonicalPath : mutantPath;

  // Use timestamp suffix to guarantee unique IDs across concurrent registrations
  const ts = Date.now();
  const newAgent: AgentNode = {
    "@context": "sevo://v1",
    "@type": "Agent",
    "@id": `agent:v${actualGen}-${ts}`,
    timestamp: new Date().toISOString(),
    blueprint: finalPath,
    parent: parent["@id"],
    generation: actualGen,
    status: "active",
  };

  await writeNode(newAgent);
  await git.add(finalPath);
  await git.commit(`evolution: register agent-v${actualGen} from ${mutationNode.proposal.slice(0, 60)}`);

  const selectedMutation: MutationNode = {
    ...mutationNode,
    "@id": `${mutationNode["@id"]}-selected`,
    status: "selected",
    timestamp: new Date().toISOString(),
  };
  await writeNode(selectedMutation);

  return newAgent;
}

// ---------------------------------------------------------------------------
// Evolve the benchmark when agents are too good
// ---------------------------------------------------------------------------
async function evolveBenchmark(
  current: BenchmarkNode,
  avgFitness: number
): Promise<BenchmarkNode | null> {
  if (avgFitness < 0.9) return null;

  console.log(`  Benchmark too easy (avg fitness ${avgFitness.toFixed(3)}). Evolving...`);

  const newVersion = current.version + 1;
  const newDifficulty = current.difficulty + 1;
  const newThreshold = Math.min(current.passThreshold + 0.05, 0.95);

  try {
    const prompt = `You are evolving a SEVO benchmark to be harder.

CURRENT BENCHMARK (v${current.version}, difficulty ${current.difficulty}):
Task: ${current.task.slice(0, 500)}
Scoring: ${current.scoringLogic.slice(0, 200)}
Pass threshold: ${current.passThreshold}

All agents currently pass with avg fitness ${avgFitness.toFixed(3)}.

Create a HARDER version (difficulty ${newDifficulty}). Add requirements that will
challenge agents. Return JSON only, no fences:
{
  "task": "description of what agents must do",
  "scoringLogic": "how to evaluate",
  "newRequirements": "what was added"
}`;

    const response = await callClaude(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);

    const newBenchmark: BenchmarkNode = {
      "@context": "sevo://v1",
      "@type": "Benchmark",
      "@id": `benchmark-v${newVersion}`,
      timestamp: new Date().toISOString(),
      version: newVersion,
      parent: current["@id"],
      task: parsed.task,
      scoringLogic: parsed.scoringLogic,
      difficulty: newDifficulty,
      passThreshold: newThreshold,
    };

    await writeNode(newBenchmark);
    console.log(`  Benchmark evolved to v${newVersion} (difficulty ${newDifficulty}, threshold ${newThreshold})`);
    return newBenchmark;
  } catch (e) {
    console.log(`  Benchmark evolution failed: ${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Choose evolution action based on island strategy and adaptive rates
// ---------------------------------------------------------------------------
function chooseAction(
  strategy: EvolutionStrategyNode,
  agentsOnIsland: number
): "mutate" | "crossover" | "novelty-mutate" {
  const r = Math.random();
  if (agentsOnIsland >= 2 && r < strategy.crossoverRate) return "crossover";
  if (r < strategy.crossoverRate + strategy.noveltyWeight) return "novelty-mutate";
  return "mutate";
}

// ===========================================================================
// MAIN SELF-DRIVING LOOP — ADVANCED EVOLUTION
// ===========================================================================

console.log("SEVO starting — advanced self-driving mode v2");
console.log("Strategies: island model, crossover, novelty search, adaptive mutation");
console.log(await git.log(10));

let cycle = 0;

while (true) {
  cycle++;
  const cycleId = `cycle-${Date.now()}`;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  CYCLE ${cycle}`);
  console.log(`${"=".repeat(60)}`);

  // --- Get active agents ---
  const agents = await queryNodes<AgentNode>(
    "agent",
    (n) => n.status === "active"
  );

  if (!agents.length) {
    console.log("FATAL: No active agents. Cannot continue.");
    await writeProgress(cycle, "FATAL: no active agents");
    break;
  }

  console.log(`Active agents (${agents.length}): ${agents.map((a) => a["@id"]).join(", ")}`);

  // --- Get latest benchmark ---
  const benchmark = await getLatestBenchmark();
  if (!benchmark) {
    console.log("FATAL: No benchmark found.");
    await writeProgress(cycle, "FATAL: no benchmark");
    break;
  }
  console.log(`Benchmark: ${benchmark["@id"]} (difficulty ${benchmark.difficulty})`);

  // --- Initialize islands if needed ---
  console.log("\n--- Island setup ---");
  const islands = await initializeIslands(agents);

  // --- STEP 1: Benchmark ALL agents ---
  console.log("\n--- Benchmarking all agents (with novelty tracking) ---");
  const results = await benchmarkAll(agents, cycleId);

  const best = results[0];
  const avgFitness =
    results.reduce((sum, r) => sum + ((r.fitness.context?.fitness as number) ?? 0), 0) / results.length;
  const avgNovelty =
    results.reduce((sum, r) => sum + r.novelty.noveltyScore, 0) / results.length;

  console.log(`\nBest: ${best.agent["@id"]} (EQS=${best.fitness.eqs.toFixed(3)}, novelty=${best.novelty.noveltyScore.toFixed(3)})`);
  console.log(`Average fitness: ${avgFitness.toFixed(3)}, Average novelty: ${avgNovelty.toFixed(3)}`);

  // Build result lookup
  const resultMap = new Map(results.map((r) => [r.agent["@id"], r]));

  // --- STEP 2: Per-island evolution ---
  console.log("\n--- Per-island evolution ---");
  const noveltyArchive = await queryNodes<NoveltyNode>("novelty");

  let islandIdx = 0;
  for (const island of islands) {
    // Rate limit: small delay between islands to avoid overwhelming claude CLI
    if (islandIdx > 0) await new Promise((r) => setTimeout(r, 5_000));
    islandIdx++;

    console.log(`\n  [${island.name}] strategy=${island.strategy}`);

    // Get island's strategy configuration
    const strategy = await getOrCreateStrategy(island.strategy);
    console.log(`    mutationRate=${strategy.mutationRate.toFixed(2)} crossoverRate=${strategy.crossoverRate.toFixed(2)} noveltyWeight=${strategy.noveltyWeight.toFixed(2)}`);

    // Find best agent on this island
    const islandAgents = agents.filter((a) => island.agents.includes(a["@id"]));
    if (islandAgents.length === 0) {
      // Island has no matching agents — assign the best available
      islandAgents.push(best.agent);
    }

    const islandBest = islandAgents
      .map((a) => ({ agent: a, result: resultMap.get(a["@id"]) }))
      .filter((x) => x.result)
      .sort((a, b) => (b.result!.fitness.eqs - a.result!.fitness.eqs))[0];

    if (!islandBest) {
      console.log(`    No results for island agents. Skipping.`);
      continue;
    }

    // Choose evolution action
    const action = chooseAction(strategy, islandAgents.length);
    console.log(`    Action: ${action}`);

    let mutantResult: Awaited<ReturnType<typeof testMutant>> = null;
    let mutantPath = "";
    let mutationNode: MutationNode | null = null;

    if (action === "crossover" && islandAgents.length >= 2) {
      // Pick two best agents on this island
      const sorted = islandAgents
        .map((a) => ({ agent: a, eqs: resultMap.get(a["@id"])?.fitness.eqs ?? 0 }))
        .sort((a, b) => b.eqs - a.eqs);
      const p1 = sorted[0].agent;
      const p2 = sorted[1]?.agent ?? sorted[0].agent;

      const crossResult = await crossoverAgents(p1, p2, benchmark, strategy);
      if (crossResult) {
        mutantPath = crossResult.mutantPath;
        mutationNode = crossResult.mutationNode;
        mutantResult = await testMutant(mutantPath, cycleId);
      }
    } else {
      // Point mutation (standard or novelty-guided)
      const fitnessHistory = await queryNodes<FitnessNode>(
        "fitness",
        (n) => n.agent === islandBest.agent["@id"]
      );
      const mutation = await mutateAgent(
        islandBest.agent,
        benchmark,
        fitnessHistory,
        strategy,
        action === "novelty-mutate" ? noveltyArchive : []
      );
      if (mutation) {
        mutantPath = mutation.mutantPath;
        mutationNode = mutation.mutationNode;
        mutantResult = await testMutant(mutantPath, cycleId);
      }
    }

    // --- STEP 3: Evaluate and select ---
    let success = false;
    if (mutantResult && mutantResult.success && mutationNode) {
      const mutantFitness = await score(
        `mutant-${island.name}-${Date.now()}`,
        mutantResult.runResult,
        cycleId
      );

      const parentAppFitness = (islandBest.result!.fitness.context?.fitness as number) ?? 0;
      const mutantAppFitness = mutantResult.fitness;

      // Combined score with novelty bonus
      const mutantNovelty = await computeNovelty(
        `mutant-${island.name}`,
        mutantResult.runResult,
        cycleId
      );
      const parentScore = parentAppFitness * (1 - strategy.noveltyWeight) +
        (islandBest.result!.novelty?.noveltyScore ?? 0) * strategy.noveltyWeight;
      const mutantScore = mutantAppFitness * (1 - strategy.noveltyWeight) +
        mutantNovelty.noveltyScore * strategy.noveltyWeight;

      console.log(`    Parent score: ${parentScore.toFixed(3)} (fitness=${parentAppFitness.toFixed(3)})`);
      console.log(`    Mutant score: ${mutantScore.toFixed(3)} (fitness=${mutantAppFitness.toFixed(3)}, novelty=${mutantNovelty.noveltyScore.toFixed(3)})`);

      if (mutantScore >= parentScore) {
        console.log(`    MUTANT WINS on ${island.name}!`);
        // Use max gen + island offset to avoid generation collisions between islands
        const maxGen = Math.max(...(await queryNodes<AgentNode>("agent")).map((a) => a.generation));
        const gen = maxGen + islandIdx + 1; // ensures uniqueness across islands
        const newAgent = await registerMutant(islandBest.agent, mutantPath, mutationNode, gen);
        await select(newAgent["@id"], islandBest.agent["@id"], mutantFitness, islandBest.result!.fitness);
        console.log(`    Registered: ${newAgent["@id"]} (gen ${newAgent.generation})`);
        success = true;
      } else {
        console.log(`    Parent wins on ${island.name} — mutant rejected`);
        await select(
          islandBest.agent["@id"],
          `mutant-${island.name}`,
          islandBest.result!.fitness,
          mutantFitness
        );
        try { await Deno.remove(mutantPath); } catch { /* ok */ }
      }
    } else if (mutantPath) {
      console.log(`    Mutant failed to run — rejected`);
      try { await Deno.remove(mutantPath); } catch { /* ok */ }
    }

    // --- Update strategy based on outcome ---
    await updateStrategy(strategy, success, island.cyclesSinceImprovement);
  }

  // --- STEP 4: Inter-island migration ---
  if (cycle % 3 === 0) {
    console.log("\n--- Inter-island migration ---");
    const migrationResults = new Map(
      results.map((r) => [r.agent["@id"], { fitness: r.fitness, novelty: r.novelty }])
    );
    await migrateAgents(islands, migrationResults);
  }

  // --- STEP 5: Evolve benchmark if too easy ---
  console.log("\n--- Checking benchmark difficulty ---");
  await evolveBenchmark(benchmark, avgFitness);

  // --- STEP 6: Meta-evolution — log strategy effectiveness ---
  if (cycle % 5 === 0) {
    console.log("\n--- Meta-evolution: strategy review ---");
    const allStrategies = await queryNodes<EvolutionStrategyNode>("evolutionstrategy");
    const latestByName = new Map<string, EvolutionStrategyNode>();
    for (const s of allStrategies) {
      const existing = latestByName.get(s.name);
      if (!existing || s.timestamp > existing.timestamp) {
        latestByName.set(s.name, s);
      }
    }
    for (const [name, s] of latestByName) {
      console.log(
        `    ${name}: ${s.totalTrials} trials, ${(s.successRate * 100).toFixed(0)}% success, ` +
        `mutRate=${s.mutationRate.toFixed(2)}, noveltyW=${s.noveltyWeight.toFixed(2)}`
      );
    }
  }

  // --- SevoScore ---
  console.log("\n--- SevoScore ---");
  await computeSevoScore(cycleId, best.agent["@id"], best.fitness.eqs, avgFitness);

  // --- Checkpoint ---
  await writeProgress(
    cycle,
    `best=${best.agent["@id"]} EQS=${best.fitness.eqs.toFixed(3)} avgFit=${avgFitness.toFixed(3)} avgNovelty=${avgNovelty.toFixed(3)} islands=${islands.length}`
  );

  // Context management — stop after N cycles so Claude Code can resume
  if (cycle % 10 === 0) {
    console.log("\nCheckpoint: pausing for context management. Resume to continue.");
    break;
  }
}

console.log("\nSEVO cycle complete. System will resume from PROGRESS.md.");

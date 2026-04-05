// src/sevoscore.ts — Self-computed SevoScore
// Each cycle, count evolution events and accumulate points.
// The score is committed to graph/sevoscores/ as immutable history.

import { queryNodes, writeNode } from "./graph.ts";
import type {
  AgentNode,
  FitnessNode,
  MutationNode,
  SelectionNode,
  NoveltyNode,
  CrossoverNode,
  SeedImprovementNode,
  BenchmarkNode,
  SevoScoreNode,
} from "./types.ts";

/** Count lines in all blueprint files */
async function countEvolvedLoc(): Promise<number> {
  let totalLines = 0;
  try {
    for await (const entry of Deno.readDir("./blueprints")) {
      if (!entry.name.endsWith(".ts")) continue;
      const text = await Deno.readTextFile(`./blueprints/${entry.name}`);
      totalLines += text.split("\n").length;
    }
  } catch {
    // blueprints dir may not exist
  }
  return totalLines;
}

/** Read project domain from goal.jsonld */
async function readDomain(): Promise<string> {
  try {
    const text = await Deno.readTextFile("./goal.jsonld");
    const goal = JSON.parse(text);
    return goal.name ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Detect fork point from git history.
 * If goal.jsonld was modified after its initial creation, this repo was forked
 * from another sevo project. The modification timestamp is the fork point —
 * only graph nodes created after that point belong to this project.
 * Returns null for original (non-forked) projects where goal.jsonld was only
 * ever created once.
 */
async function detectForkPoint(): Promise<string | null> {
  try {
    // Get all commits that touched goal.jsonld, newest first
    const cmd = new Deno.Command("git", {
      args: ["log", "--format=%aI", "--", "goal.jsonld"],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    const timestamps = new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean);

    // If goal.jsonld was only touched once, this is an original project
    if (timestamps.length <= 1) return null;

    // Multiple touches: the most recent one (timestamps[0]) is the fork commit
    // where goal.jsonld was rewritten for the new domain
    return new Date(timestamps[0]).toISOString();
  } catch {
    return null;
  }
}

/** Compute SevoScore for a completed cycle */
export async function computeSevoScore(
  cycleId: string,
  bestAgentId: string,
  bestEqs: number,
  avgFitness: number,
): Promise<SevoScoreNode> {
  // Detect fork point from git history — if this is a forked project,
  // only count nodes created after the fork, not inherited data.
  const domain = await readDomain();
  const forkPoint = await detectForkPoint();
  if (forkPoint) {
    console.log(`  Fork detected — only scoring nodes after ${forkPoint}`);
  }
  const afterFork = forkPoint
    ? <T extends { timestamp: string }>(n: T) => n.timestamp >= forkPoint
    : <T>(_n: T) => true;

  // Count events — filtered by forkPoint if this is a forked project
  const allFitness = (await queryNodes<FitnessNode>("fitness", (n) => n.cycleId === cycleId)).filter(afterFork);
  const allMutations = (await queryNodes<MutationNode>("mutation")).filter(afterFork);
  const allSelections = (await queryNodes<SelectionNode>("selection")).filter(afterFork);
  const allNoveltys = (await queryNodes<NoveltyNode>("novelty")).filter(afterFork);
  const allCrossovers = (await queryNodes<CrossoverNode>("crossover")).filter(afterFork);
  const allSeedImprovements = (await queryNodes<SeedImprovementNode>("seedimprovement")).filter(afterFork);
  const allBenchmarks = (await queryNodes<BenchmarkNode>("benchmark")).filter(afterFork);
  const allAgents = (await queryNodes<AgentNode>("agent")).filter(afterFork);
  const activeAgents = allAgents.filter((a) => a.status === "active");

  // Get previous SevoScore for cumulative total.
  // For forked projects, we need to find scores that were computed with fork-aware
  // filtering. A fork-aware score will have a metadata.forkPoint field.
  const allPreviousScores = await queryNodes<SevoScoreNode>("sevoscore");
  let latestPrevious: SevoScoreNode | null = null;
  if (forkPoint) {
    // Only use previous scores that have forkPoint metadata (fork-aware)
    const forkAware = allPreviousScores.filter(
      (s) => (s.metadata as Record<string, unknown>).forkPoint === forkPoint
    );
    latestPrevious = forkAware.length > 0
      ? forkAware.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
      : null;
  } else {
    latestPrevious = allPreviousScores.length > 0
      ? allPreviousScores.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
      : null;
  }
  const previousTotal = latestPrevious?.score ?? 0;
  const prevBreakdown = latestPrevious?.breakdown ?? null;

  const totalMutations = allMutations.length;
  const totalSelections = allSelections.length;
  const totalNoveltys = allNoveltys.length;
  const totalCrossovers = allCrossovers.length;
  const totalSeedImprovements = allSeedImprovements.length;
  const totalBenchmarks = allBenchmarks.length;
  const totalAgents = allAgents.length;

  // Cycle deltas (new events since last score)
  const cycleMutations = prevBreakdown ? totalMutations - prevBreakdown.mutationsProposed : totalMutations;
  const cycleSelections = prevBreakdown ? totalSelections - prevBreakdown.selectionsMade : totalSelections;
  const cycleNoveltys = prevBreakdown ? totalNoveltys - prevBreakdown.noveltysRecorded : totalNoveltys;
  const cycleCrossovers = prevBreakdown ? totalCrossovers - prevBreakdown.crossoversPerformed : totalCrossovers;
  const cycleSeedImprovements = prevBreakdown ? totalSeedImprovements - prevBreakdown.seedImprovements : totalSeedImprovements;
  const cycleBenchmarks = prevBreakdown ? totalBenchmarks - prevBreakdown.benchmarksEvolved : totalBenchmarks;

  // Count new agents this cycle and how many improved
  const prevTotalAgents = prevBreakdown ? prevBreakdown.agentsCreated : 0;
  const cycleAgentsCreated = totalAgents - prevTotalAgents;

  // Calculate improvement bonus from selections this cycle
  // A "winning" selection where the new agent beat the parent
  const recentSelections = allSelections
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, Math.max(cycleSelections, 0));

  let improvementBonus = 0;
  let agentsImproved = 0;
  for (const sel of recentSelections) {
    if (sel.eqsDelta > 0) {
      agentsImproved++;
      improvementBonus += sel.eqsDelta * 10;
    }
  }

  // Calculate cycle points
  let cyclePoints = 0;
  cyclePoints += Math.max(cycleAgentsCreated, 0) * 1;       // 1pt per agent created
  cyclePoints += improvementBonus;                            // fitness_delta × 10 for improvements
  cyclePoints += allFitness.length * 1;                       // 1pt per fitness evaluation
  cyclePoints += Math.max(cycleMutations, 0) * 1;            // 1pt per mutation
  cyclePoints += Math.max(cycleSelections, 0) * 1;           // 1pt per selection
  cyclePoints += Math.max(cycleNoveltys, 0) * 1;             // 1pt per novelty
  cyclePoints += Math.max(cycleCrossovers, 0) * 2;           // 2pts per crossover
  cyclePoints += Math.max(cycleSeedImprovements, 0) * 2;     // 2pts per seed improvement
  cyclePoints += Math.max(cycleBenchmarks, 0) * 3;           // 3pts per benchmark evolved

  const cumulativeScore = previousTotal + cyclePoints;

  // Get max benchmark difficulty
  const maxDifficulty = allBenchmarks.length > 0
    ? Math.max(...allBenchmarks.map((b) => b.difficulty))
    : 0;

  const evolvedLoc = await countEvolvedLoc();

  const scoreNode: SevoScoreNode = {
    "@context": "sevo://v1",
    "@type": "SevoScore",
    "@id": `sevoscore-${cycleId}`,
    timestamp: new Date().toISOString(),
    cycleId,
    score: cumulativeScore,
    cyclePoints,
    breakdown: {
      agentsCreated: totalAgents,
      agentsImproved,
      fitnessEvaluations: allFitness.length,
      mutationsProposed: totalMutations,
      selectionsMade: totalSelections,
      noveltysRecorded: totalNoveltys,
      crossoversPerformed: totalCrossovers,
      seedImprovements: totalSeedImprovements,
      benchmarksEvolved: totalBenchmarks,
      improvementBonus,
    },
    metadata: {
      totalAgents,
      activeAgents: activeAgents.length,
      bestAgentId,
      bestEqs,
      avgFitness,
      maxBenchmarkDifficulty: maxDifficulty,
      evolvedLoc,
      model: "claude-haiku-4-5",
      domain,
      ...(forkPoint ? { forkPoint } : {}),
    } as SevoScoreNode["metadata"],
  };

  await writeNode(scoreNode);
  console.log(`  SevoScore: ${cumulativeScore} (+${cyclePoints} this cycle)`);
  return scoreNode;
}

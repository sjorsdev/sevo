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

/** Compute SevoScore for a completed cycle */
export async function computeSevoScore(
  cycleId: string,
  bestAgentId: string,
  bestEqs: number,
  avgFitness: number,
): Promise<SevoScoreNode> {
  // Get previous SevoScore for cumulative total
  const previousScores = await queryNodes<SevoScoreNode>("sevoscore");
  const previousTotal = previousScores.length > 0
    ? previousScores.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].score
    : 0;

  // Count events created during this cycle (by cycleId match or recent timestamp)
  const allFitness = await queryNodes<FitnessNode>("fitness", (n) => n.cycleId === cycleId);
  const allMutations = await queryNodes<MutationNode>("mutation");
  const allSelections = await queryNodes<SelectionNode>("selection");
  const allNoveltys = await queryNodes<NoveltyNode>("novelty");
  const allCrossovers = await queryNodes<CrossoverNode>("crossover");
  const allSeedImprovements = await queryNodes<SeedImprovementNode>("seedimprovement");
  const allBenchmarks = await queryNodes<BenchmarkNode>("benchmark");
  const allAgents = await queryNodes<AgentNode>("agent");
  const activeAgents = allAgents.filter((a) => a.status === "active");

  // Count cycle-specific events by matching cycleId in timestamps
  // For nodes without cycleId, count total and diff from last score
  const prevBreakdown = previousScores.length > 0
    ? previousScores.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].breakdown
    : null;

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
  const domain = await readDomain();

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
    },
  };

  await writeNode(scoreNode);
  console.log(`  SevoScore: ${cumulativeScore} (+${cyclePoints} this cycle)`);
  return scoreNode;
}

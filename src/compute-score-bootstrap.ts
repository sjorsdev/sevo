#!/usr/bin/env -S deno run --allow-all
// One-time bootstrap: compute SevoScore from existing graph data.
// Run once to generate the first score node, then delete this file.

import { computeSevoScore } from "./sevoscore.ts";
import { queryNodes } from "./graph.ts";
import type { AgentNode, FitnessNode } from "./types.ts";

const agents = await queryNodes<AgentNode>("agent", (a) => a.status === "active");
const fitness = await queryNodes<FitnessNode>("fitness");

// Find best agent by latest EQS
const sorted = fitness.sort((a, b) => b.eqs - a.eqs);
const bestFitness = sorted[0];
const bestAgentId = bestFitness?.agent ?? "unknown";
const bestEqs = bestFitness?.eqs ?? 0;

// Average fitness across all active agents (use latest fitness per agent)
const latestPerAgent = new Map<string, number>();
for (const f of fitness) {
  const existing = latestPerAgent.get(f.agent);
  if (!existing || f.timestamp > (fitness.find((x) => x.agent === f.agent && x.eqs === existing)?.timestamp ?? "")) {
    latestPerAgent.set(f.agent, f.eqs);
  }
}
const avgFitness = latestPerAgent.size > 0
  ? [...latestPerAgent.values()].reduce((a, b) => a + b, 0) / latestPerAgent.size
  : 0;

console.log(`Bootstrap SevoScore computation:`);
console.log(`  Active agents: ${agents.length}`);
console.log(`  Total fitness records: ${fitness.length}`);
console.log(`  Best agent: ${bestAgentId} (EQS: ${bestEqs.toFixed(3)})`);
console.log(`  Average fitness: ${avgFitness.toFixed(3)}`);

const result = await computeSevoScore(
  `bootstrap-${Date.now()}`,
  bestAgentId,
  bestEqs,
  avgFitness,
);

console.log(`\nDone! Score node written: ${result["@id"]}`);
console.log(`Total SevoScore: ${result.score}`);

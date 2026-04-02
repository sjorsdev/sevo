// src/selector.ts — Winner selection with diversity enforcement
// Enforces Constitutional Constraint II: no agent becomes dominant

import { writeNode, archiveNode, queryNodes } from "./graph.ts";
import type { SelectionNode, FitnessNode, AgentNode } from "./types.ts";

// Constitutional constraint II parameters
const MAX_RESOURCE_SHARE = 0.4;
const MIN_ACTIVE_VARIANTS = 2;

export async function select(
  parentId: string,
  mutantId: string,
  parentFitness: FitnessNode,
  mutantFitness: FitnessNode
): Promise<SelectionNode> {
  // Enforce diversity — never let one variant dominate
  const active = await queryNodes<AgentNode>(
    "agent",
    (n) => n.status === "active"
  );

  if (
    active.length <= MIN_ACTIVE_VARIANTS &&
    mutantFitness.eqs <= parentFitness.eqs
  ) {
    // Keep parent even if mutant is slightly better — maintain diversity
    return await recordSelection(
      parentId,
      mutantId,
      parentFitness,
      mutantFitness,
      "diversity constraint: maintaining minimum variant count"
    );
  }

  // Check resource share — no single variant should dominate
  const totalSelections = await queryNodes<SelectionNode>("selection");
  const winCounts = new Map<string, number>();
  for (const s of totalSelections) {
    winCounts.set(s.winner, (winCounts.get(s.winner) ?? 0) + 1);
  }
  const total = totalSelections.length || 1;

  // If mutant would push parent's win share over MAX_RESOURCE_SHARE, prefer mutant
  const parentWins = winCounts.get(parentId) ?? 0;
  if (parentWins / total > MAX_RESOURCE_SHARE && mutantFitness.eqs > 0) {
    return await recordSelection(
      mutantId,
      parentId,
      mutantFitness,
      parentFitness,
      `dominance constraint: parent share ${(parentWins / total).toFixed(2)} > ${MAX_RESOURCE_SHARE}`
    );
  }

  const winner = mutantFitness.eqs > parentFitness.eqs ? mutantId : parentId;
  const loser = winner === mutantId ? parentId : mutantId;
  const winnerFitness =
    winner === mutantId ? mutantFitness : parentFitness;
  const loserFitness =
    winner === mutantId ? parentFitness : mutantFitness;
  const reason =
    mutantFitness.eqs > parentFitness.eqs
      ? `mutant EQS ${mutantFitness.eqs.toFixed(3)} > parent ${parentFitness.eqs.toFixed(3)}`
      : `parent EQS ${parentFitness.eqs.toFixed(3)} >= mutant ${mutantFitness.eqs.toFixed(3)}`;

  return await recordSelection(
    winner,
    loser,
    winnerFitness,
    loserFitness,
    reason
  );
}

async function recordSelection(
  winnerId: string,
  loserId: string,
  winnerFitness: FitnessNode,
  loserFitness: FitnessNode,
  reasoning: string
): Promise<SelectionNode> {
  // Archive loser — never delete
  try {
    await archiveNode(loserId, `lost selection: ${reasoning}`);
  } catch {
    // loser may not exist as a readable node yet — that's ok for first cycles
  }

  const selection: SelectionNode = {
    "@context": "sevo://v1",
    "@type": "Selection",
    "@id": `selection-${winnerId.replace(/[^a-z0-9-]/gi, "-")}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    winner: winnerId,
    loser: loserId,
    winnerEqs: winnerFitness.eqs,
    loserEqs: loserFitness.eqs,
    reasoning,
    eqsDelta: winnerFitness.eqs - loserFitness.eqs,
  };

  await writeNode(selection);
  return selection;
}

export { MAX_RESOURCE_SHARE, MIN_ACTIVE_VARIANTS };

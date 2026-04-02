// src/scorer.ts — EQS (Evolution Quality Score) computation

import { writeNode, queryNodes } from "./graph.ts";
import type { FitnessNode } from "./types.ts";
import type { RunResult } from "./runner.ts";

export async function score(
  agentId: string,
  runResult: RunResult,
  cycleId: string,
  parentPrediction?: { eqs: number }
): Promise<FitnessNode> {
  // Get parent's previous EQS for magnitude calculation
  const parentFitness = await queryNodes<FitnessNode>(
    "fitness",
    (n) => n.agent === agentId
  );
  const previousEqs = parentFitness.at(-1)?.eqs ?? 0;

  // Parse fitness from agent output
  const appFitness = (runResult.fitnessOutput?.fitness as number) ?? 0;
  const branchesExplored =
    (runResult.fitnessOutput?.branches as number) ?? 1;

  // Prediction error — how wrong was the parent's prediction?
  const predictionError = parentPrediction
    ? Math.abs(parentPrediction.eqs - appFitness) /
      Math.max(appFitness, 0.001)
    : 1.0; // no prediction = maximum error

  const accuracy = appFitness > previousEqs ? 1.0 : 0.0;
  const magnitude = Math.max(0, appFitness - previousEqs);

  const eqs =
    (accuracy * magnitude) /
    Math.max(branchesExplored * predictionError, 0.001);

  const fitnessNode: FitnessNode = {
    "@context": "sevo://v1",
    "@type": "Fitness",
    "@id": `fitness-${agentId.replace(/[^a-z0-9-]/gi, "-")}-${cycleId}`,
    timestamp: new Date().toISOString(),
    agent: agentId,
    eqs,
    accuracy,
    magnitude,
    branchesExplored,
    predictionError,
    cycleId,
    context: runResult.fitnessOutput ?? {},
  };

  await writeNode(fitnessNode);
  return fitnessNode;
}

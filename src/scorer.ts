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
  // Get parent's previous fitness for comparison
  const previousFitnessNodes = await queryNodes<FitnessNode>(
    "fitness",
    (n) => n.agent === agentId
  );
  const previousAppFitness =
    (previousFitnessNodes.at(-1)?.context?.fitness as number) ?? 0;

  // Parse fitness from agent output
  const appFitness = (runResult.fitnessOutput?.fitness as number) ?? 0;
  const branchesExplored =
    (runResult.fitnessOutput?.branches as number) ?? 1;

  // Prediction error — how wrong was the parent's prediction?
  const predictionError = parentPrediction
    ? Math.abs(parentPrediction.eqs - appFitness) /
      Math.max(appFitness, 0.001)
    : 1.0; // no prediction = maximum error

  // accuracy: did this agent outperform its previous run (or parent)?
  const accuracy = appFitness > previousAppFitness ? 1.0 : 0.0;
  const magnitude = Math.max(0, appFitness - previousAppFitness);

  // EQS combines improvement signal with absolute performance
  // Pure improvement formula: (accuracy * magnitude) / (branches * predError)
  // Weighted with absolute fitness to reward stable high performance
  const improvementSignal =
    (accuracy * magnitude) /
    Math.max(branchesExplored * predictionError, 0.001);

  // Blend: 60% improvement signal + 40% absolute fitness
  // This ensures agents that maintain high fitness aren't penalized
  const eqs = 0.6 * improvementSignal + 0.4 * appFitness;

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

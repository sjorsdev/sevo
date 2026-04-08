// src/phases/types.ts — Phase result interfaces

import type { DecisionScope } from "../types.ts";

export interface PhaseResult {
  phase: string;
  success: boolean;
  summary: string;
}

export interface ReflectResult extends PhaseResult {
  plateauing: boolean;
  trend: "improving" | "declining" | "plateau";
  delta: number;
  agentCount: number;
  bestFitness: number;
  opportunities: string[];   // what could be improved
}

export type ActionType =
  | "mutate_agent"      // tweak an existing agent
  | "crossover"         // combine two agents
  | "new_agent"         // generate a fresh agent from scratch
  | "evolve_benchmark"  // make benchmarks harder/different
  | "modify_engine"     // change src/ files (scorer, runner, etc.)

export interface ThinkResult extends PhaseResult {
  action: ActionType;
  reasoning: string;
  target?: string;       // agent @id, benchmark @id, or src file
  target2?: string;      // second parent for crossover
  proposal: string;      // what specifically to do
  // Structured spec (why/what/how)
  decisionId: string;
  scope: DecisionScope;
  evidence: string[];
  acceptanceCriteria: string[];
  expectedImpact: { metric: string; direction: string; magnitude?: string };
  approach: { strategy: string; filesExpected?: string[]; constraints?: string[] };
}

export interface ImplementResult extends PhaseResult {
  branch: string;
  filesModified: string[];
  agentId?: string;      // new/modified agent @id
}

export interface ReviewResult extends PhaseResult {
  criteriaResults: Array<{ criterion: string; met: boolean; evidence: string }>;
  issues: string[];
  approved: boolean;
}

export interface BenchmarkResult extends PhaseResult {
  scores: Array<{ agentId: string; fitness: number }>;
  bestAgent: string;
  bestFitness: number;
}

export interface SelectResult extends PhaseResult {
  kept: string[];
  archived: string[];
  improved: boolean;
}

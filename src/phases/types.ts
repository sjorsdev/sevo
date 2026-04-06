// src/phases/types.ts — Phase result interfaces

export interface PhaseResult {
  phase: string;
  success: boolean;
  summary: string;
}

export interface ReflectResult extends PhaseResult {
  layer: 1 | 2 | 3;
  plateauing: boolean;
  trend: "improving" | "declining" | "plateau";
  delta: number;
}

export interface ThinkResult extends PhaseResult {
  ideas: Array<{
    idea: string;
    fields: string[];
    math: string;
    testable: string;
  }>;
}

export interface ImplementResult extends PhaseResult {
  branch: string;
  filesModified: string[];
  merged: boolean;
}

export interface TestResult extends PhaseResult {
  passed: boolean;
  output: string;
}

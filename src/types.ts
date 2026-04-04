// src/types.ts — All SEVO graph node types

export interface SeVoNode {
  "@context": "sevo://v1";
  "@type": string;
  "@id": string;
  timestamp: string;
}

export interface AgentNode extends SeVoNode {
  "@type": "Agent";
  blueprint: string;
  parent?: string;
  generation: number;
  status: "active" | "testing" | "dormant" | "archived";
  domain?: string;
}

export interface FitnessNode extends SeVoNode {
  "@type": "Fitness";
  agent: string;
  eqs: number;
  accuracy: number;
  magnitude: number;
  branchesExplored: number;
  predictionError: number;
  cycleId: string;
  context: Record<string, unknown>;
}

export interface TaskNode extends SeVoNode {
  "@type": "Task";
  description: string;
  priority: number;
  status: "pending" | "running" | "done" | "failed";
  dependsOn: string[];
  result?: string;
  discoveredBy?: string;
}

export interface MutationNode extends SeVoNode {
  "@type": "Mutation";
  parent: string;
  proposal: string;
  branch: string;
  status: "proposed" | "testing" | "selected" | "rejected";
  reasoning: string;
}

export interface SelectionNode extends SeVoNode {
  "@type": "Selection";
  winner: string;
  loser: string;
  winnerEqs: number;
  loserEqs: number;
  reasoning: string;
  eqsDelta: number;
}

export interface BenchmarkNode extends SeVoNode {
  "@type": "Benchmark";
  version: number;
  parent?: string;
  task: string;
  scoringLogic: string;
  difficulty: number;
  passThreshold: number;
}

export interface SeedImprovementNode extends SeVoNode {
  "@type": "SeedImprovement";
  observation: string;
  suggestion: string;
  evidence: string[];
  priority: number;
}

// --- Advanced Evolution Types ---

export interface IslandNode extends SeVoNode {
  "@type": "Island";
  name: string;
  strategy: "conservative" | "aggressive" | "crossover" | "novelty";
  agents: string[];           // @ids of agents on this island
  migrationInterval: number;  // cycles between migrations
  mutationRate: number;       // 0-1, how aggressive mutations are
  cyclesSinceImprovement: number;
}

export interface CrossoverNode extends SeVoNode {
  "@type": "Crossover";
  parent1: string;            // @id of first parent agent
  parent2: string;            // @id of second parent agent
  child: string;              // @id of child agent
  strategy: string;           // how the crossover was done
  fitness: number;            // child's fitness result
}

export interface NoveltyNode extends SeVoNode {
  "@type": "Novelty";
  agent: string;              // @id of agent
  behaviorSignature: string;  // hash of agent's behavioral characteristics
  noveltyScore: number;       // distance from nearest neighbors in behavior space
  strategies: string[];       // list of strategies the agent uses
  testCount: number;
  uniquePatterns: string[];   // distinct patterns found in agent's approach
}

export interface EvolutionStrategyNode extends SeVoNode {
  "@type": "EvolutionStrategy";
  name: string;
  mutationRate: number;
  crossoverRate: number;
  selectionPressure: number;  // tournament size or temperature
  noveltyWeight: number;      // 0-1, how much novelty matters vs fitness
  successRate: number;        // historical success rate of this strategy
  totalTrials: number;
  successfulTrials: number;
}

// --- SevoScore — self-computed universal benchmark score ---

export interface SevoScoreNode extends SeVoNode {
  "@type": "SevoScore";
  cycleId: string;
  score: number;              // cumulative SevoScore at this cycle
  cyclePoints: number;        // points earned this cycle
  breakdown: {
    agentsCreated: number;    // agents created this cycle
    agentsImproved: number;   // agents that beat their parent
    fitnessEvaluations: number;
    mutationsProposed: number;
    selectionsMade: number;
    noveltysRecorded: number;
    crossoversPerformed: number;
    seedImprovements: number;
    benchmarksEvolved: number;
    improvementBonus: number; // sum of fitness_delta × 10 for all improvements
  };
  metadata: {
    totalAgents: number;
    activeAgents: number;
    bestAgentId: string;
    bestEqs: number;
    avgFitness: number;
    maxBenchmarkDifficulty: number;
    evolvedLoc: number;       // total lines across all blueprints
    model: string;            // AI model used for mutations
    domain: string;           // project domain
  };
}

// --- Discovery Report Types (for sevoagents.com reporting) ---

export interface DiscoveryReport {
  instanceId: string;
  timestamp: string;
  reportType:
    | "strategy_performance"
    | "eqs_milestone"
    | "crossover_success"
    | "novelty_discovery"
    | "benchmark_evolution"
    | "general";
  data: Record<string, unknown>;
}

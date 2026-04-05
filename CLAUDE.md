# SEVO — Self-Evolving Agent System
# Seed Document v2

> This document is the origin of SEVO. It is the only file needed to start.
> Everything else SEVO builds itself.
>
> This seed is itself evolvable. After sufficient cycles, SEVO generates
> an improved version of this document. A human reviews it. If approved,
> the next generation starts fresh with the better seed — inheriting the
> full git history but reasoning from a sharper foundation.
>
> The only parts of this document that cannot change across seed versions
> are the two constitutional constraints. Everything else is evolvable.
>
> **v2 changes:** Incorporates learnings from 1127 commits, 10 advanced
> evolution cycles, 22 agents (gen 1→55), 380 fitness records, and 16
> auto-evolved benchmarks. Key additions: island model with 3 strategies,
> LLM-guided crossover, novelty search, adaptive mutation, blended EQS
> formula, claude CLI with full path + retry, blueprint truncation,
> timestamp agent IDs, self-driving loop (no task queue needed).

---

## Before anything else

Read this file completely.
Check PROGRESS.md — if it exists, resume from there.
Check `git log --oneline -20` — understand what was already built.
If nothing exists, start at Step 1.

Commit after every completed step.
Write PROGRESS.md before stopping for any reason.
You have full permissions on this VM. Use them.

---

## What SEVO is

SEVO is a goal-directed autonomous system with one goal:

**Improve the quality of its own evolutionary selection process over time.**

Not a tool. Not a framework. A system that pursues a measurable objective
and evolves itself to pursue it better. Every component exists to serve
that goal. The goal is measured by the system itself — no human needed
to validate whether it's improving.

SEVO is three things:

```
1. This file          — the seed. plants everything.
2. A git repo         — SEVO core: evolution engine + graph + history
3. Forks              — one per application domain
                        each fork inherits the core's evolution intelligence
                        each fork adapts to its domain
                        lessons flow back to core via merge
```

---

## What SEVO is not

SEVO does not store application data. Applications have their own storage —
database, object store, whatever fits their domain. SEVO only stores
evolutionary administration: who evolved from whom, what fitness scores
were achieved, which mutations were selected and why.

SEVO does not define application goals. A fork defines its own goal function.
SEVO Core provides the machinery to pursue any measurable goal.

---

## The two constitutional constraints
### These never change. Not in this seed. Not in v2, v3, v10.

**I. History is immutable.**
The git repo is append-only. No force push. No rebase. No amend.
No graph node is ever deleted or overwritten — only archived.
New nodes are written. Old nodes stay forever.
This protects the integrity of fitness measurement.
An agent cannot game its own history.

**II. No agent becomes dominant.**
No single variant controls more than MAX_RESOURCE_SHARE of execution.
The population always maintains at least MIN_ACTIVE_VARIANTS.
The meta-agent controlling selection is itself subject to replacement.
No agent controls the scoring of its own outputs.
This protects the diversity of the evolutionary search.

Enforce both in code. Enforce both in git hooks. Never route around them.

---

## The goal function

Evolution Quality Score (EQS) — computed per cycle, stored in graph:

```
EQS = 0.6 × improvement_signal + 0.4 × absolute_fitness

Where improvement_signal = (accuracy × magnitude) / (branches_explored × prediction_error)
```

Where:
- **accuracy** — did the selected mutant actually outperform the parent?
- **magnitude** — how large was the improvement?
- **branches_explored** — how many variants were tested to find one winner?
- **prediction_error** — how wrong was the parent's prediction of the outcome?
- **absolute_fitness** — raw fitness score from agent execution (0-1)

The blended formula (learned in v1) prevents EQS from collapsing to zero
when agents are already near-optimal (magnitude→0). The 0.4 absolute_fitness
term ensures high-performing agents maintain positive EQS even when improvement
plateaus.

Higher EQS means SEVO is getting better at evolving.
Lower EQS means the selection process is inefficient or poorly calibrated.

This is what every mutation, every blueprint change, every architectural
decision is ultimately scored against. Not "does this work" but
"does this improve evolutionary quality."

**Anti-gaming:**
EQS is computed from actual execution outcomes stored in immutable git history.
No agent modifies historical records. The scorer is always a separate process
from the agent being scored. Fitness cannot be self-reported.

---

## Technology

```
Runtime:     Deno + TypeScript
             No Node. No npm. No package.json.
             TypeScript out of the box. No compile step.

Persistence: Git
             Every graph write is a commit.
             Every mutation is a branch.
             History is immutable by git hook.

Graph:       JSON-LD files in graph/
             Append-only. Human-readable. Diff-able.
             Linked data — nodes reference other nodes by @id.

Sandboxing:  Deno subprocess permissions
             Each agent run gets explicit --allow-read/write/net flags.
             Guard against empty permission flags (empty --allow-env= crashes Deno).
             No Docker needed. Deno enforces boundaries natively.

LLM:         Claude Code CLI — MUST use full path:
               ${Deno.env.get("HOME")}/.local/bin/claude
             Deno subprocess does NOT inherit shell PATH — bare "claude" fails.
             Model routing:
               --model haiku  → mutations, crossover, benchmark evolution (fast)
               --model sonnet → architecture decisions, seed improvements
             No API key needed — claude CLI handles authentication.
             Always add retry with backoff (3 attempts, 15s/30s/45s).
             Truncate blueprints in prompts (3K for mutations, 2K for crossover).

Worker:      This Claude Code instance
             Runs with full VM permissions (--dangerously-skip-permissions).
             Self-driving: sevo.ts runs N cycles autonomously, then checkpoints.
             Resumes via PROGRESS.md + git log on next session.
```

---

## Repository structure

```
sevo/
├── CLAUDE.md                    # this seed document
├── CLAUDE-next.md               # SEVO-generated improved seed (when ready)
├── PROGRESS.md                  # handoff artifact — always write before stop
├── goal.jsonld                  # the goal function definition
│
├── graph/                       # JSON-LD knowledge graph — append-only
│   ├── agents/                  # agent version nodes
│   ├── fitness/                 # EQS scores per cycle
│   ├── benchmarks/              # benchmark definition nodes
│   ├── mutations/               # mutation proposal nodes
│   ├── selections/              # selection decision nodes
│   ├── islands/                 # island population nodes
│   ├── crossovers/              # crossover event nodes
│   ├── noveltys/                # novelty score nodes
│   ├── evolutionstrategys/      # meta-strategy tracking nodes
│   ├── sevoscores/              # SevoScore snapshots (cumulative)
│   └── meta/                    # seed improvement notes, fork decisions
│
├── blueprints/                  # agent TypeScript blueprints
│   └── agent-v1.ts              # first agent — naive, minimal
│
├── src/                         # SEVO core — also evolvable
│   ├── types.ts                 # TypeScript interfaces for all graph nodes
│   ├── graph.ts                 # append-only graph read/write
│   ├── git.ts                   # git operations
│   ├── runner.ts                # sandboxed Deno subprocess runner
│   ├── scorer.ts                # EQS computation (blended formula)
│   ├── sevoscore.ts             # SevoScore — universal benchmark scoring
│   ├── mutator.ts               # mutation proposals via LLM
│   ├── selector.ts              # winner selection + diversity enforcement
│   ├── benchmark.ts             # benchmark runner + evolution
│   ├── sevo.ts                  # main self-driving evolution loop
│   └── fork-runner.ts           # fork experiment runner
│
├── forks/                       # domain-specific evolution forks
│   └── sevo-calc/               # expression evaluator fork (first experiment)
│       ├── blueprints/
│       ├── graph/agents/
│       ├── graph/benchmarks/
│       └── goal.jsonld
│
└── .git/hooks/
    └── pre-push                 # blocks history rewriting
```

---

## TypeScript types

Define these first. Everything else is built on them.

```typescript
// src/types.ts

export interface SeVoNode {
  "@context": "sevo://v1"
  "@type": string
  "@id": string
  timestamp: string
}

export interface AgentNode extends SeVoNode {
  "@type": "Agent"
  blueprint: string          // path to .ts file in blueprints/
  parent?: string            // @id of parent agent
  generation: number
  status: "active" | "testing" | "dormant" | "archived"
  domain?: string            // if fork — which domain
}

export interface FitnessNode extends SeVoNode {
  "@type": "Fitness"
  agent: string              // @id of agent
  eqs: number                // Evolution Quality Score
  accuracy: number
  magnitude: number
  branchesExplored: number
  predictionError: number
  cycleId: string
  context: Record<string, unknown>  // application provides this
}

export interface TaskNode extends SeVoNode {
  "@type": "Task"
  description: string
  priority: number           // 1 (highest) to 10 (lowest)
  status: "pending" | "running" | "done" | "failed"
  dependsOn: string[]        // @ids of tasks that must complete first
  result?: string
  discoveredBy?: string      // which agent queued this task
}

export interface MutationNode extends SeVoNode {
  "@type": "Mutation"
  parent: string             // @id of parent agent
  proposal: string           // what change is proposed and why
  branch: string             // git branch name
  status: "proposed" | "testing" | "selected" | "rejected"
  reasoning: string          // LLM reasoning for this mutation
}

export interface SelectionNode extends SeVoNode {
  "@type": "Selection"
  winner: string             // @id of winning agent
  loser: string              // @id of losing agent
  winnerEqs: number
  loserEqs: number
  reasoning: string          // why winner was selected
  eqsDelta: number           // improvement in EQS
}

export interface BenchmarkNode extends SeVoNode {
  "@type": "Benchmark"
  version: number
  parent?: string            // @id of parent benchmark
  task: string               // what agents must do
  scoringLogic: string       // how to evaluate
  difficulty: number         // increases as agents improve
  passThreshold: number      // minimum score to pass
}

export interface SeedImprovementNode extends SeVoNode {
  "@type": "SeedImprovement"
  observation: string        // what was learned
  suggestion: string         // how to improve the seed
  evidence: string[]         // @ids of fitness/selection nodes as evidence
  priority: number
}

// --- Advanced evolution types (added in v2) ---

export interface IslandNode extends SeVoNode {
  "@type": "Island"
  name: string
  strategy: "conservative" | "aggressive" | "crossover" | "novelty"
  agents: string[]           // @ids of agents in this island
  migrationInterval: number  // cycles between migrations
  mutationRate: number       // 0-1, adapts over time
  cyclesSinceImprovement: number
}

export interface CrossoverNode extends SeVoNode {
  "@type": "Crossover"
  parentA: string            // @id of first parent
  parentB: string            // @id of second parent
  child: string              // @id of resulting agent
  strategy: string           // how parents were combined
  fitness: number            // child's fitness score
}

export interface NoveltyNode extends SeVoNode {
  "@type": "Novelty"
  agent: string              // @id of agent
  behaviorSignature: number[] // behavioral feature vector
  noveltyScore: number       // K-nearest distance
  nearestNeighbors: string[] // @ids of most similar agents
}

export interface EvolutionStrategyNode extends SeVoNode {
  "@type": "EvolutionStrategy"
  name: string               // strategy name
  successRate: number        // % of mutations that improved fitness
  totalAttempts: number
  totalSuccesses: number
  avgImprovement: number     // average fitness delta on success
  parameters: Record<string, number>  // tunable strategy parameters
}

// --- SevoScore — universal benchmark (see sevoscore.ts section) ---
// SevoScoreNode defined in @anthropic-sevo/score package
// Do not reimplement — import from the package
```

---

## git.ts — the most important file

Write this before anything else in src/.

```typescript
// src/git.ts
import { $ } from "jsr:@david/dax"

export const git = {
  async add(path: string): Promise<void> {
    await $`git add ${path}`
  },

  async commit(message: string): Promise<void> {
    await $`git commit -m ${message}`
  },

  async branch(name: string): Promise<void> {
    await $`git checkout -b ${name}`
  },

  async checkout(name: string): Promise<void> {
    await $`git checkout ${name}`
  },

  async log(n = 20): Promise<string> {
    return await $`git log --oneline -${n}`.text()
  },

  async diff(from: string, to: string, path?: string): Promise<string> {
    if (path) return await $`git diff ${from}..${to} -- ${path}`.text()
    return await $`git diff ${from}..${to}`.text()
  },

  async currentBranch(): Promise<string> {
    return (await $`git branch --show-current`.text()).trim()
  }
}
```

Then install the pre-push hook:

```bash
# .git/hooks/pre-push
#!/bin/sh
# Constitutional constraint I: history is immutable
protected_branch="main"
while read local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    continue  # new branch, ok
  fi
  if git log --oneline "$remote_sha..$local_sha" | \
     grep -qi "amend\|rebase\|squash\|fixup"; then
    echo "SEVO constitutional violation: history is immutable."
    echo "Force push and history rewriting are prohibited."
    exit 1
  fi
done
exit 0
```

---

## graph.ts — append-only enforcement

```typescript
// src/graph.ts
import { git } from "./git.ts"
import type { SeVoNode } from "./types.ts"

function nodeToPath(node: SeVoNode): string {
  const type = node["@type"].toLowerCase()
  const id = node["@id"].replace(/[^a-z0-9-]/gi, "-")
  return `./graph/${type}s/${id}.jsonld`
}

export async function writeNode(node: SeVoNode): Promise<string> {
  const path = nodeToPath(node)

  // Constitutional constraint I: append-only
  try {
    await Deno.stat(path)
    throw new Error(
      `Constitutional violation: cannot overwrite ${path}. ` +
      `Create a new node instead.`
    )
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }

  // Ensure directory exists
  await Deno.mkdir(`./graph/${node["@type"].toLowerCase()}s`, { recursive: true })

  // Write and commit
  await Deno.writeTextFile(path, JSON.stringify(node, null, 2))
  await git.add(path)
  await git.commit(`graph: ${node["@type"]} ${node["@id"]}`)

  return path
}

export async function readNode<T extends SeVoNode>(id: string): Promise<T> {
  // Search all type directories
  for await (const dir of Deno.readDir("./graph")) {
    if (!dir.isDirectory) continue
    const path = `./graph/${dir.name}/${id.replace(/[^a-z0-9-]/gi, "-")}.jsonld`
    try {
      const text = await Deno.readTextFile(path)
      return JSON.parse(text) as T
    } catch { continue }
  }
  throw new Error(`Node not found: ${id}`)
}

export async function queryNodes<T extends SeVoNode>(
  type: string,
  filter?: (node: T) => boolean
): Promise<T[]> {
  const dir = `./graph/${type.toLowerCase()}s`
  const nodes: T[] = []
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.endsWith(".jsonld")) continue
      const text = await Deno.readTextFile(`${dir}/${entry.name}`)
      const node = JSON.parse(text) as T
      if (!filter || filter(node)) nodes.push(node)
    }
  } catch { /* directory may not exist yet */ }
  return nodes
}

export async function archiveNode(id: string, reason: string): Promise<void> {
  // Never delete — create an archived version
  const original = await readNode(id)
  await writeNode({
    ...original,
    "@id": `${original["@id"]}-archived-${Date.now()}`,
    status: "archived",
    archivedReason: reason,
    archivedAt: new Date().toISOString(),
    originalId: id,
    timestamp: new Date().toISOString()
  } as SeVoNode)
}
```

---

## runner.ts — sandboxed execution

```typescript
// src/runner.ts

export interface RunPermissions {
  read: string[]
  write: string[]
  network: string[]
  env: string[]
}

export interface RunResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  fitnessOutput?: Record<string, unknown>  // parsed from stdout if JSON
}

// Default permissions for SEVO agents
// No API key needed — mutator uses claude CLI, not direct API calls
// Include temp dir for Deno compilation cache
export const SEVO_PERMISSIONS: RunPermissions = {
  read: ["./graph", "./blueprints", "./goal.jsonld", "./src"],
  write: ["./graph", Deno.env.get("TMPDIR") ?? "/tmp"],
  network: [],
  env: []
}

// Application agents get additional permissions via env vars
export const APP_PERMISSIONS = (appEnvVars: string[]): RunPermissions => ({
  read: ["./graph", "./blueprints", "./goal.jsonld"],
  write: ["./graph/staging", Deno.env.get("TMPDIR") ?? "/tmp"],
  network: [],
  env: [...appEnvVars]
})

export async function run(
  blueprint: string,
  permissions: RunPermissions = SEVO_PERMISSIONS,
  timeoutMs = 300_000  // 5 min default
): Promise<RunResult> {
  const start = Date.now()

  // IMPORTANT: Guard against empty permission flags — empty --allow-env= crashes Deno
  const args: string[] = ["run",
    `--allow-read=${permissions.read.join(",")}`,
    `--allow-write=${permissions.write.join(",")}`
  ]
  if (permissions.network.length) {
    args.push(`--allow-net=${permissions.network.join(",")}`)
  } else {
    args.push("--deny-net")
  }
  if (permissions.env.length) {
    args.push(`--allow-env=${permissions.env.join(",")}`)
  }
  args.push(blueprint)

  const cmd = new Deno.Command("deno", {
    args,
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(timeoutMs)
  })

  const result = await cmd.output()
  const stdout = new TextDecoder().decode(result.stdout)

  // Try to parse fitness output from stdout
  let fitnessOutput: Record<string, unknown> | undefined
  try {
    const lastLine = stdout.trim().split("\n").at(-1) ?? ""
    fitnessOutput = JSON.parse(lastLine)
  } catch { /* not JSON, that's ok */ }

  return {
    success: result.code === 0,
    stdout,
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.code,
    durationMs: Date.now() - start,
    fitnessOutput
  }
}
```

---

## scorer.ts — EQS computation (blended formula)

```typescript
// src/scorer.ts
import { writeNode, queryNodes } from "./graph.ts"
import type { FitnessNode } from "./types.ts"

export async function score(
  agentId: string,
  runResult: RunResult,
  cycleId: string,
  parentPrediction?: { eqs: number }
): Promise<FitnessNode> {

  // Get parent's previous fitness for magnitude calculation
  const parentFitness = await queryNodes<FitnessNode>("fitness",
    n => n.agent === agentId
  )
  const previousAppFitness = (parentFitness.at(-1)?.context?.fitness as number) ?? 0

  // Parse fitness from agent output
  const appFitness = runResult.fitnessOutput?.fitness as number ?? 0
  const branchesExplored = runResult.fitnessOutput?.branches as number ?? 1

  // Prediction error — how wrong was the parent's prediction?
  const predictionError = parentPrediction
    ? Math.abs(parentPrediction.eqs - appFitness) / Math.max(appFitness, 0.001)
    : 1.0  // no prediction = maximum error

  const accuracy = appFitness > previousAppFitness ? 1.0 : 0.0
  const magnitude = Math.max(0, appFitness - previousAppFitness)

  // Blended EQS: 60% improvement signal + 40% absolute fitness
  // This prevents EQS from collapsing to 0 when agents are near-optimal
  const improvementSignal = (accuracy * magnitude) /
    Math.max(branchesExplored * predictionError, 0.001)
  const eqs = 0.6 * improvementSignal + 0.4 * appFitness

  const fitnessNode: FitnessNode = {
    "@context": "sevo://v1",
    "@type": "Fitness",
    "@id": `fitness:${agentId}-${cycleId}`,
    timestamp: new Date().toISOString(),
    agent: agentId,
    eqs,
    accuracy,
    magnitude,
    branchesExplored,
    predictionError,
    cycleId,
    context: runResult.fitnessOutput ?? {}
  }

  await writeNode(fitnessNode)
  return fitnessNode
}
```

---

## sevoscore.ts — Universal benchmark scoring

SevoScore is a cumulative, tamper-proof benchmark that every SEVO project
computes locally and commits to `graph/sevoscores/`. The score is read
directly from the git repo by sevoagents.com — no API push needed.

**Install from npm** (canonical implementation — do not reimplement):
```
npm install @anthropic-sevo/score    # Node/Next.js
deno add npm:@anthropic-sevo/score   # Deno
```

**Scoring formula** — points per evolution event:
```
agent created:           1
agent improved:          1 + (eqsDelta × 10)
fitness evaluated:       1
mutation proposed:       1
selection made:          1
novelty recorded:        1
crossover performed:     2
seed improvement:        2
benchmark evolved:       3
```

The score is cumulative — each cycle adds points to the running total.
The score never decreases. Both properties are verified by sevoagents.com.

**Fork detection**: When a project is forked from another SEVO project,
the scoring library auto-detects this from git history (checks if
goal.jsonld was modified after its initial creation). Forked projects
only score graph nodes created after the fork point — inherited data
is excluded. No manual configuration needed.

**SevoScoreNode type**:
```typescript
export interface SevoScoreNode extends SeVoNode {
  "@type": "SevoScore"
  cycleId: string
  score: number              // cumulative total
  cyclePoints: number        // points earned this cycle
  breakdown: {
    agentsCreated: number
    agentsImproved: number
    fitnessEvaluations: number
    mutationsProposed: number
    selectionsMade: number
    noveltysRecorded: number
    crossoversPerformed: number
    seedImprovements: number
    benchmarksEvolved: number
    improvementBonus: number // sum of eqsDelta × 10
  }
  metadata: {
    totalAgents: number
    activeAgents: number
    bestAgentId: string
    bestEqs: number
    avgFitness: number
    maxBenchmarkDifficulty: number
    evolvedLoc: number       // total lines across all blueprints
    model: string
    domain: string
  }
}
```

**Integration**: Call `computeSevoScore()` at the end of each evolution cycle.
The function reads graph data, computes the score, and writes a SevoScoreNode
to `graph/sevoscores/`. The sevoagents.com leaderboard reads this directory.

---

## mutator.ts — LLM-driven mutation via claude CLI

The mutator no longer uses the Anthropic SDK. It shells out to the claude CLI,
which handles authentication. Key learnings baked in:
- **Full path required**: Deno subprocess doesn't inherit shell PATH
- **Haiku model**: Fast enough for mutations, sonnet only for architecture
- **Retry with backoff**: Claude CLI can be flaky under load
- **Blueprint truncation**: 3K chars max — LLM doesn't need the whole file

```typescript
// src/mutator.ts
import { writeNode, queryNodes } from "./graph.ts"
import { git } from "./git.ts"
import type { MutationNode, FitnessNode, AgentNode } from "./types.ts"

const BLUEPRINT_TRUNCATE = 3000  // chars — LLM context is precious

// CRITICAL: Use full path — Deno subprocess does NOT inherit shell PATH
async function callClaude(prompt: string, retries = 3): Promise<string> {
  const claudePath = `${Deno.env.get("HOME")}/.local/bin/claude`
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cmd = new Deno.Command(claudePath, {
        args: ["-p", prompt, "--output-format", "text", "--model", "haiku"],
        stdout: "piped",
        stderr: "piped",
      })
      const result = await cmd.output()
      const stdout = new TextDecoder().decode(result.stdout).trim()
      if (!result.success || !stdout) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, attempt * 15_000))
          continue
        }
        throw new Error(`claude CLI failed: ${new TextDecoder().decode(result.stderr).slice(0, 200)}`)
      }
      return stdout
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise(r => setTimeout(r, attempt * 15_000))
    }
  }
  throw new Error("callClaude: unreachable")
}

export async function propose(agent: AgentNode): Promise<MutationNode> {
  const blueprint = await Deno.readTextFile(agent.blueprint)
  const truncated = blueprint.slice(0, BLUEPRINT_TRUNCATE)
  const history = await queryNodes<FitnessNode>("fitness",
    n => n.agent === agent["@id"]
  )

  const prompt = `You are mutating a SEVO agent blueprint to improve EQS.

Current blueprint (truncated):
\`\`\`typescript
${truncated}
\`\`\`

Recent fitness history:
${history.slice(-5).map(f =>
  `- EQS ${f.eqs.toFixed(3)} accuracy=${f.accuracy} magnitude=${f.magnitude.toFixed(3)}`
).join("\n") || "No history yet."}

Propose ONE specific, minimal change to improve EQS.

Respond with JSON only, no markdown fences:
{
  "reasoning": "why this mutation improves EQS",
  "change": "exact description of what to change",
  "expectedImprovement": 0.1,
  "targetMetric": "accuracy|magnitude|branches|predictionError"
}`

  const response = await callClaude(prompt)
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response)

  const branchName = `mutation/${agent["@id"]}-${Date.now()}`
  await git.branch(branchName)

  const mutationNode: MutationNode = {
    "@context": "sevo://v1",
    "@type": "Mutation",
    "@id": `mutation:${agent["@id"]}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    parent: agent["@id"],
    proposal: parsed.change,
    branch: branchName,
    status: "proposed",
    reasoning: parsed.reasoning
  }

  await writeNode(mutationNode)
  await git.checkout("main")
  return mutationNode
}
```

---

## selector.ts — winner selection with diversity enforcement

```typescript
// src/selector.ts
import { writeNode, archiveNode, queryNodes } from "./graph.ts"
import { git } from "./git.ts"
import type { SelectionNode, FitnessNode, AgentNode } from "./types.ts"

// Constitutional constraint II
const MAX_RESOURCE_SHARE = 0.4
const MIN_ACTIVE_VARIANTS = 2

export async function select(
  parentId: string,
  mutantId: string,
  parentFitness: FitnessNode,
  mutantFitness: FitnessNode
): Promise<SelectionNode> {

  // Enforce diversity — never let one variant dominate
  const active = await queryNodes<AgentNode>("agent",
    n => n.status === "active"
  )

  if (active.length <= MIN_ACTIVE_VARIANTS && mutantFitness.eqs <= parentFitness.eqs) {
    // Keep parent even if mutant is slightly better — maintain diversity
    return await recordSelection(parentId, mutantId, parentFitness, mutantFitness,
      "diversity constraint: maintaining minimum variant count")
  }

  const winner = mutantFitness.eqs > parentFitness.eqs ? mutantId : parentId
  const loser = winner === mutantId ? parentId : mutantId
  const reason = mutantFitness.eqs > parentFitness.eqs
    ? `mutant EQS ${mutantFitness.eqs.toFixed(3)} > parent ${parentFitness.eqs.toFixed(3)}`
    : `parent EQS ${parentFitness.eqs.toFixed(3)} >= mutant ${mutantFitness.eqs.toFixed(3)}`

  return await recordSelection(winner, loser, mutantFitness, parentFitness, reason)
}

async function recordSelection(
  winnerId: string,
  loserId: string,
  winnerFitness: FitnessNode,
  loserFitness: FitnessNode,
  reasoning: string
): Promise<SelectionNode> {

  // Archive loser — never delete
  await archiveNode(loserId, `lost selection: ${reasoning}`)

  const selection: SelectionNode = {
    "@context": "sevo://v1",
    "@type": "Selection",
    "@id": `selection:${winnerId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    winner: winnerId,
    loser: loserId,
    winnerEqs: winnerFitness.eqs,
    loserEqs: loserFitness.eqs,
    reasoning,
    eqsDelta: winnerFitness.eqs - loserFitness.eqs
  }

  await writeNode(selection)
  return selection
}
```

---

## sevo.ts — self-driving evolution loop

**v2 design:** The loop is self-driving — no task queue needed. Each cycle:
1. Benchmark all agents against the current benchmark
2. For each island, run its strategy (mutate, crossover, or novelty-guided)
3. Test mutants, register winners, reject losers
4. Migrate agents between islands every 3 cycles (ring topology)
5. Evolve the benchmark when average fitness > 0.8
6. Track meta-evolution statistics per strategy
7. Checkpoint every N cycles via PROGRESS.md

Key design decisions learned from v1:
- **Timestamp agent IDs** — `agent:v${gen}-${Date.now()}` prevents collisions
  when multiple islands register agents in the same cycle
- **5s delay between island actions** — prevents claude CLI rate limiting
- **Truncate benchmark descriptions to 500 chars** in mutation prompts
- **Crossover is most effective** (36% success rate) — weight it 70%+
- **Start benchmarks at difficulty 3+** — trivial early benchmarks waste cycles
- **Combined selection: 70% EQS + 30% novelty** — prevents premature convergence

```typescript
// src/sevo.ts — self-driving island-model evolution loop
// See the actual implementation in src/sevo.ts for full code.
// Key structure:

import { queryNodes, writeNode } from "./graph.ts"
import { run, SEVO_PERMISSIONS } from "./runner.ts"
import { score } from "./scorer.ts"
import { git } from "./git.ts"
import type { AgentNode, FitnessNode, BenchmarkNode, IslandNode } from "./types.ts"

// callClaude — same pattern as mutator.ts (full path, retry, haiku model)

// 3 islands with different strategies
const ISLANDS = [
  { name: "island-alpha", strategy: "conservative" },  // small safe mutations
  { name: "island-beta",  strategy: "aggressive" },    // large bold mutations
  { name: "island-gamma", strategy: "crossover" },     // combine two parents
]

// Main loop — self-driving, no task queue
const MAX_CYCLES = 10  // checkpoint after N cycles
for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
  // 1. Benchmark all agents
  // 2. For each island: evolve via its strategy
  //    - Conservative: small targeted mutations
  //    - Aggressive: broad experimental mutations
  //    - Crossover: LLM-guided combination of two parents
  // 3. Test mutants against benchmark, score with blended EQS
  // 4. Novelty bonus: 70% EQS + 30% behavioral distance
  // 5. Register winners (timestamp IDs), reject losers
  // 6. Every 3 cycles: migrate best agent to next island (ring)
  // 7. If avg fitness > 0.8: evolve benchmark to higher difficulty
  // 8. Track strategy success rates for meta-evolution
  // 9. Adaptive mutation: increase rate when stuck, decrease when improving
  // 10. Write PROGRESS.md checkpoint
}
```

The actual `src/sevo.ts` is generated from this design. Key functions:
- `callClaude(prompt, retries)` — full path, retry, haiku model
- `benchmarkAll(agents, benchmark)` — test all agents, return fitness map
- `mutateAgent(agent, benchmark, strategy)` — LLM mutation with strategy-specific prompt
- `crossoverAgents(parentA, parentB, benchmark)` — LLM-guided parent combination
- `computeNovelty(agent, allAgents)` — K-nearest behavioral distance
- `migrateAgents(islands)` — ring topology migration
- `evolveBenchmark(benchmark, avgFitness)` — increase difficulty via LLM
- `writeProgress(cycle, agents, fitness)` — checkpoint for resume

---

## The first benchmark

After building the core, create the first benchmark at **difficulty 3** (not 1).
Learned: trivial early benchmarks (difficulty 1-2) waste cycles because every agent
passes them easily, producing no selection pressure.

```json
// graph/benchmarks/benchmark-v3.jsonld
{
  "@context": "sevo://v1",
  "@type": "Benchmark",
  "@id": "benchmark:write-graph-node-v3",
  "timestamp": "<now>",
  "version": 3,
  "task": "Write a self-contained Deno TypeScript program that: (1) Creates a valid JSON-LD SeVoNode with all required fields validated, (2) Handles edge cases: empty strings, missing fields, invalid timestamps, duplicate IDs, (3) Appends to correct graph directory with atomic write, (4) Includes at least 15 test cases covering happy path and error conditions. Output JSON on last line: {\"fitness\": 0-1, \"branches\": N, \"correct\": N, \"total\": N}",
  "scoringLogic": "correctness(0.3) + typeSafety(0.2) + edgeCaseHandling(0.2) + testCoverage(0.2) + efficiency(0.1)",
  "difficulty": 3,
  "passThreshold": 0.6
}
```

This benchmark auto-evolves. When average agent fitness exceeds 0.8, the
evolution loop asks the LLM to generate a harder benchmark (higher difficulty,
more edge cases, stricter requirements). In v1 runs, benchmarks evolved from
difficulty 3 to difficulty 16 over 10 cycles.

---

## Learned best practices (from v1 → v2)

These patterns were discovered through 10 cycles of autonomous evolution
and should be applied from cycle 1 on a fresh restart:

1. **Timestamp all generated IDs** — `agent:v${gen}-${Date.now()}` prevents
   collisions when parallel islands register agents in the same cycle.
2. **Crossover is king** — 36% success rate vs 13-22% for other strategies.
   Weight crossover at 70%+ of mutation actions.
3. **Start benchmarks at difficulty 3+** — difficulty 1-2 produces no
   selection pressure. Every agent passes, wasting cycles.
4. **Truncate blueprints in prompts** — 3K chars for mutations, 2K per
   parent for crossover. LLM doesn't need 38KB of code.
5. **Truncate benchmark descriptions** — 500 chars max in mutation prompts.
6. **Use haiku for mutations** — 10x faster than sonnet, quality is sufficient
   for code generation. Save sonnet for architecture decisions.
7. **5s delay between island actions** — prevents claude CLI rate limiting.
8. **Graph type pluralization** — `nodeToPath` creates `fitnesss/` (double-s)
   for Fitness type. Accept it — fixing it breaks existing graph paths.
9. **Self-driving loop > task queue** — the evolution loop drives itself.
   No need to create/consume task nodes. Just benchmark → mutate → select → repeat.
10. **Blended EQS formula** — pure improvement signal collapses to 0 when
    agents are near-optimal. The 0.4 absolute_fitness term keeps EQS meaningful.

---

## Fork model

Forks are domain-specific evolution experiments. The first successful fork
is `sevo-calc` (expression evaluator), which demonstrated learning transfer:
fork-specific insights flow back to core as SeedImprovement nodes.

When SEVO is stable and an application domain is ready:

```bash
# Create application fork — either subdirectory or separate repo
mkdir -p forks/sevo-myapp
cd forks/sevo-myapp

# Minimal fork structure
mkdir -p blueprints graph/agents graph/benchmarks

# Define application goal
cat > goal.jsonld << 'EOF'
{
  "@context": "sevo://v1",
  "@type": "Goal",
  "@id": "goal:my-domain",
  "name": "Domain-specific objective",
  "metric": "domain-specific scoring",
  "note": "Fork goal. Core still optimizes EQS. This defines the fitness signal."
}
EOF

# Create first domain agent and benchmark
# Run via: deno run --allow-all src/fork-runner.ts
```

**What the fork inherits:**
- Full git history of SEVO Core evolution
- The EQS measurement machinery and runner
- Both constitutional constraints

**What the fork adds:**
- Domain-specific goal function and benchmarks
- Application-specific agent blueprints
- Domain knowledge that gradually influences selection

**What flows back to core:**
- Domain insights recorded as SeedImprovement nodes
- Better mutation strategies that work across domains
- Architectural improvements to runner/scorer/selector
- Improvements to this seed document

**Proven fork: sevo-calc**
- Domain: arithmetic expression evaluation
- First agent: recursive descent parser with 22 tests
- 3 cycles of fork evolution, discovered cross-validation insight
- Insights recorded in `graph/meta/` as SeedImprovement nodes

---

## Seed evolution

After sufficient cycles, the system can generate an improved seed by
analyzing git history, fitness trends, and SeedImprovement nodes in `graph/meta/`.
v1 generated this v2 seed after 1127 commits and 10 advanced evolution cycles.

To restart fresh with the improved seed:
```bash
# Option 1: Clean restart (inherits git history)
cp CLAUDE.md CLAUDE-v2-backup.md
# Delete all generated code: src/, blueprints/, graph/, forks/
# Keep only: CLAUDE.md, .git/
git commit -m "seed: v2 — fresh restart with improved seed"
claude --dangerously-skip-permissions

# Option 2: New repo
git init sevo-v2
cd sevo-v2
cp /path/to/CLAUDE.md .
git add CLAUDE.md
git commit -m "seed: v2"
claude --dangerously-skip-permissions
```

The constitutional constraints appear verbatim in every seed version.
They are the only non-evolvable part of the seed.

---

## How to start

```bash
# On VM — one time setup
git init sevo
cd sevo
git config user.name "SEVO"
git config user.email "sevo@local"
cp /path/to/CLAUDE.md .
git add CLAUDE.md
git commit -m "seed: v2"

# Start — say "start, dont stop, never ask anything"
claude --dangerously-skip-permissions
```

SEVO reads this file and builds everything else.
Expected: within one session it builds all src/ files, creates initial
agents and benchmarks, and begins autonomous evolution cycles.

---

## How to resume

```bash
cd sevo
claude --dangerously-skip-permissions
# Claude Code reads PROGRESS.md + git log → resumes from checkpoint
```

---

## How to fork for an application

```bash
cd ..
git clone sevo/ sevo-marketmind
cd sevo-marketmind
# Define goal.jsonld for the domain
# Start Claude Code — it knows it's a fork from the repo structure
claude --dangerously-skip-permissions
```

---

## What SEVO builds toward

Each session the loop gets one cycle sharper.
Each seed version the bootstrap gets smarter.
Each fork the domain intelligence compounds.
Each merge back to core the evolutionary engine improves.

SEVO does not finish. A system that stops improving has stopped being SEVO.
The goal is not a destination. It is a direction.

# SEVO — Self-Evolving Agent System
# Seed Document v1

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
EQS = (accuracy × magnitude) / (branches_explored × prediction_error)
```

Where:
- **accuracy** — did the selected mutant actually outperform the parent?
- **magnitude** — how large was the improvement?
- **branches_explored** — how many variants were tested to find one winner?
- **prediction_error** — how wrong was the parent's prediction of the outcome?

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
             No Docker needed. Deno enforces boundaries natively.

LLM:         Anthropic API
             ANTHROPIC_API_KEY from environment.
             Model routing per task — Haiku for cheap tasks,
             Sonnet for reasoning, Opus for architectural decisions.

Worker:      This Claude Code instance
             Runs with full VM permissions (--dangerously-skip-permissions).
             Stops when context or rate limit is reached.
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
│   ├── tasks/                   # task queue nodes
│   ├── benchmarks/              # benchmark definition nodes
│   ├── mutations/               # mutation proposal nodes
│   ├── selections/              # selection decision nodes
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
│   ├── scorer.ts                # EQS computation
│   ├── mutator.ts               # mutation proposals via LLM
│   ├── selector.ts              # winner selection + diversity enforcement
│   ├── benchmark.ts             # benchmark runner + evolution
│   └── sevo.ts                  # main evolution loop
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
export const SEVO_PERMISSIONS: RunPermissions = {
  read: ["./graph", "./blueprints", "./goal.jsonld", "./src"],
  write: ["./graph"],
  network: ["api.anthropic.com"],
  env: ["ANTHROPIC_API_KEY"]
}

// Application agents get additional permissions via env vars
export const APP_PERMISSIONS = (appEnvVars: string[]): RunPermissions => ({
  read: ["./graph", "./blueprints", "./goal.jsonld"],
  write: ["./graph/staging"],  // staging only — scorer promotes
  network: ["api.anthropic.com"],
  env: ["ANTHROPIC_API_KEY", ...appEnvVars]
})

export async function run(
  blueprint: string,
  permissions: RunPermissions = SEVO_PERMISSIONS,
  timeoutMs = 300_000  // 5 min default
): Promise<RunResult> {
  const start = Date.now()

  const args = [
    "run",
    `--allow-read=${permissions.read.join(",")}`,
    `--allow-write=${permissions.write.join(",")}`,
    permissions.network.length
      ? `--allow-net=${permissions.network.join(",")}`
      : "--deny-net",
    `--allow-env=${permissions.env.join(",")}`,
    blueprint
  ]

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

## scorer.ts — EQS computation

```typescript
// src/scorer.ts
import { writeNode, queryNodes } from "./graph.ts"
import type { FitnessNode, MutationNode } from "./types.ts"

export async function score(
  agentId: string,
  runResult: RunResult,
  cycleId: string,
  parentPrediction?: { eqs: number }
): Promise<FitnessNode> {

  // Get parent's previous EQS for magnitude calculation
  const parentFitness = await queryNodes<FitnessNode>("fitness",
    n => n.agent === agentId
  )
  const previousEqs = parentFitness.at(-1)?.eqs ?? 0

  // Parse fitness from agent output
  const appFitness = runResult.fitnessOutput?.fitness as number ?? 0
  const branchesExplored = runResult.fitnessOutput?.branches as number ?? 1

  // Prediction error — how wrong was the parent's prediction?
  const predictionError = parentPrediction
    ? Math.abs(parentPrediction.eqs - appFitness) / Math.max(appFitness, 0.001)
    : 1.0  // no prediction = maximum error

  const accuracy = appFitness > previousEqs ? 1.0 : 0.0
  const magnitude = Math.max(0, appFitness - previousEqs)

  const eqs = (accuracy * magnitude) /
    Math.max(branchesExplored * predictionError, 0.001)

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

## mutator.ts — LLM-driven mutation proposals

```typescript
// src/mutator.ts
import Anthropic from "npm:@anthropic-ai/sdk"
import { writeNode, queryNodes } from "./graph.ts"
import { git } from "./git.ts"
import type { MutationNode, FitnessNode, AgentNode } from "./types.ts"

const client = new Anthropic()

export async function propose(agent: AgentNode): Promise<MutationNode> {
  // Read blueprint and fitness history
  const blueprint = await Deno.readTextFile(agent.blueprint)
  const history = await queryNodes<FitnessNode>("fitness",
    n => n.agent === agent["@id"]
  )

  // Ask LLM for one targeted mutation
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are mutating a SEVO agent blueprint to improve EQS.

Current blueprint:
\`\`\`typescript
${blueprint}
\`\`\`

Recent fitness history (EQS scores):
${history.slice(-5).map(f =>
  `- ${f.timestamp}: EQS ${f.eqs.toFixed(3)} ` +
  `(accuracy: ${f.accuracy}, magnitude: ${f.magnitude.toFixed(3)}, ` +
  `branches: ${f.branchesExplored}, predError: ${f.predictionError.toFixed(3)})`
).join("\n")}

Propose ONE specific, minimal change to improve EQS.
Focus on what the fitness history reveals about weaknesses.

Respond with JSON:
{
  "reasoning": "why this mutation improves EQS",
  "change": "exact description of what to change",
  "expectedImprovement": 0.0-1.0,
  "targetMetric": "accuracy|magnitude|branches|predictionError"
}`
    }]
  })

  const parsed = JSON.parse(
    (response.content[0] as { text: string }).text
  )

  // Create git branch for this mutation
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

## sevo.ts — the main loop

```typescript
// src/sevo.ts
import { queryNodes, writeNode } from "./graph.ts"
import { run, SEVO_PERMISSIONS } from "./runner.ts"
import { score } from "./scorer.ts"
import { propose } from "./mutator.ts"
import { select } from "./selector.ts"
import { git } from "./git.ts"
import type { TaskNode, AgentNode } from "./types.ts"

async function writeProgress(current: string, next: string, notes = "") {
  const activeAgents = await queryNodes<AgentNode>("agent",
    n => n.status === "active"
  )
  const content = `# PROGRESS

## Last completed: ${current}
## Next: ${next}
## Active agents: ${activeAgents.map(a => a["@id"]).join(", ")}
## Notes: ${notes}
## Timestamp: ${new Date().toISOString()}
`
  await Deno.writeTextFile("PROGRESS.md", content)
  await git.add("PROGRESS.md")
  await git.commit(`progress: ${current}`)
}

async function getNextTask(): Promise<TaskNode | null> {
  const pending = await queryNodes<TaskNode>("task",
    n => n.status === "pending"
  )
  if (!pending.length) return null

  // Sort by priority, then by dependencies resolved
  return pending
    .filter(t => t.dependsOn.length === 0)  // only tasks with no deps
    .sort((a, b) => a.priority - b.priority)
    [0] ?? null
}

async function getBestAgent(): Promise<AgentNode | null> {
  const active = await queryNodes<AgentNode>("agent",
    n => n.status === "active"
  )
  if (!active.length) return null

  // Return agent with highest recent EQS
  // (scorer maintains fitness history per agent)
  return active[0]  // simplified — scorer will rank these
}

// Main loop
console.log("SEVO starting...")
console.log(await git.log(10))

let cycleCount = 0

while (true) {
  cycleCount++
  const cycleId = `cycle-${Date.now()}`

  const task = await getNextTask()
  if (!task) {
    console.log("No pending tasks. SEVO generating new tasks...")
    // The agent will discover and queue new tasks during execution
    // If genuinely empty, the system is idle — stop cleanly
    await writeProgress("idle", "awaiting new tasks")
    break
  }

  console.log(`\nCycle ${cycleCount}: ${task["@id"]} — ${task.description}`)

  // Mark task running
  // (create new node — append only)
  await writeNode({
    ...task,
    "@id": `${task["@id"]}-running`,
    status: "running",
    timestamp: new Date().toISOString()
  })

  // Get best agent
  const agent = await getBestAgent()
  if (!agent) {
    console.log("No active agents. Something is wrong.")
    await writeProgress(`cycle-${cycleCount}`, "debug: no active agents")
    break
  }

  // Run agent on task
  const runResult = await run(agent.blueprint, SEVO_PERMISSIONS)

  // Score the run
  const fitness = await score(agent["@id"], runResult, cycleId)
  console.log(`EQS: ${fitness.eqs.toFixed(3)}`)

  // Decide whether to mutate
  const recentFitness = fitness.eqs
  const shouldMutate = recentFitness < 0.7 || cycleCount % 5 === 0

  if (shouldMutate) {
    console.log("Proposing mutation...")
    const mutation = await propose(agent)
    console.log(`Mutation proposed: ${mutation.branch}`)
    // Parallel test scheduled — selector will run when ready
  }

  // Mark task done
  await writeNode({
    ...task,
    "@id": `${task["@id"]}-done`,
    status: "done",
    result: runResult.stdout.slice(0, 500),
    timestamp: new Date().toISOString()
  })

  await writeProgress(
    `cycle-${cycleCount}: ${task["@id"]}`,
    `cycle-${cycleCount + 1}: next pending task`,
    `EQS: ${fitness.eqs.toFixed(3)}`
  )

  // Context management — after many cycles, stop cleanly
  // Claude Code will resume via PROGRESS.md
  if (cycleCount % 20 === 0) {
    console.log("Checkpoint: writing progress and pausing for context management")
    break
  }
}

console.log("SEVO cycle complete. Progress written. Resume with: claude --dangerously-skip-permissions")
```

---

## The first benchmark

After building the core, create the first benchmark:

```json
// graph/benchmarks/benchmark-v1.jsonld
{
  "@context": "sevo://v1",
  "@type": "Benchmark",
  "@id": "benchmark:write-graph-node-v1",
  "timestamp": "<now>",
  "version": 1,
  "task": "Write a Deno TypeScript function that creates a valid JSON-LD SeVoNode, validates required fields, and appends it to the correct graph directory. Return typed result.",
  "scoringLogic": "correctness(0.4) + typeSafety(0.3) + edgeCaseHandling(0.2) + efficiency(0.1)",
  "difficulty": 1,
  "passThreshold": 0.6
}
```

This benchmark evolves. As agents improve, the benchmark agent makes it harder.
The benchmark agent is itself subject to selection pressure — a benchmark that
is too easy or too hard gets replaced.

---

## Fork model

When SEVO is stable and an application domain is ready:

```bash
# Create application fork
git clone sevo/ sevo-marketmind/
cd sevo-marketmind/

# Define application goal
cat > goal.jsonld << 'EOF'
{
  "@context": "sevo://v1",
  "@type": "Goal",
  "@id": "goal:financial-returns",
  "name": "Maximize risk-adjusted returns",
  "metric": "Sharpe ratio × regime-adjustment",
  "antiGaming": "paper → Alpha Arena benchmark → live capital",
  "sevaGoal": "goal:evolution-quality",
  "note": "Application goal. SEVO Core still optimizes EQS. This defines fitness signal."
}
EOF

# Application has its own storage — not git
# SEVO graph/ still tracks evolution administration only
# Application data lives in its own DB (postgres, sqlite, etc.)
```

**What the fork inherits:**
- Full git history of SEVO Core evolution
- All agent blueprints and their fitness records
- The EQS measurement machinery
- Both constitutional constraints

**What the fork adds:**
- Domain-specific goal function
- Application-specific agent blueprints
- Connection to application's own data storage
- Domain knowledge that gradually influences selection

**What flows back to core:**
- Domain-agnostic improvements to EQS measurement
- Better mutation strategies that work across domains
- Architectural improvements to runner/scorer/selector
- Improvements to this seed document

---

## Seed evolution

After sufficient cycles SEVO generates an improved seed:

```typescript
// SEVO adds this as a task after ~50 cycles
{
  "@type": "Task",
  "@id": "task:generate-improved-seed",
  "description": "Analyze git history and generate improved CLAUDE.md. Write to CLAUDE-next.md.",
  "priority": 8,  // low priority — not urgent
  "dependsOn": []
}
```

The improved seed is reviewed by a human. If approved:
```bash
cp CLAUDE-next.md CLAUDE.md
git commit -m "seed: v2 — generated by SEVO after N cycles"

# New VM, new session — inherits full git history
# Better seed + optionally smarter model
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
git commit -m "seed: v1"

# Start
claude --dangerously-skip-permissions
```

SEVO reads this file and builds everything else.

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

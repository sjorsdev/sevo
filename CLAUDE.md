# SEVO — Self-Evolving Agent System

SEVO is an application that evolves agents toward a measurable goal. Point it at any project with a `goal.md`, and it runs autonomous evolution: mutate, benchmark, score, select, repeat. It measures its own evolutionary quality (EQS) and gets better at evolving over time.

## Constitutional Constraints (immutable)

**I. History is immutable.** Append-only git. No force push, rebase, or amend. No graph node is ever deleted — only archived. Enforced by pre-push hook.

**II. No agent becomes dominant.** MAX_RESOURCE_SHARE=0.4, MIN_ACTIVE_VARIANTS=2. The meta-agent controlling selection is itself replaceable.

## Goal Function

```
EQS = 0.6 × improvement_signal + 0.4 × absolute_fitness
improvement_signal = (accuracy × magnitude) / (branches_explored × prediction_error)
```

## Technology

- **Runtime:** Deno + TypeScript (no Node/npm)
- **Persistence:** Git (every graph write = commit, append-only)
- **Graph:** JSON-LD files in `graph/` (human-readable, diff-able)
- **LLM:** Claude CLI at `~/.local/bin/claude` (haiku for mutations, sonnet for architecture)

## Usage

```bash
# Create a new project
deno run --allow-all sevo/src/cli.ts init my-project

# Run evolution (agents + engine in one unified loop)
deno run --allow-all sevo/src/cli.ts run /path/to/project

# Compute SevoScore
deno run --allow-all sevo/src/cli.ts score /path/to/project
```

## Using SEVO on your own project

```bash
deno run --allow-all sevo/src/cli.ts init my-domain
cd my-domain
# Edit goal.md with your domain's fitness metric
# Write blueprints/agent-v1.ts as your first agent
# Optionally write src/fork-runner.ts for domain-specific evolution logic
deno run --allow-all ../sevo/src/cli.ts run .
```

## Architecture

All source is in `src/`. Key modules:
- `cli.ts` — entry point (run, score, init)
- `goal.ts` — goal loader (goal.md preferred, goal.jsonld fallback)
- `orchestrator.ts` — unified loop: EVOLVE→REFLECT→THINK→IMPLEMENT→TEST→REALIGN
- `sevo.ts` — agent evolution engine (island model, crossover, novelty search)
- `types.ts` — all graph node interfaces
- `graph.ts` — append-only JSON-LD store
- `runner.ts` — sandboxed Deno subprocess execution
- `scorer.ts` — EQS computation
- `mutator.ts` — LLM-driven mutation proposals
- `selector.ts` — winner selection + diversity enforcement
- `reporter.ts` — cross-project learning via sevoagents.com
- `mod.ts` — public API (import this from forks)

## Learned Practices

1. Timestamp all IDs: `agent:v${gen}-${Date.now()}` — prevents collisions
2. Crossover is most effective (36% success) — weight at 70%+
3. Start benchmarks at difficulty 3+ — difficulty 1-2 has no selection pressure
4. Truncate blueprints in prompts — 3K for mutations, 2K per parent for crossover
5. Use haiku for mutations (fast), sonnet for architecture
6. Parameter tweaks > full rewrites — full rewrites fail >80%
7. Fix failed mutations before discarding — feed error back to LLM, retry up to 20x (loop detection: same error 3x = stuck)
8. Every phase that proposes must implement — THINK without IMPLEMENT is journaling
9. Research first — search existing work before building from scratch
10. Self-driving loop > task queue — evolution drives itself

## Resume

Read `PROGRESS.md` + `git log --oneline -20`, then continue from where it stopped.

# SEVO

Autonomous evolution engine. Point it at any project with a `goal.md`, and it evolves agents toward your fitness metric.

SEVO is not a template. You don't fork it. You clone it once and use it to evolve your own projects.

## Quick start

```bash
# Clone sevo
git clone <repo-url> sevo

# Create a new project
deno run --allow-all sevo/src/cli.ts init my-project

# Edit my-project/goal.md — define what your agents optimize for
# Add my-project/blueprints/agent-v1.ts — your first agent

# Run evolution
deno run --allow-all sevo/src/cli.ts run my-project
```

## How it works

SEVO runs a loop: **REFLECT > THINK > IMPLEMENT > REVIEW > BENCHMARK > SELECT**

Each cycle, it mutates agent code, benchmarks all active agents, keeps winners, and archives losers. It uses Claude to propose mutations, crossovers, and new agents. Everything is recorded as append-only JSON-LD in `graph/`.

## goal.md

Every project needs a `goal.md` that defines the fitness metric. YAML frontmatter for structured fields, markdown body for description:

```markdown
---
id: my-project
metric: "accuracy * speed / cost"
---

# Optimize prediction pipeline

Agents should maximize prediction accuracy while minimizing latency and compute cost.
```

## Projects evolved by SEVO

- [sevo-life](../sevo-life) — beauty-driven artificial life simulation
- [sevo-human-model](../sevo-human-model) — computational model of human psychology

SEVO also evolves itself — its own `goal.md` targets evolutionary selection quality (EQS).

## Requirements

- [Deno](https://deno.land)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) at `~/.local/bin/claude`

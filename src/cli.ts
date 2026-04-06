#!/usr/bin/env -S deno run --allow-all
// src/cli.ts — SEVO command-line interface
//
// Usage:
//   sevo evolve /path/to/project       Run agent evolution (island model)
//   sevo orchestrate /path/to/project   Run meta-cycle (REFLECT→THINK→IMPLEMENT→TEST)
//   sevo score /path/to/project         Compute and print SevoScore
//   sevo init <name>                    Scaffold a new sevo project

import { join } from "https://deno.land/std/path/mod.ts";

const [command, target] = Deno.args;

if (!command) {
  console.log(`SEVO — Self-Evolving Agent System

Usage:
  deno run --allow-all src/cli.ts <command> <path>

Commands:
  run <path>           Run evolution (agents + engine, unified loop)
  score <path>         Compute SevoScore
  init <name>          Create a new sevo project`);
  Deno.exit(0);
}

const sevoRoot = new URL(".", import.meta.url).pathname;

if (command === "init") {
  const name = target ?? "my-sevo-project";
  const dir = join(Deno.cwd(), name);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.mkdir(join(dir, "graph"), { recursive: true });
  await Deno.mkdir(join(dir, "blueprints"), { recursive: true });
  await Deno.mkdir(join(dir, "src"), { recursive: true });

  // goal.jsonld
  await Deno.writeTextFile(join(dir, "goal.jsonld"), JSON.stringify({
    "@context": "sevo://v1",
    "@type": "Goal",
    "@id": `goal:${name}`,
    name: `${name} evolution goal`,
    metric: "Define your fitness metric here",
    note: "Edit this file to define what your agents optimize for",
  }, null, 2));

  // deno.json import map pointing to sevo core
  const relSevo = sevoRoot.endsWith("/") ? sevoRoot.slice(0, -1) : sevoRoot;
  await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify({
    imports: { "sevo/": `${relSevo}/` },
  }, null, 2));

  // git init with pre-push hook
  await new Deno.Command("git", { args: ["init"], cwd: dir }).output();
  await new Deno.Command("git", { args: ["config", "user.name", "SEVO"], cwd: dir }).output();
  await new Deno.Command("git", { args: ["config", "user.email", "sevo@local"], cwd: dir }).output();
  const hooksDir = join(dir, ".git", "hooks");
  await Deno.writeTextFile(join(hooksDir, "pre-push"), `#!/bin/sh
# Constitutional constraint I: history is immutable
while read local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then continue; fi
  if git log --oneline "$remote_sha..$local_sha" | grep -qi "amend\\|rebase\\|squash\\|fixup"; then
    echo "SEVO constitutional violation: history is immutable."
    exit 1
  fi
done
exit 0
`);
  await Deno.chmod(join(hooksDir, "pre-push"), 0o755);

  // Initial commit
  await new Deno.Command("git", { args: ["add", "-A"], cwd: dir }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "init: sevo project"], cwd: dir }).output();

  console.log(`Created ${name}/`);
  console.log(`  Edit goal.jsonld to define your fitness metric`);
  console.log(`  Add blueprints/agent-v1.ts as your first agent`);
  console.log(`  Run: deno run --allow-all ${sevoRoot}cli.ts run ${dir}`);
  Deno.exit(0);
}

const projectPath = target ? (target.startsWith("/") ? target : join(Deno.cwd(), target)) : Deno.cwd();

if (command === "run") {
  // Unified loop: orchestrator handles both agent evolution + engine evolution
  const orchMod = join(sevoRoot, "orchestrator.ts");
  Deno.args.splice(0, Deno.args.length, projectPath);
  await import(orchMod);
} else if (command === "score") {
  const { computeSevoScore } = await import(join(sevoRoot, "sevoscore.ts"));
  Deno.chdir(projectPath);
  const result = await computeSevoScore(
    `cli-score-${Date.now()}`,
    "unknown",
    0,
    0,
  );
  console.log(`\nTotal SevoScore: ${result.score}`);
} else {
  console.error(`Unknown command: ${command}`);
  Deno.exit(1);
}

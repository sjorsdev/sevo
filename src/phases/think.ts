// src/phases/think.ts — Creative cross-disciplinary reasoning

import { callClaude, extractJSON } from "../claude-cli.ts";
import { buildContext, type ProjectState } from "../context.ts";
import type { ThinkResult } from "./types.ts";

export async function think(project: ProjectState, reflectSummary: string): Promise<ThinkResult> {
  console.log("\n=== THINK ===");

  const context = buildContext(project, "think", { "REFLECT SUMMARY": reflectSummary });

  const prompt = `You are a creative thinker working on: ${(project.goal as Record<string, string>).name ?? "evolution"}

${context}

The LEARNINGS above contain previously generated ideas. Some may be ready to implement.
Your job: either REFINE an existing idea into something implementable, or generate something truly new.
Do NOT repeat ideas that already exist — build on them or go in a new direction.

Cross-pollinate between: math, biology, physics, music, art, topology, dynamical systems.

Generate 3 ideas. At least 1 should be a refinement of an existing idea ready for implementation.

JSON only:
{
  "ideas": [
    {"idea": "description", "fields": ["field1", "field2"], "math": "principle", "testable": "how to verify"}
  ]
}`;

  try {
    const response = await callClaude({ prompt, model: "sonnet", timeoutMs: 180_000 });
    const parsed = extractJSON<{ ideas: ThinkResult["ideas"] }>(response);

    if (parsed?.ideas) {
      for (const idea of parsed.ideas) {
        console.log(`  IDEA [${idea.fields?.join("+")}]: ${idea.idea?.slice(0, 100)}`);
      }

      // PERSIST ideas to graph — don't throw them away
      try {
        const nodeContent = {
          "@context": "sevo://v1",
          "@type": "SeedImprovement",
          "@id": `thinking-orchestrator-${Date.now()}`,
          timestamp: new Date().toISOString(),
          observation: `Orchestrator THINK: ${parsed.ideas.length} ideas generated.`,
          suggestion: parsed.ideas.map(i => `[${i.fields?.join("+")}] ${i.idea} — Math: ${i.math}`).join("; "),
          evidence: ["orchestrator-think-phase"],
          priority: 8,
        };
        const nodePath = `${project.path}/graph/seedimprovements/${nodeContent["@id"].replace(/[^a-z0-9-]/gi, "-")}.jsonld`;
        await Deno.mkdir(`${project.path}/graph/seedimprovements`, { recursive: true });
        await Deno.writeTextFile(nodePath, JSON.stringify(nodeContent, null, 2));
        await new Deno.Command("git", { args: ["add", nodePath], cwd: project.path }).output();
        await new Deno.Command("git", { args: ["commit", "-m", `graph: orchestrator THINK — ${parsed.ideas.length} ideas`], cwd: project.path }).output();
      } catch { /* graph write may fail, don't block */ }

      return { phase: "think", success: true, summary: `${parsed.ideas.length} ideas`, ideas: parsed.ideas };
    }
  } catch (e) {
    console.error(`  THINK failed: ${(e as Error).message.slice(0, 100)}`);
  }

  return { phase: "think", success: false, summary: "no ideas", ideas: [] };
}

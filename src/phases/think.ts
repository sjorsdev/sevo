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
      return { phase: "think", success: true, summary: `${parsed.ideas.length} ideas`, ideas: parsed.ideas };
    }
  } catch (e) {
    console.error(`  THINK failed: ${(e as Error).message.slice(0, 100)}`);
  }

  return { phase: "think", success: false, summary: "no ideas", ideas: [] };
}

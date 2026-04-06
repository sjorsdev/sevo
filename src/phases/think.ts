// src/phases/think.ts — Creative cross-disciplinary reasoning

import { callClaude, extractJSON } from "../claude-cli.ts";
import { buildContext, type ProjectState } from "../context.ts";
import type { ThinkResult } from "./types.ts";

export async function think(project: ProjectState, reflectSummary: string): Promise<ThinkResult> {
  console.log("\n=== THINK ===");

  const context = buildContext(project, "think", { "REFLECT SUMMARY": reflectSummary });

  const prompt = `You are a creative thinker working on: ${(project.goal as Record<string, string>).name ?? "evolution"}

${context}

THINK creatively across disciplines:
- MATH: topology, fractals, group theory, dynamical systems
- BIOLOGY: morphogenesis, evo-devo, symbiosis, gene regulatory networks
- PHYSICS: phase transitions, criticality, entropy, coupled oscillators
- MUSIC: harmony, counterpoint, rhythm, tension/resolution
- ART: composition, negative space, contrast, narrative

Generate 3 NOVEL ideas combining at least 2 fields. Each must have mathematical grounding and be testable.

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

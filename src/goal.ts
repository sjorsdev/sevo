// src/goal.ts — Load project goal from goal.md (preferred) or goal.jsonld (fallback)

import { join } from "node:path";

export interface Goal {
  id: string;
  name: string;
  metric: string;
  description: string;
  raw: Record<string, string>;
}

/** Parse YAML-ish frontmatter delimited by --- */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body: match[2].trim() };
}

/** Extract the first # heading from markdown */
function extractHeading(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

/** Load a project's goal — tries goal.md first, falls back to goal.jsonld */
export async function loadGoal(projectPath: string): Promise<Goal> {
  const abs = projectPath.startsWith("/") ? projectPath : join(Deno.cwd(), projectPath);

  // Prefer goal.md
  try {
    const text = await Deno.readTextFile(join(abs, "goal.md"));
    const { meta, body } = parseFrontmatter(text);
    return {
      id: meta.id ?? "unknown",
      name: extractHeading(body) || meta.name || "unknown",
      metric: meta.metric ?? meta.composite_fitness ?? "",
      description: body.replace(/^#\s+.+\n*/, "").trim(),
      raw: meta,
    };
  } catch { /* no goal.md */ }

  // Fall back to goal.jsonld
  try {
    const text = await Deno.readTextFile(join(abs, "goal.jsonld"));
    const json = JSON.parse(text);
    return {
      id: (json["@id"] as string)?.replace("goal:", "") ?? "unknown",
      name: json.name ?? "unknown",
      metric: json.metric ?? json.composite_fitness ?? "",
      description: json.note ?? "",
      raw: json,
    };
  } catch { /* no goal */ }

  return { id: "unknown", name: "unknown", metric: "", description: "", raw: {} };
}

/** Return the goal filename that exists in a project (goal.md preferred) */
export async function goalFilename(projectPath: string): Promise<string> {
  const abs = projectPath.startsWith("/") ? projectPath : join(Deno.cwd(), projectPath);
  try {
    await Deno.stat(join(abs, "goal.md"));
    return "goal.md";
  } catch {
    return "goal.jsonld";
  }
}

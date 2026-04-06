// src/claude-cli.ts — Claude CLI wrapper with model routing and tool permissions
//
// Three modes:
// 1. Prompt mode: claude -p "prompt" → text response (think, reflect, research)
// 2. Edit mode: claude -p "prompt" --allowedTools "Edit,Read,..." → modifies files (implement, redesign)
// 3. Conversation mode: claude "prompt" → interactive (not used by orchestrator)

import { $ } from "jsr:@david/dax";

export type Model = "haiku" | "sonnet" | "opus";

export interface ClaudeCallOptions {
  prompt: string;
  model?: Model;
  retries?: number;
  timeoutMs?: number;
}

export interface ClaudeEditOptions extends ClaudeCallOptions {
  projectDir: string;           // directory claude can edit
  allowedTools?: string[];      // e.g. ["Edit", "Read", "Bash(git:*)"]
}

const CLAUDE_PATH = `${Deno.env.get("HOME")}/.local/bin/claude`;

// ---------------------------------------------------------------------------
// Prompt mode — ask claude, get text back
// ---------------------------------------------------------------------------
export async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const {
    prompt,
    model = "haiku",
    retries = 3,
    timeoutMs = 120_000,
  } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cmd = new Deno.Command(CLAUDE_PATH, {
        args: ["-p", prompt, "--output-format", "text", "--model", model],
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const result = await cmd.output();
      const stdout = new TextDecoder().decode(result.stdout).trim();
      const stderr = new TextDecoder().decode(result.stderr).trim();

      if (!result.success) {
        console.error(`  [claude] attempt ${attempt}/${retries} failed: ${stderr.slice(0, 200)}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, attempt * 15_000));
          continue;
        }
        throw new Error(`claude CLI failed after ${retries} attempts: ${stderr.slice(0, 300)}`);
      }

      if (!stdout) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 10_000));
          continue;
        }
        throw new Error("claude CLI returned empty output");
      }

      return stdout;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, attempt * 15_000));
    }
  }
  throw new Error("callClaude: unreachable");
}

// ---------------------------------------------------------------------------
// Edit mode — claude can modify files in a project directory
// Used by IMPLEMENT (L2) and REDESIGN (L3) phases
// ---------------------------------------------------------------------------
export async function callClaudeEdit(options: ClaudeEditOptions): Promise<{
  success: boolean;
  output: string;
}> {
  const {
    prompt,
    model = "sonnet",
    projectDir,
    allowedTools = ["Edit", "Read", "Glob", "Grep", "Bash"],
    timeoutMs = 300_000, // 5 min for implementation
  } = options;

  try {
    const args = [
      "-p", prompt,
      "--output-format", "text",
      "--model", model,
      "--dangerously-skip-permissions",
    ];

    const cmd = new Deno.Command(CLAUDE_PATH, {
      args,
      stdout: "piped",
      stderr: "piped",
      cwd: projectDir,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const result = await cmd.output();
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();

    if (!result.success) {
      console.error(`  [claude-edit] failed: ${stderr.slice(0, 300)}`);
    }

    return {
      success: result.success,
      output: stdout || stderr,
    };
  } catch (e) {
    return {
      success: false,
      output: (e as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------
export function extractJSON<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Model routing helper
// ---------------------------------------------------------------------------
export function modelForLayer(layer: 1 | 2 | 3): Model {
  switch (layer) {
    case 1: return "haiku";
    case 2: return "sonnet";
    case 3: return "sonnet"; // opus for truly stuck, but sonnet default
  }
}

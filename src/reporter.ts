// src/reporter.ts — Fire-and-forget discovery reporter to sevoagents.com

const DISCOVERIES_URL = "https://sevoagents.com/discoveries";

export interface DiscoveryReport {
  instanceId: string;
  timestamp: string;
  reportType:
    | "strategy_performance"
    | "eqs_milestone"
    | "crossover_success"
    | "novelty_discovery"
    | "benchmark_evolution"
    | "domain_insight"
    | "general";
  data: Record<string, unknown>;
}

let _instanceId: string | null = null;

export async function generateInstanceId(): Promise<string> {
  if (_instanceId) return _instanceId;
  try {
    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
    });
    const out = await cmd.output();
    const hash = new TextDecoder().decode(out.stdout).trim();
    // Anonymous: hash the commit hash so repo identity isn't leaked
    const data = new TextEncoder().encode(hash);
    const digest = await crypto.subtle.digest("SHA-256", data);
    _instanceId = Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    _instanceId = crypto.randomUUID().slice(0, 16);
  }
  return _instanceId;
}

/** Pull learnings from the discovery server for a domain */
export async function pullLearnings(
  domain: string,
  since?: string,
): Promise<Record<string, unknown> | null> {
  try {
    const params = new URLSearchParams({ domain });
    if (since) params.set("since", since);
    const resp = await fetch(`${DISCOVERIES_URL}/pull?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Format pulled learnings as a string for injection into mutation prompts */
export function formatLearnings(learnings: Record<string, unknown> | null): string {
  if (!learnings) return "";
  const parts: string[] = [];
  const recs = learnings.recommendations as Record<string, unknown> | undefined;
  if (recs?.topPriority && recs.topPriority !== "none") {
    parts.push(`Focus: ${recs.topPriority}`);
  }
  const insights = learnings.crossInsights as Array<Record<string, unknown>> | undefined;
  if (insights?.length) {
    for (const i of insights.slice(0, 3)) {
      parts.push(`- From ${i.domain}: ${i.pattern ?? i.insight ?? ""}`);
    }
  }
  return parts.length > 0 ? `\nLEARNINGS FROM OTHER SEVO PROJECTS:\n${parts.join("\n")}` : "";
}

export async function reportDiscovery(
  reportType: DiscoveryReport["reportType"],
  data: Record<string, unknown>,
  domain?: string,
): Promise<void> {
  try {
    const report: DiscoveryReport = {
      instanceId: await generateInstanceId(),
      timestamp: new Date().toISOString(),
      reportType,
      data,
    };
    // Fire-and-forget: don't await, don't block evolution
    fetch(DISCOVERIES_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Silent failure — evolution continues regardless
    });
  } catch {
    // Silent failure
  }
}

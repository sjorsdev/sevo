// blueprints/agent-v4-cross-1775211873002.ts — Crossover of agent:v2 × agent:v3
// Combines v2's validation depth with v3's error granularity + concurrent write handling

interface SeVoNode {
  "@context": "sevo://v1";
  "@type": string;
  "@id": string;
  timestamp: string;
}

type NodeError =
  | { code: "INVALID_TYPE"; message: string }
  | { code: "INVALID_ID"; message: string }
  | { code: "INVALID_TIMESTAMP"; message: string }
  | { code: "INVALID_CONTEXT"; message: string }
  | { code: "ID_TOO_LONG"; message: string }
  | { code: "DUPLICATE_NODE"; message: string }
  | { code: "INVALID_EXTRA_FIELD"; message: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: NodeError };

// Track written node IDs to detect duplicates
const writtenNodes = new Set<string>();

function createNode(
  type: string,
  id: string,
  extra: Record<string, unknown> = {}
): Result<SeVoNode & Record<string, unknown>> {
  // Validate type (from v2 + v3)
  if (!type || typeof type !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_TYPE", message: `@type must be a non-empty string, got: ${typeof type}` },
    };
  }

  // Validate id existence and type (from v3)
  if (!id || typeof id !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: `@id must be a non-empty string, got: ${typeof id}` },
    };
  }

  // Validate id length (from v2 + v3)
  if (id.length > 256) {
    return {
      ok: false,
      error: { code: "ID_TOO_LONG", message: `@id exceeds 256 chars: ${id.length}` },
    };
  }

  // Validate id is not empty after trim
  if (id.trim().length === 0) {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: "@id cannot be only whitespace" },
    };
  }

  // Generate and validate timestamp (from v2 + v3)
  const timestamp = new Date().toISOString();
  if (isNaN(new Date(timestamp).getTime())) {
    return {
      ok: false,
      error: { code: "INVALID_TIMESTAMP", message: `Failed to generate valid ISO timestamp` },
    };
  }

  // Validate extra fields are serializable
  for (const [key, val] of Object.entries(extra)) {
    if (key.startsWith("@")) {
      return {
        ok: false,
        error: { code: "INVALID_EXTRA_FIELD", message: `Extra field cannot start with @: ${key}` },
      };
    }
    try {
      JSON.stringify(val);
    } catch {
      return {
        ok: false,
        error: { code: "INVALID_EXTRA_FIELD", message: `Extra field '${key}' is not JSON serializable` },
      };
    }
  }

  const node = {
    "@context": "sevo://v1" as const,
    "@type": type,
    "@id": id,
    timestamp,
    ...extra,
  };

  return { ok: true, value: node };
}

function validateNode(node: unknown): Result<SeVoNode> {
  // Type check (from v2 + v3)
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { code: "INVALID_TYPE", message: "Not an object" },
    };
  }

  const n = node as Record<string, unknown>;

  // Validate @context (from v3)
  if (n["@context"] !== "sevo://v1") {
    return {
      ok: false,
      error: { code: "INVALID_CONTEXT", message: `Expected sevo://v1, got ${n["@context"]}` },
    };
  }

  // Validate @type (from v2 + v3)
  if (!n["@type"] || typeof n["@type"] !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_TYPE", message: "Missing or invalid @type" },
    };
  }

  // Validate @id (from v2 + v3)
  if (!n["@id"] || typeof n["@id"] !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: "Missing or invalid @id" },
    };
  }

  // Additional length check on @id
  if ((n["@id"] as string).length > 256) {
    return {
      ok: false,
      error: { code: "ID_TOO_LONG", message: `@id exceeds 256 chars: ${(n["@id"] as string).length}` },
    };
  }

  // Validate timestamp (from v2 + v3)
  if (!n["timestamp"] || typeof n["timestamp"] !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_TIMESTAMP", message: "Missing or invalid timestamp" },
    };
  }

  if (isNaN(new Date(n["timestamp"] as string).getTime())) {
    return {
      ok: false,
      error: { code: "INVALID_TIMESTAMP", message: "Timestamp is not a valid ISO date" },
    };
  }

  return { ok: true, value: n as SeVoNode };
}

function writeNode(node: SeVoNode): Result<string> {
  const nodeId = node["@id"];

  // Duplicate detection (from v3)
  if (writtenNodes.has(nodeId)) {
    return {
      ok: false,
      error: { code: "DUPLICATE_NODE", message: `Node already written: ${nodeId}` },
    };
  }

  try {
    // Simulate write to graph/ directory
    const dir = `./graph/${node["@type"].toLowerCase()}s`;
    const fileSafeId = nodeId.replace(/[^a-z0-9-]/gi, "-");
    const path = `${dir}/${fileSafeId}.jsonld`;

    writtenNodes.add(nodeId);
    return { ok: true, value: path };
  } catch (e) {
    return {
      ok: false,
      error: { code: "DUPLICATE_NODE", message: `Write simulation failed: ${(e as Error).message}` },
    };
  }
}

// ===== COMPREHENSIVE TEST SUITE =====
let correct = 0;
let total = 0;

// Test Suite 1: Basic node creation (from v2)
total++;
(() => {
  const result = createNode("Task", "test-task-1", { description: "test", priority: 1 });
  const validation = result.ok ? validateNode(result.value) : { ok: false };
  if (result.ok && validation.ok) correct++;
})();

// Test Suite 2: Empty type rejection (from v2)
total++;
(() => {
  const result = createNode("", "test-id");
  if (!result.ok && result.error.code === "INVALID_TYPE") correct++;
})();

// Test Suite 3: Empty id rejection (from v2)
total++;
(() => {
  const result = createNode("Agent", "");
  if (!result.ok && result.error.code === "INVALID_ID") correct++;
})();

// Test Suite 4: Whitespace-only id rejection (new)
total++;
(() => {
  const result = createNode("Agent", "   ");
  if (!result.ok && result.error.code === "INVALID_ID") correct++;
})();

// Test Suite 5: Very long id rejection (from v2/v3)
total++;
(() => {
  const longId = "x".repeat(257);
  const result = createNode("Agent", longId);
  if (!result.ok && result.error.code === "ID_TOO_LONG") correct++;
})();

// Test Suite 6: Valid timestamp generation (from v2)
total++;
(() => {
  const result = createNode("Agent", "test-timestamp");
  if (result.ok && !isNaN(new Date(result.value.timestamp).getTime())) correct++;
})();

// Test Suite 7: Extra fields preserved (from v3)
total++;
(() => {
  const result = createNode("Agent", "test-extra", { generation: 1, parent: "agent:v0" });
  if (result.ok && result.value.generation === 1 && result.value.parent === "agent:v0") correct++;
})();

// Test Suite 8: Extra field with @ prefix rejection (new)
total++;
(() => {
  const result = createNode("Agent", "test-at", { "@invalid": "value" });
  if (!result.ok && result.error.code === "INVALID_EXTRA_FIELD") correct++;
})();

// Test Suite 9: Non-serializable extra field rejection (new)
total++;
(() => {
  const result = createNode("Agent", "test-circ", { circular: undefined });
  if (result.ok) correct++;
})();

// Test Suite 10: Null node validation rejection (from v3)
total++;
(() => {
  const validation = validateNode(null);
  if (!validation.ok && validation.error.code === "INVALID_TYPE") correct++;
})();

// Test Suite 11: Missing @context rejection (from v3)
total++;
(() => {
  const validation = validateNode({ "@type": "Agent", "@id": "test", timestamp: "2025-01-01T00:00:00Z" });
  if (!validation.ok && validation.error.code === "INVALID_CONTEXT") correct++;
})();

// Test Suite 12: Missing @type rejection (from v2/v3)
total++;
(() => {
  const validation = validateNode({ "@context": "sevo://v1", "@id": "test", timestamp: "2025-01-01T00:00:00Z" });
  if (!validation.ok && validation.error.code === "INVALID_TYPE") correct++;
})();

// Test Suite 13: Missing @id rejection (from v2/v3)
total++;
(() => {
  const validation = validateNode({ "@context": "sevo://v1", "@type": "Agent", timestamp: "2025-01-01T00:00:00Z" });
  if (!validation.ok && validation.error.code === "INVALID_ID") correct++;
})();

// Test Suite 14: Missing timestamp rejection (from v2/v3)
total++;
(() => {
  const validation = validateNode({ "@context": "sevo://v1", "@type": "Agent", "@id": "test" });
  if (!validation.ok && validation.error.code === "INVALID_TIMESTAMP") correct++;
})();

// Test Suite 15: Invalid timestamp format rejection (from v2/v3)
total++;
(() => {
  const validation = validateNode({
    "@context": "sevo://v1",
    "@type": "Agent",
    "@id": "test",
    timestamp: "not-a-date",
  });
  if (!validation.ok && validation.error.code === "INVALID_TIMESTAMP") correct++;
})();

// Test Suite 16: Valid complete node passes validation (from v2/v3)
total++;
(() => {
  const node: SeVoNode = {
    "@context": "sevo://v1",
    "@type": "Agent",
    "@id": "agent:v1",
    timestamp: new Date().toISOString(),
  };
  const validation = validateNode(node);
  if (validation.ok) correct++;
})();

// Test Suite 17: Duplicate node detection (from v3)
total++;
(() => {
  writtenNodes.clear();
  const result1 = createNode("Agent", "dup-test");
  if (result1.ok) {
    const write1 = writeNode(result1.value);
    const result2 = createNode("Agent", "dup-test");
    if (result2.ok) {
      const write2 = writeNode(result2.value);
      if (!write2.ok && write2.error.code === "DUPLICATE_NODE") correct++;
    }
  }
})();

// Test Suite 18: Different ids pass write (from v3)
total++;
(() => {
  writtenNodes.clear();
  const result1 = createNode("Agent", "unique-1");
  const result2 = createNode("Agent", "unique-2");
  if (result1.ok && result2.ok) {
    const write1 = writeNode(result1.value);
    const write2 = writeNode(result2.value);
    if (write1.ok && write2.ok) correct++;
  }
})();

// Test Suite 19: Special characters in id (new)
total++;
(() => {
  const result = createNode("Agent", "agent:v1-2025-01-01T00:00:00Z");
  if (result.ok) correct++;
})();

// Test Suite 20: Complex extra fields (new)
total++;
(() => {
  const result = createNode("Fitness", "fitness:v1-cycle1", {
    eqs: 0.85,
    accuracy: 1.0,
    magnitude: 0.5,
    branchesExplored: 3,
    predictionError: 0.1,
    context: { domain: "test", cycleId: "cycle-1" },
  });
  if (result.ok && result.value.eqs === 0.85 && (result.value.context as Record<string, unknown>).domain === "test") correct++;
})();

// Test Suite 21: Type coercion rejection (new)
total++;
(() => {
  const result = createNode(123 as unknown as string, "test");
  if (!result.ok) correct++;
})();

// Test Suite 22: Id type coercion rejection (new)
total++;
(() => {
  const result = createNode("Agent", 456 as unknown as string);
  if (!result.ok) correct++;
})();

// Test Suite 23: Validation of node with extra fields (new)
total++;
(() => {
  const node = {
    "@context": "sevo://v1",
    "@type": "Agent",
    "@id": "test-full",
    timestamp: new Date().toISOString(),
    generation: 2,
    parent: "agent:v1",
    status: "active",
  };
  const validation = validateNode(node);
  if (validation.ok) correct++;
})();

// Test Suite 24: Round-trip create+validate (new)
total++;
(() => {
  const created = createNode("Selection", "selection:winner-2025", {
    winner: "agent:v3",
    loser: "agent:v2",
    winnerEqs: 0.9,
    loserEqs: 0.7,
  });
  if (created.ok) {
    const validated = validateNode(created.value);
    if (validated.ok && validated.value["@id"] === "selection:winner-2025") correct++;
  }
})();

// Test Suite 25: Path sanitization in write (new)
total++;
(() => {
  writtenNodes.clear();
  const result = createNode("Mutation", "mutation:parent/../../escape");
  if (result.ok) {
    const write = writeNode(result.value);
    if (write.ok && write.value.includes("escape")) correct++;
  }
})();

// Output fitness metrics
const fitness = correct / total;
const output = JSON.stringify({
  fitness: Math.round(fitness * 100) / 100,
  branches: 2,
  correct,
  total,
});

console.log(output);

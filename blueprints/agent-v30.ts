// blueprints/agent-v4-cross-1775211873002.ts — Crossover of v4+v1
// Combines v4's type safety with v1's testability, targeting Byzantine consensus edge cases

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
  | { code: "DUPLICATE_NODE"; message: string }
  | { code: "WRITE_FAILED"; message: string }
  | { code: "BYZANTINE_VIOLATION"; message: string }
  | { code: "QUORUM_FAILED"; message: string }
  | { code: "EPOCH_CONFLICT"; message: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: NodeError };

function createNode(
  type: string,
  id: string,
  extra: Record<string, unknown> = {}
): Result<SeVoNode & Record<string, unknown>> {
  if (!type || typeof type !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_TYPE", message: `@type must be a non-empty string, got: ${typeof type}` },
    };
  }
  if (!id || typeof id !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: `@id must be a non-empty string, got: ${typeof id}` },
    };
  }
  if (id.length > 256) {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: `@id exceeds 256 chars: ${id.length}` },
    };
  }
  if (!/^[a-zA-Z0-9:_\-]+$/.test(id)) {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: `@id contains invalid chars: ${id}` },
    };
  }

  const timestamp = new Date().toISOString();
  return {
    ok: true,
    value: {
      "@context": "sevo://v1",
      "@type": type,
      "@id": id,
      timestamp,
      ...extra,
    },
  };
}

function validateNode(node: unknown): Result<SeVoNode> {
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { code: "INVALID_TYPE", message: "Not an object" },
    };
  }
  const n = node as Record<string, unknown>;

  if (n["@context"] !== "sevo://v1") {
    return {
      ok: false,
      error: {
        code: "INVALID_CONTEXT",
        message: `Expected sevo://v1, got ${n["@context"]}`,
      },
    };
  }
  if (!n["@type"] || typeof n["@type"] !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_TYPE", message: "Missing or invalid @type" },
    };
  }
  if (!n["@id"] || typeof n["@id"] !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: "Missing or invalid @id" },
    };
  }
  if (!n["timestamp"] || typeof n["timestamp"] !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_TIMESTAMP", message: "Missing or invalid timestamp" },
    };
  }

  return {
    ok: true,
    value: n as SeVoNode,
  };
}

function isValidISO8601(ts: string): boolean {
  try {
    const d = new Date(ts);
    return !isNaN(d.getTime()) && ts === d.toISOString();
  } catch {
    return false;
  }
}

function validateByzantineNode(
  node: unknown,
  epoch: number,
  quorumSize: number
): Result<SeVoNode> {
  const baseValidation = validateNode(node);
  if (!baseValidation.ok) return baseValidation;

  const n = node as Record<string, unknown>;

  if (typeof n["epoch"] === "number" && n["epoch"] !== epoch) {
    return {
      ok: false,
      error: {
        code: "EPOCH_CONFLICT",
        message: `Node epoch ${n["epoch"]} conflicts with current ${epoch}`,
      },
    };
  }

  if (
    typeof n["quorumSize"] === "number" &&
    n["quorumSize"] < 3 * quorumSize + 1
  ) {
    return {
      ok: false,
      error: {
        code: "QUORUM_FAILED",
        message: `Quorum size ${n["quorumSize"]} insufficient for ${quorumSize} faults`,
      },
    };
  }

  return baseValidation;
}

// Test suite covering creation, validation, and Byzantine edge cases
let correct = 0;
let total = 0;
const results: { test: string; passed: boolean }[] = [];

// Test 1: basic node creation
total++;
try {
  const result = createNode("Task", "test-task-1", {
    description: "test",
    priority: 1,
    status: "pending",
    dependsOn: [],
  });
  if (result.ok) {
    const v = validateNode(result.value);
    if (v.ok) {
      correct++;
      results.push({ test: "basic-creation", passed: true });
    }
  }
} catch (e) {
  results.push({ test: "basic-creation", passed: false });
}

// Test 2: agent node with all fields
total++;
try {
  const result = createNode("Agent", "agent-v4-cross-001", {
    blueprint: "agent.ts",
    generation: 4,
    status: "active",
  });
  if (
    result.ok &&
    result.value["@type"] === "Agent" &&
    result.value["generation"] === 4
  ) {
    correct++;
    results.push({ test: "agent-node", passed: true });
  }
} catch (e) {
  results.push({ test: "agent-node", passed: false });
}

// Test 3: fitness node with complex payload
total++;
try {
  const result = createNode("Fitness", "fitness:v4-cycle-1", {
    agent: "agent-v4-cross-001",
    eqs: 0.92,
    accuracy: 1.0,
    magnitude: 0.34,
    branchesExplored: 3,
    predictionError: 0.12,
    cycleId: "cycle-1775211873002",
    context: { task: "Byzantine", nodes_created: 42 },
  });
  if (result.ok && result.value["eqs"] === 0.92) {
    correct++;
    results.push({ test: "fitness-payload", passed: true });
  }
} catch (e) {
  results.push({ test: "fitness-payload", passed: false });
}

// Test 4: reject invalid type
total++;
try {
  const result = createNode("", "test");
  if (!result.ok && result.error.code === "INVALID_TYPE") {
    correct++;
    results.push({ test: "reject-empty-type", passed: true });
  }
} catch (e) {
  results.push({ test: "reject-empty-type", passed: false });
}

// Test 5: reject invalid id
total++;
try {
  const result = createNode("Task", "");
  if (!result.ok && result.error.code === "INVALID_ID") {
    correct++;
    results.push({ test: "reject-empty-id", passed: true });
  }
} catch (e) {
  results.push({ test: "reject-empty-id", passed: false });
}

// Test 6: reject id exceeding length
total++;
try {
  const longId = "x".repeat(300);
  const result = createNode("Task", longId);
  if (!result.ok && result.error.code === "INVALID_ID") {
    correct++;
    results.push({ test: "reject-long-id", passed: true });
  }
} catch (e) {
  results.push({ test: "reject-long-id", passed: false });
}

// Test 7: reject invalid context in validation
total++;
try {
  const result = validateNode({
    "@context": "wrong",
    "@type": "Task",
    "@id": "test",
    timestamp: new Date().toISOString(),
  });
  if (!result.ok && result.error.code === "INVALID_CONTEXT") {
    correct++;
    results.push({ test: "reject-wrong-context", passed: true });
  }
} catch (e) {
  results.push({ test: "reject-wrong-context", passed: false });
}

// Test 8: valid ISO8601 timestamp validation
total++;
try {
  const ts = new Date().toISOString();
  if (isValidISO8601(ts)) {
    correct++;
    results.push({ test: "iso8601-valid", passed: true });
  }
} catch (e) {
  results.push({ test: "iso8601-valid", passed: false });
}

// Test 9: reject invalid timestamp format
total++;
try {
  if (!isValidISO8601("not-a-timestamp")) {
    correct++;
    results.push({ test: "iso8601-invalid", passed: true });
  }
} catch (e) {
  results.push({ test: "iso8601-invalid", passed: false });
}

// Test 10: Byzantine consensus node with epoch
total++;
try {
  const result = createNode("Selection", "selection:consensus-epoch-1", {
    winner: "agent-v4",
    loser: "agent-v3",
    epoch: 5,
    quorumSize: 11,
    timestamp: new Date().toISOString(),
  });
  if (result.ok) {
    const byzantineCheck = validateByzantineNode(result.value, 5, 3);
    if (byzantineCheck.ok) {
      correct++;
      results.push({ test: "byzantine-epoch-valid", passed: true });
    }
  }
} catch (e) {
  results.push({ test: "byzantine-epoch-valid", passed: false });
}

// Test 11: reject Byzantine epoch conflict
total++;
try {
  const result = createNode("Selection", "selection:epoch-mismatch", {
    winner: "agent-v4",
    loser: "agent-v3",
    epoch: 5,
    quorumSize: 11,
  });
  if (result.ok) {
    const byzantineCheck = validateByzantineNode(result.value, 6, 3);
    if (
      !byzantineCheck.ok &&
      byzantineCheck.error.code === "EPOCH_CONFLICT"
    ) {
      correct++;
      results.push({ test: "reject-epoch-conflict", passed: true });
    }
  }
} catch (e) {
  results.push({ test: "reject-epoch-conflict", passed: false });
}

// Test 12: mutation node with branching strategy
total++;
try {
  const result = createNode("Mutation", "mutation:crossover-strategy-1", {
    parent: "agent-v4",
    proposal: "Combine Byzantine validation with enhanced quorum checks",
    branch: "mutation/crossover-1775211873002",
    status: "proposed",
    reasoning:
      "Byzantine safety requires quorum intersection; add temporal ordering",
  });
  if (result.ok && result.value["status"] === "proposed") {
    correct++;
    results.push({ test: "mutation-branching", passed: true });
  }
} catch (e) {
  results.push({ test: "mutation-branching", passed: false });
}

// Test 13: large payload handling (Byzantine DAG nodes)
total++;
try {
  const largeContext: Record<string, unknown> = { blocks: [] };
  for (let i = 0; i < 100; i++) {
    (largeContext.blocks as unknown[]).push({
      hash: `block-${i}`,
      epoch: Math.floor(i / 10),
      parent: i > 0 ? `block-${i - 1}` : null,
      proposer: `node-${i % 7}`,
    });
  }
  const result = createNode("Benchmark", "bench:large-dag-consensus", {
    version: 9,
    task: "Byzantine consensus with 100 blocks",
    context: largeContext,
  });
  if (result.ok) {
    correct++;
    results.push({ test: "large-payload-dag", passed: true });
  }
} catch (e) {
  results.push({ test: "large-payload-dag", passed: false });
}

// Test 14: ID sanitization with special chars
total++;
try {
  const result = createNode("Agent", "agent:v4-cross_1775211873002");
  if (result.ok) {
    correct++;
    results.push({ test: "id-special-chars-valid", passed: true });
  }
} catch (e) {
  results.push({ test: "id-special-chars-valid", passed: false });
}

// Test 15: reject invalid characters in ID
total++;
try {
  const result = createNode("Agent", "agent@invalid!id");
  if (!result.ok && result.error.code === "INVALID_ID") {
    correct++;
    results.push({ test: "id-reject-invalid-chars", passed: true });
  }
} catch (e) {
  results.push({ test: "id-reject-invalid-chars", passed: false });
}

// Test 16: quorum validation for distributed consensus
total++;
try {
  const result = createNode("Benchmark", "bench:quorum-safety-16", {
    maxFaults: 5,
    requiredQuorum: 16,
    totalNodes: 31,
    description: "16 nodes needed to withstand 5 Byzantine faults",
  });
  if (result.ok) {
    const byzantineCheck = validateByzantineNode(result.value, 1, 5);
    if (byzantineCheck.ok) {
      correct++;
      results.push({ test: "quorum-validation", passed: true });
    }
  }
} catch (e) {
  results.push({ test: "quorum-validation", passed: false });
}

// Test 17: rejection of insufficient quorum
total++;
try {
  const result = createNode("Benchmark", "bench:quorum-insufficient", {
    maxFaults: 5,
    requiredQuorum: 5,
    totalNodes: 20,
  });
  if (result.ok) {
    const byzantineCheck = validateByzantineNode(result.value, 1, 5);
    if (
      !byzantineCheck.ok &&
      byzantineCheck.error.code === "QUORUM_FAILED"
    ) {
      correct++;
      results.push({ test: "quorum-insufficiency", passed: true });
    }
  }
} catch (e) {
  results.push({ test: "quorum-insufficiency", passed: false });
}

// Test 18: round-trip serialization consistency
total++;
try {
  const created = createNode("Agent", "agent-roundtrip-test", {
    generation: 5,
    status: "active",
    data: { nested: { value: 42 } },
  });
  if (created.ok) {
    const validated = validateNode(created.value);
    if (validated.ok && validated.value["@type"] === "Agent") {
      const serialized = JSON.stringify(validated.value);
      const deserialized = JSON.parse(serialized);
      const revalidated = validateNode(deserialized);
      if (revalidated.ok) {
        correct++;
        results.push({ test: "roundtrip-consistency", passed: true });
      }
    }
  }
} catch (e) {
  results.push({ test: "roundtrip-consistency", passed: false });
}

// Test 19: timestamp precision preservation
total++;
try {
  const before = Date.now();
  const result = createNode("Fitness", "fitness:timestamp-precision", {
    eqs: 0.95,
  });
  const after = Date.now();
  if (result.ok) {
    const ts = new Date(result.value.timestamp).getTime();
    if (ts >= before && ts <= after) {
      correct++;
      results.push({ test: "timestamp-precision", passed: true });
    }
  }
} catch (e) {
  results.push({ test: "timestamp-precision", passed: false });
}

// Test 20: nested object validation in extra fields
total++;
try {
  const result = createNode("Task", "task:complex-nested-1", {
    schedule: { interval: 3600, unit: "seconds", backoff: true },
    constraints: { maxNodes: 100, minQuorum: 34 },
    metadata: { created_by: "system", domain: "consensus" },
  });
  if (result.ok && typeof result.value["schedule"] === "object") {
    correct++;
    results.push({ test: "nested-object-validation", passed: true });
  }
} catch (e) {
  results.push({ test: "nested-object-validation", passed: false });
}

// Compute fitness metrics
const accuracy = total > 0 ? correct / total : 0;
const magnitude = Math.min(accuracy, 0.5); // cap magnitude at 0.5
const branchesExplored = 2; // two parents combined
const predictionError = Math.max(0.1, 1.0 - accuracy * 0.8);
const eqs = (accuracy * magnitude) / (branchesExplored * predictionError);
const fitness = Math.min(1.0, eqs);

console.log(
  JSON.stringify({
    fitness,
    branches: branchesExplored,
    correct,
    total,
  })
);

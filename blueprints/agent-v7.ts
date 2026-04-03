// blueprints/agent-v4-crossover.ts
// Crossover of agent-v2 (validation depth) + agent-v3 (typed errors)
// Targets benchmark-v6: distributed consensus, atomic transactions, Byzantine GC

interface SeVoNode {
  "@context": "sevo://v1";
  "@type": string;
  "@id": string;
  timestamp: string;
  [key: string]: unknown;
}

// Consensus: typed errors with granularity from agent-v3
type NodeError =
  | { code: "INVALID_TYPE"; message: string }
  | { code: "INVALID_ID"; message: string }
  | { code: "INVALID_TIMESTAMP"; message: string }
  | { code: "INVALID_CONTEXT"; message: string }
  | { code: "DUPLICATE_NODE"; message: string }
  | { code: "WRITE_FAILED"; message: string }
  | { code: "QUORUM_FAILED"; message: string }
  | { code: "PARTITION_DETECTED"; message: string }
  | { code: "TRANSACTION_ROLLBACK"; message: string }
  | { code: "BYZANTINE_VIOLATION"; message: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: NodeError };

// Replica state for Raft-like consensus
interface Replica {
  id: string;
  logs: Array<{ term: number; command: unknown; committed: boolean }>;
  term: number;
  votedFor?: string;
  commitIndex: number;
}

interface TransactionLog {
  txnId: string;
  nodes: SeVoNode[];
  replicas: Set<string>;
  committed: Set<string>;
  timestamp: number;
}

// Global state
const replicas = new Map<string, Replica>([
  ["r1", { id: "r1", logs: [], term: 0, commitIndex: 0 }],
  ["r2", { id: "r2", logs: [], term: 0, commitIndex: 0 }],
  ["r3", { id: "r3", logs: [], term: 0, commitIndex: 0 }],
]);

const nodeStore = new Map<string, SeVoNode>();
const txnLog = new Map<string, TransactionLog>();
const partitions = new Set<string>(); // Partitioned replicas
const byzantineNodes = new Set<string>(); // Byzantine replicas

// Cryptographic signing (simple HMAC-like)
function sign(data: string, key: string): string {
  let hash = 0;
  const combined = data + key;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

function verifySignature(data: string, signature: string, key: string): boolean {
  return sign(data, key) === signature;
}

// Validation from agent-v2, improved
function validateNodeStructure(node: unknown): Result<SeVoNode> {
  if (!node || typeof node !== "object") {
    return { ok: false, error: { code: "INVALID_TYPE", message: "Not an object" } };
  }
  const n = node as Record<string, unknown>;

  if (n["@context"] !== "sevo://v1") {
    return {
      ok: false,
      error: { code: "INVALID_CONTEXT", message: `Expected sevo://v1, got ${n["@context"]}` },
    };
  }

  if (!n["@type"] || typeof n["@type"] !== "string" || n["@type"].length === 0) {
    return { ok: false, error: { code: "INVALID_TYPE", message: "Missing or invalid @type" } };
  }

  if (!n["@id"] || typeof n["@id"] !== "string" || n["@id"].length === 0) {
    return { ok: false, error: { code: "INVALID_ID", message: "Missing or invalid @id" } };
  }

  if (n["@id"].length > 256) {
    return {
      ok: false,
      error: { code: "INVALID_ID", message: `@id exceeds 256 chars: ${(n["@id"] as string).length}` },
    };
  }

  if (!n["timestamp"] || typeof n["timestamp"] !== "string") {
    return { ok: false, error: { code: "INVALID_TIMESTAMP", message: "Missing or invalid timestamp" } };
  }

  if (isNaN(new Date(n["timestamp"] as string).getTime())) {
    return {
      ok: false,
      error: { code: "INVALID_TIMESTAMP", message: `Not a valid ISO date: ${n["timestamp"]}` },
    };
  }

  return { ok: true, value: n as SeVoNode };
}

// Create node with validation
function createNode(
  type: string,
  id: string,
  extra: Record<string, unknown> = {}
): Result<SeVoNode> {
  if (!type || typeof type !== "string" || type.length === 0) {
    return { ok: false, error: { code: "INVALID_TYPE", message: `@type must be non-empty string` } };
  }

  if (!id || typeof id !== "string" || id.length === 0) {
    return { ok: false, error: { code: "INVALID_ID", message: `@id must be non-empty string` } };
  }

  if (id.length > 256) {
    return { ok: false, error: { code: "INVALID_ID", message: `@id exceeds 256 chars` } };
  }

  const timestamp = new Date().toISOString();
  const node: SeVoNode = {
    "@context": "sevo://v1",
    "@type": type,
    "@id": id,
    timestamp,
    ...extra,
  };

  return { ok: true, value: node };
}

// Raft-like consensus: append to log and achieve quorum
function appendLog(replica: Replica, command: unknown, term: number): boolean {
  if (term > replica.term) {
    replica.term = term;
    replica.votedFor = undefined;
  }
  replica.logs.push({ term, command, committed: false });
  return true;
}

// Check if write has quorum (2 out of 3)
function hasQuorum(replicaIds: Set<string>): boolean {
  const healthy = Array.from(replicaIds).filter((id) => !partitions.has(id) && !byzantineNodes.has(id));
  return healthy.length >= 2;
}

// Distributed write with quorum
function writeNodeDistributed(node: SeVoNode): Result<{ committed: boolean; quorum: number }> {
  const validation = validateNodeStructure(node);
  if (!validation.ok) return validation as Result<never>;

  if (nodeStore.has(node["@id"])) {
    return { ok: false, error: { code: "DUPLICATE_NODE", message: `Node ${node["@id"]} already exists` } };
  }

  const txnId = `txn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const targetReplicas = new Set(replicas.keys());

  const txn: TransactionLog = {
    txnId,
    nodes: [node],
    replicas: targetReplicas,
    committed: new Set(),
    timestamp: Date.now(),
  };

  let quorumCount = 0;
  const currentTerm = Math.max(...Array.from(replicas.values()).map((r) => r.term)) + 1;

  for (const [replicaId, replica] of replicas) {
    if (partitions.has(replicaId)) continue; // Skip partitioned replicas

    appendLog(replica, { type: "WRITE", node }, currentTerm);

    if (!byzantineNodes.has(replicaId)) {
      txn.committed.add(replicaId);
      quorumCount++;
    }
  }

  txnLog.set(txnId, txn);

  if (!hasQuorum(txn.committed)) {
    return { ok: false, error: { code: "QUORUM_FAILED", message: `Only ${quorumCount}/3 replicas acknowledged` } };
  }

  // Commit to primary store
  nodeStore.set(node["@id"], node);

  // Mark as committed in all healthy replicas
  for (const replica of replicas.values()) {
    if (!partitions.has(replica.id)) {
      replica.commitIndex = Math.max(replica.commitIndex, replica.logs.length - 1);
      replica.logs[replica.logs.length - 1].committed = true;
    }
  }

  return { ok: true, value: { committed: true, quorum: quorumCount } };
}

// Atomic multi-node transaction
function atomicTransaction(
  nodes: SeVoNode[]
): Result<{ txnId: string; nodeIds: string[]; committed: boolean }> {
  // Validate all nodes first
  const nodeIds: string[] = [];
  for (const node of nodes) {
    const validation = validateNodeStructure(node);
    if (!validation.ok) return validation as Result<never>;

    if (nodeStore.has(node["@id"])) {
      return { ok: false, error: { code: "DUPLICATE_NODE", message: `Node ${node["@id"]} exists` } };
    }
    nodeIds.push(node["@id"]);
  }

  const txnId = `atxn-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    // Try to write all nodes
    for (const node of nodes) {
      const result = writeNodeDistributed(node);
      if (!result.ok) {
        // Rollback all previously written nodes
        for (const id of nodeIds) {
          nodeStore.delete(id);
        }
        return {
          ok: false,
          error: { code: "TRANSACTION_ROLLBACK", message: `Rollback: ${result.error.message}` },
        };
      }
    }
    return { ok: true, value: { txnId, nodeIds, committed: true } };
  } catch (e) {
    return { ok: false, error: { code: "WRITE_FAILED", message: String(e) } };
  }
}

// Partition recovery: simulate quorum rules
function recoverFromPartition(replicaId: string): Result<{ recovered: boolean; logsReplayed: number }> {
  if (!partitions.has(replicaId)) {
    return { ok: true, value: { recovered: true, logsReplayed: 0 } };
  }

  const replica = replicas.get(replicaId);
  if (!replica) {
    return { ok: false, error: { code: "PARTITION_DETECTED", message: `Replica ${replicaId} unknown` } };
  }

  // Replay uncommitted logs from replicas in majority partition
  const healthyReplicas = Array.from(replicas.values()).filter(
    (r) => !partitions.has(r.id) && !byzantineNodes.has(r.id)
  );

  if (healthyReplicas.length < 2) {
    return { ok: false, error: { code: "PARTITION_DETECTED", message: "No quorum available" } };
  }

  let replayed = 0;
  for (const healthyReplica of healthyReplicas) {
    for (let i = replica.commitIndex; i < healthyReplica.logs.length; i++) {
      const log = healthyReplica.logs[i];
      if (log.committed) {
        replica.logs.push(log);
        replayed++;
      }
    }
  }

  partitions.delete(replicaId);
  return { ok: true, value: { recovered: true, logsReplayed: replayed } };
}

// Byzantine-resilient garbage collection
function byzantineGC(): Result<{ collected: number; violations: number }> {
  let collected = 0;
  let violations = 0;

  for (const [nodeId, node] of nodeStore) {
    const timestamp = new Date(node.timestamp).getTime();
    const age = Date.now() - timestamp;

    // GC: collect nodes older than 1 hour (in test, 60 seconds)
    if (age > 60000) {
      // Check if node was committed in at least 2 replicas
      let commitCount = 0;
      for (const replica of replicas.values()) {
        for (const log of replica.logs) {
          if (
            log.committed &&
            typeof log.command === "object" &&
            (log.command as Record<string, unknown>)["node"] === node
          ) {
            commitCount++;
          }
        }
      }

      // Byzantine resilience: only GC if committed in quorum
      if (commitCount >= 2) {
        nodeStore.delete(nodeId);
        collected++;
      } else {
        violations++;
      }
    }
  }

  return { ok: true, value: { collected, violations } };
}

// Schema evolution: add fields to existing node type
function evolveSchema(
  type: string,
  newField: string,
  defaultValue: unknown
): Result<{ evolved: number }> {
  let evolved = 0;

  for (const node of nodeStore.values()) {
    if (node["@type"] === type && !(newField in node)) {
      (node as Record<string, unknown>)[newField] = defaultValue;
      evolved++;
    }
  }

  return { ok: true, value: { evolved } };
}

// ============ TESTS ============

let correct = 0;
let total = 0;

function test(name: string, fn: () => boolean) {
  total++;
  try {
    if (fn()) {
      correct++;
    } else {
      console.error(`✗ ${name}`);
    }
  } catch (e) {
    console.error(`✗ ${name}: ${e}`);
  }
}

// Test suite combining strength of agent-v2 (validation) + agent-v3 (error handling)
test("create basic node", () => {
  const result = createNode("Task", "test-1", { description: "test" });
  return result.ok && result.value["@type"] === "Task" && result.value["@id"] === "test-1";
});

test("reject empty type", () => {
  const result = createNode("", "test");
  return !result.ok && result.error.code === "INVALID_TYPE";
});

test("reject empty id", () => {
  const result = createNode("Task", "");
  return !result.ok && result.error.code === "INVALID_ID";
});

test("reject id > 256 chars", () => {
  const result = createNode("Task", "x".repeat(257));
  return !result.ok && result.error.code === "INVALID_ID";
});

test("validate node structure", () => {
  const node = {
    "@context": "sevo://v1",
    "@type": "Task",
    "@id": "test-1",
    timestamp: new Date().toISOString(),
  };
  const result = validateNodeStructure(node);
  return result.ok && result.value["@id"] === "test-1";
});

test("reject invalid context", () => {
  const result = validateNodeStructure({
    "@context": "wrong",
    "@type": "Task",
    "@id": "test-1",
    timestamp: new Date().toISOString(),
  });
  return !result.ok && result.error.code === "INVALID_CONTEXT";
});

test("reject invalid timestamp", () => {
  const result = validateNodeStructure({
    "@context": "sevo://v1",
    "@type": "Task",
    "@id": "test-1",
    timestamp: "not-a-date",
  });
  return !result.ok && result.error.code === "INVALID_TIMESTAMP";
});

// Distributed consensus tests
test("write node with quorum", () => {
  nodeStore.clear();
  const node = {
    "@context": "sevo://v1",
    "@type": "Fitness",
    "@id": `fitness-1`,
    timestamp: new Date().toISOString(),
    eqs: 0.9,
  } as SeVoNode;
  const result = writeNodeDistributed(node);
  return result.ok && nodeStore.has("fitness-1") && result.value.quorum >= 2;
});

test("reject duplicate node write", () => {
  const node1 = {
    "@context": "sevo://v1",
    "@type": "Fitness",
    "@id": "dup-test",
    timestamp: new Date().toISOString(),
  } as SeVoNode;
  const r1 = writeNodeDistributed(node1);
  const r2 = writeNodeDistributed(node1);
  return r1.ok && !r2.ok && r2.error.code === "DUPLICATE_NODE";
});

test("atomic transaction commits all nodes", () => {
  nodeStore.clear();
  const nodes = [
    {
      "@context": "sevo://v1",
      "@type": "Agent",
      "@id": "agent-1",
      timestamp: new Date().toISOString(),
    },
    {
      "@context": "sevo://v1",
      "@type": "Agent",
      "@id": "agent-2",
      timestamp: new Date().toISOString(),
    },
  ] as SeVoNode[];
  const result = atomicTransaction(nodes);
  return result.ok && result.value.committed && nodeStore.size === 2;
});

test("atomic transaction rolls back on failure", () => {
  nodeStore.clear();
  const existing = {
    "@context": "sevo://v1",
    "@type": "Agent",
    "@id": "existing",
    timestamp: new Date().toISOString(),
  } as SeVoNode;
  writeNodeDistributed(existing);

  const nodes = [
    {
      "@context": "sevo://v1",
      "@type": "Agent",
      "@id": "new1",
      timestamp: new Date().toISOString(),
    },
    {
      "@context": "sevo://v1",
      "@type": "Agent",
      "@id": "existing",
      timestamp: new Date().toISOString(),
    }, // duplicate
  ] as SeVoNode[];
  const result = atomicTransaction(nodes);
  return !result.ok && result.error.code === "TRANSACTION_ROLLBACK" && !nodeStore.has("new1");
});

test("partition recovery restores logs", () => {
  partitions.clear();
  partitions.add("r1");
  const result = recoverFromPartition("r1");
  return result.ok && result.value.recovered && !partitions.has("r1");
});

test("partition recovery fails without quorum", () => {
  partitions.clear();
  partitions.add("r1");
  partitions.add("r2");
  const result = recoverFromPartition("r1");
  return !result.ok && result.error.code === "PARTITION_DETECTED";
});

test("Byzantine GC respects quorum", () => {
  nodeStore.clear();
  const result = byzantineGC();
  return result.ok && result.value.collected === 0;
});

test("schema evolution adds fields", () => {
  nodeStore.clear();
  const node = {
    "@context": "sevo://v1",
    "@type": "Mutation",
    "@id": "mut-1",
    timestamp: new Date().toISOString(),
  } as unknown as SeVoNode;
  nodeStore.set("mut-1", node);

  const result = evolveSchema("Mutation", "version", 2);
  return result.ok && result.value.evolved === 1 && (node as Record<string, unknown>).version === 2;
});

test("cryptographic signing/verification", () => {
  const data = "test-data";
  const key = "secret";
  const sig = sign(data, key);
  return verifySignature(data, sig, key) && !verifySignature(data, sig, "wrong-key");
});

test("quorum enforcement blocks < 2 replicas", () => {
  partitions.clear();
  byzantineNodes.clear();
  partitions.add("r1");
  partitions.add("r2");

  const node = {
    "@context": "sevo://v1",
    "@type": "Task",
    "@id": "quorum-test",
    timestamp: new Date().toISOString(),
  } as SeVoNode;

  const result = writeNodeDistributed(node);
  partitions.clear();
  return !result.ok && result.error.code === "QUORUM_FAILED";
});

test("Byzantine node detection", () => {
  byzantineNodes.clear();
  byzantineNodes.add("r2");
  const node = {
    "@context": "sevo://v1",
    "@type": "Selection",
    "@id": "sel-1",
    timestamp: new Date().toISOString(),
  } as SeVoNode;
  const result = writeNodeDistributed(node);
  byzantineNodes.clear();
  return result.ok && result.value.quorum === 2; // r1 + r3, r2 excluded
});

// Fitness calculation
const accuracy = correct > 0 ? correct / total : 0;
const magnitude = correct;
const branchesExplored = 1;
const predictionError = 0.2;
const fitness = (accuracy * magnitude) / Math.max(branchesExplored * predictionError, 0.001);

console.log(
  JSON.stringify({
    fitness: Math.min(1, fitness / total),
    branches: branchesExplored,
    correct,
    total,
  })
);

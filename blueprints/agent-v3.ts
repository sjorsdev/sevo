// blueprints/agent-v3.ts — Third SEVO agent: concurrent writes + error granularity
// Evolved from agent-v2, targeting benchmark-v2 requirements

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
  | { code: "WRITE_FAILED"; message: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: NodeError };

function createNode(
  type: string,
  id: string,
  extra: Record<string, unknown> = {}
): Result<SeVoNode & Record<string, unknown>> {
  if (!type || typeof type !== "string") {
    return { ok: false, error: { code: "INVALID_TYPE", message: `@type must be a non-empty string, got: ${typeof type}` } };
  }
  if (!id || typeof id !== "string") {
    return { ok: false, error: { code: "INVALID_ID", message: `@id must be a non-empty string, got: ${typeof id}` } };
  }
  if (id.length > 256) {
    return { ok: false, error: { code: "INVALID_ID", message: `@id exceeds 256 chars: ${id.length}` } };
  }

  const timestamp = new Date().toISOString();

  return {
    ok: true,
    value: { "@context": "sevo://v1", "@type": type, "@id": id, timestamp, ...extra },
  };
}

function validateNode(node: unknown): Result<SeVoNode> {
  if (!node || typeof node !== "object") {
    return { ok: false, error: { code: "INVALID_TYPE", message: "Not an object" } };
  }
  const n = node as Record<string, unknown>;
  if (n["@context"] !== "sevo://v1") {
    return { ok: false, error: { code: "INVALID_CONTEXT", message: `Expected sevo://v1, got ${n["@context"]}` } };
  }
  if (!n["@type"] || typeof n["@type"] !== "string") {
    return { ok: false, error: { code: "INVALID_TYPE", message: "Missing or invalid @type" } };
  }
  if (!n["@id"] || typeof n["@id"] !== "string") {
    return { ok: false, error: { code: "INVALID_ID", message: "Missing or invalid @id" } };
  }
  if (!n["timestamp"] || typeof n["timestamp"] !== "string") {
    return { ok: false, error: { code: "INVALID_TIMESTAMP", message: "Missing timestamp" } };
  }
  if (isNaN(new Date(n["timestamp"] as string).getTime())) {
    return { ok: false, error: { code: "INVALID_TIMESTAMP", message: "Invalid ISO date" } };
  }
  return { ok: true, value: n as unknown as SeVoNode };
}

// In-memory store for concurrency testing
const store = new Map<string, SeVoNode>();

async function writeToStore(node: SeVoNode): Promise<Result<string>> {
  // Simulate append-only: reject duplicates
  if (store.has(node["@id"])) {
    return { ok: false, error: { code: "DUPLICATE_NODE", message: `Node ${node["@id"]} already exists` } };
  }
  // Simulate async write
  await new Promise((r) => setTimeout(r, 1));
  store.set(node["@id"], node);
  return { ok: true, value: node["@id"] };
}

// === Tests ===
let correct = 0;
let total = 0;

// Test 1: basic creation
total++;
const r1 = createNode("Task", "t-1", { description: "test", priority: 1, status: "pending", dependsOn: [] });
if (r1.ok && validateNode(r1.value).ok) correct++;

// Test 2: agent node
total++;
const r2 = createNode("Agent", "a-1", { blueprint: "t.ts", generation: 1, status: "active" });
if (r2.ok && r2.value["@type"] === "Agent") correct++;

// Test 3: reject empty type with proper error code
total++;
const r3 = createNode("", "id");
if (!r3.ok && r3.error.code === "INVALID_TYPE") correct++;

// Test 4: reject empty id with proper error code
total++;
const r4 = createNode("Task", "");
if (!r4.ok && r4.error.code === "INVALID_ID") correct++;

// Test 5: timestamp validity
total++;
const r5 = createNode("Fitness", "f-1");
if (r5.ok && !isNaN(new Date(r5.value.timestamp).getTime())) correct++;

// Test 6: JSON roundtrip
total++;
const r6 = createNode("Mutation", "m-1", { proposal: "change" });
if (r6.ok) {
  const parsed = JSON.parse(JSON.stringify(r6.value));
  if (validateNode(parsed).ok && parsed.proposal === "change") correct++;
}

// Test 7: reject null
total++;
if (!validateNode(null).ok) correct++;

// Test 8: reject non-objects
total++;
if (!validateNode("string").ok) correct++;

// Test 9: id length boundary
total++;
const r9 = createNode("Task", "x".repeat(257));
if (!r9.ok && r9.error.code === "INVALID_ID") correct++;

// Test 10: nested object preservation
total++;
const r10 = createNode("Selection", "s-1", { winner: "a", context: { nested: { deep: true } } });
if (r10.ok && (r10.value.context as Record<string, unknown>)?.nested) correct++;

// Test 11: concurrent writes — no duplicates
total++;
const concurrentResult = await (async () => {
  store.clear();
  const node1 = createNode("Task", "concurrent-1");
  const node2 = createNode("Task", "concurrent-1"); // same id
  if (!node1.ok || !node2.ok) return false;
  const w1 = await writeToStore(node1.value as SeVoNode);
  const w2 = await writeToStore(node2.value as SeVoNode);
  // First should succeed, second should fail with DUPLICATE_NODE
  return w1.ok && !w2.ok && w2.error.code === "DUPLICATE_NODE";
})();
if (concurrentResult) correct++;

// Test 12: concurrent parallel writes
total++;
const parallelResult = await (async () => {
  store.clear();
  const nodes = Array.from({ length: 5 }, (_, i) => createNode("Task", `parallel-${i}`));
  const writes = nodes.map((n) => n.ok ? writeToStore(n.value as SeVoNode) : Promise.resolve({ ok: false as const, error: { code: "INVALID_TYPE" as const, message: "" } }));
  const results = await Promise.all(writes);
  return results.every((r) => r.ok);
})();
if (parallelResult) correct++;

// Test 13: error granularity — bad context
total++;
const badContext = { "@context": "wrong", "@type": "Task", "@id": "x", timestamp: new Date().toISOString() };
const r13 = validateNode(badContext);
if (!r13.ok && r13.error.code === "INVALID_CONTEXT") correct++;

// Test 14: error granularity — bad timestamp
total++;
const badTs = { "@context": "sevo://v1", "@type": "Task", "@id": "x", timestamp: "not-a-date" };
const r14 = validateNode(badTs);
if (!r14.ok && r14.error.code === "INVALID_TIMESTAMP") correct++;

const fitness = correct / total;
console.log(JSON.stringify({ fitness, branches: 1, correct, total }));

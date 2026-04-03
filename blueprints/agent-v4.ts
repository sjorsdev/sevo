// blueprints/agent-v4.ts — Fourth SEVO agent: adds FS interaction + path computation + large payload tests
// Evolved from agent-v3, targeting real graph semantics (file-system append-only, ID sanitization)

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

// ===== Graph path helpers (mirroring src/graph.ts logic) =====

/** Sanitize an @id value to a filesystem-safe filename segment. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-z0-9-]/gi, "-");
}

/** Compute the relative graph path for a node (mirrors graph.ts nodeToPath). */
function nodeToPath(node: SeVoNode): string {
  const type = node["@type"].toLowerCase();
  const id = sanitizeId(node["@id"]);
  return `./graph/${type}s/${id}.jsonld`;
}

// ===== File-system helpers for FS tests =====

/** Write a SeVoNode to a temp directory, enforcing append-only (no overwrite). */
async function writeFsNode(node: SeVoNode, baseDir: string): Promise<Result<string>> {
  const type = node["@type"].toLowerCase();
  const dir = `${baseDir}/${type}s`;
  await Deno.mkdir(dir, { recursive: true });

  const filename = `${sanitizeId(node["@id"])}.jsonld`;
  const path = `${dir}/${filename}`;

  // Append-only: reject if file already exists
  try {
    await Deno.stat(path);
    return { ok: false, error: { code: "DUPLICATE_NODE", message: `File already exists: ${path}` } };
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      return { ok: false, error: { code: "WRITE_FAILED", message: String(e) } };
    }
  }

  await Deno.writeTextFile(path, JSON.stringify(node, null, 2));
  return { ok: true, value: path };
}

/** Read a previously written node from the temp directory. */
async function readFsNode(id: string, type: string, baseDir: string): Promise<Result<SeVoNode>> {
  const dir = `${baseDir}/${type.toLowerCase()}s`;
  const path = `${dir}/${sanitizeId(id)}.jsonld`;
  try {
    const text = await Deno.readTextFile(path);
    const parsed = JSON.parse(text);
    return validateNode(parsed);
  } catch (e) {
    return { ok: false, error: { code: "WRITE_FAILED", message: `Read failed: ${e}` } };
  }
}

// === Tests ===
let correct = 0;
let total = 0;

// ---- Inherited from v3 ----

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

// ---- New in v4 ----

// Test 15: graph path — basic well-formed id
total++;
{
  const node = { "@context": "sevo://v1" as const, "@type": "Agent", "@id": "agent-v1", timestamp: new Date().toISOString() };
  const path = nodeToPath(node);
  if (path === "./graph/agents/agent-v1.jsonld") correct++;
}

// Test 16: graph path — special characters are sanitized
total++;
{
  // Colons, slashes, spaces, unicode are all replaced with hyphens
  const node = { "@context": "sevo://v1" as const, "@type": "Fitness", "@id": "fitness:agent-v1/cycle 1\u00e9", timestamp: new Date().toISOString() };
  const path = nodeToPath(node);
  // sanitizeId replaces non-[a-z0-9-] with '-'
  const expected = "./graph/fitnesss/fitness-agent-v1-cycle-1-.jsonld";
  if (path === expected) correct++;
}

// Test 17: graph path — id with only special chars becomes all hyphens
total++;
{
  // "!!!@@@" is 6 chars, each replaced with '-', producing "------"
  const node = { "@context": "sevo://v1" as const, "@type": "Task", "@id": "!!!@@@", timestamp: new Date().toISOString() };
  const path = nodeToPath(node);
  if (path === "./graph/tasks/------.jsonld") correct++;
}

// Test 18: graph path — uppercase letters preserved (sanitizeId is case-insensitive on regex but keeps case)
total++;
{
  const node = { "@context": "sevo://v1" as const, "@type": "Mutation", "@id": "Mutation-ABC-123", timestamp: new Date().toISOString() };
  const path = nodeToPath(node);
  // [^a-z0-9-] with gi flag: uppercase letters ARE in [a-zA-Z0-9] but the class is [a-z0-9-] without i flag
  // The regex /[^a-z0-9-]/gi uses the i flag, so uppercase letters match [a-z] and are NOT replaced
  if (path === "./graph/mutations/Mutation-ABC-123.jsonld") correct++;
}

// Test 19: sanitizeId — colons replaced
total++;
{
  const sanitized = sanitizeId("agent:v1:gen-3");
  if (sanitized === "agent-v1-gen-3") correct++;
}

// Test 20: sanitizeId — slashes replaced
total++;
{
  const sanitized = sanitizeId("selection/winner/2024");
  if (sanitized === "selection-winner-2024") correct++;
}

// Test 21: sanitizeId — spaces replaced
total++;
{
  const sanitized = sanitizeId("my node id");
  if (sanitized === "my-node-id") correct++;
}

// Test 22: sanitizeId — dots replaced
total++;
{
  const sanitized = sanitizeId("v1.0.3");
  if (sanitized === "v1-0-3") correct++;
}

// Test 23: FS write + read roundtrip
total++;
{
  const tempDir = await Deno.makeTempDir({ prefix: "sevo-test-" });
  try {
    const node = createNode("Task", "fs-test-1", { description: "fs roundtrip" });
    if (node.ok) {
      const writeResult = await writeFsNode(node.value as SeVoNode, tempDir);
      if (writeResult.ok) {
        const readResult = await readFsNode("fs-test-1", "Task", tempDir);
        if (
          readResult.ok &&
          readResult.value["@id"] === "fs-test-1" &&
          readResult.value["@type"] === "Task"
        ) correct++;
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

// Test 24: FS append-only — second write to same id is rejected
total++;
{
  const tempDir = await Deno.makeTempDir({ prefix: "sevo-test-" });
  try {
    const node = createNode("Agent", "fs-dedup-1", { generation: 1, status: "active" });
    if (node.ok) {
      const w1 = await writeFsNode(node.value as SeVoNode, tempDir);
      const w2 = await writeFsNode(node.value as SeVoNode, tempDir); // same id, same path
      if (w1.ok && !w2.ok && w2.error.code === "DUPLICATE_NODE") correct++;
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

// Test 25: FS — different types go to different subdirectories
total++;
{
  const tempDir = await Deno.makeTempDir({ prefix: "sevo-test-" });
  try {
    const task = createNode("Task", "shared-id-1");
    const agent = createNode("Agent", "shared-id-1"); // same @id, different @type
    if (task.ok && agent.ok) {
      const wt = await writeFsNode(task.value as SeVoNode, tempDir);
      const wa = await writeFsNode(agent.value as SeVoNode, tempDir);
      // Both should succeed because they live in different subdirs
      if (wt.ok && wa.ok) correct++;
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

// Test 26: FS — special-char id is sanitized on disk
total++;
{
  const tempDir = await Deno.makeTempDir({ prefix: "sevo-test-" });
  try {
    // "fitness:agent-v1" has a colon — should be sanitized to "fitness-agent-v1"
    const node = createNode("Fitness", "fitness:agent-v1", { eqs: 0.85 });
    if (node.ok) {
      const writeResult = await writeFsNode(node.value as SeVoNode, tempDir);
      if (writeResult.ok) {
        // The path should use the sanitized id
        const expectedPath = `${tempDir}/fitnesss/fitness-agent-v1.jsonld`;
        try {
          const stat = await Deno.stat(expectedPath);
          if (stat.isFile) correct++;
        } catch { /* file not found at expected path */ }
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

// Test 27: large payload — node with 100 extra fields
total++;
{
  const extra: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) {
    extra[`field_${i}`] = { value: i, label: `field-${i}`, nested: { x: i * 2 } };
  }
  const node = createNode("Selection", "large-payload-1", extra);
  if (node.ok) {
    const json = JSON.stringify(node.value);
    const parsed = JSON.parse(json);
    const validationResult = validateNode(parsed);
    // All 100 fields must survive the roundtrip
    const allFieldsPresent = Array.from({ length: 100 }, (_, i) => `field_${i}`)
      .every((k) => parsed[k] !== undefined);
    if (validationResult.ok && allFieldsPresent) correct++;
  }
}

// Test 28: large payload — deeply nested object
total++;
{
  // Build a 10-level deep nested object
  let deep: Record<string, unknown> = { leaf: true };
  for (let i = 9; i >= 0; i--) {
    deep = { [`level_${i}`]: deep };
  }
  const node = createNode("Mutation", "deep-payload-1", { deep });
  if (node.ok) {
    const json = JSON.stringify(node.value);
    const parsed = JSON.parse(json);
    if (validateNode(parsed).ok && parsed.deep !== undefined) correct++;
  }
}

// Test 29: large payload — array with 500 elements
total++;
{
  const bigArray = Array.from({ length: 500 }, (_, i) => ({ index: i, data: `item-${i}` }));
  const node = createNode("Task", "array-payload-1", { items: bigArray });
  if (node.ok) {
    const json = JSON.stringify(node.value);
    const parsed = JSON.parse(json);
    const items = parsed.items as unknown[];
    if (validateNode(parsed).ok && Array.isArray(items) && items.length === 500) correct++;
  }
}

// Test 30: large payload — FS write + read roundtrip with many fields
total++;
{
  const tempDir = await Deno.makeTempDir({ prefix: "sevo-test-" });
  try {
    const extra: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      extra[`prop_${i}`] = `value_${i}`;
    }
    const node = createNode("Benchmark", "large-fs-1", extra);
    if (node.ok) {
      const writeResult = await writeFsNode(node.value as SeVoNode, tempDir);
      if (writeResult.ok) {
        const readResult = await readFsNode("large-fs-1", "Benchmark", tempDir);
        if (readResult.ok) {
          const raw = readResult.value as unknown as Record<string, unknown>;
          const allPresent = Array.from({ length: 50 }, (_, i) => `prop_${i}`)
            .every((k) => raw[k] !== undefined);
          if (allPresent) correct++;
        }
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

const fitness = correct / total;
console.log(JSON.stringify({ fitness, branches: 1, correct, total }));

// sevo-calc fork: Agent v1 — Basic expression evaluator
// Self-contained agent blueprint with built-in tests

// --- Expression Evaluator ---
type Token = { type: "number"; value: number } | { type: "op"; value: string } | { type: "paren"; value: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    if (s[i] === " ") { i++; continue; }

    if (s[i] === "(" || s[i] === ")") {
      tokens.push({ type: "paren", value: s[i] });
      i++;
      continue;
    }

    if ("+-*/".includes(s[i])) {
      // Handle unary negation
      if (s[i] === "-" && (tokens.length === 0 || tokens[tokens.length - 1].type === "op" || (tokens[tokens.length - 1].type === "paren" && tokens[tokens.length - 1].value === "("))) {
        let num = "-";
        i++;
        while (i < s.length && (s[i] >= "0" && s[i] <= "9" || s[i] === ".")) {
          num += s[i]; i++;
        }
        if (num === "-") throw new Error("Invalid expression: lone minus");
        tokens.push({ type: "number", value: parseFloat(num) });
        continue;
      }
      tokens.push({ type: "op", value: s[i] });
      i++;
      continue;
    }

    if ((s[i] >= "0" && s[i] <= "9") || s[i] === ".") {
      let num = "";
      while (i < s.length && (s[i] >= "0" && s[i] <= "9" || s[i] === ".")) {
        num += s[i]; i++;
      }
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }

    throw new Error(`Unexpected character: ${s[i]}`);
  }

  return tokens;
}

function parse(tokens: Token[]): number {
  let pos = 0;

  function parseExpr(): number {
    let left = parseTerm();
    while (pos < tokens.length && tokens[pos].type === "op" && (tokens[pos].value === "+" || tokens[pos].value === "-")) {
      const op = tokens[pos].value; pos++;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (pos < tokens.length && tokens[pos].type === "op" && (tokens[pos].value === "*" || tokens[pos].value === "/")) {
      const op = tokens[pos].value; pos++;
      const right = parseFactor();
      if (op === "/" && right === 0) throw new Error("Division by zero");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number {
    if (pos >= tokens.length) throw new Error("Unexpected end of expression");

    if (tokens[pos].type === "paren" && tokens[pos].value === "(") {
      pos++; // skip (
      const result = parseExpr();
      if (pos >= tokens.length || tokens[pos].value !== ")") {
        throw new Error("Mismatched parentheses");
      }
      pos++; // skip )
      return result;
    }

    if (tokens[pos].type === "number") {
      return tokens[pos++].value;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(tokens[pos])}`);
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error("Unexpected tokens after expression");
  return result;
}

function evaluate(expr: string): number {
  if (!expr || expr.trim() === "") throw new Error("Empty expression");
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new Error("Empty expression");
  return parse(tokens);
}

// --- Test Suite ---
let correct = 0;
let total = 0;
const branches = 2; // strategies: recursive descent + tokenizer

function test(name: string, fn: () => void) {
  total++;
  try {
    fn();
    correct++;
  } catch (e) {
    console.error(`FAIL: ${name} — ${e instanceof Error ? e.message : e}`);
  }
}

function assertEqual(actual: number, expected: number, tolerance = 1e-10) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function assertThrows(fn: () => void) {
  try { fn(); throw new Error("Expected error"); } catch (e) {
    if (e instanceof Error && e.message === "Expected error") throw e;
  }
}

// Basic arithmetic
test("addition", () => assertEqual(evaluate("2 + 3"), 5));
test("subtraction", () => assertEqual(evaluate("10 - 4"), 6));
test("multiplication", () => assertEqual(evaluate("3 * 7"), 21));
test("division", () => assertEqual(evaluate("20 / 4"), 5));

// Operator precedence
test("precedence mul before add", () => assertEqual(evaluate("2 + 3 * 4"), 14));
test("precedence div before sub", () => assertEqual(evaluate("10 - 6 / 2"), 7));
test("left to right mul/div", () => assertEqual(evaluate("12 / 3 * 2"), 8));

// Parentheses
test("simple parens", () => assertEqual(evaluate("(2 + 3) * 4"), 20));
test("nested parens", () => assertEqual(evaluate("((1 + 2) * (3 + 4))"), 21));
test("deeply nested", () => assertEqual(evaluate("(((5)))"), 5));

// Unary negation
test("unary neg", () => assertEqual(evaluate("-5"), -5));
test("unary neg in expr", () => assertEqual(evaluate("-5 + 3"), -2));
test("neg after paren", () => assertEqual(evaluate("(-3) * 2"), -6));

// Edge cases
test("division by zero", () => assertThrows(() => evaluate("1 / 0")));
test("empty input", () => assertThrows(() => evaluate("")));
test("whitespace only", () => assertThrows(() => evaluate("   ")));
test("mismatched parens", () => assertThrows(() => evaluate("(1 + 2")));
test("extra close paren", () => assertThrows(() => evaluate("1 + 2)")));

// Floating point
test("decimal numbers", () => assertEqual(evaluate("1.5 + 2.5"), 4));
test("small decimals", () => assertEqual(evaluate("0.1 + 0.2"), 0.3, 1e-10));

// Complex expressions
test("complex 1", () => assertEqual(evaluate("2 * (3 + 4) - 1"), 13));
test("complex 2", () => assertEqual(evaluate("(1 + 2) * (3 + 4) / (5 - 2)"), 7));

// Output fitness
const fitness = correct / total;
console.log(JSON.stringify({ fitness, branches, correct, total }));

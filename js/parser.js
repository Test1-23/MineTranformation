/* MineTransformation - 表达式解析与变换解析
 *
 * API:
 *   parseMath(src)              -> AST
 *   compileAst(node)            -> fns(x)
 *   parseGraphItem(src, ctx)    -> item { type: definition|matrixdef|plain|affine|parametric }
 *   compileItem(item, registry) -> 可绘制的对象
 *   ctx: { isMatrix(name) }     用于解析 矩阵别名应用 "A f(x)"
 *   registry: { name -> { fn } | { matrix } }
 *
 * 名称支持下标: f_1 = g1 = f₁ (全角₀-₉ 归一化为 _数字)
 * 输入归一化: 全角字符/×÷−/上标平方 → 半角
 */
(function (root) {
  "use strict";

  const SUBSCRIPTS = "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089"; // ₀-₉
  const SUPERSCRIPTS = "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079"; // ⁰¹²³⁴⁵⁶⁷⁸⁹

  function normalize(src) {
    let s = "";
    for (const ch of src) {
      const code = ch.charCodeAt(0);
      if (/[\uff01-\uff5e]/.test(ch)) s += String.fromCharCode(code - 0xfee0);
      else s += ch;
    }
    s = s.replace(/[×·]/g, "*").replace(/[÷]/g, "/").replace(/[−]/g, "-");
    // 下标 → _数字
    s = s.replace(new RegExp("[" + SUBSCRIPTS + "]", "g"), (ch) => "_" + SUBSCRIPTS.indexOf(ch));
    // 上标 → ^数字
    s = s.replace(new RegExp("[" + SUPERSCRIPTS + "]", "g"), (ch) => "^" + SUPERSCRIPTS.indexOf(ch));
    return s;
  }

  // ---------------- 词法 ----------------
  function lex(src) {
    const s = normalize(src);
    const out = [];
    let i = 0;
    const push = (type, value) => out.push({ type, value });
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const num = s.slice(i, j);
        if ((num.match(/\./g) || []).length > 1) throw new Error("非法数字: " + num);
        push("num", parseFloat(num));
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
        push("id", s.slice(i, j));
        i = j;
        continue;
      }
      if (c === "(") { push("lp", c); i++; continue; }
      if (c === ")") { push("rp", c); i++; continue; }
      if (c === ",") { push("comma", c); i++; continue; }
      if (c === ";") { push("semi", c); i++; continue; }
      if ("+-*/^".includes(c)) { push("op", c); i++; continue; }
      throw new Error("无法识别的字符: '" + c + "'");
    }
    push("eof", null);
    return out;
  }

  // ---------------- 数学表达式(递归下降) ----------------
  const FUNCTIONS = {
    sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1,
    sinh: 1, cosh: 1, tanh: 1, sqrt: 1, cbrt: 1, abs: 1,
    ln: 1, log: 1, log10: 1, log2: 1, exp: 1,
    floor: 1, ceil: 1, round: 1, sign: 1
  };
  const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
  const FUNC_IMPL = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
    ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
    round: Math.round, sign: Math.sign
  };

  function parseMath(srcOrToks) {
    const tokens = Array.isArray(srcOrToks) ? srcOrToks : lex(srcOrToks);
    let pos = 0;
    const peek = () => tokens[pos];
    const tok = () => tokens[pos++];
    const isImplicitStart = (t) => t.type === "num" || t.type === "id" || t.type === "lp";

    function expr() {
      let node = term();
      while (peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = tok().value;
        node = { type: "bin", op, left: node, right: term() };
      }
      return node;
    }
    function term() {
      let node = unary();
      for (;;) {
        const t = peek();
        if (t.type === "op" && (t.value === "*" || t.value === "/")) {
          const op = tok().value;
          node = { type: "bin", op, left: node, right: unary() };
        } else if (isImplicitStart(t)) {
          node = { type: "bin", op: "*", left: node, right: unary() };
        } else break;
      }
      return node;
    }
    function unary() {
      const t = peek();
      if (t.type === "op" && (t.value === "-" || t.value === "+")) {
        const op = tok().value;
        return { type: "neg", op, operand: unary() };
      }
      return postfix();
    }
    function postfix() {
      const atom = atomp();
      if (peek().type === "op" && peek().value === "^") {
        tok();
        return { type: "bin", op: "^", left: atom, right: unary() };
      }
      return atom;
    }
    function atomp() {
      const t = peek();
      if (t.type === "num") { tok(); return { type: "num", value: t.value }; }
      if (t.type === "id") {
        tok();
        const name = t.value;
        if (peek().type === "lp") {
          if (FUNCTIONS[name] !== undefined || CONSTANTS[name] !== undefined) {
            tok();
            const arg = expr();
            expect("rp", "缺右括号");
            return { type: "call", name, arg };
          }
          // 非内置函数: 隐式乘法 var * (group), expr() 已消费整个括号组
          const arg = expr();
          return { type: "bin", op: "*", left: { type: "var", name }, right: arg };
        }
        if (CONSTANTS[name] !== undefined) return { type: "const", name };
        return { type: "var", name };
      }
      if (t.type === "lp") {
        tok();
        const node = expr();
        expect("rp", "缺右括号");
        return node;
      }
      throw new Error("语法错误: 期望数字/变量/函数, 遇到 '" + String(t.value) + "'");
    }
    function expect(type, msg) {
      if (peek().type !== type) throw new Error(msg);
      return tok();
    }
    const node = expr();
    if (peek().type !== "eof") {
      if (peek().type === "rp") throw new Error("多余的右括号");
      throw new Error("语法错误: 多余的输入 '" + peek().value + "'");
    }
    return node;
  }

  function compileAst(node) {
    function evalNode(n, env) {
      switch (n.type) {
        case "num": return n.value;
        case "const": return CONSTANTS[n.name];
        case "var": {
          const v = env[n.name];
          if (v === undefined) throw new Error("未知变量: " + n.name);
          return v;
        }
        case "neg": { const v = evalNode(n.operand, env); return n.op === "-" ? -v : +v; }
        case "bin": {
          const l = evalNode(n.left, env);
          const r = evalNode(n.right, env);
          switch (n.op) {
            case "+": return l + r;
            case "-": return l - r;
            case "*": return l * r;
            case "/": return l / r;
            case "^": return Math.pow(l, r);
          }
          throw new Error("未知运算符: " + n.op);
        }
        case "call": {
          const a = evalNode(n.arg, env);
          const f = FUNC_IMPL[n.name];
          if (!f) throw new Error("未知函数: " + n.name);
          return f(a);
        }
      }
      throw new Error("无法求值节点");
    }
    return (x) => evalNode(node, { x });
  }

  // ---------------- 名称与保留字 ----------------
  const RESERVED = { x: 1, M: 1 };
  function badName(name) {
    return name === "x" || CONSTANTS[name] !== undefined || FUNCTIONS[name] !== undefined || RESERVED[name];
  }

  // ---------------- 矩阵字面量 ----------------
  function parseMatrixLiteral(content) {
    const nums = content.replace(/[,;$]/g, " ").trim().split(/\s+/).map(Number);
    if (nums.length !== 4 || nums.some((n) => Number.isNaN(n))) {
      throw new Error("矩阵需要 4 个数字, 如 M(0 1; 1 2)");
    }
    if (Math.abs(nums[0] * nums[3] - nums[1] * nums[2]) < 1e-12) {
      throw new Error("矩阵必须可逆");
    }
    return { a: nums[0], b: nums[1], c: nums[2], d: nums[3] };
  }

  // ---------------- 图元解析 ----------------
  // 定义:   f(x)=x^2 | f=x^2 | fx=x^2 | g2(x)=x^2 | f_1(x)=x^2 | A=M(0 1; 1 2)
  // 仿射:   [a]? name [(inner)] [+d]?   2f(x) / f(2x)+1 / 0.5f(x-1) / 2f / 2fx / 2f_1 / 2g1(x)
  // 矩阵:   M(a b; c d) [base]?         缺省 base = f
  // 矩阵别名: A f(x) | A f | A 2f(x)     (A 为已定义的矩阵, 由 ctx.isMatrix 判定)
  // 纯函数: x^2 / sin(x)/x / 2x

  function parseGraphItem(src, ctx) {
    ctx = ctx || {};
    const s = normalize(src);

    // ---- 定义 ----
    const defMatch =
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*x\s*\)\s*=\s*(.+)$/.exec(s)
      || (/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(s))
      || /^\s*([A-Za-z_])\s*x\s*=\s*(.+)$/.exec(s);
    if (defMatch) {
      const name = defMatch[1];
      if (badName(name)) throw new Error("不能使用保留名 '" + name + "'");
      const expr = defMatch[2].trim();
      const mm = /^M\s*\(\s*([^)]*)\)\s*$/.exec(expr);
      if (mm) {
        return { type: "matrixdef", name, matrix: parseMatrixLiteral(mm[1]), source: src };
      }
      const node = parseMath(expr);
      return { type: "definition", name, fn: compileAst(node), source: src };
    }

    // ---- 矩阵字面量应用: M(...) [base] ----
    const m = /^M\s*\(\s*([^)]*)\)\s*(.*)$/.exec(s.trim());
    if (m) {
      const matrix = parseMatrixLiteral(m[1]);
      const baseSrc = m[2].trim();
      let base;
      if (!baseSrc || /^\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.test(baseSrc)) {
        base = { type: "implicit", name: baseSrc ? baseSrc.trim() : "f" };
      } else {
        base = parseCurvePart(baseSrc);
      }
      return { type: "parametric", matrix, base, source: src };
    }

    // ---- 矩阵别名应用: A f(x) | A f | A 2f(x) ----
    const am = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(s);
    if (am && ctx.isMatrix && ctx.isMatrix(am[1])) {
      const base = parseCurvePart(am[2]);
      return { type: "parametric", matrixRef: am[1], base, source: src };
    }

    return parseCurvePart(s);
  }

  function parseCurvePart(src) {
    const affine = extractAffineHead(src);
    if (affine) return affine;
    const node = parseMath(src);
    return { type: "plain", fn: compileAst(node), source: src };
  }

  // 仿射头解析: [scale] name (...) [+-offset] | [scale] name x | [scale] name
  function extractAffineHead(src) {
    const s = src.trim();
    const m = /^([+-]?\d*\.?\d+)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(s);
    if (m) {
      const name = m[2];
      const scale = (m[1] === undefined || m[1] === "") ? null : parseFloat(m[1]);
      if (!badName(name)) {
        const close = findMatchingParen(s, m[0].length - 1);
        if (close < 0) throw new Error("缺右括号");
        const innerSrc = s.slice(m[0].length, close).trim();
        const rest = s.slice(close + 1).trim();
        let offset = 0;
        if (rest) {
          const om = /^([+-])\s*(\d*\.?\d+)$/.exec(rest);
          if (!om) throw new Error("变换尾部只能为常量平移, 如 +3 或 -1");
          offset = (om[1] === "-" ? -1 : 1) * parseFloat(om[2] || "1");
        }
        const inner = innerSrc ? compileAst(parseMath(innerSrc)) : null;
        return { type: "affine", name, scale, inner, offset, source: src };
      }
    }
    // 无括号: [scale] name x  (2fx / f1x 风格)
    const m2 = /^([+-]?\d*\.?\d+)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*x\s*$/.exec(s);
    if (m2 && !badName(m2[2])) {
      return { type: "affine", name: m2[2], scale: m2[1] ? parseFloat(m2[1]) : null, inner: null, offset: 0, source: src };
    }
    // 无括号: [scale] name  (2f_1 风格)
    const m3 = /^([+-]?\d*\.?\d+)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(s);
    if (m3 && !badName(m3[2])) {
      return { type: "affine", name: m3[2], scale: m3[1] ? parseFloat(m3[1]) : null, inner: null, offset: 0, source: src };
    }
    return null;
  }

  // 在 str 中找与从 open('(') 配对的右括号下标
  function findMatchingParen(str, open) {
    let depth = 0;
    for (let i = open; i < str.length; i++) {
      if (str[i] === "(") depth++;
      else if (str[i] === ")") { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  // ---------------- 编译图元 -> 绘图函数 ----------------
  // plain:  draw(x) -> y
  // affine: draw(x, reg) -> y
  // parametric: evalCurve(t, reg) -> [X, Y]
  function compileItem(item, registry) {
    if (item.type === "definition") {
      return { kind: "plain", source: item.source, draw: item.fn };
    }
    if (item.type === "matrixdef") {
      return { kind: "matrixdef", source: item.source, matrix: item.matrix };
    }
    if (item.type === "plain") {
      return { kind: "plain", draw: item.fn, source: item.source };
    }
    if (item.type === "affine") {
      return {
        kind: "affine",
        source: item.source,
        draw(x, reg) {
          const def = reg[item.name];
          if (!def) throw new Error("函数 " + item.name + " 未定义, 请先输入 " + item.name + "(x)=...");
          let arg = x;
          if (item.inner) arg = item.inner(x);
          let y = def.fn(arg);
          if (item.scale !== null) y *= item.scale;
          return y + item.offset;
        }
      };
    }
    if (item.type === "parametric") {
      const base = item.base;
      const matrixRef = item.matrixRef || null;
      const matrix = item.matrix || null;
      const baseEval = (t, reg) => {
        if (base.type === "implicit") {
          const def = reg[base.name];
          if (!def) throw new Error("函数 " + base.name + " 未定义");
          return def.fn(t);
        }
        if (base.type === "plain") return base.fn(t);
        if (base.type === "affine") {
          const def = reg[base.name];
          if (!def) throw new Error("函数 " + base.name + " 未定义");
          let arg = t;
          if (base.inner) arg = base.inner(t);
          let y = def.fn(arg);
          if (base.scale !== null) y *= base.scale;
          return y + base.offset;
        }
        throw new Error("未知基准类型");
      };
      return {
        kind: "parametric",
        source: item.source,
        evalCurve(t, reg) {
          reg = reg || {};
          const y = baseEval(t, reg);
          let m = matrix;
          if (matrixRef) {
            const md = reg[matrixRef];
            if (!md || !md.matrix) throw new Error("矩阵 " + matrixRef + " 未定义");
            m = md.matrix;
          }
          return [m.a * t + m.b * y, m.c * t + m.d * y];
        }
      };
    }
    throw new Error("未知图元类型");
  }

  const api = {
    normalize, lex, parseMath, compileAst, parseGraphItem, compileItem,
    FUNCTIONS, CONSTANTS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MineTransformer = api;
})(typeof window !== "undefined" ? window : globalThis);

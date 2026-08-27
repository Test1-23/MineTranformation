/* MineTransformation - 表达式解析与变换解析
 *
 * API:
 *   parseMath(src)              -> AST
 *   compileAst(node, env?)      -> fns(x)
 *   parseGraphItem(src)         -> item { type: definition|plain|affine|parametric }
 *   compileItem(item, registry) -> 可绘制的对象
 *   registry: { name -> { fn, source } }
 */
(function (root) {
  "use strict";

  // ---------------- 词法 ----------------
  function lex(src) {
    const out = [];
    let i = 0;
    const push = (type, value) => out.push({ type, value });
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < src.length && /[0-9.]/.test(src[j])) j++;
        const num = src.slice(i, j);
        if ((num.match(/\./g) || []).length > 1) throw new Error("非法数字: " + num);
        push("num", parseFloat(num));
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        push("id", src.slice(i, j));
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
          const arg = expr();
          expect("rp", "缺右括号");
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

  // ---------------- 图元解析 ----------------
  // 定义: f(x)=x^2 | f=x^2 | fx=x^2 | g = sin(x)
  // 仿射: [a]? f [(b*x+c)] [+d]?        2f(x) / f(2x)+1 / 0.5f(x-1) / 2f / 2fx
  // 矩阵: M(a b; c d) [base]?           缺省 base = f
  // 纯函数: x^2 / sin(x)/x / 2x

  function parseGraphItem(src) {
    const defMatch =
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*x\s*\)\s*=\s*(.+)$/.exec(src)
      || /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(src)
      || /^\s*([A-Za-z_])\s*x\s*=\s*(.+)$/.exec(src);
    if (defMatch) {
      const name = defMatch[1];
      const expr = defMatch[2];
      const node = parseMath(expr);
      return { type: "definition", name, fn: compileAst(node), source: src };
    }

    // 矩阵: M(...) [base]
    const m = /^M\s*\(\s*([^)]*)\)\s*(.*)$/.exec(src.trim());
    if (m) {
      const nums = m[1].replace(/[,;$]/g, " ").trim().split(/\s+/).map(Number);
      if (nums.length !== 4 || nums.some((n) => Number.isNaN(n))) {
        throw new Error("矩阵需要 4 个数字, 如 M(0 1; 1 2)");
      }
      if (Math.abs(nums[0] * nums[3] - nums[1] * nums[2]) < 1e-12) {
        throw new Error("矩阵必须可逆");
      }
      const baseSrc = m[2].trim();
      let base;
      if (!baseSrc || /^\s*[A-Za-z_]+\s*$/.test(baseSrc)) {
        base = { type: "implicit", name: baseSrc ? baseSrc.trim() : "f" };
      } else {
        const parsed = parseCurvePart(baseSrc);
        base = parsed;
      }
      return {
        type: "parametric",
        matrix: { a: nums[0], b: nums[1], c: nums[2], d: nums[3] },
        base,
        source: src
      };
    }

    return parseCurvePart(src);
  }

  function parseCurvePart(src) {
    // 仿射: [scale]? name ( balanced-inner ) [+/-offset]?
    const affine = extractAffineHead(src);
    if (affine) return affine;

    // 纯数学表达式
    const node = parseMath(src);
    return { type: "plain", fn: compileAst(node), source: src };
  }

  // 解析仿射头: 可借助括号平衡提取内层
  function extractAffineHead(src) {
    const s = src.trim();
    const m = /^([+-]?\d*\.?\d+)?\s*([A-Za-z_])\s*\(/.exec(s);
    const name = m ? m[2] : null;
    const scale = m && (m[1] === undefined || m[1] === "") ? null : (m ? parseFloat(m[1]) : null);
    if (m && name !== "x" && CONSTANTS[name] === undefined && FUNCTIONS[name] === undefined) {
      const after = s.slice(m[0].length - 1); // from '('
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
    if (!m) {
      // 无括号形式: [scale] name x (2fx) | [scale] name (2f)
      const m2 = /^([+-]?\d*\.?\d+)\s*([A-Za-z_])\s*x\s*$/.exec(s);
      if (m2 && m2[2] !== "x") {
        return { type: "affine", name: m2[2], scale: parseFloat(m2[1]), inner: null, offset: 0, source: src };
      }
      const m3 = /^([+-]?\d*\.?\d+)?\s*([A-Za-z_])\s*$/.exec(s);
      if (m3 && m3[2] !== "x" && CONSTANTS[m3[2]] === undefined && FUNCTIONS[m3[2]] === undefined) {
        return { type: "affine", name: m3[2], scale: m3[1] ? parseFloat(m3[1]) : null, inner: null, offset: 0, source: src };
      }
    }
    return null;
  }

  // 在 str 中找与从 start('('位置) 配对的右括号下标
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
      const matrix = item.matrix;
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
          return [matrix.a * t + matrix.b * y, matrix.c * t + matrix.d * y];
        }
      };
    }
    throw new Error("未知图元类型");
  }

  const api = {
    lex, parseMath, compileAst, parseGraphItem, compileItem,
    FUNCTIONS, CONSTANTS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MineTransformer = api;
})(typeof window !== "undefined" ? window : globalThis);

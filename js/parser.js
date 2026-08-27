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
          if (name === "x") {
            // 变量 x 后跟括号: 隐式乘法 x * (group)
            tok();
            const arg = expr();
            expect("rp", "缺右括号");
            return { type: "bin", op: "*", left: { type: "var", name }, right: arg };
          }
          // 用户自定义函数调用 f(...)
          tok();
          const arg = expr();
          expect("rp", "缺右括号");
          return { type: "ucall", name, arg };
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
        case "ucall": {
          // 用户函数调用 f(x): 从 registry 取定义 (带递归深度保护)
          const def = env.reg && env.reg[n.name];
          if (!def || !def.fn) throw new Error("函数 " + n.name + " 未定义, 请先输入 " + n.name + "(x)=...");
          const a = evalNode(n.arg, env);
          const d = env.reg.__depth || 0;
          if (d > 32) throw new Error("函数递归嵌套过深: " + n.name);
          env.reg.__depth = d + 1;
          try { return def.fn(a, env.reg); }
          finally { env.reg.__depth = d; }
        }
      }
      throw new Error("无法求值节点");
    }
    return (x, reg) => evalNode(node, { x, reg: reg || null });
  }

  // ---------------- 名称与保留字 ----------------
  const RESERVED = { x: 1, M: 1 };
  function badName(name) {
    return name === "x" || CONSTANTS[name] !== undefined || FUNCTIONS[name] !== undefined || RESERVED[name];
  }

  // ---------------- 矩阵字面量 & 矩阵表达式 ----------------
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

  function matMul(P, Q) {
    return {
      a: P.a * Q.a + P.b * Q.c,
      b: P.a * Q.b + P.b * Q.d,
      c: P.c * Q.a + P.d * Q.c,
      d: P.c * Q.b + P.d * Q.d
    };
  }

  // 矩阵表达式解析: 词法在 lex 基础上完成
  // 支持: M(..) 字面量 | 已定义矩阵名 | + - 运算 | 常见结合
  // 语法: M(0 1; 1 2)*A+2M(1 0; 0 1) 等
  function parseMatrixExpr(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const tok = () => tokens[pos++];

    function expr() {
      let node = term();
      while (peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = tok().value;
        node = { type: "mbin", op, left: node, right: term() };
      }
      return node;
    }
    function term() {
      let node = unary();
      for (;;) {
        const t = peek();
        if (t.type === "op" && t.value === "*") {
          tok();
          node = { type: "mbin", op: "*", left: node, right: unary() };
        } else if (t.type === "id") {
          node = { type: "mbin", op: "*", left: node, right: unary() }; // 隐式乘法
        } else break;
      }
      return node;
    }
    function unary() {
      const t = peek();
      if (t.type === "op" && (t.value === "-" || t.value === "+")) {
        const op = tok().value;
        return { type: "mneg", op, operand: unary() };
      }
      return primary();
    }
    function primary() {
      const t = peek();
      if (t.type === "id" && t.value === "M" && tokens[pos + 1] && tokens[pos + 1].type === "lp") {
        tok(); tok();
        const nums = [];
        while (peek().type !== "rp") {
          if (peek().type === "num") { nums.push(tok().value); continue; }
          if (peek().type === "comma" || peek().type === "semi") { tok(); continue; }
          if (peek().type === "op" && peek().value === "-") {
            tok();
            if (peek().type !== "num") throw new Error("矩阵分量必须是数字");
            nums.push(-tok().value);
            continue;
          }
          if (peek().type === "eof") throw new Error("矩阵表达式括号不匹配");
          throw new Error("矩阵分量必须是数字");
        }
        tok();
        // M(...) 按当前注册矩阵展开(作为字面量组件) - 下移为矩阵求值
        return { type: "mlit", nums: nums };
      }
      if (t.type === "id") {
        tok();
        return { type: "mname", name: t.value };
      }
      if (t.type === "lp") {
        tok();
        const node = expr();
        if (peek().type !== "rp") throw new Error("缺右括号");
        tok();
        return node;
      }
      throw new Error("矩阵表达式语法错误: 期望 M(...) 或矩阵名");
    }
    const node = expr();
    if (peek().type !== "eof") throw new Error("矩阵表达式多余输入: '" + peek().value + "'");
    return node;
  }

  // 编译矩阵表达式 -> fn(reg) => {a,b,c,d}
  function compileMatrixExpr(node) {
    function evalNode(n, reg) {
      switch (n.type) {
        case "mlit": return parseMatrixLiteral(n.nums.join(" "));
        case "mname": {
          const def = reg[n.name];
          if (!def || !def.matrixFn && !def.matrix) throw new Error("矩阵 " + n.name + " 未定义");
          return def.matrixFn ? def.matrixFn(reg) : def.matrix;
        }
        case "mneg": {
          const m = evalNode(n.operand, reg);
          return { a: -(n.op === "-" ? m.a : -m.a), b: -(n.op === "-" ? m.b : -m.b), c: -(n.op === "-" ? m.c : -m.c), d: -(n.op === "-" ? m.d : -m.d) };
        }
        case "mbin": {
          const l = evalNode(n.left, reg);
          const r = evalNode(n.right, reg);
          switch (n.op) {
            case "+": return { a: l.a + r.a, b: l.b + r.b, c: l.c + r.c, d: l.d + r.d };
            case "-": return { a: l.a - r.a, b: l.b - r.b, c: l.c - r.c, d: l.d - r.d };
            case "*": return matMul(l, r);
          }
          throw new Error("未知矩阵运算: " + n.op);
        }
      }
      throw new Error("无法求值矩阵节点");
    }
    return (reg) => evalNode(node, reg || {});
  }

  // ---------------- 图元解析 ----------------
  // 定义:   f(x)=x^2 | f=x^2 | fx=x^2 | g2(x)=x^2 | f_1(x)=x^2 | A=M(0 1; 1 2) | B=A*A (矩阵表达式)
  // 仿射:   [a]? name [(inner)] [+d]?   2f(x) / f(2x)+1 / 0.5f(x-1) / 2f / 2fx / 2f_1 / 2g1(x)
  // 矩阵:   M(a b; c d) [base]?         缺省 base = f
  // 矩阵链: A B f(x) / M(..) A f(x)     从左到右依次为最外层矩阵
  // 纯函数: x^2 / sin(x)/x / 2x

  // 判断表达式是否引用矩阵 (用于识别矩阵定义 B=AA)
  function looksLikeMatrixExpr(expr, ctx) {
    const tokens = lex(expr);
    let sawM = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === "eof") break;
      if (t.type === "id" && t.value === "M" && tokens[i + 1] && tokens[i + 1].type === "lp") { sawM = true; continue; }
      if (t.type === "id" && ctx.isMatrix && ctx.isMatrix(t.value)) { sawM = true; continue; }
      if (t.type === "id" && t.value !== "M" && !(FUNCTIONS[t.value] !== undefined || CONSTANTS[t.value] !== undefined)) {
        // 非矩阵非内置引用: 需要该名字已定义
        // B=AA 中 A 是矩阵; 函数名 x 直接排除
        if (t.value === "x") return false;
        if (ctx.isMatrix && ctx.isMatrix(t.value)) { sawM = true; continue; }
        if (ctx.isMatrix && !ctx.isMatrix(t.value)) return false;
      }
    }
    return sawM;
  }

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
      // 矩阵表达式定义: 内含 M( 或引用已定义矩阵
      if (looksLikeMatrixExpr(expr, ctx)) {
        const node = parseMatrixExpr(lex(expr));
        return { type: "matrixdef", name, matrixFn: compileMatrixExpr(node), matrix: null, source: src };
      }
      const node = parseMath(expr);
      return { type: "definition", name, fn: compileAst(node), source: src };
    }

    // ---- 矩阵链应用: M(...) | 已定义矩阵名, 依次作用于 base ----
    const mats = [];
    let rest = s.trim();
    while (true) {
      const t0 = /^\s*M\s*\(\s*([^)]*)\)/.exec(rest);
      if (t0) {
        mats.push({ lit: parseMatrixLiteral(t0[1]) });
        rest = rest.slice(t0[0].length);
        continue;
      }
      const t1 = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(rest);
      if (t1 && ctx.isMatrix && ctx.isMatrix(t1[1])) {
        mats.push({ ref: t1[1] });
        rest = t1[2];
        continue;
      }
      break;
    }
    if (mats.length) {
      let base;
      if (!rest.trim()) {
        base = { type: "implicit", name: "f" };
      } else if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.test(rest)) {
        base = { type: "implicit", name: rest.trim() };
      } else {
        base = parseCurvePart(rest);
      }
      return { type: "parametric", mats, base, source: src };
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
      if (item.matrixFn) {
        return { kind: "matrixdef", source: item.source, matrixFn: item.matrixFn };
      }
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
      const mats = item.mats; // [{lit} | {ref}], 从左到右
      const matrixRef = item.matrixRef || null;
      const matrix = item.matrix || null;
      const baseEval = (t, reg) => {
        if (base.type === "implicit") {
          const def = reg[base.name];
          if (!def || !def.fn) throw new Error("函数 " + base.name + " 未定义");
          return def.fn(t, reg);
        }
        if (base.type === "plain") {
          if (base.fn) return base.fn(t, reg);
          if (base.y0x) return base.y0x(reg)(t);
        }
        if (base.type === "affine") {
          const def = reg[base.name];
          if (!def || !def.fn) throw new Error("函数 " + base.name + " 未定义");
          let arg = t;
          if (base.inner) arg = base.inner(t, reg);
          let y = def.fn(arg, reg);
          if (base.scale !== null) y *= base.scale;
          return y + base.offset;
        }
        throw new Error("未知基准类型");
      };
      const resolveMatrix = (m, reg) => {
        if (m.lit) return m.lit;
        if (m.ref) {
          const md = reg[m.ref];
          if (!md) throw new Error("矩阵 " + m.ref + " 未定义");
          if (md.matrixFn) return md.matrixFn(reg);
          if (md.matrix) return md.matrix;
          throw new Error("矩阵 " + m.ref + " 未定义");
        }
        throw new Error("未知矩阵引用");
      };
      // 合成矩阵 (最左为最外层): C = mats[0] * mats[1] * ... * mats[n]
      const composite = (reg) => {
        let C = null;
        for (const m of mats) {
          const M = resolveMatrix(m, reg);
          C = C ? matMul(C, M) : M;
        }
        if (!C) return { a: 1, b: 0, c: 0, d: 1 };
        return C;
      };
      return {
        kind: "parametric",
        source: item.source,
        composite,
        // 由当前视口 4 角经 M⁻¹ 反推出 t 的有效范围 (t = (d*x - b*y) / det)
        tRange(view, reg) {
          let C;
          try { C = composite(reg); } catch (e) { return [view.x0, view.x1]; }
          const det = C.a * C.d - C.b * C.c;
          if (Math.abs(det) < 1e-12) return [view.x0, view.x1];
          const corners = [
            [view.x0, view.y0], [view.x0, view.y1],
            [view.x1, view.y0], [view.x1, view.y1]
          ];
          let tmin = Infinity, tmax = -Infinity;
          for (const [x, y] of corners) {
            const t = (C.d * x - C.b * y) / det;
            if (t < tmin) tmin = t;
            if (t > tmax) tmax = t;
          }
          const pad = (Math.abs(tmin) + Math.abs(tmax)) * 0.05 + 1;
          tmin = Math.max(-1e9, Math.min(tmin - pad, 0));
          tmax = Math.min(1e9, Math.max(tmax + pad, 0));
          return [tmin, tmax];
        },
        evalCurve(t, reg) {
          reg = reg || {};
          const y = baseEval(t, reg);
          let px = t, py = y;
          if (mats) {
            // 从左到右为最外层矩阵: "A B f" = A(B(f)); 求值时从内向外
            for (let i = mats.length - 1; i >= 0; i--) {
              const M = resolveMatrix(mats[i], reg);
              const nx = M.a * px + M.b * py;
              const ny = M.c * px + M.d * py;
              px = nx; py = ny;
            }
          } else {
            // 旧式单矩阵
            let M = matrix;
            if (matrixRef) M = resolveMatrix({ ref: matrixRef }, reg);
            const nx = M.a * px + M.b * py;
            const ny = M.c * px + M.d * py;
            px = nx; py = ny;
          }
          return [px, py];
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

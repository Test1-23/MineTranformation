/* 表达式解析器测试: node test/parser.test.js */
"use strict";
const P = require("../js/parser.js");
let failed = 0;

function T(name, fn) {
  try { fn(); console.log("  ✓ " + name); }
  catch (e) { failed++; console.error("  ✗ " + name + " -> " + e.message); }
}
function eq(a, b, msg) {
  if (Math.abs(a - b) > 1e-9) throw new Error(msg + ": 期望 " + b + ", 实际 " + a);
}
function eqArr(a, b, msg) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) throw new Error(msg + ": 期望 [" + b + "], 实际 [" + a + "]");
  }
}

console.log("--- 数学表达式 ---");
T("x^2 求值", () => { const f = P.compileAst(P.parseMath("x^2")); eq(f(3), 9, "x^2"); });
T("隐式乘法 2x", () => { const f = P.compileAst(P.parseMath("2x")); eq(f(4), 8, "2x"); });
T("sin(x)/x", () => { const f = P.compileAst(P.parseMath("sin(x)/x")); eq(f(Math.PI / 2), 2 / Math.PI, "sin(x)/x"); });
T("右结合 2^3^2", () => { const f = P.compileAst(P.parseMath("2^3^2")); eq(f(0), 512, "2^3^2"); });
T("负号 -x^2", () => { const f = P.compileAst(P.parseMath("-x^2")); eq(f(3), -9, "-x^2"); });
T("常数 pi", () => { const f = P.compileAst(P.parseMath("cos(pi)")); eq(f(0), -1, "cos(pi)"); });
T("括号乘积 (x+1)(x-1)", () => { const f = P.compileAst(P.parseMath("(x+1)(x-1)")); eq(f(3), 8, "(x+1)(x-1)"); });
T("sqrt abs", () => { const f = P.compileAst(P.parseMath("sqrt(abs(x))")); eq(f(-9), 3, "sqrt(abs)"); });
T("除号优先级 1+2/2", () => { const f = P.compileAst(P.parseMath("1+2/2")); eq(f(0), 2, "1+2/2"); });

console.log("--- 图元解析 ---");
let reg = {};
T("定义 f(x)=x^2", () => {
  const it = P.parseGraphItem("f(x)=x^2");
  if (it.type !== "definition") throw new Error("类型错误: " + it.type);
  reg.f = { fn: it.fn, source: it.source };
  eq(it.fn(5), 25, "f(5)");
});
T("定义 f=x^2 (简写)", () => {
  const it = P.parseGraphItem("f = x^2");
  if (it.type !== "definition") throw new Error("类型错误: " + it.type);
  eq(it.fn(5), 25, "f(5)");
});
T("定义 fx=x^2 (省略括号)", () => {
  const it = P.parseGraphItem("fx=x^2");
  if (it.type !== "definition") throw new Error("类型错误: " + it.type);
  eq(it.fn(5), 25, "f(5)");
});
T("仿射 2f(x)", () => {
  const it = P.parseGraphItem("2f(x)");
  if (it.type !== "affine") throw new Error("类型错误: " + it.type);
  const c = P.compileItem(it, reg);
  eq(c.draw(3, reg), 18, "2f(3)");
});
T("仿射 f(2x)", () => {
  const it = P.parseGraphItem("f(2x)");
  const c = P.compileItem(it, reg);
  eq(c.draw(3, reg), 36, "f(2*3)");
});
T("仿射 0.5f(x-1)+2", () => {
  const it = P.parseGraphItem("0.5f(x-1)+2");
  const c = P.compileItem(it, reg);
  eq(c.draw(4, reg), 0.5 * 9 + 2, "0.5f(3)+2");
});
T("仿射 2fx (带记号风)", () => {
  const it = P.parseGraphItem("2fx");
  if (it.type !== "affine") throw new Error("类型错误: " + it.type);
  const c = P.compileItem(it, reg);
  eq(c.draw(3, reg), 18, "2f(3)");
});
T("仿射 f(2x)+1 尾部偏移", () => {
  const it = P.parseGraphItem("f(2x)+1");
  const c = P.compileItem(it, reg);
  eq(c.draw(3, reg), 37, "f(6)+1");
});
T("嵌套 f(sin(x))", () => {
  const it = P.parseGraphItem("f(sin(x))");
  const c = P.compileItem(it, reg);
  eq(c.draw(Math.PI / 2, reg), 1, "f(sin(pi/2))");
});
T("纯函数 2x (非仿射)", () => {
  const it = P.parseGraphItem("2x");
  if (it.type !== "plain") throw new Error("类型错误: " + it.type);
  eq(it.fn(3), 6, "2x");
});

console.log("--- 矩阵变换 ---");
T("M(0 1 1 2) 解析", () => {
  const it = P.parseGraphItem("M(0 1; 1 2)");
  if (it.type !== "parametric") throw new Error("类型错误: " + it.type);
  const c = P.compileItem(it, reg);
  const [X, Y] = c.evalCurve(2, reg);
  eq(X, 0 * 2 + 1 * 4, "X=4");
  eq(Y, 1 * 2 + 2 * 4, "Y=10");
});
T("M(0 -1 1 0) 旋转90°", () => {
  const it = P.parseGraphItem("M(0 -1 1 0)");
  const c = P.compileItem(it, reg);
  const [X, Y] = c.evalCurve(2, reg);
  eq(X, -4, "X=-4");
  eq(Y, 2, "Y=2");
});
T("矩阵对仿射基 M(0 1 1 2) 2f(x)", () => {
  const it = P.parseGraphItem("M(0 1; 1 2) 2f(x)");
  if (it.type !== "parametric") throw new Error("类型错误: " + it.type);
  const c = P.compileItem(it, reg);
  const [X, Y] = c.evalCurve(2, reg);
  eq(X, 8, "X=2*f(2)*? * 2 = 8? 校验直接值");
  eq(Y, 2 + 2 * 8, "Y");
});
T("奇异矩阵报错", () => {
  let err = null;
  try { P.parseGraphItem("M(1 2 2 4)"); } catch (e) { err = e; }
  if (!err) throw new Error("本应报错");
});

console.log("--- 下标名称与归一化 ---");
T("下标名 g_1(x)=x^2", () => {
  const it = P.parseGraphItem("g_1(x)=x^2");
  if (it.type !== "definition" || it.name !== "g_1") throw new Error("解析错误: " + JSON.stringify({ type: it.type, name: it.name }));
});
T("下标 Unicode g₂(x)=x²", () => {
  const it = P.parseGraphItem("g\u2082(x)=x\u00b2");
  if (it.name !== "g_2") throw new Error("名称应为 g_2: " + it.name);
  reg.g_2 = { fn: it.fn };
  eq(it.fn(3), 9, "g_2(3)");
});
T("全角输入 ｇ１（ｘ）＝ｘ＾２", () => {
  const it = P.parseGraphItem("\uff47\uff11\uff08\uff58\uff09\uff1d\uff58\uff3e\uff12");
  if (it.type !== "definition" || it.name !== "g1") throw new Error("解析错误: " + it.type + "/" + it.name);
});
T("仿射 2g1(x) 下标函数", () => {
  const it = P.parseGraphItem("2g1(x)");
  if (it.type !== "affine" || it.name !== "g1") throw new Error("解析错误: " + it.type + "/" + it.name);
  reg.g1 = { fn: P.compileAst(P.parseMath("x^2")) };
  const c = P.compileItem(it, reg);
  eq(c.draw(3, reg), 18, "2*g1(3)");
});
T("仿射 f₁(x) (Unicode 下标)", () => {
  const it = P.parseGraphItem("f\u2081(x)");
  if (it.type !== "affine" || it.name !== "f_1") throw new Error("解析错误: " + it.type + "/" + it.name);
});

console.log("--- 矩阵定义与别名 ---");
T("矩阵定义 A=M(0 1; 1 2)", () => {
  const it = P.parseGraphItem("A=M(0 1; 1 2)");
  if (it.type !== "matrixdef" || it.name !== "A") throw new Error("解析错误: " + it.type + "/" + it.name);
  reg.A = { matrix: it.matrix };
});
T("矩阵别名 A f(x)", () => {
  const ctx = { isMatrix: (n) => n === "A" };
  const it = P.parseGraphItem("A f(x)", ctx);
  if (it.type !== "parametric" || it.matrixRef !== "A") throw new Error("解析错误: " + it.type + "/" + it.matrixRef);
  const c = P.compileItem(it, reg);
  const [X, Y] = c.evalCurve(2, reg);
  eq(X, 4, "X=1*f(2)=4");
  eq(Y, 10, "Y=t+2*f(t)=2+8");
});
T("矩阵别名 A f", () => {
  const ctx = { isMatrix: (n) => n === "A" };
  const it = P.parseGraphItem("A f", ctx);
  const c = P.compileItem(it, reg);
  const [X, Y] = c.evalCurve(2, reg);
  eq(X, 4, "X");
  eq(Y, 10, "Y");
});
T("矩阵别名 A 2f", () => {
  const ctx = { isMatrix: (n) => n === "A" };
  const c = P.compileItem(P.parseGraphItem("A 2f", ctx), reg);
  const [X, Y] = c.evalCurve(2, reg);
  eq(X, 8, "X=2*f(2)");
  eq(Y, 18, "Y=t+2*2*f(t)");
});
T("矩阵重定义(负分量/逗号分隔)", () => {
  const it = P.parseGraphItem("A=M(0,-1,1,0)");
  const c = P.compileItem(it, reg);
  eq(c.matrix.a, 0, "a");
  eq(c.matrix.b, -1, "b");
});
T("矩阵未定义时报错", () => {
  const c = P.compileItem(P.parseGraphItem("A f(x)", { isMatrix: () => false }), {});
  let err = null;
  try { c.evalCurve(1, {}); } catch (e) { err = e; }
  if (!err) throw new Error("本应报错");
});

console.log(failed ? "\n" + failed + " 个测试失败" : "\n全部通过");
process.exit(failed ? 1 : 0);

/* 集成冒烟测试: node test/smoke.test.js */
"use strict";
const P = require("../js/parser.js");
const Plotter = require("../js/plotter.js");

// 模拟 window / canvas 环境
const fs = require("fs");
const src = fs.readFileSync("js/plotter.js", "utf8");

function makeStubCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === "canvas" || k === "measureText") {
        if (k === "measureText") return () => ({ width: 10 });
        return {};
      }
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function makeStubCanvas() {
  const c = {
    width: 800, height: 600,
    getContext: () => makeStubCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: () => {},
    style: {}
  };
  return c;
}

global.window = {
  devicePixelRatio: 1,
  addEventListener: () => {}
};
global.requestAnimationFrame = (fn) => { fn(); return 0; };

const g = (function () {
  const module = { exports: {} };
  const window = global.window;
  // 用新的函数作用域加载 plotter.js (挂到 module.exports)
  (new Function("module", "exports", "window", "globalThis", src + "\nreturn module.exports;"))(module, module.exports, window, global.window || globalThis);
  return module.exports;
})();

const canvas = makeStubCanvas();
const plotter = new g(canvas);
let failed = 0;
function T(name, fn) {
  try { fn(); console.log("  ✓ " + name); }
  catch (e) { failed++; console.error("  ✗ " + name + " -> " + e.message); }
}

T("绘制网格+坐标轴不抛异常", () => { plotter.draw(); });

T("绘制函数曲线", () => {
  plotter.setRegistry({ f: { fn: P.compileAst(P.parseMath("x^2")) } });
  plotter.setCurves([
    { kind: "function", color: "#000", draw: (x) => x * x, item: null },
    { kind: "function", color: "#000", draw: P.compileAst(P.parseMath("sin(x)")) }
  ]);
  plotter.draw();
});

T("绘制带渐近线函数 (1/x)", () => {
  plotter.setCurves([
    { kind: "function", color: "#000", draw: P.compileAst(P.parseMath("1/x")) }
  ]);
  plotter.draw();
});

T("绘制参数曲线 (矩阵变换)", () => {
  const it = P.parseGraphItem("M(0 1; 1 2)");
  const c = P.compileItem(it, { f: { fn: P.compileAst(P.parseMath("x^2")) } });
  plotter.setCurves([{ kind: "parametric", color: "#000", evalCurve: c.evalCurve, item: null }]);
  plotter.draw();
});

T("视图平移缩放不抛异常", () => {
  plotter.zoom(1.3); plotter.zoom(1 / 1.3);
  const v = plotter.view;
  plotter.view = { x0: v.x0 - 5, x1: v.x1 + 5, y0: v.y0 - 5, y1: v.y1 + 5 };
  plotter.draw();
});

T("niceStep 数值", () => {
  if (plotter.niceStep(0.4) !== 0.5) throw new Error("期望0.5");
  if (plotter.niceStep(3.2) !== 5) throw new Error("期望5");
  if (plotter.niceStep(8) !== 10) throw new Error("期望10");
  if (plotter.niceStep(0.8) !== 1) throw new Error("期望1");
});

T("fmt 格式化", () => {
  if (plotter.fmt(30000) !== "30000") throw new Error("期望30000");
  if (plotter.fmt(1500000) !== "1.5e6") throw new Error("期望1.5e6");
});

T("悬停命中检测 hitTest", () => {
  // 视口 -10..10, canvas 800x600, 画 y = x
  plotter.view = { x0: -10, x1: 10, y0: -10, y1: 10 };
  const curve = { kind: "function", color: "#000", draw: (x) => x, item: null };
  plotter.setCurves([curve]);
  plotter.draw(); // 填充 screenPts
  // 屏幕中心 (400,300) 对应 (0,0), y=x 线上
  const hit = plotter.hitTest(400, 300);
  if (!hit) throw new Error("未命中");
  if (Math.abs(hit.x - 0) > 0.2 || Math.abs(hit.y - 0) > 0.2) {
    throw new Error("命中坐标不对: " + hit.x + "," + hit.y);
  }
  // 远离曲线 -> 不命中
  const miss = plotter.hitTest(100, 100);
  if (miss) throw new Error("本应不命中");
});

console.log(failed ? "\n" + failed + " 个测试失败" : "\n冒烟测试全部通过");
process.exit(failed ? 1 : 0);

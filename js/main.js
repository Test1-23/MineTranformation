/* MineTransformation - 主应用逻辑 */
(function () {
  "use strict";
  const P = window.MineTransformer;
  const T = window.MinePlotter;

  const canvas = document.getElementById("plot-canvas");
  const input = document.getElementById("expr-input");
  const btnAdd = document.getElementById("btn-add");
  const listEl = document.getElementById("expr-list");
  const statusBar = document.getElementById("status-bar");
  const helpModal = document.getElementById("help-modal");
  const pointTip = document.getElementById("point-tip");

  const plotter = new T(canvas);

  const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777"];

  // registry: 已定义函数 {name: {fn, source}}
  const registry = Object.create(null);
  // items: {id, text, parsed, compiled, color, error}
  const items = [];
  let idSeq = 0;

  function rebuild() {
    plotter.setRegistry(registry);
    const curves = [];
    for (const it of items) {
      it.error = null;
      if (it.compiled.kind === "plain" || it.compiled.kind === "affine") {
        curves.push({ kind: "function", color: it.color, draw: it.compiled.draw, item: it });
      } else if (it.compiled.kind === "parametric") {
        curves.push({ kind: "parametric", color: it.color, evalCurve: it.compiled.evalCurve, item: it });
      }
    }
    plotter.setCurves(curves);
    plotter.requestDraw();
    renderList();
  }

  function addItem(text) {
    text = text.trim();
    if (!text) return;
    let parsed;
    try {
      parsed = P.parseGraphItem(text);
    } catch (e) {
      statusBar.textContent = "错误: " + e.message;
      input.select();
      return;
    }
    if (parsed.type === "definition") {
      registry[parsed.name] = { fn: parsed.fn, source: parsed.source };
    }
    const compiled = P.compileItem(parsed, registry);
    items.push({ id: idSeq++, text, parsed, compiled, color: PALETTE[items.length % PALETTE.length] });
    input.value = "";
    input.focus();
    rebuild();
  }

  function removeItem(id) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const it = items[idx];
    if (it.parsed.type === "definition") {
      delete registry[it.parsed.name];
    }
    items.splice(idx, 1);
    rebuild();
  }

  function renderList() {
    listEl.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "expr-item";
      empty.style.color = "#999";
      empty.textContent = "暂无表达式";
      listEl.appendChild(empty);
      return;
    }
    for (const it of items) {
      const div = document.createElement("div");
      div.className = "expr-item" + (it.error ? " item-error" : "");
      if (it.error) div.title = it.error;
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = it.color;
      const formula = document.createElement("span");
      formula.className = "formula";
      formula.textContent = it.error ? it.text + " ⚠ " + it.error : it.text;
      const type = document.createElement("span");
      type.className = "item-type";
      type.textContent = it.parsed.type === "definition" ? "定义" : it.parsed.type === "plain" ? "函数" : it.parsed.type === "affine" ? "变换" : "矩阵";
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.textContent = "×";
      rm.title = "删除";
      rm.addEventListener("click", () => removeItem(it.id));
      div.appendChild(swatch);
      div.appendChild(formula);
      div.appendChild(type);
      div.appendChild(rm);
      listEl.appendChild(div);
    }
  }

  // ---------- 悬停坐标提示 ----------
  function showPointTip(mx, my, px, py) {
    const hit = plotter.hitTest(px, py);
    if (!hit) {
      plotter.hover = null;
      pointTip.classList.add("hidden");
      statusBar.textContent = "x = " + mx.toFixed(4) + "   y = " + my.toFixed(4) + " · 左键拖拽平移 · 滚轮缩放";
      return;
    }
    plotter.hover = { x: hit.x, y: hit.y, color: hit.curve.color };
    plotter.requestDraw();
    const label = hit.curve.item ? hit.curve.item.text : "曲线";
    pointTip.innerHTML =
      '<span class="tip-dot" style="background:' + hit.curve.color + '"></span>' +
      label + " ( " + hit.x.toFixed(4) + " , " + hit.y.toFixed(4) + " )";
    pointTip.classList.remove("hidden");
    // 定位在点旁边, 贴近视口但不越界
    const rect = canvas.getBoundingClientRect();
    const mainEl = canvas.parentElement;
    const tipW = pointTip.offsetWidth, tipH = pointTip.offsetHeight;
    let left = px + 14, top = py - tipH - 8;
    if (left + tipW > mainEl.clientWidth - 6) left = px - tipW - 14;
    if (top < 4) top = py + 14;
    pointTip.style.left = left + "px";
    pointTip.style.top = top + "px";
    statusBar.textContent = "曲线: " + label + "  点 (" + hit.x.toFixed(4) + ", " + hit.y.toFixed(4) + ") · 左键拖拽平移 · 滚轮缩放";
  }

  btnAdd.addEventListener("click", () => addItem(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addItem(input.value);
  });
  document.getElementById("btn-zoom-in").addEventListener("click", () => plotter.zoom(1 / 1.3));
  document.getElementById("btn-zoom-out").addEventListener("click", () => plotter.zoom(1.3));
  document.getElementById("btn-reset").addEventListener("click", () => plotter.resetView());
  document.getElementById("btn-help").addEventListener("click", () => helpModal.classList.remove("hidden"));
  document.getElementById("btn-close-help").addEventListener("click", () => helpModal.classList.add("hidden"));
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.classList.add("hidden");
  });
  document.getElementById("btn-panel").addEventListener("click", () => {
    listEl.classList.toggle("visible");
  });

  plotter.onHover = (mx, my, px, py) => showPointTip(mx, my, px, py);
  plotter.onAfterDraw = () => renderList();

  window.addEventListener("resize", () => plotter.resize());

  // 演示示例
  addItem("f(x)=sin(x)");
  addItem("2f(x)");
  addItem("f(2x)+1");
  addItem("M(0 1; 1 2)");

  setTimeout(() => plotter.resize(), 0);
})();

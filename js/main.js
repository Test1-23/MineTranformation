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
  const errorBanner = document.getElementById("error-banner");

  const plotter = new T(canvas);

  const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777"];

  // registry: {name: {fn}} 函数定义 | {name: {matrix}} 矩阵定义
  const registry = Object.create(null);
  // items: {id, text, parsed, compiled, color, error, hidden, editing}
  const items = [];
  let idSeq = 0;
  let errorTimer = null;

  function isMatrixName(name) { return !!(registry[name] && (registry[name].matrixFn || registry[name].matrix)); }
  function ctxForParse() { return { isMatrix: isMatrixName }; }

  function showError(msg) {
    errorBanner.textContent = "⚠ " + msg;
    errorBanner.classList.remove("hidden");
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => errorBanner.classList.add("hidden"), 5000);
  }

  function rebuild() {
    plotter.setRegistry(registry);
    const curves = [];
    for (const it of items) {
      it.error = null;
      if (it.hidden) continue;
      if (it.compiled.kind === "plain" || it.compiled.kind === "affine") {
        curves.push({ kind: "function", color: it.color, draw: it.compiled.draw, item: it });
      } else if (it.compiled.kind === "parametric") {
        curves.push({
          kind: "parametric",
          color: it.color,
          evalCurve: it.compiled.evalCurve,
          tRange: it.compiled.tRange,
          item: it
        });
      }
    }
    plotter.setCurves(curves);
    plotter.requestDraw();
    renderList();
  }

  // 解析并创建一个条目 (文本): 先解析再注册, 失败不产生副作用
  function makeItem(text, color) {
    const parsed = P.parseGraphItem(text, ctxForParse());
    const compiled = P.compileItem(parsed, registry);
    return { id: idSeq++, text, parsed, compiled, color, error: null, hidden: false };
  }
  function registerParsed(parsed) {
    if (parsed.type === "definition") registry[parsed.name] = { fn: parsed.fn };
    else if (parsed.type === "matrixdef") {
      if (parsed.matrixFn) registry[parsed.name] = { matrixFn: parsed.matrixFn };
      else registry[parsed.name] = { matrix: parsed.matrix };
    }
  }
  function unregisterParsed(parsed) {
    if (parsed.type === "definition") {
      if (registry[parsed.name] && registry[parsed.name].fn === parsed.fn) delete registry[parsed.name];
    } else if (parsed.type === "matrixdef") {
      if (registry[parsed.name] && (registry[parsed.name].matrixFn === parsed.matrixFn || registry[parsed.name].matrix === parsed.matrix)) delete registry[parsed.name];
    }
  }

  function addItem(text, colorHint) {
    text = text.trim();
    if (!text) return;
    let it;
    try {
      it = makeItem(text, colorHint || PALETTE[items.length % PALETTE.length]);
      registerParsed(it.parsed);
    } catch (e) {
      showError(e.message);
      return;
    }
    items.push(it);
    input.value = "";
    input.focus();
    rebuild();
  }

  function removeItem(id) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const it = items[idx];
    unregisterParsed(it.parsed);
    items.splice(idx, 1);
    rebuild();
  }

  // 内联编辑: 用新文本替换条目
  function replaceItemText(it, text) {
    text = text.trim();
    if (!text) { renderList(); return; }
    let fresh;
    try {
      fresh = makeItem(text, it.color); // 仅解析, 未注册
    } catch (e) {
      showError(e.message);
      renderList();
      return;
    }
    unregisterParsed(it.parsed);
    registerParsed(fresh.parsed);
    Object.assign(it, { text: fresh.text, parsed: fresh.parsed, compiled: fresh.compiled });
    rebuild();
  }

  function toggleVisible(id) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    it.hidden = !it.hidden;
    rebuild();
  }

  function renderList() {
    listEl.innerHTML = "";
    for (const it of items) {
      const div = document.createElement("div");
      div.className = "expr-item" + (it.error ? " item-error" : "") + (it.hidden ? " item-off" : "");
      if (it.error) div.title = it.error;
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = it.color;
      div.appendChild(swatch);
      const formula = document.createElement("span");
      formula.className = "formula";
      formula.textContent = it.error ? it.text + " ⚠ " + it.error : it.text;
      formula.title = "点击编辑";
      formula.addEventListener("click", () => beginEdit(it, formula));
      div.appendChild(formula);
      const type = document.createElement("span");
      type.className = "item-type";
      type.textContent = it.parsed.type === "definition" ? "定义" : it.parsed.type === "matrixdef" ? "矩阵" : it.parsed.type === "plain" ? "函数" : it.parsed.type === "affine" ? "变换" : "参数";
      div.appendChild(type);
      const eye = document.createElement("button");
      eye.className = "remove";
      eye.textContent = it.hidden ? "◌" : "●";
      eye.title = it.hidden ? "恢复显示" : "隐藏";
      eye.addEventListener("click", () => toggleVisible(it.id));
      div.appendChild(eye);
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.textContent = "×";
      rm.title = "删除";
      rm.addEventListener("click", () => removeItem(it.id));
      div.appendChild(rm);
      listEl.appendChild(div);
    }
  }

  // 点击条目 -> 内联输入框
  function beginEdit(it, span) {
    if (it.editing) return;
    it.editing = true;
    const ed = document.createElement("input");
    ed.className = "inline-edit";
    ed.type = "text";
    ed.value = it.text;
    span.replaceWith(ed);
    ed.focus();
    ed.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      it.editing = false;
      if (save) replaceItemText(it, ed.value);
      else renderList();
    };
    ed.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { finish(false); }
    });
    ed.addEventListener("blur", () => finish(true));
    ed.addEventListener("mousedown", (e) => e.stopPropagation());
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
  addItem("A=M(0 1; 1 2)");
  addItem("A f");

  setTimeout(() => plotter.resize(), 0);
})();

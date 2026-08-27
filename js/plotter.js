/* MineTransformation - Canvas 绘图器
 * 绘制网格/坐标轴/曲线, 支持平移缩放 (视口 view={x0,x1,y0,y1})
 */
(function (root) {
  "use strict";

  class Plotter {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.view = { x0: -10, x1: 10, y0: -10, y1: 10 };
      this.curves = []; // {color, width, draw(x,reg)=>y | evalCurve(t,reg)=>[x,y], kind}
      this.registry = {}; // {name: {fn, source}}
      this.onHover = null;
      this.hover = null;      // 悬停命中 {x, y, curve, sx, sy}
      this.hoverThreshold = 12; // 命中半径(px)
      this.dpr = window.devicePixelRatio || 1;
      this._drag = null;
      this.bindEvents();
    }

    bindEvents() {
      const c = this.canvas;
      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * (this.view.x1 - this.view.x0) + this.view.x0;
        const my = -(((e.clientY - rect.top) / rect.height) * (this.view.y1 - this.view.y0) - this.view.y1);
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        this.view.x0 = mx - (mx - this.view.x0) * factor;
        this.view.x1 = mx + (this.view.x1 - mx) * factor;
        this.view.y0 = my - (my - this.view.y0) * factor;
        this.view.y1 = my + (this.view.y1 - my) * factor;
        this.requestDraw();
      }, { passive: false });
      // 拖拽平移
      c.addEventListener("mousedown", (e) => {
        this._drag = { x: e.clientX, y: e.clientY };
      });
      window.addEventListener("mousemove", (e) => {
        const rect = c.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const mx = (px / rect.width) * (this.view.x1 - this.view.x0) + this.view.x0;
        const my = -((py / rect.height) * (this.view.y1 - this.view.y0) - this.view.y1);
        if (this.onHover && !this._drag) this.onHover(mx, my, px, py);
        if (this._drag) {
          const dx = ((e.clientX - this._drag.x) / rect.width) * (this.view.x1 - this.view.x0);
          const dy = ((e.clientY - this._drag.y) / rect.height) * (this.view.y1 - this.view.y0);
          this.view.x0 -= dx; this.view.x1 -= dx;
          this.view.y0 += dy; this.view.y1 += dy;
          this._drag = { x: e.clientX, y: e.clientY };
          this.requestDraw();
        }
      });
      window.addEventListener("mouseup", () => { this._drag = null; });
      this.rafPending = false;
    }

    requestDraw() {
      if (this.rafPending) return;
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        this.draw();
        if (this.onAfterDraw) this.onAfterDraw();
      });
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = rect.height * this.dpr;
      this.draw();
    }

    setCurves(curves) { this.curves = curves; this.requestDraw(); }
    setRegistry(reg) { this.registry = reg; }
    resetView() { this.view = { x0: -10, x1: 10, y0: -10, y1: 10 }; this.requestDraw(); }
    zoom(factor) {
      const v = this.view;
      const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
      const nx0 = cx - (cx - v.x0) * factor, nx1 = cx + (v.x1 - cx) * factor;
      const ny0 = cy - (cy - v.y0) * factor, ny1 = cy + (v.y1 - cy) * factor;
      this.view = { x0: nx0, x1: nx1, y0: ny0, y1: ny1 };
      this.requestDraw();
    }

    toScreen(x, y) {
      const v = this.view;
      const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
      return [
        ((x - v.x0) / (v.x1 - v.x0)) * w,
        (1 - (y - v.y0) / (v.y1 - v.y0)) * h
      ];
    }

    draw() {
      const canvas = this.canvas;
      const ctx = this.ctx;
      const v = this.view;
      const w = canvas.width / this.dpr, h = canvas.height / this.dpr;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this.drawGrid(ctx, w, h);
      this.drawAxes(ctx, w, h);
      for (const curve of this.curves) {
        curve.screenPts = [];
        try {
          if (curve.kind === "parametric") this.drawParametric(ctx, curve, w, h);
          else this.drawFunction(ctx, curve, w, h);
          if (curve.item) curve.item.error = null;
        } catch (e) {
          // 依赖未定义的函数等情况, 跳过该曲线
          if (curve.item) curve.item.error = e.message;
        }
      }
      if (this.hover) this.drawHoverMarker(ctx);
    }

    // 网格与刻度
    drawGrid(ctx, w, h) {
      const v = this.view;
      const xStep = this.niceStep((v.x1 - v.x0) / w * 60);
      const yStep = this.niceStep((v.y1 - v.y0) / h * 60);
      ctx.strokeStyle = "#e8e8ec";
      ctx.lineWidth = 1;
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#888";
      ctx.lineWidth = 1;
      // 竖线
      for (let x = Math.ceil(v.x0 / xStep) * xStep; x <= v.x1; x += xStep) {
        const [sx] = this.toScreen(x, 0);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
      }
      for (let y = Math.ceil(v.y0 / yStep) * yStep; y <= v.y1; y += yStep) {
        const [, sy] = this.toScreen(0, y);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      }
      // 刻度文字
      ctx.textAlign = "center";
      for (let x = Math.ceil(v.x0 / xStep) * xStep; x <= v.x1; x += xStep) {
        const [sx] = this.toScreen(x, 0);
        if (sx < -20 || sx > w + 20) continue;
        ctx.fillText(this.fmt(x), sx, h - 6);
      }
      ctx.textAlign = "right";
      for (let y = Math.ceil(v.y0 / yStep) * yStep; y <= v.y1; y += yStep) {
        const [, sy] = this.toScreen(0, y);
        if (sy < -12 || sy > h + 12) continue;
        ctx.fillText(this.fmt(y), 40, sy + 4);
      }
    }

    drawAxes(ctx, w, h) {
      const v = this.view;
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 1.5;
      const [x0s, y0s] = this.toScreen(v.x0, v.y0);
      const [x1s, y1s] = this.toScreen(v.x1, v.y1);
      // y 轴
      if (v.x0 <= 0 && v.x1 >= 0) {
        const [sx] = this.toScreen(0, 0);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
      }
      if (v.y0 <= 0 && v.y1 >= 0) {
        const [, sy] = this.toScreen(0, 0);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      }
    }

    niceStep(raw) {
      if (raw <= 0) return 1;
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const candidates = [1, 2, 2.5, 5, 10];
      for (const c of candidates) {
        if (c * pow >= raw) return c * pow;
      }
      return 10 * pow;
    }

    fmt(n) {
      if (n === 0) return "0";
      const abs = Math.abs(n);
      if (abs >= 1e6 || abs < 1e-4) return n.toExponential(1).replace(/\+/, "");
      const v = Math.round(n * 1000) / 1000;
      return String(v).replace(/(\.\d*?)0+$/, "$1");
    }

    // y = f(x) 曲线: 自适应采样
    drawFunction(ctx, curve, w, h) {
      const v = this.view;
      const reg = this.registry;
      const N = Math.max(256, Math.ceil(w * 1.5));
      const xs = v.x0, xe = v.x1;
      const dx = (xe - xs) / N;
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = (curve.width || 2);
      ctx.beginPath();
      let started = false;
      let prevY = null;
      for (let i = 0; i <= N; i++) {
        const x = xs + i * dx;
        let y;
        try { y = curve.draw(x, reg); } catch (e) { y = NaN; }
        if (!isFinite(y)) { started = false; prevY = null; continue; }
        if (Math.abs(y) > (Math.abs(v.y0) + Math.abs(v.y1) + 100)) {
          // 超出视口过远视为断点(渐近线)
          started = false; prevY = null;
          continue;
        }
        // 跳跃检测: 相邻两点差值巨大且很可能渐近线
        if (prevY !== null && Math.abs(y - prevY) > (v.y1 - v.y0) * 4) {
          started = false;
        }
        const [sx, sy] = this.toScreen(x, y);
        if (started) ctx.lineTo(sx, sy);
        else { ctx.moveTo(sx, sy); started = true; }
        if (curve.screenPts) curve.screenPts.push([sx, sy, x, y]);
        prevY = y;
      }
      ctx.stroke();
    }

    // 参数曲线 [X(t), Y(t)]: 自适应细分采样(按屏幕误差细分, 消除锯齿/破折)
    drawParametric(ctx, curve, w, h) {
      const v = this.view;
      const reg = this.registry;
      const evalP = (t) => {
        let p;
        try { p = curve.evalCurve(t, reg); } catch (e) { p = null; }
        if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
        return p;
      };
      const toScreen = (p) => this.toScreen(p[0], p[1]);

      // t 范围: 曲线提供 tRange 则用逆矩阵反推, 否则覆盖视口 x
      let t0, t1;
      if (curve.tRange) {
        const r = curve.tRange(v, reg);
        t0 = r[0]; t1 = r[1];
      } else {
        t0 = v.x0; t1 = v.x0 + (v.x1 - v.x0) * 1.5;
      }
      const spanAbs = t1 - t0;
      const SEG = Math.min(2048, Math.max(64, Math.ceil(w / 8)));
      const dt = spanAbs / SEG;
      const steps = [];
      for (let i = 0; i <= SEG; i++) steps.push(evalP(t0 + i * dt));

      ctx.strokeStyle = curve.color;
      ctx.lineWidth = (curve.width || 2);
      ctx.beginPath();
      let started = false;
      let prev = null;

      const plotPt = (p) => {
        const [sx, sy] = toScreen(p);
        if (started && prev) {
          if (Math.hypot(sx - prev[0], sy - prev[1]) > w * 0.5) started = false;
        }
        if (started) ctx.lineTo(sx, sy);
        else { ctx.moveTo(sx, sy); started = true; }
        if (curve.screenPts) curve.screenPts.push([sx, sy, p[0], p[1]]);
        prev = [sx, sy];
      };

      for (let i = 0; i < SEG; i++) {
        const pA = steps[i], pB = steps[i + 1];
        if (!pA || !pB) { started = false; prev = null; continue; }
        if (prev) started = true; // 段间连接
        plotPt(pA);
        // 离屏段: 两端都远在视口外时只走直线, 不细分
        const [ax0, ay0] = toScreen(pA);
        const [bx0, by0] = toScreen(pB);
        const bothOff = (ay0 < -40 && by0 < -40) || (ay0 > h + 40 && by0 > h + 40)
          || (ax0 < -40 && bx0 < -40) || (ax0 > w + 40 && bx0 > w + 40);
        if (!bothOff) {
          // 自适应细分: 中点与弦的屏幕偏差 > 0.7px 则继续细分
          (function refine(tA, tB, k) {
            const tm = (tA + tB) / 2;
            const pm = evalP(tm);
            if (!pm) return;
            const [ax, ay] = toScreen(pA);
            const [bx, by] = toScreen(pB);
            const [mx, my] = toScreen(pm);
            const len = Math.hypot(bx - ax, by - ay) || 1;
            const dev = Math.abs((bx - ax) * (ay - my) - (ax - mx) * (by - ay)) / len;
            if (dev > 0.7 && k < 10) {
              refine(tA, tm, k + 1);
              plotPt(pm);
              refine(tm, tB, k + 1);
            } else {
              plotPt(pm);
            }
          })(t0 + i * dt, t0 + (i + 1) * dt, 0);
        }
        plotPt(pB);
      }
      ctx.stroke();
    }

    // 悬停命中检测: 在(px,py)附近找最近的曲线点, 返回 {curve, x, y, sx, sy}
    hitTest(px, py) {
      let best = null;
      let bestD2 = this.hoverThreshold * this.hoverThreshold;
      for (const curve of this.curves) {
        const pts = curve.screenPts;
        if (!pts) continue;
        for (const p of pts) {
          const d2 = (p[0] - px) * (p[0] - px) + (p[1] - py) * (p[1] - py);
          if (d2 < bestD2) { bestD2 = d2; best = { curve, sx: p[0], sy: p[1], x: p[2], y: p[3] }; }
        }
      }
      return best;
    }

    drawHoverMarker(ctx) {
      const hv = this.hover;
      const [sx, sy] = this.toScreen(hv.x, hv.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hv.color;
      ctx.stroke();
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = Plotter;
  root.MinePlotter = Plotter;
})(typeof window !== "undefined" ? window : globalThis);

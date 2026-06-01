/**
 * Interactive scatter chart for Real vs Sim success rate comparison.
 * SimFoundry (blues) vs Polaris (oranges)
 */

const SCATTER_DATA = {
  simfoundry: {
    stack_dishware: { pi0: [100, 34], pi05: [100, 64], n16: [40, 0] },
    put_away_marker: { pi0: [48, 4], pi05: [60, 20], n16: [32, 0] },
    throw_away_trash: { pi0: [20, 0], pi05: [48, 4], n16: [0, 0] },
    serve_fruits: { pi0: [0, 4], pi05: [72, 80], n16: [4, 20], n17: [40, 32], dreamzero: [8, 12] },
    cup_in_bowl: { pi0: [88, 56], pi05: [100, 92], n16: [68, 40], n17: [92, 92], dreamzero: [100, 92] },
    marker_in_cup: { pi0: [40, 40], pi05: [92, 88], n16: [28, 28], n17: [88, 88], dreamzero: [88, 80] },
    clear_table: { pi0: [0, 12], pi05: [40, 36], n16: [0, 0], n17: [8, 28], dreamzero: [16, 28] },
  },
  polaris: {
    stack_dishware: { pi0: [100, 0], pi05: [100, 8], n16: [40, 0] },
    put_away_marker: { pi0: [48, 0], pi05: [60, 4], n16: [32, 0] },
    throw_away_trash: { pi0: [20, 0], pi05: [48, 0], n16: [0, 0] },
    serve_fruits: { pi0: [0, 4], pi05: [72, 28], n16: [4, 24], n17: [40, 4], dreamzero: [8, 4] },
    cup_in_bowl: { pi0: [88, 20], pi05: [100, 36], n16: [68, 76], n17: [92, 48], dreamzero: [100, 68] },
    marker_in_cup: { pi0: [40, 0], pi05: [92, 4], n16: [28, 4], n17: [88, 12], dreamzero: [88, 4] },
    clear_table: { pi0: [0, 0], pi05: [40, 0], n16: [0, 4], n17: [8, 0], dreamzero: [16, 12] },
  },
};

const MODEL_LABELS = {
  pi0: "π₀",
  pi05: "π₀.₅",
  n16: "N1.6",
  n17: "N1.7",
  dreamzero: "DreamZero",
};

const TASK_LABELS = {
  stack_dishware: "Stack Dishware",
  put_away_marker: "Store Marker",
  throw_away_trash: "Throw Away Trash",
  serve_fruits: "Serve Fruits",
  cup_in_bowl: "Put Cup In Bowl",
  marker_in_cup: "Put Marker In Cup",
  clear_table: "Clear Table",
};

const TASK_SHAPES = {
  stack_dishware: "circle",
  put_away_marker: "square",
  throw_away_trash: "diamond",
  serve_fruits: "triangle-up",
  cup_in_bowl: "triangle-down",
  marker_in_cup: "plus",
  clear_table: "star",
};

function computeTaskMetrics(taskData) {
  const pairs = Object.values(taskData).map(([real, sim]) => ({ real, sim }));
  if (pairs.length < 2) return { r: null, mmrv: null };

  const n = pairs.length;
  const reals = pairs.map((p) => p.real);
  const sims = pairs.map((p) => p.sim);

  const meanReal = reals.reduce((a, b) => a + b, 0) / n;
  const meanSim = sims.reduce((a, b) => a + b, 0) / n;

  let num = 0, denReal = 0, denSim = 0;
  for (let i = 0; i < n; i++) {
    const dr = reals[i] - meanReal;
    const ds = sims[i] - meanSim;
    num += dr * ds;
    denReal += dr * dr;
    denSim += ds * ds;
  }
  const r = (denReal > 0 && denSim > 0) ? num / Math.sqrt(denReal * denSim) : null;

  let violations = 0, comparisons = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const realDiff = reals[i] - reals[j];
      const simDiff = sims[i] - sims[j];
      if (realDiff !== 0) {
        comparisons++;
        if (realDiff * simDiff < 0) violations++;
      }
    }
  }
  const mmrv = comparisons > 0 ? violations / comparisons : 0;

  return { r, mmrv };
}

const TASK_METRICS = {};
for (const method of ["simfoundry", "polaris"]) {
  TASK_METRICS[method] = {};
  for (const task of Object.keys(SCATTER_DATA[method])) {
    TASK_METRICS[method][task] = computeTaskMetrics(SCATTER_DATA[method][task]);
  }
}

const SF_COLORS = ["#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"];
const POL_COLORS = ["#fdd0a2", "#fdae6b", "#fd8d3c", "#e6550d", "#a63603"];
const MODEL_ORDER = ["pi0", "pi05", "n16", "n17", "dreamzero"];

function getModelColor(model, method) {
  const idx = MODEL_ORDER.indexOf(model);
  const colors = method === "simfoundry" ? SF_COLORS : POL_COLORS;
  return colors[Math.min(idx, colors.length - 1)];
}

function createShape(type, x, y, size, color, strokeColor = "#000", strokeWidth = 1) {
  const half = size / 2;
  let el;

  switch (type) {
    case "circle":
      el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      el.setAttribute("cx", x);
      el.setAttribute("cy", y);
      el.setAttribute("r", half);
      break;

    case "square":
      el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      el.setAttribute("x", x - half);
      el.setAttribute("y", y - half);
      el.setAttribute("width", size);
      el.setAttribute("height", size);
      break;

    case "diamond":
      el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      el.setAttribute("points", `${x},${y - half} ${x + half},${y} ${x},${y + half} ${x - half},${y}`);
      break;

    case "triangle-up":
      el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const h1 = half * 1.15;
      el.setAttribute("points", `${x},${y - h1} ${x + half},${y + half * 0.7} ${x - half},${y + half * 0.7}`);
      break;

    case "triangle-down":
      el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const h2 = half * 1.15;
      el.setAttribute("points", `${x},${y + h2} ${x + half},${y - half * 0.7} ${x - half},${y - half * 0.7}`);
      break;

    case "plus":
      el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const t = size * 0.2;
      el.setAttribute("d", `M${x - half},${y - t / 2} h${half - t / 2} v${-half + t / 2} h${t} v${half - t / 2} h${half - t / 2} v${t} h${-half + t / 2} v${half - t / 2} h${-t} v${-half + t / 2} h${-half + t / 2} z`);
      break;

    case "star":
      el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? half : half * 0.5;
        const angle = (Math.PI / 2) + (i * Math.PI / 5);
        pts.push(`${x + r * Math.cos(angle)},${y - r * Math.sin(angle)}`);
      }
      el.setAttribute("points", pts.join(" "));
      break;

    default:
      el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      el.setAttribute("cx", x);
      el.setAttribute("cy", y);
      el.setAttribute("r", half);
  }

  el.setAttribute("fill", color);
  el.setAttribute("stroke", strokeColor);
  el.setAttribute("stroke-width", strokeWidth);
  return el;
}

class ScatterChart {
  constructor(svgId, tooltipId) {
    this.svg = document.getElementById(svgId);
    this.tooltip = document.getElementById(tooltipId);
    if (!this.svg) return;

    this.margin = { top: 30, right: 30, bottom: 50, left: 60 };
    this.width = 600;
    this.height = 500;
    this.plotWidth = this.width - this.margin.left - this.margin.right;
    this.plotHeight = this.height - this.margin.top - this.margin.bottom;

    this.currentMethod = "both";
    this.points = [];
    this.animated = false;

    this.init();
  }

  init() {
    this.drawAxes();
    this.drawDiagonal();
    this.collectPoints();
    this.buildLegends();
    this.wireControls();

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !this.animated) {
          this.animated = true;
          this.animatePoints();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(this.svg);
  }

  scaleX(val) {
    return this.margin.left + (val / 100) * this.plotWidth;
  }

  scaleY(val) {
    return this.margin.top + this.plotHeight - (val / 100) * this.plotHeight;
  }

  drawAxes() {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("axes");

    // X axis
    const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    xAxis.setAttribute("x1", this.margin.left);
    xAxis.setAttribute("y1", this.margin.top + this.plotHeight);
    xAxis.setAttribute("x2", this.margin.left + this.plotWidth);
    xAxis.setAttribute("y2", this.margin.top + this.plotHeight);
    xAxis.setAttribute("stroke", "#333");
    xAxis.setAttribute("stroke-width", "1.5");
    g.appendChild(xAxis);

    // Y axis
    const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    yAxis.setAttribute("x1", this.margin.left);
    yAxis.setAttribute("y1", this.margin.top);
    yAxis.setAttribute("x2", this.margin.left);
    yAxis.setAttribute("y2", this.margin.top + this.plotHeight);
    yAxis.setAttribute("stroke", "#333");
    yAxis.setAttribute("stroke-width", "1.5");
    g.appendChild(yAxis);

    // Tick marks and labels
    for (let v = 0; v <= 100; v += 20) {
      // X ticks
      const xt = document.createElementNS("http://www.w3.org/2000/svg", "line");
      xt.setAttribute("x1", this.scaleX(v));
      xt.setAttribute("y1", this.margin.top + this.plotHeight);
      xt.setAttribute("x2", this.scaleX(v));
      xt.setAttribute("y2", this.margin.top + this.plotHeight + 6);
      xt.setAttribute("stroke", "#333");
      g.appendChild(xt);

      const xl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      xl.setAttribute("x", this.scaleX(v));
      xl.setAttribute("y", this.margin.top + this.plotHeight + 22);
      xl.setAttribute("text-anchor", "middle");
      xl.setAttribute("font-size", "12");
      xl.setAttribute("fill", "#555");
      xl.textContent = v;
      g.appendChild(xl);

      // Y ticks
      const yt = document.createElementNS("http://www.w3.org/2000/svg", "line");
      yt.setAttribute("x1", this.margin.left - 6);
      yt.setAttribute("y1", this.scaleY(v));
      yt.setAttribute("x2", this.margin.left);
      yt.setAttribute("y2", this.scaleY(v));
      yt.setAttribute("stroke", "#333");
      g.appendChild(yt);

      const yl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      yl.setAttribute("x", this.margin.left - 12);
      yl.setAttribute("y", this.scaleY(v) + 4);
      yl.setAttribute("text-anchor", "end");
      yl.setAttribute("font-size", "12");
      yl.setAttribute("fill", "#555");
      yl.textContent = v;
      g.appendChild(yl);

      // Grid lines
      if (v > 0 && v < 100) {
        const gx = document.createElementNS("http://www.w3.org/2000/svg", "line");
        gx.setAttribute("x1", this.scaleX(v));
        gx.setAttribute("y1", this.margin.top);
        gx.setAttribute("x2", this.scaleX(v));
        gx.setAttribute("y2", this.margin.top + this.plotHeight);
        gx.setAttribute("stroke", "#ddd");
        gx.setAttribute("stroke-dasharray", "3,3");
        g.appendChild(gx);

        const gy = document.createElementNS("http://www.w3.org/2000/svg", "line");
        gy.setAttribute("x1", this.margin.left);
        gy.setAttribute("y1", this.scaleY(v));
        gy.setAttribute("x2", this.margin.left + this.plotWidth);
        gy.setAttribute("y2", this.scaleY(v));
        gy.setAttribute("stroke", "#ddd");
        gy.setAttribute("stroke-dasharray", "3,3");
        g.appendChild(gy);
      }
    }

    // Axis labels
    const xLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    xLabel.setAttribute("x", this.margin.left + this.plotWidth / 2);
    xLabel.setAttribute("y", this.height - 8);
    xLabel.setAttribute("text-anchor", "middle");
    xLabel.setAttribute("font-size", "14");
    xLabel.setAttribute("font-weight", "500");
    xLabel.setAttribute("fill", "#333");
    xLabel.textContent = "Real Success Rate (%)";
    g.appendChild(xLabel);

    const yLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yLabel.setAttribute("x", 18);
    yLabel.setAttribute("y", this.margin.top + this.plotHeight / 2);
    yLabel.setAttribute("text-anchor", "middle");
    yLabel.setAttribute("font-size", "14");
    yLabel.setAttribute("font-weight", "500");
    yLabel.setAttribute("fill", "#333");
    yLabel.setAttribute("transform", `rotate(-90, 18, ${this.margin.top + this.plotHeight / 2})`);
    yLabel.textContent = "Sim Success Rate (%)";
    g.appendChild(yLabel);

    this.svg.appendChild(g);
  }

  drawDiagonal() {
    const diag = document.createElementNS("http://www.w3.org/2000/svg", "line");
    diag.setAttribute("x1", this.scaleX(0));
    diag.setAttribute("y1", this.scaleY(0));
    diag.setAttribute("x2", this.scaleX(100));
    diag.setAttribute("y2", this.scaleY(100));
    diag.setAttribute("stroke", "#999");
    diag.setAttribute("stroke-width", "1.5");
    diag.setAttribute("stroke-dasharray", "6,4");
    diag.setAttribute("opacity", "0.7");
    this.svg.appendChild(diag);

    // Label for diagonal
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", this.scaleX(85));
    label.setAttribute("y", this.scaleY(88));
    label.setAttribute("font-size", "11");
    label.setAttribute("fill", "#777");
    label.setAttribute("transform", `rotate(-45, ${this.scaleX(85)}, ${this.scaleY(88)})`);
    label.textContent = "Sim = Real";
    this.svg.appendChild(label);
  }

  collectPoints() {
    this.points = [];
    const pointsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    pointsGroup.id = "scatter-points";
    this.svg.appendChild(pointsGroup);

    for (const method of ["simfoundry", "polaris"]) {
      const data = SCATTER_DATA[method];
      for (const task of Object.keys(data)) {
        for (const model of Object.keys(data[task])) {
          const [real, sim] = data[task][model];
          this.points.push({ method, task, model, real, sim });
        }
      }
    }
  }

  animatePoints() {
    const group = document.getElementById("scatter-points");
    group.innerHTML = "";

    const visiblePoints = this.points.filter((p) => {
      if (this.currentMethod === "both") return true;
      return p.method === this.currentMethod;
    });

    visiblePoints.forEach((p, i) => {
      const x = this.scaleX(p.real);
      const y = this.scaleY(p.sim);
      const color = getModelColor(p.model, p.method);
      const shape = TASK_SHAPES[p.task];

      const el = createShape(shape, x, y, 14, color, "#222", 1);
      el.classList.add("scatter-point");
      el.style.opacity = "0";
      el.style.transform = "scale(0)";
      el.style.transformOrigin = `${x}px ${y}px`;
      el.dataset.method = p.method;
      el.dataset.task = p.task;
      el.dataset.model = p.model;

      el.addEventListener("mouseenter", (e) => this.showTooltip(e, p));
      el.addEventListener("mouseleave", () => this.hideTooltip());

      group.appendChild(el);

      setTimeout(() => {
        el.style.transition = "opacity 0.4s ease-out, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)";
        el.style.opacity = "1";
        el.style.transform = "scale(1)";
      }, 30 + i * 20);
    });
  }

  showTooltip(e, p) {
    const methodLabel = p.method === "simfoundry" ? "SimFoundry" : "Polaris";
    const metrics = TASK_METRICS[p.method][p.task];
    const rStr = metrics.r !== null ? metrics.r.toFixed(3) : "N/A";
    const mmrvStr = metrics.mmrv !== null ? metrics.mmrv.toFixed(3) : "N/A";

    this.tooltip.innerHTML = `
      <strong>${TASK_LABELS[p.task]}</strong><br>
      <span class="tooltip-method ${p.method}">${methodLabel}</span> · ${MODEL_LABELS[p.model]}<br>
      Real: ${p.real}% · Sim: ${p.sim}%<br>
      <span class="tooltip-metrics">r = ${rStr} · MMRV = ${mmrvStr}</span>
    `;
    this.tooltip.style.opacity = "1";
    this.tooltip.style.visibility = "hidden";
    this.tooltip.style.left = "0";
    this.tooltip.style.top = "0";

    const rect = this.svg.getBoundingClientRect();
    const container = this.svg.parentElement.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const tooltipW = tooltipRect.width;
    const tooltipH = tooltipRect.height;

    let x = e.clientX - rect.left + 15;
    let y = e.clientY - rect.top - 10;

    if (x + tooltipW > rect.width) {
      x = e.clientX - rect.left - tooltipW - 15;
    }
    if (x < 0) {
      x = 10;
    }

    if (y + tooltipH > rect.height) {
      y = e.clientY - rect.top - tooltipH - 15;
    }
    if (y < 0) {
      y = 10;
    }

    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
    this.tooltip.style.visibility = "visible";
  }

  hideTooltip() {
    this.tooltip.style.opacity = "0";
  }

  setMethod(method) {
    this.currentMethod = method;
    this.animatePoints();
  }

  buildLegends() {
    const sfLegend = document.getElementById("legend-simfoundry");
    const polLegend = document.getElementById("legend-polaris");
    const taskLegend = document.getElementById("legend-tasks");

    if (!sfLegend || !polLegend || !taskLegend) return;

    // Diagonal reference
    sfLegend.innerHTML = `
      <div class="legend-item">
        <svg width="24" height="14"><line x1="2" y1="12" x2="22" y2="2" stroke="#999" stroke-width="1.5" stroke-dasharray="4,3"/></svg>
        <span>Sim = Real</span>
      </div>
    `;

    // Model legends for SimFoundry
    MODEL_ORDER.forEach((m) => {
      const color = getModelColor(m, "simfoundry");
      sfLegend.innerHTML += `
        <div class="legend-item">
          <svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="${color}" stroke="#222" stroke-width="1"/></svg>
          <span>${MODEL_LABELS[m]}</span>
        </div>
      `;
    });

    // Model legends for Polaris
    MODEL_ORDER.forEach((m) => {
      const color = getModelColor(m, "polaris");
      polLegend.innerHTML += `
        <div class="legend-item">
          <svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="${color}" stroke="#222" stroke-width="1"/></svg>
          <span>${MODEL_LABELS[m]}</span>
        </div>
      `;
    });

    // Task legends
    Object.entries(TASK_SHAPES).forEach(([task, shape]) => {
      const svgContent = this.getLegendShape(shape);
      taskLegend.innerHTML += `
        <div class="legend-item">
          <svg width="16" height="16">${svgContent}</svg>
          <span>${TASK_LABELS[task]}</span>
        </div>
      `;
    });
  }

  getLegendShape(shape) {
    const gray = "#888";
    switch (shape) {
      case "circle":
        return `<circle cx="8" cy="8" r="5" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
      case "square":
        return `<rect x="3" y="3" width="10" height="10" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
      case "diamond":
        return `<polygon points="8,2 14,8 8,14 2,8" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
      case "triangle-up":
        return `<polygon points="8,2 14,13 2,13" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
      case "triangle-down":
        return `<polygon points="8,14 14,3 2,3" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
      case "plus":
        return `<path d="M6,2 h4 v4 h4 v4 h-4 v4 h-4 v-4 h-4 v-4 h4 z" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
      case "star":
        return `<polygon points="8,1 9.8,5.8 15,6.2 11,9.8 12.2,15 8,12 3.8,15 5,9.8 1,6.2 6.2,5.8" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
      default:
        return `<circle cx="8" cy="8" r="5" fill="${gray}" stroke="#222" stroke-width="0.5"/>`;
    }
  }

  wireControls() {
    const buttons = document.querySelectorAll(".chart-toggle");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        this.setMethod(btn.dataset.method);
      });
    });
  }
}

function computeAverageMetrics() {
  const avgMetrics = { simfoundry: { r: 0, mmrv: 0 }, polaris: { r: 0, mmrv: 0 } };
  
  for (const method of ["simfoundry", "polaris"]) {
    const tasks = Object.keys(TASK_METRICS[method]);
    let sumR = 0, sumMMRV = 0, countR = 0, countMMRV = 0;
    
    for (const task of tasks) {
      const m = TASK_METRICS[method][task];
      if (m.r !== null) { sumR += m.r; countR++; }
      if (m.mmrv !== null) { sumMMRV += m.mmrv; countMMRV++; }
    }
    
    avgMetrics[method].r = countR > 0 ? sumR / countR : 0;
    avgMetrics[method].mmrv = countMMRV > 0 ? sumMMRV / countMMRV : 0;
  }
  
  return avgMetrics;
}

function renderMetricsBars() {
  const avg = computeAverageMetrics();
  
  const barRSf = document.getElementById("bar-r-sf");
  const barRPol = document.getElementById("bar-r-pol");
  const valRSf = document.getElementById("val-r-sf");
  const valRPol = document.getElementById("val-r-pol");
  
  const barMmrvSf = document.getElementById("bar-mmrv-sf");
  const barMmrvPol = document.getElementById("bar-mmrv-pol");
  const valMmrvSf = document.getElementById("val-mmrv-sf");
  const valMmrvPol = document.getElementById("val-mmrv-pol");
  
  if (!barRSf || !barRPol) return;
  
  // Pearson r: scale 0-1 to 0-100%
  const rSf = avg.simfoundry.r;
  const rPol = avg.polaris.r;
  
  valRSf.textContent = rSf.toFixed(3);
  valRPol.textContent = rPol.toFixed(3);
  
  // MMRV: scale 0-1 to 0-100% (but lower is better)
  const mmrvSf = avg.simfoundry.mmrv;
  const mmrvPol = avg.polaris.mmrv;
  
  valMmrvSf.textContent = mmrvSf.toFixed(3);
  valMmrvPol.textContent = mmrvPol.toFixed(3);
  
  // Animate bars after a short delay
  setTimeout(() => {
    barRSf.style.width = `${Math.max(rSf, 0) * 100}%`;
    barRPol.style.width = `${Math.max(rPol, 0) * 100}%`;
    barMmrvSf.style.width = `${Math.min(mmrvSf, 1) * 100}%`;
    barMmrvPol.style.width = `${Math.min(mmrvPol, 1) * 100}%`;
  }, 100);
}

document.addEventListener("DOMContentLoaded", () => {
  new ScatterChart("scatter-svg", "scatter-tooltip");
  renderMetricsBars();
});

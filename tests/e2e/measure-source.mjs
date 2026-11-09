// BUDGETS and INSPECT are copied unchanged from seed/measure.cjs and locked by tests/unit/lock.test.mjs. Read-only.
export const BUDGETS = {
  first: { chromeWords: 30, words: 80, rows: 14, maxWordsInRow: 9, controlsOutsideRows: 8, filledButtons: 1, wordsUnder15px: 0, colours: 2, biggestCount: 1 },
  list: { chromeWords: 30, words: 130, rows: 14, maxWordsInRow: 9, controlsOutsideRows: 8, filledButtons: 1, wordsUnder15px: 0, colours: 2, biggestCount: 1 },
  detail: { panelWords: 60, filledButtons: 1, wordsUnder15px: 0, colours: 2 },
  none: {},
};

// Runs inside the page.
export const INSPECT = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = { viewport: [vw, vh], words: 0, chromeWords: 0, rowWords: 0, panelWords: 0, wordsUnder15px: 0, minFont: 999 };
  const sizes = {};
  const blocks = [];
  const hues = new Set();
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hueName = (c) => {
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    if (max - min < 40) return null;
    let h = max === c.r ? ((c.g - c.b) / (max - min)) % 6 : max === c.g ? (c.b - c.r) / (max - min) + 2 : (c.r - c.g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
    return h < 20 || h >= 335 ? "red" : h < 50 ? "orange" : h < 70 ? "yellow" : h < 170 ? "green" : h < 260 ? "blue" : "purple";
  };
  const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const shown = (el) => el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
  const onTop = (el, r) => {
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  const count = (text, el, r) => {
    const n = text.trim().split(/\\s+/).filter((w) => /[\\p{L}\\p{N}]/u.test(w)).length;
    if (!n) return;
    const cs = getComputedStyle(el);
    const fs = Math.round(parseFloat(cs.fontSize) * 10) / 10;
    out.words += n;
    const inRow = !!el.closest("[data-rows]"), inPanel = !!el.closest("[data-panel]");
    if (inRow) out.rowWords += n; else out.chromeWords += n;
    if (inPanel) out.panelWords += n;
    if (fs < 15) out.wordsUnder15px += n;
    out.minFont = Math.min(out.minFont, fs);
    sizes[fs] = (sizes[fs] || 0) + n;
    blocks.push({ fs, text: text.trim().slice(0, 70), y: Math.round(r.top) });
    const c = parse(cs.color); if (c && c.a > 0.3) { const h = hueName(c); if (h) hues.add(h); }
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, el = node.parentElement;
    if (!el || !node.textContent.trim() || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION"].includes(el.tagName) || !shown(el)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!inView(r) || !onTop(el, r)) continue;
    count(node.textContent, el, r);
  }
  document.querySelectorAll("input, select, textarea").forEach((el) => {
    if (!shown(el) || ["checkbox", "radio", "hidden"].includes(el.type)) return;
    const r = el.getBoundingClientRect();
    if (!inView(r) || !onTop(el, r)) return;
    const text = el.tagName === "SELECT" ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : "") : (el.value || el.placeholder || "");
    if (text) count(text, el, r);
  });
  const CONTROL = "a[href], button, input, select, textarea, [role=button], [role=tab], [role=switch], [role=menuitem], [onclick]";
  let inRowsC = 0, outC = 0, filled = 0;
  const seen = new Set();
  document.querySelectorAll(CONTROL).forEach((el) => {
    if (el.parentElement && el.parentElement.closest(CONTROL) || !shown(el) || el.type === "hidden") return;
    const r = el.getBoundingClientRect();
    if (!inView(r) || !onTop(el, r) || seen.has(el)) return;
    seen.add(el);
    if (el.closest("[data-rows]")) inRowsC++; else outC++;
    const cs = getComputedStyle(el), bg = parse(cs.backgroundColor);
    if (bg && bg.a > 0.5 && el.tagName !== "INPUT" && el.tagName !== "SELECT" && (bg.r * 0.299 + bg.g * 0.587 + bg.b * 0.114) < 170) filled++;
  });
  document.querySelectorAll("body *").forEach((el) => {
    if (!shown(el)) return;
    const r = el.getBoundingClientRect();
    if (!inView(r)) return;
    const bg = parse(getComputedStyle(el).backgroundColor);
    if (bg && bg.a > 0.3) { const h = hueName(bg); if (h) hues.add(h); }
  });
  const rows = [...document.querySelectorAll("[data-row]")].filter((el) => { if (!shown(el)) return false; const r = el.getBoundingClientRect(); return inView(r) && onTop(el, r); });
  const wordsIn = (el) => (el.innerText || "").trim().split(/\\s+/).filter((w) => /[\\p{L}\\p{N}]/u.test(w)).length;
  out.rows = rows.length;
  out.maxWordsInRow = rows.length ? Math.max(...rows.map(wordsIn)) : 0;
  const heights = rows.map((el) => Math.round(el.getBoundingClientRect().height)).sort((a, b) => a - b);
  out.rowHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  out.controlsOutsideRows = outC; out.controlsInRows = inRowsC; out.filledButtons = filled;
  if (out.minFont === 999) out.minFont = 0;
  out.fontSizes = Object.fromEntries(Object.entries(sizes).sort((a, b) => b[0] - a[0]));
  const maxFs = Math.max(0, ...blocks.map((b) => b.fs));
  const top = blocks.filter((b) => b.fs === maxFs);
  out.biggest = top.map((b) => b.text).slice(0, 3);
  out.biggestCount = new Set(top.map((b) => Math.round(b.y / 6))).size;
  out.biggestPx = maxFs;
  out.colours = [...hues];
  out.scrollsSideways = document.documentElement.scrollWidth > vw + 1;
  return out;
})()`;

// Ported from measure.cjs. errors is the page's error messages; report gains errors, errorText and overBudget.
export function judge(report, budgetName, errors = []) {
  report.errors = errors.length;
  if (errors.length) report.errorText = errors.slice(0, 4).map((e) => String(e).slice(0, 240));
  const budget = BUDGETS[budgetName] || {};
  report.overBudget = Object.entries(budget).filter(([k, max]) => (k === "colours" ? report.colours.length : report[k]) > max).map(([k, max]) => `${k} ${k === "colours" ? report.colours.length : report[k]} (limit ${max})`);
  if (budgetName !== "none" && report.minFont < 15) report.overBudget.push(`minFont ${report.minFont} (must be 15 or more)`);
  if ((budgetName === "list" || budgetName === "first") && report.biggestPx < 26) report.overBudget.push(`biggest text ${report.biggestPx}px (must be 26 or more)`);
  if (budgetName !== "none" && report.scrollsSideways) report.overBudget.push("page scrolls sideways");
  if (errors.length) report.overBudget.push(`${errors.length} page errors`);
  return report;
}

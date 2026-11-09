// The product's stack of priorities on invented years, for HiGHS. Each stage is its own solve, pinned before the next.
const OPTIONS = { output_flag: false, mip_rel_gap: 0, mip_abs_gap: 0.9, time_limit: 60, random_seed: 0 };
const wrap = (t) => { const l = []; for (let i = 0; i < t.length; i += 12) l.push(" " + t.slice(i, i + 12).join(" ")); return l.join("\n"); };
const term = ([c, n]) => (c < 0 ? `- ${-c} ${n}` : `+ ${c} ${n}`);
function build(inst) {
  const best = new Map();
  for (const p of inst.prefs) { const k = p.t + "|" + p.c, b = inst.bonus[p.round], cur = best.get(k); if (!cur) best.set(k, { rank: p.rank, bonus: b }); else { cur.rank = Math.min(cur.rank, p.rank); cur.bonus = Math.max(cur.bonus, b); } }
  const submitters = new Set(inst.prefs.map((p) => p.t)), unticked = new Set(inst.unticked), stay = inst.stay || {};
  const repeaterOn = new Map(inst.teachers.filter((t) => t.repeater && t.incumbent).map((t) => [t.id, t.incumbent]));
  const lockedCourses = new Set([...repeaterOn.values()].filter((c) => !unticked.has(c)));
  const vars = [], byT = new Map(inst.teachers.map((t) => [t.id, []])), byC = new Map(inst.courses.map((c) => [c.id, []]));
  const genderOf = new Map(inst.teachers.map((t) => [t.id, t.gender]));
  const forced = [];
  for (const c of inst.courses) {
    if (unticked.has(c.id)) continue;
    for (const t of inst.teachers) {
      const inc = repeaterOn.get(t.id);
      if (inc && inc !== c.id) continue;              // returning sponsors stay put
      if (!c.requires.every((r) => t.quals.includes(r))) continue;  // certificates
      if (submitters.has(t.id) && !best.has(t.id + "|" + c.id) && inc !== c.id) continue;  // only courses they ranked
      const v = { name: "x" + vars.length, t: t.id, c: c.id }; vars.push(v); byT.get(t.id).push(v); byC.get(c.id).push(v);
      if (inc === c.id) forced.push(v.name);
    }
  }
  const rows = [], bins = vars.map((v) => v.name), conts = [];
  let r = 0;
  for (const n of forced) rows.push(` r${r++}: ${n} = 1`);
  for (const [, vs] of byT) if (vs.length) rows.push(` r${r++}:\n${wrap(vs.map((v) => "+ " + v.name))}\n <= 1`);
  const shortTerms = [], mixedTerms = [];
  inst.courses.forEach((c, i) => {
    if (unticked.has(c.id)) return;
    const here = byC.get(c.id).map((v) => "+ " + v.name);
    if (lockedCourses.has(c.id)) {
      const s = "s" + i; conts.push(s); shortTerms.push([1, s]);
      rows.push(` r${r++}:\n${wrap([...here, "+ " + s])}\n >= ${c.min}`);
      rows.push(` r${r++}:\n${wrap(here)}\n <= ${c.max}`);
    } else {
      const y = "y" + i; bins.push(y);
      if (here.length) { rows.push(` r${r++}:\n${wrap([...here, `- ${c.min} ${y}`])}\n >= 0`); rows.push(` r${r++}:\n${wrap([...here, `- ${c.max} ${y}`])}\n <= 0`); }
      else rows.push(` r${r++}: ${y} = 0`);
    }
    const men = byC.get(c.id).filter((v) => genderOf.get(v.t) === "male").map((v) => v.name), women = byC.get(c.id).filter((v) => genderOf.get(v.t) === "female").map((v) => v.name);
    if (men.length && women.length && c.max >= 2) {
      const z = "z" + i; bins.push(z); mixedTerms.push([2, z]);
      rows.push(` r${r++}:\n${wrap([`+ ${z}`, ...men.map((n) => "- " + n)])}\n <= 0`);
      rows.push(` r${r++}:\n${wrap([`+ ${z}`, ...women.map((n) => "- " + n)])}\n <= 0`);
    }
  });
  const score = vars.flatMap((v) => { const b = best.get(v.t + "|" + v.c); return b ? [[inst.weights[b.rank - 1] + b.bonus, v.name]] : []; });
  const noForm = vars.filter((v) => !submitters.has(v.t) && !repeaterOn.has(v.t)).map((v) => [1, v.name]);
  const stays = vars.filter((v) => stay[v.t] === v.c).map((v) => [1, v.name]);
  const stages = [["min", shortTerms], ["max", [...score, ...mixedTerms]], ["min", noForm], ["max", stays]];
  return { vars, rows, bins, conts, stages, best, submitters, repeaterOn, lockedCourses, byC };
}
function lpText(m, sense, terms, pins) {
  const pinRows = pins.map(([ts, val], i) => ` pin${i}:\n${wrap(ts.map(term))}\n = ${val}`);
  return [sense === "max" ? "Maximize" : "Minimize", " obj:", wrap(terms.length ? terms.map(term) : ["0 " + m.bins[0]]), "Subject To", m.rows.join("\n"), ...(pinRows.length ? [pinRows.join("\n")] : []),
    ...(m.conts.length ? ["Bounds", m.conts.map((s) => ` ${s} >= 0`).join("\n")] : []), "Binaries", wrap(m.bins), "End", ""].join("\n");
}
function solveStack(highs, inst, extra = {}) {
  const m = build(inst), pins = [], values = []; let res, secs = 0;
  for (const [sense, terms] of m.stages) {
    if (!terms.length) { values.push(0); continue; }
    const t0 = performance.now();
    res = highs.solve(lpText(m, sense, terms, pins), { ...OPTIONS, ...extra });
    secs += (performance.now() - t0) / 1000;
    if (res.Status !== "Optimal") return { status: res.Status, values, secs };
    const v = Math.round(res.ObjectiveValue); values.push(v); pins.push([terms, v]);
  }
  const assignment = Object.fromEntries(inst.teachers.map((t) => [t.id, null]));
  for (const v of m.vars) if (res.Columns[v.name] && res.Columns[v.name].Primal > 0.5) assignment[v.t] = v.c;
  return { status: "Optimal", values, secs, assignment };
}
module.exports = { build, lpText, solveStack, OPTIONS };

// The draft: each priority is its own solve, pinned before the next. Runs HiGHS on the page.
import highsLoader from "highs";

const OPTIONS = { output_flag: false, mip_rel_gap: 0, mip_abs_gap: 0.9, time_limit: 60, random_seed: 0 };
const WEIGHTS = [7, 6, 5, 4, 3, 2, 1];
const BONUS = { "Round 1": 20, "Round 2": 10, Singapore: 0 };
const ROUNDS = ["Round 1", "Round 2", "Singapore"];

export function loadHighs(options) {
  return highsLoader(options);
}

const key = (s) => s.trim().toLowerCase();
const byKey = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);

// The rank the page shows for a course: the one on the earliest of Round 1, Round 2, Singapore that lists it.
export function displayedRank(prefs, courseId) {
  const listings = prefs.filter((p) => p.course === courseId);
  listings.sort((a, b) => ROUNDS.indexOf(a.round) - ROUNDS.indexOf(b.round) || a.rank - b.rank);
  return listings.length ? listings[0].rank : null;
}

export function toInstance(school) {
  const teachers = [...school.teachers].sort(byKey((t) => key(t.email)));
  const courses = [...school.courses].sort(byKey((c) => c.id));
  return {
    teachers: teachers.map((t) => ({
      id: t.id,
      quals: t.certificates,
      repeater: t.returning,
      incumbent: t.returningCourse,
    })),
    courses: courses.map((c) => ({ id: c.id, min: c.seats, max: c.seats, requires: c.needs ? [c.needs] : [] })),
    prefs: teachers.flatMap((t) => t.prefs.map((p) => ({ t: t.id, c: p.course, rank: p.rank, round: p.round }))),
    unticked: courses.filter((c) => !c.running).map((c) => c.id),
    owed: school.past ? teachers.filter((t) => t.lastYear && t.lastYear.result === "none").map((t) => t.id) : null,
    weights: WEIGHTS,
    bonus: BONUS,
  };
}

const wrap = (t) => {
  const l = [];
  for (let i = 0; i < t.length; i += 12) l.push(" " + t.slice(i, i + 12).join(" "));
  return l.join("\n");
};
const term = ([c, n]) => (c < 0 ? `- ${-c} ${n}` : `+ ${c} ${n}`);

function build(inst) {
  const best = new Map();
  for (const p of inst.prefs) {
    const k = p.t + "|" + p.c, b = inst.bonus[p.round], cur = best.get(k);
    if (!cur) best.set(k, { rank: p.rank, bonus: b });
    else { cur.rank = Math.min(cur.rank, p.rank); cur.bonus = Math.max(cur.bonus, b); }
  }
  const submitters = new Set(inst.prefs.map((p) => p.t)), unticked = new Set(inst.unticked);
  const repeaterOn = new Map(inst.teachers.filter((t) => t.repeater && t.incumbent).map((t) => [t.id, t.incumbent]));
  const lockedCourses = new Set([...repeaterOn.values()].filter((c) => !unticked.has(c)));
  const vars = [], byT = new Map(inst.teachers.map((t) => [t.id, []])), byC = new Map(inst.courses.map((c) => [c.id, []]));
  const forced = [];
  for (const c of inst.courses) {
    if (unticked.has(c.id)) continue;
    for (const t of inst.teachers) {
      const inc = repeaterOn.get(t.id);
      if (inc && inc !== c.id) continue;
      if (!c.requires.every((r) => t.quals.includes(r))) continue;
      if (submitters.has(t.id) && !best.has(t.id + "|" + c.id) && inc !== c.id) continue;
      const v = { name: "x" + vars.length, t: t.id, c: c.id };
      vars.push(v); byT.get(t.id).push(v); byC.get(c.id).push(v);
      if (inc === c.id) forced.push(v.name);
    }
  }
  const rows = [], bins = vars.map((v) => v.name), conts = [];
  let r = 0;
  for (const n of forced) rows.push(` r${r++}: ${n} = 1`);
  for (const [, vs] of byT) if (vs.length) rows.push(` r${r++}:\n${wrap(vs.map((v) => "+ " + v.name))}\n <= 1`);
  const shortTerms = [];
  inst.courses.forEach((c, i) => {
    if (unticked.has(c.id)) return;
    const here = byC.get(c.id).map((v) => "+ " + v.name);
    if (lockedCourses.has(c.id)) {
      const s = "s" + i; conts.push(s); shortTerms.push([1, s]);
      rows.push(` r${r++}:\n${wrap([...here, "+ " + s])}\n >= ${c.min}`);
      rows.push(` r${r++}:\n${wrap(here)}\n <= ${c.max}`);
    } else {
      const y = "y" + i; bins.push(y);
      if (here.length) {
        rows.push(` r${r++}:\n${wrap([...here, `- ${c.min} ${y}`])}\n >= 0`);
        rows.push(` r${r++}:\n${wrap([...here, `- ${c.max} ${y}`])}\n <= 0`);
      } else rows.push(` r${r++}: ${y} = 0`);
    }
  });
  const score = vars.flatMap((v) => { const b = best.get(v.t + "|" + v.c); return b ? [[inst.weights[b.rank - 1] + b.bonus, v.name]] : []; });
  const noForm = vars.filter((v) => !submitters.has(v.t) && !repeaterOn.has(v.t)).map((v) => [1, v.name]);
  const stages = [["min", shortTerms], ["max", score], ["min", noForm]];
  if (inst.owed !== null) {
    // Those who got none of their choices last year, on a 1st to 4th choice this year. A returning sponsor is fixed, so not counted.
    const owed = new Set(inst.owed), listed = new Map(inst.owed.map((t) => [t, []]));
    for (const p of inst.prefs) if (owed.has(p.t)) listed.get(p.t).push({ course: p.c, rank: p.rank, round: p.round });
    const top4 = (v) => { const rank = displayedRank(listed.get(v.t), v.c); return rank !== null && rank <= 4; };
    stages.splice(1, 0, ["max", vars.filter((v) => owed.has(v.t) && !repeaterOn.has(v.t) && top4(v)).map((v) => [1, v.name])]);
  }
  return { vars, rows, bins, conts, stages };
}

function lpText(m, sense, terms, pins) {
  const pinRows = pins.map(([ts, val], i) => ` pin${i}:\n${wrap(ts.map(term))}\n = ${val}`);
  return [
    sense === "max" ? "Maximize" : "Minimize", " obj:", wrap(terms.length ? terms.map(term) : ["0 " + m.bins[0]]),
    "Subject To", m.rows.join("\n"), ...(pinRows.length ? [pinRows.join("\n")] : []),
    ...(m.conts.length ? ["Bounds", m.conts.map((s) => ` ${s} >= 0`).join("\n")] : []),
    "Binaries", wrap(m.bins), "End", "",
  ].join("\n");
}

// values: [short seats (min), score (max), no-form placed (min)], or with last year's files
// [short seats (min), owed on a top-4 choice (max), score (max), no-form placed (min)]. pairs: one [tid, cid] per placed column.
export function solveDraft(highs, school) {
  const inst = toInstance(school), m = build(inst), pins = [], values = [];
  let res;
  for (const [sense, terms] of m.stages) {
    if (!terms.length) { values.push(0); continue; }
    res = highs.solve(lpText(m, sense, terms, pins), OPTIONS);
    if (res.Status !== "Optimal") return { status: res.Status, values, pairs: [] };
    const v = Math.round(res.ObjectiveValue);
    values.push(v); pins.push([terms, v]);
  }
  const pairs = m.vars.filter((v) => res.Columns[v.name] && res.Columns[v.name].Primal > 0.5).map((v) => [v.t, v.c]);
  return { status: "Optimal", values, pairs };
}

export function toDraft(school, pairs) {
  const draft = Object.fromEntries(school.teachers.map((t) => [t.id, null]));
  for (const [t, c] of pairs) draft[t] = c;
  return draft;
}

import { Mock } from "./state.js";
import { parseFiles, SLOTS } from "./import.js";
import { loadHighs, solveDraft, toDraft } from "./solver.js";
import { recheck } from "./recheck.js";
import { sheetsFor, fileName } from "./export.js";
import { writeBook } from "./xlsx.js";
import { addSnapshot, loadAll, saveUpload, wipe } from "./store.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const L = (id) => esc(Mock.label(id));
const many = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const byId = (a, b) => a.id.localeCompare(b.id);
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const view = { tab: "todo", stack: [], idx: 0, q: { courses: "", teachers: "" } };
const top_ = () => view.stack[view.stack.length - 1];

/* Start: files stay in memory, keyed by name, until Build. Nothing is stored. */
const held = new Map();
let phase = "loading"; // loading, start, building, failed or draft
let slots = {};
let parsed = null;
let reading = 0;
let queue = Promise.resolve();

/* Saving: one write at a time, in order. A write that fails stops the line, so "saved" is never claimed over a gap. */
let savedVersion = null;
let saving = Promise.resolve();
function inOrder(job) {
  saving = saving.then(job);
  saving.catch(() => {});
}
function showSaved() {
  const el = document.querySelector("[data-saved]");
  if (!el || savedVersion === null) return;
  el.dataset.version = savedVersion;
  el.textContent = savedVersion === Mock.state.version ? "Saved in this browser" : "";
}
function remember(snap) {
  inOrder(async () => {
    await addSnapshot(snap);
    savedVersion = snap.version;
    showSaved();
  });
}
function startOver() {
  const toStart = () => location.reload();
  saving.catch(() => {}).then(wipe).then(toStart, toStart);
}

const readBytes = (f) => f.arrayBuffer().then((b) => new Uint8Array(b), () => new Uint8Array());
// Drops are handled strictly in order, so a later file always replaces an earlier one of the same name.
function addFiles(list) {
  if (phase !== "start") return;
  const files = [...list];
  reading += 1;
  parsed = null;
  render();
  queue = queue.then(async () => {
    try {
      for (const f of files) held.set(f.name, { name: f.name, bytes: await readBytes(f) });
      const named = (yes) => [...held.values()].filter((f) => SLOTS.includes(f.name) === yes);
      // A file with any other name keeps its one line but never holds up Build.
      const out = await parseFiles(named(true));
      slots = { ...(await parseFiles(named(false))).slots, ...out.slots };
      parsed = out.school;
    } catch {
      parsed = null;
    } finally {
      reading -= 1;
      render();
    }
  });
}
const canBuild = () => phase === "start" && reading === 0 && !!parsed;

async function build() {
  if (!canBuild()) return;
  // T numbers are random, so T-number order says nothing about names or the order of the staff file. The solver sorts its own input.
  const school = { ...parsed, teachers: [...parsed.teachers].sort(byId) };
  phase = "building";
  render();
  try {
    const { status, pairs } = solveDraft(await loadHighs({ locateFile: (f) => "/" + f }), school);
    if (status !== "Optimal" || recheck(school, pairs).length) { phase = "failed"; render(); return; }
    inOrder(() => saveUpload(school));
    Mock.init(school);
    Mock.build(toDraft(school, pairs));
    held.clear();
    phase = "draft";
  } catch {
    phase = "failed";
  }
  render();
}

function slotRow(name) {
  const v = slots[name];
  if (v === "ready") return `<div class="row r-two" data-row data-slot="${esc(name)}"><span>${esc(name)}</span><span class="q">ready</span></div>`;
  return `<div class="row" data-row data-slot="${esc(name)}"><span class="${v.endsWith("file not added") ? "q" : "need"}">${esc(v)}</span></div>`;
}
function startView() {
  if (phase === "failed") return `<h1 class="big" data-big>Couldn't build a draft. Reload and try again.</h1>`;
  const names = [...SLOTS, ...Object.keys(slots).filter((n) => !SLOTS.includes(n))].filter((n) => slots[n]);
  return `<div class="narrow drop" data-drop>
    <h1 class="big" data-big>Drop the six files here</h1>
    <p class="sub"><span>Invented school</span>&ensp;<span>Interim 2028</span></p>
    <label class="link choose">Choose files<input type="file" multiple accept=".xlsx" data-k="files"></label>
    <div class="gap" data-rows>${names.map(slotRow).join("")}</div>
    <div class="acts"><button class="btn fill" data-act="build" data-k="build"${canBuild() ? "" : " disabled"}>${phase === "building" ? "Building" : "Build"}</button></div>
  </div>`;
}

const who = (id) => `${id} ${Mock.label(id)}`;

function shortNeed(text) {
  const m = text.match(/Needs sponsors: (\d+) of (\d+)/);
  return m ? `Needs ${many(m[2] - m[1], "sponsor")}` : text;
}
function worst(cid) {
  const f = Mock.courseFlags(cid);
  return f.find((x) => x.level === "needs") || f[0] || null;
}
function longChoice(id, c) {
  const t = Mock.teacher(id);
  if (t.returning && t.returningCourse === c) return "Returning sponsor";
  if (!t.submitted) return "No form received";
  return Mock.choiceText(id, c);
}
function teacherOrder(id) {
  const t = Mock.teacher(id), c = Mock.placedOn(id);
  if (!c) return 1000;
  if (t.returning && t.returningCourse === c) return -1;
  const ch = Mock.choice(id, c);
  return ch ? ch.rank : 100;
}
const warns = (o) => o.warn.map((x) => x.replace("This course is full", "Full").replace(" on file", "")).join(", ").replace(/, (\w)/g, (_, c) => `, ${c.toLowerCase()}`);

/* Top bar and bottom line */
function topBar() {
  const s = Mock.summary(), n = Mock.todo().length;
  const running = Mock.courses().filter((c) => Mock.sponsors(c.id).length).length;
  const tab = (id, text) => `<button class="tab" role="tab" data-tab="${id}" data-k="tab-${id}" aria-selected="${view.tab === id}">${text}</button>`;
  return `<div class="wrap bar" data-result data-placed="${s.placed}" data-running="${running}">
    <div class="brand">Invented school</div>
    <div class="tabs" role="tablist">${tab("todo", n ? `To do ${n}` : "To do")}${tab("teachers", "Teachers")}${tab("courses", "Courses")}</div>
    <div class="right">
      <button class="switch" role="switch" data-names data-k="names" aria-checked="${Mock.state.namesOn}">Show names <span class="track"><span class="knob"></span></span></button>
      <button class="plain" data-download data-k="download" title="${Mock.state.namesOn ? "Download with names" : "Download with T numbers"}">Download</button>
    </div></div>`;
}
const bottomLine = () => `<div class="wrap"><span data-saved></span>
  ${Mock.canUndo() ? `<button class="link" data-act="undo" data-k="un">Undo</button>` : ""}
  <button class="link" data-act="open" data-to="history" data-k="hist">History</button></div>`;

/* Opened items */
const card = (inner) => `<section class="card" data-panel>${inner}</section>`;
const back = () => `<button class="link back" data-act="back" data-k="back">Back</button>`;
const title = (t) => `<h2 tabindex="-1">${t}</h2>`;

function teacherBody(id) {
  const c = Mock.placedOn(id), mail = Mock.contact(id);
  const opts = Mock.optionsFor(id).filter((o) => o.choice !== "Not on their list").slice(0, 5);
  let round = null;
  const rows = opts.map((o) => {
    const [n, r] = o.choice.split(" choice, ");
    const head = r === round ? "" : `<div class="row r-opt head"><span>${round === null ? "Move to" : ""}</span><span>${esc(r)}</span><span></span></div>`;
    round = r;
    return `${head}<button class="row r-opt" data-row data-act="moveTo" data-id="${id}" data-c="${esc(o.cid)}" data-k="o-${esc(o.cid)}"><span>${esc(o.name)}</span><span class="q">${esc(n)}</span><span class="q">${esc(warns(o))}</span></button>`;
  }).join("");
  return `${title(L(id))}
    <p class="under ${c ? "" : "need"}">${c ? esc(Mock.course(c).name) : "Not placed"}</p>
    <p class="why"><span class="q">Why</span>&ensp;${esc(Mock.reason(id))}</p>
    ${mail ? `<p class="q gap">${esc(mail)}</p>` : ""}
    ${!c && !Mock.state.left.has(id) ? `<div class="acts"><button class="btn" data-act="leave" data-id="${id}" data-k="lv">Leave unplaced</button></div>` : ""}
    ${rows ? `<div class="gap" data-rows>${rows}</div>` : ""}
    <div class="links"><button class="link" data-act="open" data-to="move" data-id="${id}" data-k="all">All options</button></div>`;
}
function noFormBody(tids) {
  return `${title(`${tids.length === 1 ? "1 person" : `${tids.length} people`} with no form`)}
    <div class="gap" data-rows>${tids.map((id) => `<button class="row r-two" data-row data-teacher="${id}" data-k="n-${id}"><span>${L(id)}</span></button>`).join("")}</div>
    <div class="acts"><button class="btn" data-act="leaveGroup" data-k="lg">Leave them unplaced</button></div>`;
}
function askedRows(list, first) {
  let round = null;
  if (!list.length) return `<div class="row r-asked head"><span>${first}</span></div><div class="row q">Nobody</div>`;
  return list.map((x) => {
    const [n, r] = x.choice.split(" choice, ");
    const head = r === round ? "" : `<div class="row r-asked head"><span>${round === null ? first : ""}</span><span>${esc(r)}</span></div>`;
    round = r;
    return `${head}<button class="row r-asked" data-row data-teacher="${x.tid}" data-k="a-${x.tid}"><span>${L(x.tid)}</span><span class="q">${esc(n)}</span></button>`;
  }).join("");
}
// Who could actually fill a seat here: unplaced teachers who qualify, then qualified teachers who asked for it.
function fillers(cid) {
  const c = Mock.course(cid), ok = (t) => !c.needs || t.certificates.includes(c.needs);
  const asked = Mock.whoAsked(cid), askedAt = new Map(asked.map((x, i) => [x.tid, i]));
  const free = Mock.teachers().filter((t) => !Mock.placedOn(t.id) && !Mock.state.left.has(t.id) && ok(t))
    .sort((a, b) => (askedAt.get(a.id) ?? 999) - (askedAt.get(b.id) ?? 999) || byId(a, b));
  const elsewhere = asked.filter((x) => !x.placedHere && Mock.placedOn(x.tid) && ok(Mock.teacher(x.tid)));
  return [...free.map((t) => ({ tid: t.id, now: "Not placed" })), ...elsewhere.map((x) => ({ tid: x.tid, now: x.choice.split(" choice")[0] }))].slice(0, 5);
}
function fillRows(cid) {
  const list = fillers(cid);
  if (!list.length) return "";
  return `<div class="gap" data-rows><div class="row r-fill head"><span>Could sponsor</span><span></span><span></span></div>${list.map((x) =>
    `<button class="row r-fill" data-row data-act="moveTo" data-id="${x.tid}" data-c="${esc(cid)}" data-k="f-${x.tid}"><span>${L(x.tid)}</span><span class="q">${esc(x.now)}</span><span class="go">Move here</span></button>`).join("")}</div>`;
}
function courseBody(cid) {
  const c = Mock.course(cid), list = Mock.sponsors(cid), short = list.length < c.seats;
  const asked = Mock.whoAsked(cid).filter((x) => !x.placedHere);
  return `${title(esc(c.name))}
    <p class="under ${short ? "need" : "q"}">${list.length} of ${many(c.seats, "sponsor")}${short && c.needs ? `. Needs ${esc(c.needs.toLowerCase())}` : ""}</p>
    ${list.length ? `<div class="gap" data-rows>${list.map((t) => `<button class="row r-two" data-row data-teacher="${t}" data-k="s-${t}"><span>${L(t)}</span><span class="q">${esc(longChoice(t, cid))}</span></button>`).join("")}</div>` : ""}
    ${short ? fillRows(cid) : ""}
    ${asked.length ? `<div class="links"><button class="link" data-act="open" data-to="asked" data-id="${esc(cid)}" data-k="wa">Who asked ${asked.length}</button></div>` : ""}`;
}

function moveCard(f) {
  const id = f.id, c = Mock.placedOn(id), opts = Mock.optionsFor(id), byCourse = new Map(opts.map((o) => [o.cid, o]));
  const order = { "Round 1": 0, "Round 2": 1, Singapore: 2 };
  const prefs = [...Mock.teacher(id).prefs].sort((a, b) => order[a.round] - order[b.round] || a.rank - b.rank);
  const go = (cid, name, a, b, k) => `<button class="row stack" data-row data-act="moveTo" data-id="${id}" data-c="${esc(cid)}" data-k="${esc(k)}">${esc(name)}<small><span>${esc(a)}</span><b>${esc(b)}</b></small></button>`;
  const fixed = (name, a, b) => `<div class="row stack" data-row>${esc(name)}<small><span>${esc(a)}</span><b>${esc(b)}</b></small></div>`;
  let round = null;
  const own = prefs.map((p, i) => {
    const course = Mock.course(p.course), n = Mock.choiceText(id, p.course).split(" choice")[0];
    const head = p.round === round ? "" : `<div class="group"><span>${esc(p.round)} choices</span></div>`;
    round = p.round;
    if (!course.running) return head + fixed(course.name, n, "Not running");
    if (p.course === c) return head + fixed(course.name, n, "Placed here");
    return head + go(p.course, course.name, n, warns(byCourse.get(p.course)), `p-${i}`);
  }).join("");
  const rest = opts.filter((o) => o.choice === "Not on their list").map((o) => go(o.cid, o.name, "", warns(o), `o-${o.cid}`)).join("");
  return card(`${back()}${title(`Move ${L(id)}`)}
    ${c ? `<div class="links"><button class="link" data-act="moveTo" data-id="${id}" data-c="" data-k="np">Not placed</button></div>` : ""}
    <div data-rows>${own}<div class="group"><span>${own ? "Other courses" : "All courses"}</span></div>${rest}</div>`);
}
function askedCard(f) {
  const list = Mock.whoAsked(f.id).filter((x) => !x.placedHere);
  return card(`${back()}${title("Who asked")}<p class="under q">${esc(Mock.course(f.id).name)}</p>
    <div class="gap" data-rows>${askedRows(list, "")}</div>`);
}

function historyCard() {
  return card(`${back()}${title("History")}<div class="gap" data-rows>${Mock.history().map((h, i) => `
    <div class="row r-two" data-row><span><span class="q">${esc(timeOf(h.when))}</span>&ensp;${esc(Mock.describe(h))}</span>${i ? `<button class="link" data-act="restore" data-v="${h.version}" data-k="h-${h.version}">Restore</button>` : ""}</div>`).join("")}</div>
    <div class="links"><button class="link" data-act="startOver" data-k="so">Start over</button></div>`);
}

function frame(f) {
  const map = { teacher: () => card(back() + teacherBody(f.id)), course: () => card(back() + courseBody(f.id)), move: () => moveCard(f), asked: () => askedCard(f), history: historyCard };
  return `<div class="narrow">${map[f.k]()}</div>`;
}

/* Tabs */
function bigLine() {
  const n = Mock.todo().length;
  return `<h1 class="big" data-big>${n ? `${many(n, "thing")} need${n === 1 ? "s" : ""} you` : "Nothing needs you"}</h1>`;
}
function todoBody(item) {
  if (item.kind === "course") return courseBody(item.cid);
  return item.kind === "teacher" ? teacherBody(item.tid) : noFormBody(item.tids);
}
function todoHome() {
  const list = Mock.todo(), s = Mock.summary();
  view.idx = list.length ? view.idx % list.length : 0;
  const body = list.length ? `<section class="card" data-panel data-rows>
      ${list.length > 1 ? `<button class="link nextbtn" data-act="next" data-k="nx">Next</button>` : ""}
      ${todoBody(list[view.idx])}</section>` : "";
  return `<div class="narrow home">${bigLine()}
    <p class="sub">best draft found&ensp;${s.placed} of ${s.teachers} teachers placed</p>${body}</div>`;
}
const tools = (which) => `<div class="tools"><input class="search" type="search" placeholder="Search" aria-label="Search" data-search="${which}" data-k="${which}-q" value="${esc(view.q[which])}"></div>`;
function coursesHome() {
  const weight = (c) => { const f = worst(c.id); return !f ? 2 : f.level === "needs" ? 0 : 1; };
  const list = [...Mock.courses()].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
  return `${bigLine()}${tools("courses")}
    <div data-rows>${list.map((c) => {
      const f = worst(c.id), sp = Mock.sponsors(c.id);
      return `<button class="row r-course" data-row data-course="${esc(c.id)}" data-q="${esc(c.name + " " + sp.map(who).join(" "))}" data-k="c-${esc(c.id)}">
        <span>${esc(c.name)}</span><span class="pair">${sp.map((t) => `<span>${L(t)}</span>`).join("")}</span>
        <span class="${f && f.level === "needs" ? "need" : "q"}">${f ? esc(shortNeed(f.text)) : ""}</span></button>`;
    }).join("")}<div class="row q" data-empty hidden>No matches</div></div>`;
}
function teachersHome() {
  const order = Mock.state.namesOn ? (a, b) => teacherOrder(b.id) - teacherOrder(a.id) || byId(a, b) : byId;
  const list = [...Mock.teachers()].sort(order);
  return `${bigLine()}${tools("teachers")}
    <div data-rows>${list.map((t) => {
      const c = Mock.placedOn(t.id), cn = c ? Mock.course(c).name : "Not placed";
      return `<button class="row r-teacher" data-row data-teacher="${t.id}" data-k="t-${t.id}" data-q="${esc(who(t.id) + " " + cn)}">
        <span>${L(t.id)}</span><span class="${c ? "" : "need"}">${esc(cn)}</span></button>`;
    }).join("")}<div class="row q" data-empty hidden>No matches</div></div>`;
}

function filter(which) {
  const q = (view.q[which] || "").trim().toLowerCase();
  const box = document.querySelector(`[data-search="${which}"]`);
  if (!box) return;
  const rows = [...document.querySelectorAll("#main [data-q]")];
  rows.forEach((r) => { r.hidden = !!q && !r.dataset.q.toLowerCase().includes(q); });
  document.querySelector("#main [data-empty]").hidden = !q || rows.some((r) => !r.hidden);
}

function render() {
  const k = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const head = document.getElementById("top"), main = document.getElementById("main"), done = document.getElementById("done");
  const onDraft = phase === "draft";
  head.hidden = done.hidden = !onDraft;
  if (onDraft) {
    head.innerHTML = topBar();
    const f = top_();
    main.innerHTML = f ? frame(f) : view.tab === "todo" ? todoHome() : view.tab === "courses" ? coursesHome() : teachersHome();
    ["courses", "teachers"].forEach(filter);
    done.innerHTML = bottomLine();
    showSaved();
  } else {
    main.innerHTML = startView();
  }
  if (k) { const el = document.querySelector(`[data-k="${CSS.escape(k)}"]`); if (el) el.focus(); }
}

function push(f) {
  f.y = window.scrollY; view.stack.push(f); render();
  window.scrollTo(0, 0);
  const h = document.querySelector("#main h2"); if (h) h.focus({ preventScroll: true });
}
function pop() {
  const f = view.stack.pop(); render();
  if (f) window.scrollTo(0, f.y);
}
function setNames(on) {
  // What was typed may be a name; it must not outlive the switch.
  if (!on) view.q = { courses: "", teachers: "" };
  Mock.setNames(on);
}

// Builds the workbook from the draft as it is now, on the current switch, and hands it to the browser as a download.
async function download() {
  const blob = new Blob([await writeBook(sheetsFor(Mock))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName(Mock);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-tab],[data-names],[data-download],[data-act],[data-course],[data-teacher]");
  if (!el) return;
  const d = el.dataset;
  if ("download" in d) { download(); return; }
  if ("tab" in d) { view.tab = d.tab; view.stack = []; render(); window.scrollTo(0, 0); return; }
  if ("names" in d) { setNames(!Mock.state.namesOn); return; }
  if (!d.act) { push(d.course && !d.teacher ? { k: "course", id: d.course } : { k: "teacher", id: d.teacher }); return; }
  switch (d.act) {
    case "build": build(); break;
    case "open": push({ k: d.to, id: d.id }); break;
    case "back": pop(); break;
    case "next": view.idx += 1; render(); break;
    case "moveTo": Mock.move(d.id, d.c || null); if (top_() && top_().k === "move") pop(); break;
    case "leave": Mock.leave([d.id]); break;
    case "leaveGroup": Mock.leave(Mock.todo().find((i) => i.kind === "noForm").tids); break;
    case "restore": Mock.restore(Number(d.v)); break;
    case "undo": Mock.undo(); break;
    case "startOver": startOver(); break;
  }
});
document.addEventListener("input", (e) => {
  const w = e.target.dataset && e.target.dataset.search;
  if (w) { view.q[w] = e.target.value; filter(w); }
});
document.addEventListener("change", (e) => {
  if (e.target.matches('[data-k="files"]')) addFiles(e.target.files);
});
// A file dropped anywhere on the page counts, and never makes the browser navigate to it.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });

Mock.on(render);
Mock.onSnapshot(remember);

async function boot() {
  const saved = await loadAll().catch(() => null);
  if (saved) {
    savedVersion = saved.snapshots.at(-1).version;
    phase = "draft";
    Mock.init(saved.school, saved.snapshots);
  } else {
    phase = "start";
    addFiles([]);
  }
}
boot();

import { Mock } from "./state.js";
import { stub } from "./stub.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const L = (id) => esc(Mock.label(id));
const many = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const view = { tab: "todo", stack: [], idx: 0, menu: false, q: { courses: "", teachers: "", swap: "" } };
const top_ = () => view.stack[view.stack.length - 1];
const undoStack = [];
let note = null;
const act = (fn) => { note = null; undoStack.push(Mock.state.version); fn(); };
function tickCourse(cid) {
  note = `${Mock.state.reviewed.has(cid) ? "Not reviewed" : "Reviewed"} ${Mock.course(cid).name}`;
  undoStack.push({ tick: cid });
  Mock.toggleReviewed(cid);
}
function undo() {
  const u = undoStack.pop();
  if (u.tick) { note = "Went back"; Mock.toggleReviewed(u.tick); }
  else if (u.run) { note = "Went back"; Mock.course(u.run).running = true; render(); }
  else { note = null; Mock.restore(u); }
}

// Every unplaced teacher is a to-do, so "10 things" adds up with "9 not placed" and "1 course". Deciding to leave someone unplaced clears it.
const toDo = (a) => a.level === "needs" || (a.tid && !Mock.placedOn(a.tid));
const decided = (a) => a.tid && !Mock.placedOn(a.tid) && Mock.state.kept.has(a.tid);
const needs = () => Mock.attention().filter((a) => toDo(a) && !decided(a));
const who = (id) => `${id} ${Mock.label(id)}`;

function shortNeed(text) {
  const t = text.split(": ").length > 1 && !text.startsWith("Needs") ? text.slice(text.indexOf(": ") + 2) : text;
  const m = t.match(/Needs sponsors: (\d+) of (\d+)/);
  if (m) return `Needs ${many(m[2] - m[1], "sponsor")}`;
  return t.replace("Not a mixed pair", "Not mixed").replace("Not on their list", "Not ranked").replace(" on file", "");
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
function people(text) {
  let out = text;
  for (const t of Mock.teachers()) out = out.split(t.name).join(t.id);
  out = out.replace(/T\d{3}/g, (id) => (Mock.teacher(id) ? Mock.label(id) : id));
  return out.replace(/^Restored version \d+$/, "Went back");
}
function why(id) {
  const text = Mock.reason(id);
  if (Mock.placedOn(id)) return text;
  if (!text.includes("Every course on their list")) return text.replace(" Not placed yet.", "");
  if (Mock.state.moved.has(id)) return text.split(" Not placed.")[0];
  const open = Mock.teacher(id).prefs.map((p) => Mock.course(p.course)).find((c) => c.running && Mock.seatsLeft(c.id) > 0 && Mock.sponsors(c.id).length);
  return open ? `${open.name}, on their list, has a seat.` : text.replace("Not placed. ", "");
}
const warns = (o) => o.warn.filter((x) => x !== "They did not rank this").map((x) => x.replace("This course is full", "Full").replace(" on file", "")).join(", ").replace(", No ", ", no ");

/* Top bar */
function topBar() {
  const s = Mock.summary(), n = needs().length;
  const tab = (id, text) => `<button class="tab" role="tab" data-tab="${id}" data-k="tab-${id}" aria-selected="${view.tab === id}">${text}</button>`;
  return `<div class="wrap bar">
    <div class="brand">${esc(s.year)}</div>
    <div class="tabs" role="tablist">${tab("todo", n ? `To do ${n}` : "To do")}${tab("courses", "Courses")}${tab("teachers", "Teachers")}</div>
    <div class="right">
      <button class="switch" role="switch" data-names data-k="names" aria-checked="${Mock.state.namesOn}">Show names <span class="track"><span class="knob"></span></span></button>
      <button class="plain" data-more data-k="more" aria-haspopup="menu" aria-expanded="${view.menu}">More</button>
      ${view.menu ? `<div class="menu" role="menu">
        <button role="menuitem" data-act="open" data-to="history" data-k="m4">History</button>
      </div>` : ""}
    </div></div>`;
}

/* Opened items */
const card = (inner) => `<section class="card" data-panel>${inner}</section>`;
const back = () => `<button class="link back" data-act="back" data-k="back">Back</button>`;
const title = (t) => `<h2 tabindex="-1">${t}</h2>`;

function teacherBody(id) {
  const c = Mock.placedOn(id), mail = Mock.contact(id), note = Mock.comment(id), kept = Mock.state.kept.has(id);
  const opts = Mock.optionsFor(id).filter((o) => o.choice !== "Not on their list").slice(0, 5);
  let round = null;
  const rows = opts.map((o) => {
    const [n, r] = o.choice.split(" choice, ");
    const head = r === round ? "" : `<div class="row r-opt head"><span>${round === null ? "Move to" : ""}</span><span>${esc(r)}</span><span></span></div>`;
    round = r;
    return `${head}<button class="row r-opt" data-row data-act="moveTo" data-id="${id}" data-c="${o.cid}" data-k="o-${o.cid}"><span>${esc(o.name)}</span><span class="q">${esc(n)}</span><span class="q">${esc(warns(o))}</span></button>`;
  }).join("");
  return `${title(L(id))}
    <p class="under ${c ? "" : "need"}">${c ? esc(Mock.course(c).name) : "Not placed"}</p>
    <p class="why"><span class="q">Why</span>&ensp;${esc(why(id))}</p>
    ${mail ? `<p class="q gap">${esc(mail)}</p>` : ""}${note ? `<p class="q">${esc(note)}</p>` : ""}
    <div class="acts">
      <button class="btn" data-act="keep" data-id="${id}" data-k="kp" aria-pressed="${kept}">${c ? (kept ? "Kept" : "Keep") : (kept ? "Left unplaced" : "Leave unplaced")}</button>
    </div>
    ${rows ? `<div class="gap" data-rows>${rows}</div>` : ""}
    <div class="links"><button class="link" data-act="open" data-to="move" data-id="${id}" data-k="all">All options</button></div>`;
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
  const free = Mock.teachers().filter((t) => !Mock.placedOn(t.id) && !Mock.state.kept.has(t.id) && ok(t))
    .sort((a, b) => (askedAt.get(a.id) ?? 999) - (askedAt.get(b.id) ?? 999) || a.id.localeCompare(b.id));
  const elsewhere = asked.filter((x) => !x.placedHere && Mock.placedOn(x.tid) && ok(Mock.teacher(x.tid)));
  return [...free.map((t) => ({ tid: t.id, now: "Not placed" })), ...elsewhere.map((x) => ({ tid: x.tid, now: x.choice.split(" choice")[0] }))].slice(0, 5);
}
function fillRows(cid) {
  const list = fillers(cid);
  if (!list.length) return "";
  return `<div class="gap" data-rows><div class="row r-fill head"><span>Could sponsor</span><span></span><span></span></div>${list.map((x) =>
    `<button class="row r-fill" data-row data-act="moveTo" data-id="${x.tid}" data-c="${cid}" data-k="f-${x.tid}"><span>${L(x.tid)}</span><span class="q">${esc(x.now)}</span><span class="go">Move here</span></button>`).join("")}</div>`;
}
function courseBody(cid) {
  const c = Mock.course(cid), list = Mock.sponsors(cid), done = Mock.state.reviewed.has(cid), short = list.length < c.seats;
  const asked = Mock.whoAsked(cid).filter((x) => !x.placedHere);
  return `${title(esc(c.name))}
    <p class="under ${short ? "need" : "q"}">${list.length} of ${many(c.seats, "sponsor")}${short && c.needs ? `. Needs ${esc(c.needs.toLowerCase())}` : ""}</p>
    ${list.length ? `<div class="gap" data-rows>${list.map((t) => `<button class="row r-two" data-row data-teacher="${t}" data-k="s-${t}"><span>${L(t)}</span><span class="q">${esc(longChoice(t, cid))}</span></button>`).join("")}</div>` : ""}
    ${short ? fillRows(cid) : ""}
    <div class="links">
      ${short ? "" : `<label class="tick"><input type="checkbox" data-act="reviewed" data-id="${cid}" data-k="rv" ${done ? "checked" : ""}> Reviewed</label>`}
      ${asked.length ? `<button class="link" data-act="open" data-to="asked" data-id="${cid}" data-k="wa">Who asked ${asked.length}</button>` : ""}
      ${short ? `<button class="link" data-act="dontRun" data-id="${cid}" data-k="dr">Don't run this course</button>` : ""}
    </div>`;
}

function moveCard(f) {
  const id = f.id, c = Mock.placedOn(id), opts = Mock.optionsFor(id), byCourse = new Map(opts.map((o, i) => [o.cid, { o, i }]));
  const order = { "Round 1": 0, "Round 2": 1, Singapore: 2 };
  const prefs = [...Mock.teacher(id).prefs].sort((a, b) => order[a.round] - order[b.round] || a.rank - b.rank);
  const go = (cid, name, a, b, k) => `<button class="row stack" data-row data-act="moveTo" data-id="${id}" data-c="${cid}" data-k="${k}">${esc(name)}<small><span>${esc(a)}</span><b>${esc(b)}</b></small></button>`;
  const fixed = (name, a, b) => `<div class="row stack" data-row>${esc(name)}<small><span>${esc(a)}</span><b>${esc(b)}</b></small></div>`;
  let round = null;
  const own = prefs.map((p, i) => {
    const course = Mock.course(p.course), n = Mock.choiceText(id, p.course).split(" choice")[0];
    const head = p.round === round ? "" : `<div class="group"><span>${esc(p.round)} choices</span></div>`;
    round = p.round;
    if (!course.running) return head + fixed(course.name, n, "Not running");
    if (p.course === c) return head + fixed(course.name, n, "Placed here");
    return head + go(p.course, course.name, n, warns(byCourse.get(p.course).o), `p-${i}`);
  }).join("");
  const rest = opts.filter((o) => o.choice === "Not on their list").map((o) => go(o.cid, o.name, "", warns(o), `o-${o.cid}`)).join("");
  const rank = (t) => { const hit = byCourse.get(Mock.placedOn(t.id)); return hit ? hit.i : 999; };
  const others = Mock.teachers().filter((t) => t.id !== id && Mock.placedOn(t.id) && Mock.placedOn(t.id) !== c).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return card(`${back()}${title(`Move or swap ${L(id)}`)}
    ${c ? `<div class="links"><button class="link" data-act="moveTo" data-id="${id}" data-c="" data-k="lv">Leave unplaced</button></div>` : ""}
    <div class="cols"><div data-rows>${own}<div class="group"><span>${own ? "Other courses" : "All courses"}</span></div>${rest}</div>
    <div><input class="search swapbox" type="search" placeholder="Swap with" aria-label="Swap with" data-search="swap" data-k="sq" value="${esc(view.q.swap)}">
      <div data-rows>${others.map((t) => {
        const cn = Mock.course(Mock.placedOn(t.id)).name;
        return `<button class="row r-two" data-row data-act="swapWith" data-id="${id}" data-other="${t.id}" data-q="${esc(who(t.id) + " " + cn)}" data-k="w-${t.id}"><span>${L(t.id)}</span><span class="q">${esc(cn)}</span></button>`;
      }).join("")}<div class="row q" data-empty hidden>No matches</div></div></div></div>`);
}
function askedCard(f) {
  const list = Mock.whoAsked(f.id).filter((x) => !x.placedHere);
  return card(`${back()}${title("Who asked")}<p class="under q">${esc(Mock.course(f.id).name)}</p>
    <div class="gap" data-rows>${askedRows(list, "")}</div>`);
}

function historyCard() {
  return card(`${back()}${title("History")}<p class="under q">Saved ${esc(Mock.summary().savedAt)}</p><div class="gap" data-rows>${Mock.history().map((h, i) => `
    <div class="row r-two" data-row><span><span class="q">${esc(h.when)}</span>&ensp;${esc(people(h.text))}</span>${i ? `<button class="link" data-act="restore" data-v="${h.version}" data-k="h-${h.version}">Go back</button>` : ""}</div>`).join("")}</div>`);
}

function frame(f) {
  const map = { teacher: () => card(back() + teacherBody(f.id)), course: () => card(back() + courseBody(f.id)), move: () => moveCard(f), asked: () => askedCard(f),
    history: historyCard };
  return f.k === "move" ? map.move() : `<div class="narrow">${map[f.k]()}</div>`;
}

/* Tabs */
function todoHome() {
  const list = needs(), s = Mock.summary();
  view.idx = list.length ? view.idx % list.length : 0;
  const big = list.length ? `${many(list.length, "thing")} need${list.length === 1 ? "s" : ""} you` : "Nothing needs you";
  const a = list[view.idx];
  const body = a ? `<section class="card" data-panel data-rows>
      ${list.length > 1 ? `<button class="link nextbtn" data-act="next" data-k="nx">Next</button>` : ""}
      ${a.cid ? courseBody(a.cid) : teacherBody(a.tid)}</section>` : "";
  return `<div class="narrow home"><h1 class="big">${big}</h1>
    <p class="sub">${s.placed} of ${s.teachers} teachers placed</p>${body}</div>`;
}
const tools = (which) => `<div class="tools"><input class="search" type="search" placeholder="Search" aria-label="Search" data-search="${which}" data-k="${which}-q" value="${esc(view.q[which])}"></div>`;
function coursesHome() {
  const short = Mock.summary().coursesShort;
  const big = short ? `${many(short, "course")} need${short === 1 ? "s" : ""} sponsors` : "All courses have sponsors";
  const weight = (c) => { const f = worst(c.id); return !f ? 2 : f.level === "needs" ? 0 : 1; };
  const list = [...Mock.courses()].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
  return `<h1 class="big">${big}</h1>${tools("courses")}
    <div data-rows><div class="row r-list head"><span></span><span>Reviewed</span></div>${list.map((c) => {
      const f = worst(c.id), sp = Mock.sponsors(c.id), done = Mock.state.reviewed.has(c.id);
      const end = !f ? `<label class="tick q"><input type="checkbox" data-act="reviewed" data-id="${c.id}" data-k="rv-${c.id}" aria-label="Reviewed ${esc(c.name)}" ${done ? "checked" : ""}></label>` : done ? "Reviewed" : "";
      return `<div class="row r-list" data-row data-course="${c.id}" data-q="${esc(c.name + " " + sp.map(who).join(" "))}">
        <button class="r-course" data-k="c-${c.id}"><span>${esc(c.name)}</span><span class="pair">${sp.map((t) => `<span>${L(t)}</span>`).join("")}</span>
        <span class="${f && f.level === "needs" ? "need" : "q"}">${f ? esc(shortNeed(f.text)) : ""}</span></button>
        <span class="q">${end}</span></div>`;
    }).join("")}<div class="row q" data-empty hidden>No matches</div></div>`;
}
function teachersHome() {
  const n = Mock.summary().notPlaced;
  const big = n ? `${many(n, "teacher")} not placed` : "All teachers placed";
  const list = [...Mock.teachers()].sort((a, b) => teacherOrder(b.id) - teacherOrder(a.id) || a.id.localeCompare(b.id));
  return `<h1 class="big">${big}</h1>${tools("teachers")}
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
  document.getElementById("top").innerHTML = topBar();
  const f = top_();
  document.getElementById("main").innerHTML = f ? frame(f) : view.tab === "todo" ? todoHome() : view.tab === "courses" ? coursesHome() : teachersHome();
  ["courses", "teachers", "swap"].forEach(filter);
  const h = Mock.history(), done = document.getElementById("done");
  done.hidden = h.length < 2 && !note;
  if (!done.hidden) done.innerHTML = `<div class="wrap"><span>${esc(note || people(h[0].text))}</span>
    <em class="saved">Saved ${esc(Mock.summary().savedAt)}</em>
    ${undoStack.length ? `<button class="link" data-act="undo" data-k="un">Undo</button>` : ""}</div>`;
  if (k) { const el = document.querySelector(`[data-k="${k}"]`); if (el) el.focus(); }
}

function push(f) {
  f.y = window.scrollY; view.q.swap = ""; view.stack.push(f); view.menu = false; render();
  window.scrollTo(0, 0);
  const h = document.querySelector("#main h2"); if (h) h.focus({ preventScroll: true });
}
function pop() {
  const f = view.stack.pop(); view.q.swap = ""; view.menu = false; render();
  if (f) window.scrollTo(0, f.y);
}

document.addEventListener("click", (e) => {
  if (e.target.closest("label.tick") && e.target.tagName !== "INPUT") return;
  const el = e.target.closest("[data-tab],[data-names],[data-more],[data-act],[data-course],[data-teacher]");
  const inMenu = e.target.closest(".menu");
  if (view.menu && !inMenu && !(el && "more" in el.dataset)) { view.menu = false; if (!el) { render(); return; } }
  if (!el) return;
  const d = el.dataset;
  if ("tab" in d) { view.tab = d.tab; view.stack = []; view.q.swap = ""; render(); window.scrollTo(0, 0); return; }
  if ("names" in d) { Mock.setNames(!Mock.state.namesOn); return; }
  if ("more" in d) { view.menu = !view.menu; render(); return; }
  if (!d.act) { push(d.course && !d.teacher ? { k: "course", id: d.course } : { k: "teacher", id: d.teacher }); return; }
  switch (d.act) {
    case "open": push({ k: d.to, id: d.id }); break;
    case "back": pop(); break;
    case "next": view.idx += 1; view.q.swap = ""; render(); break;
    case "keep": act(() => Mock.keep(d.id)); break;
    case "reviewed": tickCourse(d.id); break;
    case "moveTo": act(() => Mock.move(d.id, d.c || null)); if (top_() && top_().k === "move") pop(); break;
    case "swapWith": view.q.swap = ""; act(() => Mock.swap(d.id, d.other)); pop(); break;
    case "restore": act(() => Mock.restore(Number(d.v))); break;
    case "dontRun": undoStack.push({ run: d.id }); Mock.course(d.id).running = false; note = `${Mock.course(d.id).name} will not run`; if (top_() && top_().k === "course") pop(); else render(); break;
    case "undo": undo(); break;
  }
});
document.addEventListener("input", (e) => {
  const w = e.target.dataset && e.target.dataset.search;
  if (w) { view.q[w] = e.target.value; filter(w); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && view.menu) { view.menu = false; render(); document.querySelector("[data-more]").focus(); }
});

Mock.on(render);
Mock.init(stub);

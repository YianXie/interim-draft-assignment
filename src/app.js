import { Mock } from "./state.js";
import { parseFiles, readForms, slotName, LATER, SLOTS, PAST_SLOTS, OPTIONAL, FIT } from "./import.js";
import { RESULT_LABEL } from "./past.js";
import { loadHighs, solveDraft, toDraft } from "./solver.js";
import { recheck, newProblems } from "./recheck.js";
import { sheetsFor, fileName } from "./export.js";
import { writeBook } from "./xlsx.js";
import { addSnapshot, loadAll, replaceUpload, saveUpload, wipe } from "./store.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const L = (id) => esc(Mock.label(id));
const many = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const byId = (a, b) => a.id.localeCompare(b.id);
// A History line's day and time: versions made on different days must not look alike.
const whenOf = (iso) => `${new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

// sort is per list, { key, dir } once a header is clicked, null before; it lives here so it outlasts a tab switch.
const view = { tab: "todo", stack: [], idx: 0, q: { courses: "", teachers: "" }, sort: { courses: null, teachers: null } };
const top_ = () => view.stack[view.stack.length - 1];

/* Start: files stay in memory, keyed by name, until Build. Nothing is stored. */
const held = new Map();
let phase = "loading"; // loading, start, building or draft
let buildFailed = false; // the last Build gave no draft: Start says so, with the same files still listed, until they change
let slots = {};
let parsed = null;
let reading = 0;
let wasReady = false; // Build could be pressed at the last render
let queue = Promise.resolve();

/* Saving: one write at a time, in order. A write that fails stops the line, so "saved" is never claimed over a gap.
   After a failed load nothing is written or wiped for the whole session: a draft may still be on disk.
   Either way the line says Not saved from then on, so the office knows a reload would lose work. */
let loadFailed = false;
let saveFailed = false;
let savedVersion = null;
let saveId = null; // the stored upload this tab writes to; another tab's upload makes every write here fail
let saving = Promise.resolve();
function inOrder(job) {
  if (loadFailed) return;
  saving = saving.then(job);
  saving.catch(() => { saveFailed = true; showSaved(); });
}
function showSaved() {
  const el = document.querySelector("[data-saved]");
  if (!el) return;
  if (savedVersion !== null) el.dataset.version = savedVersion; // the newest version on disk, whatever the line says
  if (loadFailed || saveFailed) { el.textContent = "Not saved"; return; }
  if (savedVersion === null) return;
  el.textContent = savedVersion === Mock.state.version ? "Saved in this browser" : "";
}
function remember(snap) {
  inOrder(async () => {
    await addSnapshot(snap, saveId);
    savedVersion = snap.version;
    showSaved();
    tell({ saveId, version: snap.version });
  });
}
function startOver() {
  if (!window.confirm("Delete the draft, every version and what was read from the files? This cannot be undone.")) return;
  const toStart = () => location.reload();
  saving.catch(() => {}).then(() => loadFailed || wipe(saveId)).then(() => tell({ saveId: null })).then(toStart, toStart);
}

/* Other tabs of the page, in this browser only: after every save each one is told, and loads what was saved, so a
   second tab works on the newest draft instead of an older one whose next change would be refused and lost. */
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("interim-demo") : null;
function tell(msg) {
  try { channel?.postMessage(msg); } catch { /* a tab that cannot be told reloads by hand, as before */ }
}
let catchingUp = Promise.resolve();
let missed = false; // another tab saved while this one was Placing: that placing is stopped, then this tab catches up
channel?.addEventListener("message", (e) => {
  catchingUp = catchingUp.then(() => catchUp(e.data)).catch((err) => console.warn(err));
});
async function catchUp(msg) {
  if (loadFailed || !msg || typeof msg !== "object") return;
  // Files dropped here and not built yet are the office's own: never thrown away for another tab's draft.
  if (phase === "start") { if (!held.size && !reading) location.reload(); return; }
  if (phase !== "draft") return;
  // Another tab started over or built a new draft: this one's draft is gone from the browser, so show what is there now.
  if (msg.saveId !== saveId) { location.reload(); return; }
  // Wait for this tab's own writes, then load the newest saved version unless this tab already shows it.
  await saving.catch(() => {});
  if (placing) { missed = true; return; }
  if (saveFailed) return;
  const saved = await loadAll();
  if (!saved || saved.saveId !== saveId) { location.reload(); return; }
  const newest = saved.snapshots.at(-1).version;
  if (newest === Mock.state.version) return;
  const names = Mock.state.namesOn;
  const list = Mock.todo(), openItem = view.tab === "todo" && list.length ? todoKey(list[view.idx % list.length]) : null;
  savedVersion = newest;
  Mock.init(saved.school, saved.snapshots);
  if (names) Mock.setNames(true);
  // The open To do item stays the same item, wherever it now sits in the list.
  if (openItem !== null) { const at = Mock.todo().findIndex((i) => todoKey(i) === openItem); if (at >= 0) view.idx = at; }
  render();
  // Forms picked on the Add forms card are read again against the draft as it now is; a placing just stopped still says so.
  if (laterHeld.size) { const failed = laterFailed; addLaterFiles([]); laterFailed = failed; render(); }
}
const todoKey = (i) => `${i.kind}:${i.cid ?? i.tid ?? ""}`;

const KNOWN = [...SLOTS, ...PAST_SLOTS, FIT];
const readBytes = (f) => f.arrayBuffer().then((b) => new Uint8Array(b), () => new Uint8Array());
// A dropped file is held under the slot its name picks, so "Courses (1).xlsx" replaces courses.xlsx and is listed as it.
const namedFor = (f) => { const name = slotName(f.name); return { name, arrayBuffer: () => f.arrayBuffer() }; };
// Drops and removals are handled strictly in order, so a later file always replaces an earlier one of the same name.
function addFiles(list, remove = null) {
  if (phase !== "start") return;
  const files = [...list].map(namedFor);
  reading += 1;
  parsed = null;
  buildFailed = false;
  render();
  queue = queue.then(async () => {
    try {
      if (remove !== null) held.delete(remove);
      for (const f of files) held.set(f.name, { name: f.name, bytes: await readBytes(f) });
      // Last year's files are read together with the six, so the School carries last year.
      const named = (yes) => [...held.values()].filter((f) => KNOWN.includes(f.name) === yes);
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
// The invented school, fetched from this page's own server and read like dropped files. A file that fails to arrive reads as empty.
// On the Last year tab it is last year's four, plus any of the six not added yet, so the sample builds either way
// and files the office already dropped are never replaced.
const sampleFiles = () => {
  const names = startTab === "past" ? [...SLOTS.filter((name) => !held.has(name)), ...PAST_SLOTS] : SLOTS;
  return names.map((name) => ({ name, arrayBuffer: () => fetch(`sample/${name}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())) }));
};
// The solver file is asked for at every Build and Add and place. The copy taken when the page loaded is used only when that
// fails, so a server stopped since then (the Terminal window closed) does not read as a problem with the files.
const solverFile = () => fetch("highs.wasm").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("no solver file"))));
const solverAtLoad = solverFile().catch(() => null);
async function solver() {
  const bytes = await solverFile().catch(() => solverAtLoad);
  if (!bytes) throw new Error("no solver file");
  const module = await WebAssembly.compile(bytes);
  return loadHighs({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(module, imports).then(done); return {}; } });
}
const canBuild = () => phase === "start" && reading === 0 && !!parsed;

async function build() {
  if (!canBuild()) return;
  // T numbers are random, so T-number order says nothing about names or the order of the staff file. The solver sorts its own input.
  const school = { ...parsed, teachers: [...parsed.teachers].sort(byId) };
  buildFailed = false;
  phase = "building";
  render();
  try {
    const { status, pairs } = solveDraft(await solver(), school);
    if (status !== "Optimal" || recheck(school, pairs).length) { failBuild(); return; }
    const id = crypto.randomUUID();
    saveId = id;
    inOrder(() => saveUpload(school, id));
    Mock.init(school);
    Mock.build(toDraft(school, pairs));
    held.clear();
    phase = "draft";
  } catch {
    failBuild();
    return;
  }
  render();
}
// Back to Start with the files still held, so the office can swap one and press Build again without dropping all of them.
function failBuild() {
  phase = "start";
  buildFailed = true;
  render();
  window.scrollTo(0, 0); // after render, which puts focus back on Build further down
}

// What each file holds, under its name on Start, so which files are wanted is never a guess.
const ABOUT = {
  "courses.xlsx": "Every course: code, name, type, seats, offered, certificate, arrival, vendor",
  "staff.xlsx": "Every teacher who can sponsor: email, name, certificates held",
  "returning.xlsx": "Sponsors coming back to the course they ran: email and course code",
  "round1.xlsx": "Round 1 forms: time, email, up to seven choices, three answers",
  "round2.xlsx": "Round 2 forms: time, email and up to three course choices",
  "singapore.xlsx": "Singapore course forms: time, email, up to five choices, two answers",
  "past-allocation.xlsx": "Last year's final list: each course and its sponsors by name",
  "past-round1.xlsx": "Last year's Round 1 forms, laid out like round1.xlsx",
  "past-round2.xlsx": "Last year's Round 2 forms, laid out like round2.xlsx",
  "past-singapore.xlsx": "Last year's Singapore forms, laid out like singapore.xlsx",
  [FIT]: "Optional: what the reader found in the answers, checked by the office",
};
let startTab = "now"; // now or past: which files Start lists. Either tab takes any file dropped.

// An icon only, so the row keeps its words. Removing a file lets the same name be dropped again.
const X_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
// The project's own page on GitHub. A plain link: nothing is fetched from it, and the page's policy still blocks every outside request.
const REPO = "https://github.com/YianXie/interim-draft-assignment";
const GH_ICON = `<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const repoLink = (withText) => `<a class="repo" data-repo data-k="repo" href="${REPO}" target="_blank" rel="noopener noreferrer"${withText ? "" : ` aria-label="GitHub" title="GitHub"`}>${GH_ICON}${withText ? "<span>GitHub</span>" : ""}</a>`;
const removeBtn = (name, h = held) => (h.has(name) ? `<button class="x" data-act="remove" data-file="${esc(name)}" aria-label="Remove ${esc(name)}">${X_ICON}</button>` : "");
// Start passes nothing and reads its own files; the Add forms card passes its own, so neither ever sees the other's.
function slotRow(name, s = slots, h = held) {
  const row = slotRowBody(name, s);
  if (!h.has(name)) return row;
  return row.replace('class="row ', 'class="row r-x ').replace(/<\/div>$/, `${removeBtn(name, h)}</div>`);
}
function slotRowBody(name, s = slots) {
  const v = s[name], about = ABOUT[name] ? `<small class="q about">${esc(ABOUT[name])}</small>` : "";
  // Entries on last year's allocation that matched nobody on the staff list: a number only, never the entries.
  const lost = name === PAST_SLOTS[0] && parsed && parsed.past ? parsed.past.unmatched.length : 0;
  const head = `<span><b>${esc(name)}</b>${about}</span>`;
  if (v === OPTIONAL) return `<div class="row r-two r-file" data-row data-slot="${esc(name)}">${head}<span class="q" data-line>optional, not added</span></div>`;
  if (v === "ready") return `<div class="row r-two r-file" data-row data-slot="${esc(name)}">${head}<span class="q" data-line>ready${lost ? `, ${lost} not matched` : ""}</span></div>`;
  if (!v || v.endsWith("file not added")) {
    // A past file before any of the four is added is a placeholder only: it is not a slot until one of them arrives.
    const attr = v ? `data-slot="${esc(name)}"` : `data-placeholder="${esc(name)}"`;
    return `<div class="row r-two r-file" data-row ${attr}>${head}<span class="q" data-line>file not added</span></div>`;
  }
  // A file with any other name has no description, so its line keeps the name. A known file's name is already in bold above.
  if (!about) return `<div class="row r-file" data-row data-slot="${esc(name)}"><span class="need" data-line>${esc(v)}</span></div>`;
  const problem = v.startsWith(name) ? v.slice(name.length).replace(/^[,:]\s*/, "") : v;
  return `<div class="row r-file" data-row data-slot="${esc(name)}">${head}<span class="need" data-line>${esc(problem.charAt(0).toUpperCase() + problem.slice(1))}</span></div>`;
}
function startTabs() {
  const added = PAST_SLOTS.filter((n) => slots[n] && !slots[n].endsWith("file not added")).length;
  const wrong = PAST_SLOTS.some((n) => slots[n] && slots[n] !== "ready" && !slots[n].endsWith("file not added"));
  // One to three of the four lock Build as surely as a refused file, so both are red on the tab whichever tab is open.
  const note = wrong ? `<span class="need">needs a look</span>` : added ? `<span class="${added < 4 ? "need" : "q"}">${added} of 4</span>` : `<span class="q">optional</span>`;
  const tab = (id, text) => `<button class="tab" role="tab" data-start-tab="${id}" data-k="start-${id}" aria-selected="${startTab === id}">${text}</button>`;
  return `<div class="tabs start-tabs" role="tablist">${tab("now", "This year")}${tab("past", `Last year ${note}`)}</div>`;
}
function startView() {
  const others = Object.keys(slots).filter((n) => !KNOWN.includes(n));
  // fit.xlsx is optional and never holds up Build: a placeholder after the six until it is added. Its row makes the panel
  // one row longer, so the panel's rows sit closer, and a short window that scrolls to Build still shows the heading.
  const six = SLOTS.filter((n) => slots[n]);
  const fitRow = six.length === SLOTS.length;
  const now = [...six, ...(fitRow ? [FIT] : []), ...others.filter((n) => slots[n])];
  const past = PAST_SLOTS;
  return `<div class="narrow drop" data-drop>
    <h1 class="big" data-big>${buildFailed ? "Couldn't build a draft from these files" : startTab === "now" ? "Drop this year's files here" : "Drop last year's four files here"}</h1>
    <div class="links"><label class="link choose">Choose files<input type="file" multiple accept=".xlsx" data-k="files"></label>
    <button class="link sample" data-act="sample">Use sample data</button>
    <a class="link sample-zip" data-k="sample-zip" href="sample/${startTab === "now" ? "sample-this-year.zip" : "sample-last-year.zip"}" download>Download sample data</a></div>
    ${startTabs()}
    <div class="gap${fitRow ? " tight" : ""}" data-rows data-start-panel="now"${startTab === "now" ? "" : " hidden"}>
      <p class="q intro">Needed every year. round2.xlsx and singapore.xlsx are optional, since those forms come after Round 1: a form file left out counts as nobody having sent that form.</p>
      ${now.map((n) => slotRow(n)).join("")}</div>
    <div class="gap" data-rows data-start-panel="past"${startTab === "past" ? "" : " hidden"}>
      <p class="q intro">Optional: add all four or none. With them, each teacher's result last year is on their card and in the download, and anyone who got none of their choices last year is put on a top-4 choice first where the rules allow.</p>
      ${past.map((n) => slotRow(n)).join("")}</div>
    <div class="acts"><button class="btn fill" data-act="build" data-k="build"${canBuild() ? "" : " disabled"}>${phase === "building" ? "Building" : "Build"}</button></div>
  </div>${aboutPanel()}
  <p class="narrow repo-line">${repoLink(true)}</p>`;
}

// How the page and the draft work, folded under Start. Its open state lives here, since every render rewrites the page.
let aboutOpen = false;
const li = (items) => items.map((x) => `<li>${x}</li>`).join("");
function aboutPanel() {
  return `<details class="narrow about-box" data-about${aboutOpen ? " open" : ""}>
    <summary data-k="about">How it works</summary>
    <div class="about-body">
    <h3>What it does</h3>
    <p>It reads this year's spreadsheets (round2.xlsx and singapore.xlsx are optional), builds a draft that puts sponsors on courses, explains each placement in one line, and lets the office move anyone before downloading the result to Excel. The draft is a starting point: the office makes the decisions.</p>

    <h3>Rules every draft follows</h3>
    <ul>${li([
      "Each teacher is on one course at most.",
      "A course marked not offered in courses.xlsx gets nobody.",
      "A course that needs a certificate gets only teachers who hold it in staff.xlsx.",
      "A returning sponsor stays on the course they ran, if it is offered this year. If it is not, they are treated like anyone else.",
      "Anyone who sent a form is placed only on a course they listed, in any round.",
      "A course with a returning sponsor always runs, even with seats empty. Any other course runs with every seat filled, or not at all.",
      "Someone who sent no form can be placed on any course they qualify for, but only to fill seats.",
    ])}</ul>

    <h3>Priority order</h3>
    <p>Each priority is settled first and then held fixed while the next one is worked out, so a later priority never trades away an earlier one.</p>
    <ol>${li([
      "<b>Fewest empty seats</b> on courses that have a returning sponsor.",
      "<b>Last year's unlucky first</b>, only when last year's four files are added: as many as possible of those who got none of their choices last year are put on a 1st to 4th choice.",
      "<b>Best choices overall.</b> Each placement scores 7 for a 1st choice down to 1 for a 7th, plus 20 for Round 1, 10 for Round 2 and 0 for Singapore, and the draft takes the highest total. So any Round 1 choice counts above any Round 2 choice, and any Round 2 choice above any Singapore one. A course listed in two rounds counts at its better score.",
      "<b>Fewest people with no form</b> placed.",
    ])}</ol>
    <p>When the form was sent does not matter, and neither does the order of any file. The same files always give the same draft: the input is sorted by email and course code, never by name or T number.</p>

    <h3>After the draft</h3>
    <ul>${li([
      "Every draft is checked against the rules above before it is shown. If no draft passes, nothing is shown.",
      "To do lists what needs a person: courses short of sponsors, over their seats or missing a certificate, teachers not placed, and people with no form.",
      "Each teacher's card says why they are where they are, with facts only. It never names another teacher.",
      "You can move anyone anywhere. A move that breaks a rule, such as a full course or a missing certificate, is shown with a warning, not blocked.",
      "Undo and History step back through every change. Restore goes back to any earlier version.",
      "Add forms brings in Round 2 or Singapore forms later. Everyone on a course stays; only open seats and unplaced teachers are worked out.",
    ])}</ul>

    <h3>Your data</h3>
    <ul>${li([
      "Everything happens in this browser tab on this laptop. The files are read and the draft is worked out inside the page. Nothing is uploaded.",
      "The page is blocked by its own policy from sending anything to any other site. It only loads from this laptop's own server.",
      "Dropped files stay in memory until Build. The spreadsheets themselves are never saved.",
      "After Build, what was read from them (names, emails, certificates and choices) and every version of the draft are saved in this browser, unencrypted, so a reload does not lose work. Anyone using this browser on this laptop could see them.",
      "Start over, at the bottom of History, deletes all of it from the browser.",
      "Each teacher gets a random T number at upload. With Show names off, the page shows T numbers and no emails. That changes only what you see: the names are still in the browser. T numbers are pseudonymous, not anonymous.",
      "Download follows the switch: names and emails with Show names on, T numbers only with it off. Once downloaded, the workbook is an ordinary file and the page's protections no longer apply to it.",
      "Last year's files are used only to work out each teacher's result last year. Entries that match nobody on this year's staff list are counted, never shown.",
    ])}</ul>
    </div>
  </details>`;
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
    <div class="brand">Interim Draft Assistant</div>
    <div class="tabs" role="tablist">${tab("todo", n ? `To do ${n}` : "To do")}${tab("teachers", "Teachers")}${tab("courses", "Courses")}</div>
    <div class="right">
      <button class="switch" role="switch" data-names data-k="names" aria-checked="${Mock.state.namesOn}">Show names <span class="track"><span class="knob"></span></span></button>
      <button class="plain" data-download data-k="download" title="${Mock.state.namesOn ? "Download with names" : "Download with T numbers"}">Download</button>
      ${repoLink(false)}
    </div></div>`;
}
const bottomLine = () => `<div class="wrap"><span data-saved></span>
  ${Mock.canUndo() ? `<button class="link" data-act="undo" data-k="un">Undo</button>` : ""}
  <button class="link" data-act="open" data-to="forms" data-k="forms">Add forms</button>
  <button class="link" data-act="open" data-to="history" data-k="hist">History</button></div>`;

/* Opened items */
const card = (inner) => `<section class="card" data-panel>${inner}</section>`;
const back = () => `<button class="link back" data-act="back" data-k="back">Back</button>`;
const title = (t) => `<h2 tabindex="-1">${t}</h2>`;

// opened: the card reached from a row. A To do item is the same body without the last-year and fit lines, which would not fit there.
function teacherBody(id, opened = false) {
  const c = Mock.placedOn(id), mail = Mock.contact(id), last = opened ? Mock.lastYearLine(id) : "", fit = opened ? Mock.fitLine(id) : "";
  // The fit line is one more line on the card, so one fewer option is listed for it, and one more with the last-year line too.
  // Long Fact labels can still run the opened card over the panel's words, so with the fit line options are dropped until
  // the card, Back included, fits. Every option is still under All options.
  const shorter = fit ? (last ? 2 : 1) : 0;
  const all = Mock.optionsFor(id).filter((o) => o.choice !== "Not on their list");
  const body = (n) => {
    let round = null;
    const rows = all.slice(0, n).map((o) => {
      const [k, r] = o.choice.split(" choice, ");
      const head = r === round ? "" : `<div class="row r-opt head"><span>${round === null ? "Move to" : ""}</span><span>${esc(r)}</span><span></span></div>`;
      round = r;
      return `${head}<button class="row r-opt" data-row data-act="moveTo" data-id="${id}" data-c="${esc(o.cid)}" data-k="o-${esc(o.cid)}"><span>${esc(o.name)}</span><span class="q">${esc(k)}</span><span class="q">${esc(warns(o))}</span></button>`;
    }).join("");
    return `${title(L(id))}
    <p class="under ${c ? "" : "need"}">${c ? esc(Mock.course(c).name) : "Not placed"}</p>
    <p class="why"><span class="q">Why</span>&ensp;${esc(Mock.reason(id))}</p>${last ? `\n    <p class="q" data-last>${esc(last)}</p>` : ""}${fit ? `\n    <p class="q" data-fit>${esc(fit)}</p>` : ""}
    ${mail ? `<p class="q gap">${esc(mail)}</p>` : ""}
    ${!c && !Mock.state.left.has(id) ? `<div class="acts"><button class="btn" data-act="leave" data-id="${id}" data-k="lv">Leave unplaced</button></div>` : ""}
    ${rows ? `<div class="gap" data-rows>${rows}</div>` : ""}
    <div class="links"><button class="link" data-act="open" data-to="move" data-id="${id}" data-k="all">All options</button></div>`;
  };
  let n = 5 - shorter;
  if (fit) while (n > 0 && htmlWords(back() + body(n)) > PANEL_WORDS) n--;
  return body(n);
}
// The opened card's word budget (seed/measure.cjs, detail), and its words counted the way measure.cjs counts them.
const PANEL_WORDS = 60;
const htmlWords = (html) => html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
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
  const c = Mock.course(cid), list = Mock.sponsors(cid), short = list.length < c.seats, over = list.length > c.seats;
  const asked = Mock.whoAsked(cid).filter((x) => !x.placedHere);
  const sponsorRow = (t) => {
    // A sponsor here without the course's certificate: their row says so in place of their choice.
    const missing = Mock.noCert(t);
    return `<button class="row r-two" data-row data-teacher="${t}" data-k="s-${t}"><span>${L(t)}</span><span class="${missing ? "need" : "q"}"${missing ? " data-no-cert" : ""}>${esc(missing || longChoice(t, cid))}</span></button>`;
  };
  return `${title(esc(c.name))}
    <p class="under ${short || over ? "need" : "q"}">${list.length} of ${many(c.seats, "sponsor")}${short && c.needs ? `. Needs ${esc(c.needs.toLowerCase())}` : ""}</p>
    ${list.length ? `<div class="gap" data-rows>${list.map(sponsorRow).join("")}</div>` : ""}
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
    ${c ? `<div class="links"><button class="link" data-act="moveTo" data-id="${id}" data-c="" data-k="np">Not placed</button>${Mock.teacher(id).returning && Mock.teacher(id).returningCourse === c ? `<span class="need">Returning sponsor</span>` : ""}</div>` : ""}
    <div data-rows>${own}<div class="group"><span>${own ? "Other courses" : "All courses"}</span></div>${rest}</div>`);
}
function askedCard(f) {
  const list = Mock.whoAsked(f.id).filter((x) => !x.placedHere);
  return card(`${back()}${title("Who asked")}<p class="under q">${esc(Mock.course(f.id).name)}</p>
    <div class="gap" data-rows>${askedRows(list, "")}</div>`);
}

function historyCard() {
  return card(`${back()}${title("History")}<div class="gap" data-rows>${Mock.history().map((h, i) => `
    <div class="row r-two" data-row><span><span class="q" data-when>v${h.version}&ensp;${esc(whenOf(h.when))}</span>&ensp;${esc(Mock.describe(h))}</span>${i ? `<button class="link" data-act="restore" data-v="${h.version}" data-k="h-${h.version}">Restore</button>` : ""}</div>`).join("")}</div>
    <div class="links"><button class="link" data-act="startOver" data-k="so">Start over</button></div>`);
}

/* Add forms: round2.xlsx or singapore.xlsx brought into the built draft. The card's files are its own, never Start's,
   and stay in memory until Add and place. Everyone on a course stays; only open seats and unplaced teachers are solved. */
const laterHeld = new Map();
let laterSlots = {};
let laterRead = null; // readForms' answer once every file is ready
let laterReading = 0;
let laterQueue = Promise.resolve();
let placing = false;
let laterFailed = false;
let laterGen = 0; // a read still running when the card is opened again is dropped
function laterReset() {
  laterGen += 1;
  laterHeld.clear();
  laterSlots = {};
  laterRead = null;
  laterFailed = false;
}
function addLaterFiles(list, remove = null) {
  if (phase !== "draft") return;
  const files = [...list].map(namedFor), gen = laterGen;
  laterReading += 1;
  laterRead = null;
  laterFailed = false;
  render();
  laterQueue = laterQueue.then(async () => {
    try {
      if (gen !== laterGen) return;
      if (remove !== null) laterHeld.delete(remove);
      for (const f of files) laterHeld.set(f.name, { name: f.name, bytes: await readBytes(f) });
      const out = laterHeld.size ? await readForms(Mock.school(), [...laterHeld.values()]) : { school: null, slots: {} };
      laterSlots = out.slots;
      laterRead = out.school ? out : null;
    } catch {
      laterRead = null;
    } finally {
      laterReading -= 1;
      render();
    }
  });
}
const canAdd = () => phase === "draft" && laterReading === 0 && !!laterRead && !placing;
async function addLater() {
  if (!canAdd()) return;
  const read = laterRead;
  placing = true;
  render();
  try {
    const highs = await solver();
    if (phase !== "draft") return;
    // Another tab saved meanwhile: these placements would be worked out on an older draft and refused, so none are made.
    if (missed) { laterFailed = true; return; }
    // Read after the await: from here to addForms nothing yields, so a move made while Placing is in keep and stands.
    const keep = Mock.teachers().filter((t) => Mock.placedOn(t.id)).map((t) => [t.id, Mock.placedOn(t.id)]);
    const { status, pairs } = solveDraft(highs, read.school, keep, Mock.handOff());
    if (status !== "Optimal" || newProblems(read.school, keep, [...keep, ...pairs]).length) { laterFailed = true; return; }
    // The upload is written first; the snapshot addForms makes is queued after it, so a failed upload write stops it too.
    const next = Mock.state.version + 1; // the version Mock.addForms writes below
    inOrder(() => replaceUpload(read.school, saveId, next));
    placing = false;
    laterReset();
    Mock.addForms(read.school, pairs, read.rounds, read.senders);
    if (top_() && top_().k === "forms") pop();
  } catch {
    laterFailed = true;
  } finally {
    placing = false;
    render();
    if (missed) { missed = false; catchingUp = catchingUp.then(() => catchUp({ saveId })).catch((err) => console.warn(err)); }
  }
}
function formsCard() {
  const others = Object.keys(laterSlots).filter((n) => !LATER.includes(n));
  return card(`<div data-drop>${back()}${title("Add forms")}
    <p class="q intro" data-later-note>Forms are read, never stored in this browser, so after Add and place each file says file not added again.</p>
    <div class="gap" data-rows>${[...LATER, ...others].map((n) => slotRow(n, laterSlots, laterHeld)).join("")}</div>
    <div class="links"><label class="link choose">Choose files<input type="file" multiple accept=".xlsx" data-k="later-files"></label></div>
    ${laterFailed ? `<p class="need gap" data-failed>Couldn't place anyone. Nothing changed.</p>` : ""}
    <div class="acts"><button class="btn fill" data-act="addLater" data-k="addLater"${canAdd() ? "" : " disabled"}>${placing ? "Placing" : "Add and place"}</button></div></div>`);
}

function frame(f) {
  const map = { teacher: () => card(back() + teacherBody(f.id, true)), course: () => card(back() + courseBody(f.id)), move: () => moveCard(f), asked: () => askedCard(f), history: historyCard, forms: formsCard };
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
// One line and a preview per To do item, for the side list beside the open item.
function todoPreview(item) {
  if (item.kind === "course") {
    const f = worst(item.cid);
    return [esc(Mock.course(item.cid).name), f ? esc(shortNeed(f.text)) : ""];
  }
  if (item.kind === "teacher") return [L(item.tid), "Not placed"];
  return ["No form", item.tids.length === 1 ? "1 person" : `${item.tids.length} people`];
}
function todoNav(list) {
  return `<nav class="todo-nav" aria-label="To do list" data-rows>${list.map((item, i) => {
    const [name, preview] = todoPreview(item);
    return `<button class="todo-item${item.kind === "noForm" ? "" : " need-item"}" data-act="pick" data-i="${i}" data-k="ti-${i}"${i === view.idx ? ` aria-current="true"` : ""}>
      <span class="todo-n">${i + 1}</span><span class="todo-text"><span>${name}</span><small class="q">${preview}</small></span></button>`;
  }).join("")}</nav>`;
}
function todoHome() {
  const list = Mock.todo(), s = Mock.summary();
  view.idx = list.length ? view.idx % list.length : 0;
  const body = list.length ? `<section class="card" data-panel data-rows>
      ${list.length > 1 ? `<button class="link nextbtn" data-act="next" data-k="nx">Next</button>` : ""}
      ${todoBody(list[view.idx])}</section>` : "";
  return `<div class="home${list.length > 1 ? " todo-layout" : ""}"><div class="narrow">${bigLine()}
    <p class="sub">best draft found&ensp;${s.placed} of ${s.teachers} teachers placed</p>${body}</div>${list.length > 1 ? todoNav(list) : ""}</div>`;
}
const tools = (which) => `<div class="tools"><input class="search" type="search" placeholder="Search" aria-label="Search" data-search="${which}" data-k="${which}-q" value="${esc(view.q[which])}"></div>`;
// Header cells that sort the list. A blank value always goes last; ties keep the list's own order (sort is stable).
const ABC = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
// Before any click, the header that matches the list's own order is shown as the sort. Teachers with names on are in
// placement order, which no column matches.
const sortOf = (which) => view.sort[which] ?? (which === "courses" ? { key: "status", dir: 1 } : Mock.state.namesOn ? null : { key: "name", dir: 1 });
function sorted(which, list, cols) {
  const s = sortOf(which), col = s && cols.find((c) => c.key === s.key);
  if (!col) return list;
  const vals = new Map(list.map((x) => [x, col.val(x)]));
  const blank = (v) => v === "" || v == null;
  return [...list].sort((a, b) => {
    const x = vals.get(a), y = vals.get(b);
    if (blank(x) || blank(y)) return blank(x) - blank(y);
    return s.dir * (typeof x === "number" ? x - y : ABC.compare(x, y));
  });
}
function headCells(which, cols) {
  const s = sortOf(which);
  return cols.map((c) => {
    const on = s && s.key === c.key, arrow = on ? (s.dir > 0 ? "↑" : "↓") : "↕";
    return `<span><button class="sort${on ? " on" : ""}" data-sort="${which}" data-key="${c.key}" data-k="sort-${which}-${c.key}"${on ? ` aria-pressed="true"` : ""}>${c.label}<span class="arrow" aria-hidden="true">${arrow}</span></button></span>`;
  }).join("");
}
const weight = (c) => { const f = worst(c.id); return !f ? 2 : f.level === "needs" ? 0 : 1; };
const COURSE_COLS = [
  { key: "code", label: "Code", val: (c) => c.id },
  { key: "name", label: "Course", val: (c) => c.name },
  { key: "sponsors", label: "Sponsors", val: (c) => Mock.sponsors(c.id).map((t) => Mock.label(t)).join(" ") },
  // Needs first, then other notes, then nothing to say; by name within each, as the list opens.
  { key: "status", label: "Status", val: weight },
];
const TEACHER_COLS = [
  { key: "name", label: "Teacher", val: (t) => Mock.label(t.id) },
  { key: "code", label: "Code", val: (t) => Mock.placedOn(t.id) || "" },
  { key: "course", label: "Course", val: (t) => { const c = Mock.placedOn(t.id); return c ? Mock.course(c).name : ""; } },
  { key: "tags", label: "Tags", val: (t) => Mock.fitTags(t.id).join(" ") },
];
function coursesHome() {
  const list = sorted("courses", [...Mock.courses()].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name)), COURSE_COLS);
  return `${bigLine()}${tools("courses")}
    <div data-rows><div class="row r-course head" data-head>${headCells("courses", COURSE_COLS)}</div>${list.map((c) => {
      const f = worst(c.id), sp = Mock.sponsors(c.id);
      return `<button class="row r-course" data-row data-course="${esc(c.id)}" data-q="${esc(c.id + " " + c.name + " " + sp.map(who).join(" "))}" data-k="c-${esc(c.id)}">
        <span class="code" data-cell="code">${esc(c.id)}</span><span data-cell="name">${esc(c.name)}</span><span class="pair">${sp.map((t) => `<span>${L(t)}</span>`).join("")}</span>
        <span class="${f && f.level === "needs" ? "need" : "q"}">${f ? esc(shortNeed(f.text)) : ""}</span></button>`;
    }).join("")}<div class="row q" data-empty hidden>No matches</div></div>`;
}
function teachersHome() {
  const order = Mock.state.namesOn ? (a, b) => teacherOrder(b.id) - teacherOrder(a.id) || byId(a, b) : byId;
  const tags = Mock.fit(), cols = tags ? TEACHER_COLS : TEACHER_COLS.slice(0, 3);
  const list = sorted("teachers", [...Mock.teachers()].sort(order), cols);
  return `${bigLine()}${tools("teachers")}
    <div data-rows><div class="row r-teacher${tags ? " r-tags" : ""} head" data-head>${headCells("teachers", cols)}</div>${list.map((t) => {
      const c = Mock.placedOn(t.id), cn = c ? Mock.course(c).name : "Not placed";
      // Search also finds last year's result, in the card's words and in the download's, and with names on what their form showed.
      const was = Mock.past() && Mock.lastYear(t.id);
      const tagList = tags ? Mock.fitTags(t.id) : [];
      return `<button class="row r-teacher${tags ? " r-tags" : ""}" data-row data-teacher="${t.id}" data-k="t-${t.id}" data-q="${esc([who(t.id), c, cn, Mock.lastYearLine(t.id), was ? RESULT_LABEL[was.result] : "", Mock.fitSearch(t.id), ...tagList].filter(Boolean).join(" "))}">
        <span data-cell="name">${L(t.id)}</span><span class="code" data-cell="code">${c ? esc(c) : ""}</span><span class="${c ? "" : "need"}" data-cell="course">${esc(cn)}</span>${tags ? `<span class="tags" data-cell="tags">${tagList.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</span>` : ""}</button>`;
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
  const sel = document.activeElement?.matches?.("input[data-search]") ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
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
  if (k) {
    const el = document.querySelector(`[data-k="${CSS.escape(k)}"]`);
    // Never scrolls, and a search box keeps its caret, so a render the office did not cause (another tab's save) moves nothing.
    if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) el.setSelectionRange(sel[0], sel[1]); }
  }
  // Last year's rows make Start longer, so Build can end up below a short window just as it unlocks. Only then: a later
  // render, such as a Start tab, leaves the page where the office put it.
  const ready = canBuild();
  if (ready && !wasReady && PAST_SLOTS.some((name) => slots[name])) document.querySelector('[data-k="build"]').scrollIntoView({ block: "nearest" });
  wasReady = ready;
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
// If that fails, the button says so until the page next changes or a download works.
async function download() {
  try {
    const blob = new Blob([await writeBook(sheetsFor(Mock))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName(Mock);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    const el = document.querySelector("[data-download]");
    if (el) el.textContent = "Download"; // a try that works after one that failed
  } catch (err) {
    console.warn(err);
    const el = document.querySelector("[data-download]");
    if (el) el.textContent = "Download failed";
  }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-sort],[data-start-tab],[data-tab],[data-names],[data-download],[data-act],[data-course],[data-teacher]");
  if (!el) return;
  const d = el.dataset;
  if ("sort" in d) {
    const s = sortOf(d.sort);
    view.sort[d.sort] = { key: d.key, dir: s && s.key === d.key ? -s.dir : 1 };
    render(); return;
  }
  if ("startTab" in d) { startTab = d.startTab; render(); return; }
  if ("download" in d) { download(); return; }
  if ("tab" in d) { view.tab = d.tab; view.stack = []; render(); window.scrollTo(0, 0); return; }
  if ("names" in d) { setNames(!Mock.state.namesOn); return; }
  if (!d.act) { push(d.course && !d.teacher ? { k: "course", id: d.course } : { k: "teacher", id: d.teacher }); return; }
  switch (d.act) {
    case "build": build(); break;
    case "sample": addFiles(sampleFiles()); break;
    case "remove": if (phase === "draft") addLaterFiles([], d.file); else addFiles([], d.file); break;
    case "open": if (d.to === "forms") { if (top_()?.k === "forms") break; laterReset(); } push({ k: d.to, id: d.id }); break;
    case "addLater": addLater(); break;
    case "back": pop(); break;
    case "next": view.idx += 1; render(); break;
    case "pick": view.idx = Number(d.i); render(); break;
    case "moveTo": Mock.move(d.id, d.c || null); if (top_() && top_().k === "move") pop(); break;
    case "leave": Mock.leave([d.id]); break;
    case "leaveGroup": Mock.leave(Mock.todo().find((i) => i.kind === "noForm")?.tids ?? []); break;
    case "restore": Mock.restore(Number(d.v)); break;
    case "undo": Mock.undo(); break;
    case "startOver": startOver(); break;
  }
});
document.addEventListener("input", (e) => {
  const w = e.target.dataset && e.target.dataset.search;
  if (w) { view.q[w] = e.target.value; filter(w); }
});
// toggle does not bubble, so it is caught on the way down.
document.addEventListener("toggle", (e) => {
  if (e.target.matches && e.target.matches("[data-about]")) aboutOpen = e.target.open;
}, true);
document.addEventListener("change", (e) => {
  if (e.target.matches('[data-k="files"]')) { addFiles(e.target.files); e.target.value = ""; }
  if (e.target.matches('[data-k="later-files"]')) { addLaterFiles(e.target.files); e.target.value = ""; }
});
// A file dropped anywhere on the page counts, and never makes the browser navigate to it.
window.addEventListener("dragover", (e) => e.preventDefault());
// While the Add forms card is open, a drop goes to the card; otherwise to Start.
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (phase === "draft" && top_()?.k === "forms") addLaterFiles(e.dataTransfer.files);
  else addFiles(e.dataTransfer.files);
});

Mock.on(render);
Mock.onSnapshot(remember);

async function boot() {
  const saved = await loadAll().catch((err) => {
    console.error(err);
    loadFailed = true;
    return null;
  });
  if (saved) {
    savedVersion = saved.snapshots.at(-1).version;
    saveId = saved.saveId;
    phase = "draft";
    Mock.init(saved.school, saved.snapshots);
  } else {
    phase = "start";
    addFiles([]);
  }
}
boot();

// Writes the six invented Fernhollow files from a fixed seed. Everything here is made up.
// Usage: node tools/make_school.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeBook } from "../src/xlsx.js";

const SEED = 20261109;
const N3 = 17; // free offered courses with 3 seats; the rest keep 2
const out = new URL("../fixtures/school/", import.meta.url);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function pickWeighted(items, weights, k) {
  const pool = items.map((it, i) => ({ it, w: weights[i] }));
  const got = [];
  while (got.length < k && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rnd() * total, i = 0;
    while (r >= pool[i].w && i < pool.length - 1) { r -= pool[i].w; i++; }
    got.push(pool.splice(i, 1)[0].it);
  }
  return got;
}

const FIRST = "Ada Bram Cora Dov Esme Finn Greer Hollis Ines Jory Kestrel Linus Mirel Nico Orla Perrin Quill Rosamund Silas Tamsin Ulric Vesper Wren Xanthe Yorick Zinnia Alder Briar Calder Delphine Emeric Fenna".split(" ");
const LAST = "Quillfeather Tollivant Ambletide Hazelrook Thornquist Marrowby Fernwhistle Lindqvale Ashdowne Brambleton Copperfold Dunmorrow Elderhaven Foxglenn Gorsewick Hollowmere Inglethorn Juniperlee Kettlewick Larkmoor Mossgrove Nettlefield Orchardley Pinewhistle Quarrystone Rookhollow Sedgemoor Tansywell Underhill Vetchley Willowmere Yarrowby".split(" ");
const REGION = "Talloway Eskmere Ombrine Kelvane Sundaril Verrano Quillon Marrowdale Hesperin".split(" ");
const ACTIVITY = ["Coast Kayaking", "Highland Trek", "Reef Science", "Wildlife Survey", "Temple Arts", "Cycling Tour", "Village Service", "Photography Walk"];
const LOCAL = ["Urban Gardens", "Hawker Heritage", "River Clean-up", "Tech Makers", "Community Theatre", "Coding for Seniors", "Mangrove Walks", "Bird Watching", "Zero Waste Lab", "Museum Curators", "Kitchen Science"];

const renames = JSON.parse(await readFile(new URL("renames.json", import.meta.url), "utf8"));
const rename = (s) => renames[s] ?? s;

// Courses
const intNames = shuffle(REGION.flatMap((r) => ACTIVITY.map((a) => `${r} ${a}`)));
const SCUBA_COURSE = "Kelvane Reef Diving";
const intPool = intNames.slice(0, 29);
const courses = [];
for (let i = 1; i <= 30; i++) courses.push({ code: `INT-${String(i).padStart(2, "0")}`, name: i === 1 ? SCUBA_COURSE : intPool[i - 2], type: "International" });
const sgNames = shuffle(LOCAL).slice(0, 10);
for (let i = 1; i <= 10; i++) courses.push({ code: `SG-${String(i).padStart(2, "0")}`, name: sgNames[i - 1], type: "Singapore" });
const notOffered = new Set(["INT-27", "INT-28", "INT-29", "INT-30", "SG-09", "SG-10"]);
const pairCourses = ["INT-02", "INT-03", "INT-04", "INT-05", "INT-06", "SG-01", "SG-02", "SG-03", "SG-04"];
const free = courses.filter((c) => !notOffered.has(c.code) && c.code !== "INT-01" && !pairCourses.includes(c.code));
const threes = new Set(shuffle(free.map((c) => c.code)).slice(0, N3));
for (const c of courses) {
  c.seats = threes.has(c.code) ? 3 : 2;
  c.offered = !notOffered.has(c.code);
  c.cert = c.code === "INT-01" ? "Scuba certificate" : "";
  c.name = rename(c.name);
}
const byCode = Object.fromEntries(courses.map((c) => [c.code, c]));

// People
const pairs = shuffle(FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`))).slice(0, 96);
const people = pairs.map((n, i) => {
  const name = rename(n);
  const [f, l] = name.split(" ");
  return { name, email: `${f}.${l}@fernhollow.example`.toLowerCase(), cert: "", returning: null, form: true };
});
let k = 0;
people[k].cert = "Scuba certificate"; people[k].returning = "INT-01"; people[k].form = false; k++;
for (const code of pairCourses) for (let j = 0; j < 2; j++) { people[k].returning = code; people[k].form = false; k++; }
people[k].returning = "INT-28"; k++; // returning sponsor on a not-offered course, sends a form
for (let j = 0; j < 6; j++) people[k++].form = false;
const staff = shuffle(people);

// Choices, skewed to a few popular courses
const intCodes = courses.filter((c) => c.type === "International");
const sgCodes = courses.filter((c) => c.type === "Singapore");
const pop = (c) => (c.offered ? 0.4 + Math.pow(rnd(), 2.2) * 9 : 0.3) * (c.code === "INT-01" ? 0.3 : 1);
const intW = intCodes.map(pop), sgW = sgCodes.map(pop);
const r1 = [], r2 = [], sg = [];
for (const p of staff.filter((p) => p.form)) {
  let got = false;
  if (rnd() < 0.85) { r1.push([p.email, ...pickWeighted(intCodes, intW, 7).map((c) => c.name)]); got = true; }
  if (rnd() < 0.35) { r2.push([p.email, ...pickWeighted(intCodes, intW, 3).map((c) => c.name)]); got = true; }
  if (rnd() < 0.6 || !got) sg.push([p.email, ...pickWeighted(sgCodes, sgW, 5).map((c) => c.name)]);
}

const H = (n) => Array.from({ length: n }, (_, i) => `Choice ${i + 1}`);
const files = {
  courses: [["Course Code", "Course Name", "Type", "Seats", "Offered", "Certificate"], ...courses.map((c) => [c.code, c.name, c.type, c.seats, c.offered ? "Yes" : "No", c.cert])],
  staff: [["Email", "Name", "Certificates"], ...staff.map((p) => [p.email, p.name, p.cert])],
  returning: [["Email", "Course Code"], ...staff.filter((p) => p.returning).map((p) => [p.email, p.returning])],
  round1: [["Email", ...H(7)], ...r1],
  round2: [["Email", ...H(3)], ...r2],
  singapore: [["Email", ...H(5)], ...sg],
};
await mkdir(out, { recursive: true });
for (const [name, rows] of Object.entries(files)) await writeFile(new URL(`${name}.xlsx`, out), await writeBook([{ name: "Fernhollow", rows }]));
console.log(`school written: ${staff.length} staff, ${courses.length} courses, ${courses.filter((c) => c.seats === 3 && c.offered).length} three-seat`);

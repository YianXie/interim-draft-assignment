"""Throwaway mock data: one invented school, using a real solver run on an invented year.

Every name, email, course and comment here is made up. Usage: python3 make_sample.py SCRATCH_DIR OUT.js
"""

import json
import random
import sys
from pathlib import Path

sp, out = Path(sys.argv[1]), Path(sys.argv[2])
inst = json.loads((sp / "instances/sweep/typical-000-product.json").read_text())
runs = json.loads((sp / "instances/sweep/highs_results.json").read_text())["runs"]
assignment = next(r for r in runs if r["name"] == "typical-000-product")["assignment"]
rng = random.Random(20261109)

FIRST = "Ada Bram Cora Dov Esme Finn Greer Hollis Ines Jory Kestrel Linus Mirel Nico Orla Perrin Quill Rosamund Silas Tamsin Ulric Vesper Wren Xanthe Yorick Zinnia Alder Briar Calder Delphine Emeric Fenna".split()
LAST = "Quillfeather Tollivant Ambletide Hazelrook Thornquist Marrowby Fernwhistle Lindqvale Ashdowne Brambleton Copperfold Dunmorrow Elderhaven Foxglenn Gorsewick Hollowmere Inglethorn Juniperlee Kettlewick Larkmoor Mossgrove Nettlefield Orchardley Pinewhistle Quarrystone Rookhollow Sedgemoor Tansywell Underhill Vetchley Willowmere Yarrowby".split()
pairs = [(f, l) for f in FIRST for l in LAST]
rng.shuffle(pairs)

REGION = "Talloway Eskmere Ombrine Kelvane Sundaril Verrano Quillon Marrowdale Hesperin".split()
ACTIVITY = ["Coast Kayaking", "Highland Trek", "Reef Science", "Wildlife Survey", "Street Food Stories", "Temple Arts", "Cycling Tour", "Village Service", "Photography Walk"]
LOCAL = ["Urban Gardens", "Hawker Heritage", "River Clean-up", "Tech Makers", "Community Theatre", "Coding for Seniors", "Mangrove Walks", "Bird Watching", "Zero Waste Lab", "Museum Curators", "Kitchen Science"]
intl_names = [f"{r} {a}" for r in REGION for a in ACTIVITY]
rng.shuffle(intl_names)

ROUND = {"intl_r1": "Round 1", "intl_r2": "Round 2", "sg": "Singapore"}
COMMENTS = [
    "I hold a current first-aid certificate.",
    "Happy to lead swim safety on water-based courses.",
    "I speak conversational Spanish.",
    "Knee surgery last spring, so moderate walking only please.",
    "Would love to co-sponsor with {other}.",
    "I led a similar trip at my last school.",
    "Open to anything after my top three.",
    "I can drive the minibus if needed.",
    "Prefer not to be away during the first week of exams.",
]

i_n, s_n = 0, 0
courses = []
names = {}
for c in inst["courses"]:
    if c["id"].startswith("I"):
        name, kind = intl_names[i_n], "International"
        i_n += 1
    else:
        name, kind = LOCAL[s_n], "Singapore"
        s_n += 1
    names[c["id"]] = name
    courses.append({"id": c["id"], "name": name, "kind": kind, "seats": c["max"], "running": c["id"] not in inst["unticked"],
                    "needs": "Scuba certificate" if c["requires"] else None})

submitted = {p["t"] for p in inst["prefs"]}
ids = [t["id"] for t in inst["teachers"]]
display = {tid: pairs[i] for i, tid in enumerate(ids)}
teachers = []
for t in inst["teachers"]:
    first, last = display[t["id"]]
    prefs = [{"course": p["c"], "rank": p["rank"], "round": ROUND[p["round"]]} for p in inst["prefs"] if p["t"] == t["id"]]
    comment = None
    if t["id"] in submitted and rng.random() < 0.3:
        other = display[rng.choice(ids)]
        comment = rng.choice(COMMENTS).format(other=f"{other[0]} {other[1]}")
    teachers.append({
        "id": t["id"], "name": f"{first} {last}", "email": f"{first}.{last}@fernhollow.example".lower(),
        "gender": rng.choice("MF"), "returning": t["repeater"], "returningCourse": t["incumbent"],
        "submitted": t["id"] in submitted, "certificates": ["Scuba certificate"] if t["quals"] else [], "comment": comment, "prefs": prefs,
    })

# A believable staff list: most pairs mixed, a handful not, so the warning is meaningful in the mock.
by_course: dict[str, list[dict]] = {}
for t in teachers:
    if assignment.get(t["id"]):
        by_course.setdefault(assignment[t["id"]], []).append(t)
for group in by_course.values():
    first = rng.choice("MF")
    for j, t in enumerate(group):
        t["gender"] = first if j % 2 == 0 else ("F" if first == "M" else "M")
    if len(group) >= 2 and rng.random() < 0.08:
        group[1]["gender"] = group[0]["gender"]

data = {"school": "Fernhollow Academy", "year": "Interim 2028", "courses": courses, "teachers": teachers, "draft": assignment}
out.write_text("window.DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")
print(f"wrote {out}: {len(teachers)} teachers, {len(courses)} courses, placed {sum(v is not None for v in assignment.values())}")

"""Independent CP-SAT solve of the three priorities on the invented Fernhollow files.
Shares no code with src/. Reads fixtures/school/*.xlsx, writes fixtures/expected.json.
Run: uv run --no-project --isolated --with ortools --with openpyxl tools/expected.py
With --past it also reads fixtures/past/*.xlsx, adds the priority for those who got none of their choices
last year as the second of four, and writes fixtures/expected-past.json instead.
With --fit it also reads fixtures/fit/fit.xlsx and adds, after every other priority, most teachers on a course they fit;
it writes fixtures/expected-fit.json, or fixtures/expected-past-fit.json with --past --fit. The keep stage is not computed here.
With --later (alone) it builds on a kept draft, fixtures/later/kept.json ([{email, course}]): the kept teachers get no
variables and stay where they are, even where that breaks a rule; a course's free seats are its seats minus its kept
teachers; an offered course with a kept teacher runs and may stay short, and the first priority is its empty seats;
an offered course with nobody kept runs full or not at all; a returning sponsor who is not kept is like anyone else.
It writes fixtures/expected-later.json, where placed and running count kept and new teachers together."""
import json, sys
from collections import Counter
from pathlib import Path
from openpyxl import load_workbook
from ortools.sat.python import cp_model as cp

ROOT = Path(__file__).resolve().parent.parent
SCHOOL = ROOT / "fixtures" / "school"
PAST = ROOT / "fixtures" / "past"
FIT = ROOT / "fixtures" / "fit"
LATER = ROOT / "fixtures" / "later"
if sys.argv[1:] not in ([], ["--past"], ["--fit"], ["--past", "--fit"], ["--later"]):
    sys.exit("usage: expected.py [--past] [--fit] | --later")
WITH_LATER = "--later" in sys.argv[1:]
WITH_PAST = "--past" in sys.argv[1:]
WITH_FIT = "--fit" in sys.argv[1:]
WEIGHTS = [7, 6, 5, 4, 3, 2, 1]
BONUS = {"round1": 20, "round2": 10, "singapore": 0}

def form_columns(head):
    """A form is Timestamp, Email, the choices, then written answers: the Email column and the Choice columns, in order."""
    return head.index("Email"), [i for i, h in enumerate(head) if str(h).startswith("Choice ")]

def rows(name, folder=SCHOOL):
    ws = load_workbook(folder / f"{name}.xlsx", read_only=True).worksheets[0]
    assert ws.title == "Fernhollow", name
    out = [[("" if c is None else str(c).strip()) if not isinstance(c, (int, float)) else c for c in r] for r in ws.iter_rows(values_only=True)]
    return out[0], [r for r in out[1:] if any(c != "" for c in r)]

_, crow = rows("courses")
courses = {r[0]: dict(name=r[1], seats=int(r[3]), offered=r[4] == "Yes", cert=r[5]) for r in crow}
by_name = {c["name"]: k for k, c in courses.items()}
_, srow = rows("staff")
people = {r[0]: dict(name=r[1], certs={x.strip() for x in r[2].split(";") if x.strip()}) for r in srow}
_, rrow = rows("returning")
sponsor = {r[0]: r[1] for r in rrow}

best = {}  # (email, course) -> the best score of any one listing: rank weight plus round bonus, never mixed across listings
shown = {}  # (email, course) -> the rank on the earliest of Round 1, Round 2, Singapore that lists the course
forms = set()
for fname in ("round1", "round2", "singapore"):
    head, frows = rows(fname)
    at, picks = form_columns(head)
    for r in frows:
        r = r + [""] * (len(head) - len(r))
        forms.add(r[at])
        for i, nm in enumerate((r[j] for j in picks), start=1):
            if nm == "":
                continue
            k = (r[at], by_name[nm])
            best[k] = max(best.get(k, -1), WEIGHTS[i - 1] + BONUS[fname])
            shown.setdefault(k, i)

# A returning sponsor whose course is not offered is an ordinary teacher.
rep = {e: c for e, c in sponsor.items() if courses[c]["offered"]}
kept = {}
if WITH_LATER:
    kept = {r["email"]: r["course"] for r in json.loads((LATER / "kept.json").read_text())}
    assert all(e in people for e in kept) and all(c in courses for c in kept.values()), "kept.json names someone unknown"
    rep = {}  # a kept sponsor gets no variable; a sponsor who is not kept was taken off by the office: like anyone else
held = Counter(kept.values())  # course -> kept teachers on it
locked = set(rep.values())

m = cp.CpModel(); x = {}
for c, cd in sorted(courses.items()):
    if not cd["offered"]:
        continue
    if held[c] >= cd["seats"]:
        continue  # at or over its seats with kept teachers: nobody new
    for e in sorted(people):
        if e in kept:
            continue
        if e in rep and rep[e] != c:
            continue
        if cd["cert"] and cd["cert"] not in people[e]["certs"]:
            continue
        if e in forms and (e, c) not in best and rep.get(e) != c:
            continue
        x[e, c] = m.new_bool_var(f"x_{e}_{c}")
for e in people:
    vs = [v for (a, _), v in x.items() if a == e]
    m.add_at_most_one(vs)
    if e in rep:
        m.add(x[e, rep[e]] == 1)
short, running = [], {}
for c, cd in sorted(courses.items()):
    if not cd["offered"]:
        continue
    here = [v for (_, b), v in x.items() if b == c]
    if held[c]:
        # Runs already: new teachers fill at most its free seats, and every free seat left empty counts.
        room = max(0, cd["seats"] - held[c])
        s = m.new_int_var(0, room, f"s_{c}"); short.append(s)
        m.add(sum(here) <= room); m.add(sum(here) + s >= room)
        continue
    r = m.new_bool_var(f"r_{c}"); running[c] = r
    m.add(sum(here) <= cd["seats"] * r); m.add(sum(here) >= r)
    if c in locked:
        s = m.new_int_var(0, cd["seats"], f"s_{c}"); short.append(s)
        m.add(sum(here) + s >= cd["seats"])
    else:
        m.add(sum(here) >= cd["seats"] * r)
score = [(best[k], v) for k, v in x.items() if k in best]
noform = [v for (a, _), v in x.items() if a not in forms and a not in rep]
stages = [("min", [(1, s) for s in short]), ("max", score), ("min", [(1, v) for v in noform])]

def none_last_year():
    """Staff who sent a form last year and were placed on a course that was on none of their forms.
    A sponsor entry is a name: it counts only when exactly one of this year's staff has it, ignoring case and extra spaces.
    A past choice is the allocation's course whatever its letter case or spacing.
    Emails are in lower case throughout, the staff list's as well as the past forms'."""
    squash = lambda s: " ".join(str(s).lower().split())
    named = {}
    for e, p in people.items():
        named.setdefault(squash(p["name"]), []).append(e.lower())
    _, arow = rows("past-allocation", PAST)
    placed = {}
    for r in arow:
        for entry in r[2:]:
            who = named.get(squash(entry), [])
            if len(who) == 1:
                placed[who[0]] = squash(r[1])
    sent, listed = set(), set()
    for fname in ("past-round1", "past-round2", "past-singapore"):
        head, frows = rows(fname, PAST)
        at, picks = form_columns(head)
        for r in frows:
            r = r + [""] * (len(head) - len(r))
            e = r[at].lower(); sent.add(e)  # a row with every choice blank is still a form
            listed.update((e, squash(r[j])) for j in picks if r[j] != "")
    return {e for e, c in placed.items() if e in sent and (e, c) not in listed}

if WITH_PAST:
    # Second priority: most of them on a 1st to 4th choice this year. A returning sponsor is fixed, so not counted.
    got_none = none_last_year()
    top4 = [k for k in x if k[0].lower() in got_none and k[0] not in rep and shown.get(k, 99) <= 4]
    stages.insert(1, ("max", [(1, x[k]) for k in top4]))

if WITH_FIT:
    # Last priority: most teachers on a course they fit, a fit being a row whose Kind is not Limitation and whose code is not blank.
    _, frow = rows("fit", FIT)
    fits = sorted({(str(r[0]).lower(), r[1]) for r in frow if r[2] != "Limitation" and r[1] != ""})
    stages.append(("max", [(1, x[e, c]) for (e, c) in fits if (e, c) in x]))

def solve(sense, expr):
    (m.maximize if sense == "max" else m.minimize)(expr)
    s = cp.CpSolver(); s.parameters.num_workers = 1; s.parameters.random_seed = 0; s.parameters.max_time_in_seconds = 300
    code = s.solve(m)
    if code != cp.OPTIMAL:
        sys.exit(f"not proven optimal: {s.status_name(code)}")
    return round(s.objective_value)

values = []
for sense, ts in stages:
    e = sum(c * v for c, v in ts); v = solve(sense, e); values.append(v); m.add(e == v)
placed = len(kept) + sum(x.values()); nrun = len(held) + sum(running.values())
res = dict(values=values, placedMin=solve("min", placed), placedMax=solve("max", placed),
           runningMin=solve("min", nrun), runningMax=solve("max", nrun))
if WITH_PAST:
    res["owed"] = len({e for e, _ in top4})  # how many teachers the second priority can count
name = "expected" + ("-past" if WITH_PAST else "") + ("-fit" if WITH_FIT else "") + ("-later" if WITH_LATER else "") + ".json"
(ROOT / "fixtures" / name).write_text(json.dumps(res, indent=2) + "\n")
if WITH_LATER:
    print(json.dumps(res))
    if values[0] == 0:
        sys.exit("kept.json leaves no running course short, so the first priority is not checked")
    print(f"kept {len(kept)} on {len(held)} courses, new placed {res['placedMin'] - len(kept)}, short seats {values[0]}, new no-form placed {values[-1]}")
    sys.exit(0)

# Counts for the To do list, from the pinned result (all fixed once the values are pinned)
n_off = sum(c["offered"] for c in courses.values())
form_people = len(forms); noform_people = len(people) - form_people - len([e for e in rep])
noform_placed = values[-2] if WITH_FIT else values[-1]  # the no-form stage is the last before the fit stage
form_placed = res["placedMin"] - len(rep) - noform_placed
print(json.dumps(res))
print(f"offered {n_off}, running {res['runningMin']}, empty offered {n_off - res['runningMin']}, short seats {values[0]}")
print(f"form people {form_people}, form placed {form_placed}, form not placed {form_people - form_placed}")
print(f"no-form people {noform_people}, no-form placed {noform_placed}, no-form not placed {noform_people - noform_placed}")

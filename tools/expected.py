"""Independent CP-SAT solve of the three priorities on the invented Fernhollow files.
Shares no code with src/. Reads fixtures/school/*.xlsx, writes fixtures/expected.json.
Run: uv run --no-project --isolated --with ortools --with openpyxl tools/expected.py
With --past it also reads fixtures/past/*.xlsx, adds the priority for those who got none of their choices
last year as the second of four, and writes fixtures/expected-past.json instead."""
import json, sys
from pathlib import Path
from openpyxl import load_workbook
from ortools.sat.python import cp_model as cp

ROOT = Path(__file__).resolve().parent.parent
SCHOOL = ROOT / "fixtures" / "school"
PAST = ROOT / "fixtures" / "past"
if sys.argv[1:] not in ([], ["--past"]):
    sys.exit("usage: expected.py [--past]")
WITH_PAST = sys.argv[1:] == ["--past"]
WEIGHTS = [7, 6, 5, 4, 3, 2, 1]
BONUS = {"round1": 20, "round2": 10, "singapore": 0}

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

best = {}  # (email, course) -> (best rank, best bonus)
shown = {}  # (email, course) -> the rank on the earliest of Round 1, Round 2, Singapore that lists the course
forms = set()
for fname in ("round1", "round2", "singapore"):
    _, frows = rows(fname)
    for r in frows:
        forms.add(r[0])
        for i, nm in enumerate(r[1:], start=1):
            if nm == "":
                continue
            k = (r[0], by_name[nm]); rk, bn = best.get(k, (99, -1))
            best[k] = (min(rk, i), max(bn, BONUS[fname]))
            shown.setdefault(k, i)

# A returning sponsor whose course is not offered is an ordinary teacher.
rep = {e: c for e, c in sponsor.items() if courses[c]["offered"]}
locked = set(rep.values())

m = cp.CpModel(); x = {}
for c, cd in sorted(courses.items()):
    if not cd["offered"]:
        continue
    for e in sorted(people):
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
    r = m.new_bool_var(f"r_{c}"); running[c] = r
    m.add(sum(here) <= cd["seats"] * r); m.add(sum(here) >= r)
    if c in locked:
        s = m.new_int_var(0, cd["seats"], f"s_{c}"); short.append(s)
        m.add(sum(here) + s >= cd["seats"])
    else:
        m.add(sum(here) >= cd["seats"] * r)
score = [(WEIGHTS[best[k][0] - 1] + best[k][1], v) for k, v in x.items() if k in best]
noform = [v for (a, _), v in x.items() if a not in forms and a not in rep]
stages = [("min", [(1, s) for s in short]), ("max", score), ("min", [(1, v) for v in noform])]

def none_last_year():
    """Staff who sent a form last year and were placed on a course that was on none of their forms.
    A sponsor entry is a name: it counts only when exactly one of this year's staff has it, ignoring case and extra spaces.
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
                placed[who[0]] = r[1]
    sent, listed = set(), set()
    for fname in ("past-round1", "past-round2", "past-singapore"):
        _, frows = rows(fname, PAST)
        for r in frows:
            e = r[0].lower(); sent.add(e)  # a row with every choice blank is still a form
            listed.update((e, nm) for nm in r[1:] if nm != "")
    return {e for e, c in placed.items() if e in sent and (e, c) not in listed}

if WITH_PAST:
    # Second priority: most of them on a 1st to 4th choice this year. A returning sponsor is fixed, so not counted.
    got_none = none_last_year()
    top4 = [k for k in x if k[0].lower() in got_none and k[0] not in rep and shown.get(k, 99) <= 4]
    stages.insert(1, ("max", [(1, x[k]) for k in top4]))

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
placed = sum(x.values()); nrun = sum(running.values())
res = dict(values=values, placedMin=solve("min", placed), placedMax=solve("max", placed),
           runningMin=solve("min", nrun), runningMax=solve("max", nrun))
if WITH_PAST:
    res["owed"] = len({e for e, _ in top4})  # how many teachers the second priority can count
(ROOT / "fixtures" / ("expected-past.json" if WITH_PAST else "expected.json")).write_text(json.dumps(res, indent=2) + "\n")

# Counts for the To do list, from the pinned result (all fixed once the values are pinned)
n_off = sum(c["offered"] for c in courses.values())
form_people = len(forms); noform_people = len(people) - form_people - len([e for e in rep])
form_placed = res["placedMin"] - len(rep) - values[-1]
print(json.dumps(res))
print(f"offered {n_off}, running {res['runningMin']}, empty offered {n_off - res['runningMin']}, short seats {values[0]}")
print(f"form people {form_people}, form placed {form_placed}, form not placed {form_people - form_placed}")
print(f"no-form people {noform_people}, no-form placed {values[-1]}, no-form not placed {noform_people - values[-1]}")

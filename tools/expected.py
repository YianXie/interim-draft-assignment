"""Independent CP-SAT solve of the three priorities on the invented Fernhollow files.
Shares no code with src/. Reads fixtures/school/*.xlsx, writes fixtures/expected.json.
Run: uv run --no-project --isolated --with ortools --with openpyxl tools/expected.py"""
import json, sys
from pathlib import Path
from openpyxl import load_workbook
from ortools.sat.python import cp_model as cp

ROOT = Path(__file__).resolve().parent.parent
SCHOOL = ROOT / "fixtures" / "school"
WEIGHTS = [7, 6, 5, 4, 3, 2, 1]
BONUS = {"round1": 20, "round2": 10, "singapore": 0}

def rows(name):
    ws = load_workbook(SCHOOL / f"{name}.xlsx", read_only=True).worksheets[0]
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
(ROOT / "fixtures" / "expected.json").write_text(json.dumps(res, indent=2) + "\n")

# Counts for the To do list, from the pinned result (all fixed once the values are pinned)
n_off = sum(c["offered"] for c in courses.values())
form_people = len(forms); noform_people = len(people) - form_people - len([e for e in rep])
form_placed = res["placedMin"] - len(rep) - values[2]
print(json.dumps(res))
print(f"offered {n_off}, running {res['runningMin']}, empty offered {n_off - res['runningMin']}, short seats {values[0]}")
print(f"form people {form_people}, form placed {form_placed}, form not placed {form_people - form_placed}")
print(f"no-form people {noform_people}, no-form placed {values[2]}, no-form not placed {noform_people - values[2]}")

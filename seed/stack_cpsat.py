"""Independent CP-SAT encoding of the product's stack of priorities on invented years. Reads invented JSON only.
Compares each priority's best value with the HiGHS values and re-checks every HiGHS assignment with plain code."""
import json, sys, time
from pathlib import Path
from ortools.sat.python import cp_model as cp

inst_dir, highs_json, out_path = Path(sys.argv[1]), json.load(open(sys.argv[2])), Path(sys.argv[3])

def model(d):
    best = {}
    for p in d["prefs"]:
        k = (p["t"], p["c"]); b = d["bonus"][p["round"]]
        r, bb = best.get(k, (99, -1)); best[k] = (min(r, p["rank"]), max(bb, b))
    subs = {p["t"] for p in d["prefs"]}; off = set(d["unticked"]); stay = d.get("stay") or {}
    rep = {t["id"]: t["incumbent"] for t in d["teachers"] if t["repeater"] and t["incumbent"]}
    locked = {c for c in rep.values() if c not in off}
    m = cp.CpModel(); x = {}
    for c in d["courses"]:
        if c["id"] in off: continue
        for t in d["teachers"]:
            inc = rep.get(t["id"])
            if inc and inc != c["id"]: continue
            if not set(c["requires"]) <= set(t["quals"]): continue
            if t["id"] in subs and (t["id"], c["id"]) not in best and inc != c["id"]: continue
            x[t["id"], c["id"]] = m.new_bool_var(f"x_{t['id']}_{c['id']}")
    for t in d["teachers"]:
        vs = [v for (a, _), v in x.items() if a == t["id"]]
        if vs: m.add_at_most_one(vs)
        inc = rep.get(t["id"])
        if inc and (t["id"], inc) in x: m.add(x[t["id"], inc] == 1)
    short, mixed = [], []
    gen = {t["id"]: t["gender"] for t in d["teachers"]}
    for c in d["courses"]:
        cid = c["id"]
        if cid in off: continue
        here = [v for (_, b), v in x.items() if b == cid]
        if cid in locked:
            s = m.new_int_var(0, c["min"], f"s_{cid}"); short.append(s)
            m.add(sum(here) + s >= c["min"]); m.add(sum(here) <= c["max"])
        else:
            y = m.new_bool_var(f"y_{cid}")
            m.add(sum(here) >= c["min"] * y); m.add(sum(here) <= c["max"] * y)
        men = [v for (a, b), v in x.items() if b == cid and gen[a] == "male"]
        wom = [v for (a, b), v in x.items() if b == cid and gen[a] == "female"]
        if men and wom and c["max"] >= 2:
            z = m.new_bool_var(f"z_{cid}"); mixed.append(z)
            m.add(z <= sum(men)); m.add(z <= sum(wom))
    w = d["weights"]
    score = [(w[best[k][0] - 1] + best[k][1], v) for k, v in x.items() if k in best]
    noform = [v for (a, _), v in x.items() if a not in subs and a not in rep]
    stays = [v for (a, b), v in x.items() if stay.get(a) == b]
    return m, x, [("min", [(1, s) for s in short]), ("max", score + [(2, z) for z in mixed]), ("min", [(1, v) for v in noform]), ("max", [(1, v) for v in stays])], best, subs, rep, locked

def solve_stack(d, workers=8):
    m, x, stages, *_ = model(d); vals = []; t0 = time.perf_counter(); status = "OPTIMAL"
    for sense, ts in stages:
        if not ts: vals.append(0); continue
        e = sum(c * v for c, v in ts)
        (m.maximize if sense == "max" else m.minimize)(e)
        s = cp.CpSolver(); s.parameters.num_workers = workers; s.parameters.max_time_in_seconds = 60; s.parameters.random_seed = 0
        code = s.solve(m)
        if code != cp.OPTIMAL: status = s.status_name(code); break
        v = round(s.objective_value); vals.append(v); m.add(e == v)
    return status, vals, time.perf_counter() - t0

def recheck(d, a, values):
    """Plain code, no solver: does this assignment keep every rule, and does it score what was claimed?"""
    _, _, _, best, subs, rep, locked = model(d)
    off = set(d["unticked"]); C = {c["id"]: c for c in d["courses"]}; T = {t["id"]: t for t in d["teachers"]}
    by = {}
    for t, c in a.items():
        if c is None: continue
        by.setdefault(c, []).append(t)
        if c in off: return "placed on a course that is off"
        if not set(C[c]["requires"]) <= set(T[t]["quals"]): return "certificate missing"
        if t in subs and (t, c) not in best and rep.get(t) != c: return "not a ranked course"
    for t, inc in rep.items():
        if inc not in off and a.get(t) != inc: return "returning sponsor moved"
    for c, ts in by.items():
        if len(ts) > C[c]["max"]: return "over seats"
        if c not in locked and len(ts) < C[c]["min"]: return "under minimum on an unlocked course"
    short = sum(max(0, C[c]["min"] - len(by.get(c, []))) for c in locked)
    score = sum(d["weights"][best[(t, c)][0] - 1] + best[(t, c)][1] for t, c in a.items() if c and (t, c) in best)
    for c, ts in by.items():
        g = {T[t]["gender"] for t in ts}
        if "male" in g and "female" in g: score += 2
    nf = sum(1 for t, c in a.items() if c and t not in subs and t not in rep)
    st = sum(1 for t, c in (d.get("stay") or {}).items() if a.get(t) == c)
    if [short, score, nf, st] != values: return f"recount {[short, score, nf, st]} differs"
    return "ok"

files = sorted(p for p in inst_dir.glob("*.json") if "results" not in p.name)
limit = int(sys.argv[4]) if len(sys.argv) > 4 else len(files)
same = diff = 0; bad = []; recheck_ok = 0; rc_bad = []; goldens = []; t_total = 0; shape = {"bent": 0, "stage3_nonzero": 0, "stage4_nonzero": 0, "years": 0}
for p in files[:limit]:
    d = json.loads(p.read_text())
    st, vals, secs = solve_stack(d); t_total += secs
    h = highs_json.get(d["name"], {})
    goldens.append({"name": d["name"], "status": st, "values": vals})
    shape["years"] += 1; shape["bent"] += int(vals[0] > 0); shape["stage3_nonzero"] += int(len(vals) > 2 and vals[2] > 0); shape["stage4_nonzero"] += int(len(vals) > 3 and vals[3] > 0)
    if st == "OPTIMAL" and h.get("status") == "Optimal" and vals == h["values"]: same += 1
    else: diff += 1; bad.append((d["name"], st, vals, h.get("status"), h.get("values")))
    if "assignment" in h:
        r = recheck(d, h["assignment"], h["values"])
        if r == "ok": recheck_ok += 1
        else: rc_bad.append((d["name"], r))
out_path.write_text(json.dumps(goldens))
print(f"CP-SAT stack vs HiGHS stack: all four priorities equal on {same} of {same + diff}; CP-SAT total {t_total:.0f} s")
print("plain-code re-check of HiGHS answers:", recheck_ok, "ok;", rc_bad[:5])
print("shape:", shape)
for b in bad[:10]: print("DIFF", b)

import json, re, sys, time, urllib.request
# Usage: python3 run.py <this folder> [model] [prompt file] [cases module] [twice|once]
# Sends each invented answer in cases.py to Ollama on this machine and scores the reply. Invented data only.
sys.path.insert(0, sys.argv[1])
MODEL = sys.argv[2] if len(sys.argv) > 2 else "qwen3.5:9b"
import importlib, os
PROMPT = sys.argv[3] if len(sys.argv) > 3 else "prompt_v1.txt"
SYSTEM = open(os.path.join(sys.argv[1], PROMPT)).read()
CASEMOD = sys.argv[4] if len(sys.argv) > 4 else "cases"
CASES = importlib.import_module(CASEMOD).CASES
TWICE = (sys.argv[5] if len(sys.argv) > 5 else "twice") == "twice"
def call(c):
    body = {"model": MODEL, "stream": False, "think": False, "options": {"temperature": 0, "seed": 1},
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": "Ranked courses: " + "; ".join(c["ranked"]) + "\nAnswer: " + c["text"]}]}
    t = time.time()
    d = json.load(urllib.request.urlopen(urllib.request.Request("http://localhost:11434/api/chat", json.dumps(body).encode()), timeout=300))
    return d["message"]["content"], time.time() - t
def parse(raw):
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    d = json.loads(s)
    return d["tags"] if "tags" in d else [t for x in d["sentences"] for t in x.get("tags", [])]
norm = lambda s: " ".join(s.split())
out = []
for c in CASES:
    raw1, secs = call(c); raw2 = call(c)[0] if TWICE else raw1
    r = dict(id=c["id"], note=c["note"], secs=round(secs, 1), same=raw1 == raw2, problems=[], raw=raw1)
    try: tags = parse(raw1)
    except Exception as e:
        r["problems"].append("unreadable reply"); out.append(r); continue
    r["tags"] = tags
    for t in tags:
        if norm(t.get("quote", "")) not in norm(c["text"]): r["problems"].append(f"quote not in text: {t.get('quote')!r}")
        bad = [x for x in t.get("courses", []) if x not in c["ranked"]]
        if bad: r["problems"].append(f"course not in ranked list: {bad}")
        if t.get("kind") != "limitation":
            for f in c["forbid"]:
                if f.lower() in (t.get("quote", "") + " " + t.get("tag", "")).lower(): r["problems"].append(f"listed something it should skip: {t.get('quote')!r}")
    if c.get("empty") and tags: r["problems"].append(f"should be empty, got {len(tags)} tags")
    for e in c["expect"]:
        kw, want = e[0], e[1]; kind = e[2] if len(e) > 2 else None
        hits = [t for t in tags if any(k.lower() in t.get("quote", "").lower() for k in kw.split("|"))]
        if not hits: r["problems"].append(f"missed: {kw!r}"); continue
        got = sorted(set(x for t in hits for x in t.get("courses", [])))
        if isinstance(want, list) and got != sorted(want): r["problems"].append(f"wrong courses for {kw!r}: got {got}")
        if isinstance(want, tuple) and not set(want[1]) <= set(got): r["problems"].append(f"wrong courses for {kw!r}: got {got}")
        if kind and not any(t.get("kind") == kind for t in hits): r["problems"].append(f"wrong kind for {kw!r}: {[t.get('kind') for t in hits]}")
    out.append(r)
    print(c["id"], c["note"], "| OK" if not r["problems"] else "| " + "; ".join(r["problems"]), "| same twice" if r["same"] else "| DIFFERENT twice", f"| {r['secs']}s", flush=True)
json.dump(out, open(sys.argv[1] + f"/results/results-{MODEL.replace(':','-')}-{PROMPT[:-4]}-{CASEMOD}.json", "w"), indent=1)
ok = sum(not r["problems"] for r in out)
print("misses:", sum(p.startswith("missed") for r in out for p in r["problems"]), "of", sum(len(c["expect"]) for c in CASES), "expected")
print(f"\nclean cases: {ok}/{len(out)}; identical on rerun: {sum(r['same'] for r in out)}/{len(out)}; tags: {sum(len(r.get('tags', [])) for r in out)}; bad quotes: {sum(p.startswith('quote not') for r in out for p in r['problems'])}")

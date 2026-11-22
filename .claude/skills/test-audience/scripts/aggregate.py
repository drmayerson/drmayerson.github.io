#!/usr/bin/env python3
"""Check and summarise the visitor responses of a test-audience run.

    python aggregate.py <run_dir> [--expect id1,id2,...]

Reads <run_dir>/responses/*.json, reports missing/invalid files, writes <run_dir>/summary.json
and prints Markdown tables (ratings overall and by group, exit reasons, screen reach).
If --expect is not given, the persona ids are read from the "Panel" / "ids" line of brief.md when possible.
Standard library only.
"""
import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from statistics import mean

REQUIRED = ["persona_id", "profile", "first_sight", "timeline", "exit", "understood",
            "tell_someone_tonight", "failures", "ratings"]
RATINGS = ["enjoyment", "clarity", "learned", "felt_smart", "would_recommend"]
GROUPS = ["age_band", "gw_et_knowledge", "digital_skill", "language", "et_stance"]


def screen_key(s):
    m = re.match(r"S(\d+)", str(s or ""))
    return (int(m.group(1)), str(s)) if m else (10**6, str(s))


def expected_ids(run, explicit):
    if explicit:
        return [x.strip() for x in explicit.split(",") if x.strip()]
    brief = os.path.join(run, "brief.md")
    if os.path.exists(brief):
        text = open(brief, encoding="utf-8").read()
        ids = re.findall(r"\b([a-z]+(?:-[a-z]+)*-\d{1,3})\b", text)
        seen = []
        for i in ids:
            if i not in seen:
                seen.append(i)
        return seen
    return []


def fmt(x):
    return "–" if x is None else f"{x:.1f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--expect", default="")
    args = ap.parse_args()
    try:  # Windows consoles default to cp1252; responses contain any script
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    files = sorted(glob.glob(os.path.join(args.run, "responses", "*.json")))
    data, problems = [], []
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception as e:  # noqa: BLE001
            problems.append(f"invalid JSON: {os.path.basename(f)} ({e})")
            continue
        missing = [k for k in REQUIRED if k not in d]
        if missing:
            problems.append(f"{os.path.basename(f)} lacks: {', '.join(missing)}")
        data.append(d)

    got = {d.get("persona_id") for d in data}
    exp = expected_ids(args.run, args.expect)
    for pid in exp:
        if pid not in got:
            problems.append(f"missing response: {pid}")

    n = len(data)
    out = {"n": n, "problems": problems}

    # ratings
    def rmean(rows, key):
        vals = [r.get("ratings", {}).get(key) for r in rows]
        vals = [v for v in vals if isinstance(v, (int, float))]
        return round(mean(vals), 2) if vals else None

    out["ratings_overall"] = {k: rmean(data, k) for k in RATINGS}
    by_group = {}
    for g in GROUPS:
        buckets = defaultdict(list)
        for d in data:
            buckets[str(d.get("profile", {}).get(g, "?"))].append(d)
        by_group[g] = {b: {"n": len(rows), **{k: rmean(rows, k) for k in RATINGS}} for b, rows in sorted(buckets.items())}
    out["ratings_by_group"] = by_group

    # funnel
    started = sum(1 for d in data if d.get("first_sight", {}).get("started"))
    out["started"] = started
    exits = Counter(d.get("exit", {}).get("reason", "?") for d in data)
    out["exit_reasons"] = dict(exits.most_common())
    exit_screens = Counter(str(d.get("exit", {}).get("screen", "?")) for d in data)
    out["exit_screens"] = dict(sorted(exit_screens.items(), key=lambda kv: screen_key(kv[0])))
    reach = Counter()
    for d in data:
        for s in {str(t.get("screen")) for t in d.get("timeline", []) if t.get("screen")}:
            reach[s] += 1
    out["screen_reach"] = dict(sorted(reach.items(), key=lambda kv: screen_key(kv[0])))
    times = [d.get("exit", {}).get("t") for d in data if isinstance(d.get("exit", {}).get("t"), (int, float))]
    out["time_spent_s"] = {"mean": round(mean(times)) if times else None, "min": min(times) if times else None, "max": max(times) if times else None}

    # failures and confusions by screen
    fails = defaultdict(list)
    for d in data:
        for f in d.get("failures", []) or []:
            fails[(str(f.get("screen", "?")), f.get("type", "?"))].append({"persona": d.get("persona_id"), "what": f.get("what"), "severity": f.get("severity")})
    out["failures_by_screen_type"] = [
        {"screen": s, "type": t, "count": len(v), "max_severity": max((x.get("severity") or 0) for x in v), "items": v}
        for (s, t), v in sorted(fails.items(), key=lambda kv: (-len(kv[1]), screen_key(kv[0][0])))
    ]
    out["misconception_count"] = sum(len(d.get("misconceptions", []) or []) for d in data)
    conf = [d.get("sim_confidence", {}).get("score") for d in data]
    conf = [c for c in conf if isinstance(c, (int, float))]
    out["mean_sim_confidence"] = round(mean(conf), 2) if conf else None

    with open(os.path.join(args.run, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)

    # print
    print(f"## Responses: {n}" + (f" of {len(exp)} expected" if exp else ""))
    for p in problems:
        print(f"- PROBLEM: {p}")
    print()
    print("| | " + " | ".join(RATINGS) + " |")
    print("|---|" + "---|" * len(RATINGS))
    print("| all (n=%d) | " % n + " | ".join(fmt(out["ratings_overall"][k]) for k in RATINGS) + " |")
    for g in ("age_band", "gw_et_knowledge"):
        for b, row in by_group[g].items():
            print(f"| {g}={b} (n={row['n']}) | " + " | ".join(fmt(row[k]) for k in RATINGS) + " |")
    print()
    print(f"Started: {started}/{n}. Time spent (s): {out['time_spent_s']}")
    print("Exit reasons: " + ", ".join(f"{k} {v}" for k, v in out["exit_reasons"].items()))
    print("Exit screens: " + ", ".join(f"{k} {v}" for k, v in out["exit_screens"].items()))
    print("Screen reach: " + ", ".join(f"{k} {v}" for k, v in out["screen_reach"].items()))
    print(f"Misconceptions reported: {out['misconception_count']}. Mean sim confidence: {out['mean_sim_confidence']}")
    print()
    print("Failures by screen and type (count, max severity):")
    for f in out["failures_by_screen_type"]:
        print(f"- {f['screen']} {f['type']}: {f['count']} (max {f['max_severity']})")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()

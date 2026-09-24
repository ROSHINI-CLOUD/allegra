import json, glob, os, sys, subprocess, collections

D = r"C:\Users\nithy\.claude\projects\C--Users-nithy-Desktop--website-production-allegra-aws"
ROOT = r"C:\Users\nithy\Desktop\.website-production\allegra aws"
BS = chr(92)
APPLY = "--apply" in sys.argv
SINCE = "2026-09-01T00:00:00"
RECENT = "2026-09-24T08:00:00"
NEWFILES = {"apps/api/src/providers/animatedArtwork.ts","apps/api/src/providers/animatedArtwork.test.ts","apps/api/src/providers/appleMusicCanvas.ts","apps/api/src/providers/appleMusicCanvas.test.ts","apps/api/src/providers/unison.ts","apps/api/src/providers/unison.test.ts","apps/api/src/providers/youlyplus.ts","apps/api/src/providers/youlyplus.test.ts","apps/api/src/providers/youtubeMusic.ts","apps/api/src/providers/youtubeMusic.test.ts","apps/api/src/routes/canvas.ts","apps/api/src/services/canvas.ts","apps/api/src/services/songRelations.ts","apps/api/src/services/songRelations.test.ts","apps/api/src/services/youtubeRelated.ts","apps/api/src/services/youtubeRelated.test.ts","apps/api/src/user/plays.ts","apps/api/src/user/plays.test.ts","apps/api/.env","apps/web/.env.local"}

tracked = set(subprocess.run(["git", "-C", ROOT, "ls-files"], capture_output=True, text=True).stdout.split("\n"))


def rel(fp):
    fp = fp.replace(BS, "/")
    key = "allegra aws/"
    if key in fp:
        return fp.split(key, 1)[1]
    return None


def wanted(r):
    return r is not None and (
        r.startswith("apps/api/") or r.startswith("packages/shared/") or r in ("apps/web/.env.local", "apps/web/.env.example", "apps/api/.env")
    )


events = []
for f in glob.glob(os.path.join(D, "*.jsonl")):
    uses = {}
    results = {}
    for line in open(f, encoding="utf8", errors="ignore"):
        try:
            o = json.loads(line)
        except Exception:
            continue
        ts = o.get("timestamp", "")
        c = (o.get("message") or {}).get("content")
        if not isinstance(c, list):
            continue
        for it in c:
            if it.get("type") == "tool_use" and it.get("name") in ("Write", "Edit", "MultiEdit"):
                uses[it["id"]] = (ts, it)
            elif it.get("type") == "tool_result":
                results[it.get("tool_use_id")] = bool(it.get("is_error"))
    for uid, (ts, it) in uses.items():
        if uid in results and not results[uid] and ts >= SINCE:
            events.append((ts, it))

events.sort(key=lambda e: e[0])
state = {}
stats = collections.Counter()
skipped = collections.defaultdict(int)


def load(r):
    if r in state:
        return state[r]
    p = os.path.join(ROOT, r.replace("/", os.sep))
    state[r] = open(p, encoding="utf8", newline="").read() if os.path.exists(p) else None
    return state[r]


for ts, it in events:
    inp = it["input"]
    r = rel(inp.get("file_path", ""))
    if not wanted(r):
        continue
    if r not in NEWFILES and ts < RECENT:
        continue
    if r in tracked and not r.startswith("apps/web/.env") and r not in NEWFILES:
        if it["name"] == "Write":
            stats["write-skipped-tracked"] += 1
            continue
    if r not in tracked and r not in NEWFILES:
        stats["ignored-untracked-nonwhitelist"] += 1
        continue
    if it["name"] == "Write":
        if r in tracked and not r.startswith("apps/web/.env"):
            stats["write-skipped-tracked"] += 1
            continue
        state[r] = inp["content"]
        stats["write"] += 1
    else:
        edits = [inp] if it["name"] == "Edit" else inp.get("edits", [])
        cur = load(r)
        if cur is None:
            stats["edit-nofile"] += 1
            skipped[r] += 1
            continue
        for e in edits:
            old, new = e["old_string"], e["new_string"]
            n = cur.count(old)
            if n == 0 or (n > 1 and not e.get("replace_all")):
                stats["edit-skipped"] += 1
                skipped[r] += 1
                continue
            cur = cur.replace(old, new) if e.get("replace_all") else cur.replace(old, new, 1)
            stats["edit"] += 1
        state[r] = cur

print(dict(stats))
changed = []
for r, content in sorted(state.items()):
    if content is None:
        continue
    p = os.path.join(ROOT, r.replace("/", os.sep))
    before = open(p, encoding="utf8", newline="").read() if os.path.exists(p) else None
    if before != content:
        changed.append(r)
        print(("NEW " if before is None else "MOD ") + r, "(skipped edits: %d)" % skipped.get(r, 0))
        if APPLY:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w", encoding="utf8", newline="").write(content)
print("changed", len(changed))

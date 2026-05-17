#!/usr/bin/env python3
"""
outreach_automap.py — DB의 최신 PDF 첨부 중 '회사소개서/크리에이터' 패턴 매치를 슬롯에 복사.
Usage: outreach_automap.py [--dry]
"""
import sys, json, sqlite3, os, shutil, re

DB = "/root/jinho-playground/data/ceo_mail.db"
ATTACH_BASE = "/root/jinho-playground/public"
SLOT_DIR = "/root/jinho-playground/public/files"

SLOTS = [
    {
        "slot": "company",
        "target": "beaus-company-deck.pdf",
        # 이름 패턴 우선순위: 더 매치되는 키워드 많을수록 점수 ↑
        "keywords": ["회사소개서", "회사 소개서", "company"],
        "exclude": ["크리에이터", "PACK", "creator"],  # 크리에이터 PDF는 제외
    },
    {
        "slot": "creators",
        "target": "beaus-creators-roster.pdf",
        "keywords": ["크리에이터", "creator", "BROUND", "비라운드", "PACK"],
        "exclude": [],
    },
]

def score(name, keywords, exclude):
    n = name.lower()
    s = 0
    for k in keywords:
        if k.lower() in n: s += 2
    for x in exclude:
        if x.lower() in n: s -= 5
    if n.endswith(".pdf"): s += 1
    return s

def main():
    dry = "--dry" in sys.argv

    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute("""
      SELECT date_ts, attachments FROM messages
      WHERE attachments LIKE '%pdf%'
        AND (attachments LIKE '%뷰스%' OR attachments LIKE '%beaus%' OR attachments LIKE '%BROUND%' OR attachments LIKE '%비라운드%' OR attachments LIKE '%크리에이터%')
        AND attachments LIKE '%url%'
      ORDER BY date_ts DESC LIMIT 50
    """).fetchall()

    # 각 슬롯에 대해 최적 후보 찾기 (최신 + 키워드 최고점)
    candidates_by_slot = {s["slot"]: [] for s in SLOTS}
    for date_ts, atts_json in rows:
        try:
            atts = json.loads(atts_json)
        except Exception:
            continue
        for a in atts:
            name = a.get("name", "")
            url = a.get("url")
            if not url or not name.lower().endswith(".pdf"): continue
            size = a.get("size", 0)
            for slot_def in SLOTS:
                sc = score(name, slot_def["keywords"], slot_def["exclude"])
                if sc <= 0: continue
                candidates_by_slot[slot_def["slot"]].append({
                    "ts": date_ts, "name": name, "size": size, "url": url, "score": sc,
                })

    os.makedirs(SLOT_DIR, exist_ok=True)
    result = {}
    for slot_def in SLOTS:
        slot = slot_def["slot"]
        cands = candidates_by_slot[slot]
        if not cands:
            result[slot] = {"ok": False, "error": "no candidate found"}
            continue
        # 점수 desc, 그 다음 최신 desc
        cands.sort(key=lambda c: (-c["score"], -c["ts"]))
        best = cands[0]
        src = ATTACH_BASE + best["url"]
        dst = os.path.join(SLOT_DIR, slot_def["target"])
        if not os.path.isfile(src):
            result[slot] = {"ok": False, "error": f"src not on disk: {src}"}
            continue
        if dry:
            result[slot] = {"ok": True, "dry": True, "src": src, "dst": dst, "name": best["name"], "size": best["size"]}
        else:
            try:
                shutil.copy2(src, dst)
                result[slot] = {"ok": True, "src": best["name"], "size": best["size"], "dst_path": f"/files/{slot_def['target']}"}
            except Exception as e:
                result[slot] = {"ok": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

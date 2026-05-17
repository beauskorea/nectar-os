#!/usr/bin/env python3
"""
fetch_schedule.py — Google Sheets (주차별 진행업무) CSV → JSON
시트: 1OzFtdgXmgIqN4MjEi-w3Q6RqKPq65KY463eanSALw3A gid=2032315859
공개 link share 기반 (CSV export endpoint).
"""
import csv, json, urllib.request, os
from datetime import datetime, timezone

SHEET_ID = "1OzFtdgXmgIqN4MjEi-w3Q6RqKPq65KY463eanSALw3A"
GID = "2032315859"
URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}"
OUT = "/root/jinho-playground/public/schedule.json"

def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode("utf-8")
    rows = list(csv.reader(text.splitlines()))
    # Filter: keep only rows that have at least one non-empty cell beyond col 1
    cleaned = []
    for row in rows:
        if any(c.strip() for c in row[1:]):
            cleaned.append([c.strip() for c in row])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({
            "sheetId": SHEET_ID,
            "gid": GID,
            "updatedAt": int(datetime.now(timezone.utc).timestamp()),
            "rowCount": len(cleaned),
            "rows": cleaned,
        }, f, ensure_ascii=False)
    print(f"[schedule] rows={len(cleaned)} -> {OUT}")

if __name__ == "__main__":
    main()

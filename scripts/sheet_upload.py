#!/usr/bin/env python3
"""
sheet_upload.py — chairman_draft.json의 두 가지 요약을 주간업무 시트에 자동 write.

stdin (optional JSON): {"target": "thisWeek"|"prevWeek"}
stdout JSON:
{
  "ok": bool,
  "target": "thisWeek"/"prevWeek",
  "weekLabel": "20주 진행업무",
  "period": "5/18~5/22",
  "results": [
    {"row": "전체", "field": "sheetSummary", "ok": true, "range": "...", "chars": n},
    {"row": "대표님", "field": "personalSheetSummary", "ok": true, "range": "...", "chars": n}
  ],
  "missing": ["전체"]   # 시트에서 못 찾은 이름
}

매핑:
  "전체"            → block.sheetSummary          (회사 전체)
  "대표"/"대표님"/"박진호" → block.personalSheetSummary (본인 칸)
"""
import json
import os
import re
import sys
from pathlib import Path

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

ROOT = Path("/root/jinho-playground")
SA_PATH = "/root/.openclaw/workspace/data/google-calendar-sa.json"
DRAFT_PATH = ROOT / "public" / "chairman_draft.json"
SCHEDULE_PATH = ROOT / "public" / "schedule.json"

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

ROW_MAP = [
    {"names": ["전체"], "field": "sheetSummary", "fallback_field": "sheetText"},
    {"names": ["대표", "대표님", "박진호", "CEO"], "field": "personalSheetSummary", "fallback_field": None},
]


def col_to_a1(col_idx: int) -> str:
    s, n = "", col_idx
    while True:
        s = chr(ord("A") + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


def parse_blocks(rows):
    if len(rows) < 4:
        return []
    header = rows[1] if len(rows) > 1 else []
    sub = rows[3] if len(rows) > 3 else []
    max_cols = max(len(r) for r in rows)
    week_starts = []
    for i, cell in enumerate(header):
        if cell and re.search(r"주\s*진행업무", cell):
            week_starts.append((i, cell.strip()))
    blocks = []
    for idx, (col, label) in enumerate(week_starts):
        end = week_starts[idx + 1][0] if idx + 1 < len(week_starts) else max_cols
        period = ""
        for c in range(col, end):
            v = header[c] if c < len(header) else ""
            m = re.search(r"기간\s*[:：]\s*(.+)$", v)
            if m:
                period = m.group(1).strip()
                break
        name_col = -1
        task_col = -1
        for c in range(col, end):
            v = (sub[c] if c < len(sub) else "").strip()
            if v == "이름" and name_col < 0:
                name_col = c
            elif re.search(r"진행업무$", v) and task_col < 0:
                task_col = c
        if name_col < 0:
            continue
        if task_col < 0:
            task_col = name_col + 1
        blocks.append({
            "weekLabel": label,
            "period": period,
            "nameCol": name_col,
            "taskCol": task_col,
        })
    return blocks


def normalize_period(p):
    return re.sub(r"\s+", "", p or "").replace("～", "~").replace("–", "~").replace("-", "~")


def find_row_for_names(rows, name_col, names):
    """Return 0-based row index for first row whose name cell matches any in names."""
    name_set = set(names)
    for i in range(4, len(rows)):
        r = rows[i]
        if name_col >= len(r):
            continue
        name = (r[name_col] or "").strip()
        if name in name_set:
            return i, name
    return None, None


def main():
    raw_in = sys.stdin.read()
    try:
        payload = json.loads(raw_in) if raw_in.strip() else {}
    except Exception:
        payload = {}

    target = payload.get("target", "thisWeek")
    if target not in ("thisWeek", "prevWeek"):
        print(json.dumps({"ok": False, "error": f"bad target {target}"}, ensure_ascii=False))
        return 0
    only_row = payload.get("row")  # "전체" | "대표님" | None(=둘 다)

    if not DRAFT_PATH.exists():
        print(json.dumps({"ok": False, "error": "no chairman_draft.json"}, ensure_ascii=False))
        return 0
    if not SCHEDULE_PATH.exists():
        print(json.dumps({"ok": False, "error": "no schedule.json"}, ensure_ascii=False))
        return 0

    draft = json.loads(DRAFT_PATH.read_text(encoding="utf-8"))
    schedule = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    block_draft = draft.get(target) or {}

    sheet_id = schedule.get("sheetId")
    gid = str(schedule.get("gid"))
    rows = schedule.get("rows") or []
    blocks = parse_blocks(rows)
    if not blocks:
        print(json.dumps({"ok": False, "error": "no week blocks parsed"}, ensure_ascii=False))
        return 0

    target_period = normalize_period(block_draft.get("period", ""))
    matched = next((b for b in blocks if normalize_period(b["period"]) == target_period), None)
    if matched is None:
        sample = [(b["weekLabel"], b["period"]) for b in blocks[-6:]]
        print(json.dumps({"ok": False, "error": f"no block matches period={block_draft.get('period','')}", "available": sample}, ensure_ascii=False))
        return 0

    try:
        creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
        svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
        meta = svc.spreadsheets().get(spreadsheetId=sheet_id, fields="sheets(properties(sheetId,title))").execute()
        sheet_title = None
        for s in meta.get("sheets", []):
            if str(s["properties"].get("sheetId")) == gid:
                sheet_title = s["properties"]["title"]
                break
        if not sheet_title:
            print(json.dumps({"ok": False, "error": f"no sheet for gid={gid}"}, ensure_ascii=False))
            return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"sheets api init: {e}"}, ensure_ascii=False))
        return 0

    results = []
    missing = []
    batch_data = []
    a1_col = col_to_a1(matched["taskCol"])

    for spec in ROW_MAP:
        if only_row and only_row not in spec["names"]:
            continue
        row_idx, matched_name = find_row_for_names(rows, matched["nameCol"], spec["names"])
        text = block_draft.get(spec["field"]) or (block_draft.get(spec["fallback_field"]) if spec["fallback_field"] else "") or ""
        if row_idx is None:
            missing.append(spec["names"][0])
            results.append({"row": spec["names"][0], "field": spec["field"], "ok": False, "reason": f"row not found ({'/'.join(spec['names'])})"})
            continue
        if not text.strip():
            results.append({"row": matched_name, "field": spec["field"], "ok": False, "reason": "empty text"})
            continue
        rng = f"'{sheet_title}'!{a1_col}{row_idx + 1}"
        batch_data.append({"range": rng, "values": [[text]]})
        results.append({"row": matched_name, "field": spec["field"], "ok": True, "range": rng, "chars": len(text)})

    if batch_data:
        try:
            svc.spreadsheets().values().batchUpdate(
                spreadsheetId=sheet_id,
                body={"data": batch_data, "valueInputOption": "RAW"},
            ).execute()
        except Exception as e:
            for r in results:
                if r["ok"]:
                    r["ok"] = False
                    r["reason"] = f"batch update: {e}"
            print(json.dumps({
                "ok": False,
                "target": target,
                "weekLabel": matched["weekLabel"],
                "period": matched["period"],
                "results": results,
                "missing": missing,
            }, ensure_ascii=False))
            return 0

    any_ok = any(r["ok"] for r in results)
    print(json.dumps({
        "ok": any_ok,
        "target": target,
        "weekLabel": matched["weekLabel"],
        "period": matched["period"],
        "sheetUrl": f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit?gid={gid}",
        "results": results,
        "missing": missing,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
upload_chairman_to_sheet.py — chairman_draft.json 의 thisWeek/prevWeek 데이터를
'주간 업무회의 통합양식' 시트의 적절한 블록에 쓴다.

stdin JSON:
  { "target": "thisWeek" | "prevWeek",
    "row": "대표님" | "전체" }            # 옵션, 기본 "대표님"

전략:
1. draft.<target>.period (예: "5/18~5/22") 로 row 2 에서 '기간 : <period>' 셀을 찾는다.
2. 그 셀로부터 블록 시작 컬럼을 역추적 (2칸 왼쪽이 'X주 진행업무' 헤더).
3. 같은 블록 내 row 5 에서 '진행업무' / '이름' 컬럼 찾기.
4. row 대상 (대표님) 에 sheetText 쓰기. 전체일 때는 대표님 + personalSheetSummary 가 있다면 그 텍스트도 보조 칸에.
5. 매칭 블록 없으면 최우측에 새 블록 생성.

stdout JSON: { ok, weekLabel, period, sheetUrl, results: [{row, field, ok, range, chars, reason}], missing }
"""
import json
import sys
import os
from typing import Tuple, Optional, List, Dict

import gspread
from google.oauth2.service_account import Credentials

SHEET_ID = "1OzFtdgXmgIqN4MjEi-w3Q6RqKPq65KY463eanSALw3A"
GID = 2032315859
DRAFT_PATH = "/root/jinho-playground/public/chairman_draft.json"
CREDS_PATH = "/root/jinho-playground/data/gsheets_service_account.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?gid={GID}"


def col_letter(n: int) -> str:
    s = ""
    while n >= 0:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
    return s


def find_block(ws, period: str, week_label: str):
    """
    Returns dict {block_start, task_col, name_col, end_col, created_new}
    All 0-indexed.
    Creates new block if no match.
    """
    row2 = ws.row_values(2)
    row5 = ws.row_values(5)
    n_cols = max(len(row2), ws.col_count)

    period_norm = period.replace(" ", "")
    target_start = -1
    for i, v in enumerate(row2):
        if not v.strip():
            continue
        vn = v.replace(" ", "")
        if "기간" in vn and period_norm in vn:
            for j in range(i, -1, -1):
                if "주 진행업무" in (row2[j] if j < len(row2) else ""):
                    target_start = j
                    break
            break

    if target_start < 0:
        return _create_new_block(ws, period, week_label)

    # block end = next 주 진행업무 header or end of cols
    block_end = n_cols - 1
    for j in range(target_start + 1, n_cols):
        if j < len(row2) and "주 진행업무" in row2[j]:
            block_end = j - 1
            break

    task_col = -1
    name_col = -1
    for j in range(target_start, block_end + 1):
        v = row5[j].strip() if j < len(row5) else ""
        if v == "이름" and name_col < 0:
            name_col = j
        if ("진행업무" in v) and task_col < 0:
            task_col = j
    if name_col < 0:
        name_col = target_start + 1
    if task_col < 0:
        task_col = target_start + 2

    return {
        "block_start": target_start,
        "task_col": task_col,
        "name_col": name_col,
        "end_col": block_end,
        "created_new": False,
    }


def _create_new_block(ws, period: str, week_label: str):
    rows_to_scan = [ws.row_values(2), ws.row_values(4), ws.row_values(5), ws.row_values(6)]
    rightmost = 0
    for r in rows_to_scan:
        for i, v in enumerate(r):
            if v.strip():
                rightmost = max(rightmost, i)
    start = rightmost + 1
    needed_cols = start + 4
    if needed_cols > ws.col_count:
        ws.add_cols(needed_cols - ws.col_count)
    start_l = col_letter(start)
    mid_l = col_letter(start + 1)
    last_l = col_letter(start + 2)
    updates = [
        {"range": f"{start_l}2", "values": [[f"{week_label} 진행업무"]]},
        {"range": f"{last_l}2", "values": [[f"기간 : {period}"]]},
        {"range": f"{start_l}4", "values": [["1. 작성가이드 : 주요 진행 업무 / 진행결과 / 이슈 사항외"]]},
        {"range": f"{start_l}5", "values": [["No"]]},
        {"range": f"{mid_l}5", "values": [["이름"]]},
        {"range": f"{last_l}5", "values": [["금주 진행업무"]]},
        {"range": f"{start_l}6", "values": [["1"]]},
        {"range": f"{mid_l}6", "values": [["대표님"]]},
    ]
    ws.batch_update(updates, value_input_option="USER_ENTERED")
    return {
        "block_start": start,
        "task_col": start + 2,
        "name_col": start + 1,
        "end_col": start + 3,
        "created_new": True,
    }


def find_row_by_name(ws, name_col_idx: int, target_name: str, max_row: int = 60) -> int:
    """Returns 1-indexed row number or -1."""
    col_vals = ws.col_values(name_col_idx + 1)
    for r_idx, v in enumerate(col_vals, 1):
        if r_idx < 6 or r_idx > max_row:
            continue
        if v.strip() == target_name:
            return r_idx
    return -1


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    target = payload.get("target") or "thisWeek"
    row_spec = payload.get("row") or "대표님"

    if target not in ("thisWeek", "prevWeek"):
        print(json.dumps({"ok": False, "error": f"invalid target: {target}"}, ensure_ascii=False))
        return 1

    with open(DRAFT_PATH, "r", encoding="utf-8") as f:
        draft = json.load(f)

    block_data = draft.get(target) or {}
    period = (block_data.get("period") or "").strip()
    label = (block_data.get("label") or "").strip()
    sheet_text = block_data.get("sheetText") or ""
    personal_summary = block_data.get("personalSheetSummary") or ""

    if not period or not sheet_text:
        print(json.dumps({"ok": False, "error": f"missing period/sheetText in draft.{target}"}, ensure_ascii=False))
        return 1

    creds = Credentials.from_service_account_file(CREDS_PATH, scopes=SCOPES)
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(SHEET_ID)
    ws = sh.get_worksheet_by_id(GID)

    block = find_block(ws, period, label)
    task_col_letter = col_letter(block["task_col"])

    # 사용자 설정: 어떤 row 들에 쓸지
    if row_spec == "대표님":
        rows_to_write = [("대표님", sheet_text, "금주 진행업무")]
    elif row_spec == "전체":
        # 현재 AI 초안은 대표님 칸만 작성. 추가로 personalSheetSummary 가 있다면 별도 칸에 같이 쓸 수도 있겠지만,
        # 시트에 본인-외부미팅 전용 행이 없는 한 의미가 없으므로, "전체" 도 대표님 행에 sheetText 쓰기로 폴백.
        # 향후 다른 인원 (박창현·성지영) 데이터까지 AI가 생성하면 여기서 확장.
        rows_to_write = [("대표님", sheet_text, "금주 진행업무")]
        if personal_summary:
            rows_to_write.append(("대표님", personal_summary, "personalSummary(미사용)"))
    else:
        print(json.dumps({"ok": False, "error": f"invalid row: {row_spec}"}, ensure_ascii=False))
        return 1

    results: List[Dict] = []
    missing: List[str] = []
    batch_updates = []

    for r_name, r_text, r_field in rows_to_write:
        # 대표님 외 row 는 일단 생략 (시트 상 위치 없으면 missing 으로 처리)
        if r_field == "personalSummary(미사용)":
            results.append({
                "row": r_name,
                "field": r_field,
                "ok": False,
                "reason": "personalSheetSummary는 별도 칸이 시트에 없어 skip",
            })
            continue
        row_idx = find_row_by_name(ws, block["name_col"], r_name)
        if row_idx < 0:
            missing.append(r_name)
            results.append({"row": r_name, "field": r_field, "ok": False, "reason": "이름 못 찾음"})
            continue
        cell_addr = f"{task_col_letter}{row_idx}"
        batch_updates.append({"range": cell_addr, "values": [[r_text]]})
        results.append({
            "row": r_name,
            "field": r_field,
            "ok": True,
            "range": f"'1.2.주간업무보고 Summary'!{cell_addr}",
            "chars": len(r_text),
        })

    if batch_updates:
        ws.batch_update(batch_updates, value_input_option="USER_ENTERED")

    out = {
        "ok": any(r["ok"] for r in results),
        "weekLabel": label,
        "period": period,
        "sheetUrl": SHEET_URL,
        "results": results,
        "missing": missing,
        "createdNewBlock": block["created_new"],
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()

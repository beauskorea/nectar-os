#!/usr/bin/env python3
"""
DART API로 brand_financials.json의 매출/영업이익을 분기마다 자동 갱신.

cron: 0 4 1 1,4,7,10 * cd /root/jinho-playground && /usr/bin/python3 scripts/refresh_brand_financials.py >> /var/log/refresh_brand_financials.log 2>&1
"""

import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

DART_KEY = "9368180b688642e7ad84bb3de231e2693289cf16"
BASE_DIR = Path("/root/jinho-playground")
JSON_PATH = BASE_DIR / "public" / "brand_financials.json"
DATA_DIR = BASE_DIR / "data"
CORP_XML = DATA_DIR / "dart_corpcode.xml"
CORP_XML_MAX_AGE_DAYS = 7

KST = timezone(timedelta(hours=9))

# 매핑이 애매한 회사명 -> DART corp_name 힌트 (선택적 override)
NAME_HINTS = {
    "샌드박스 네트워크": "샌드박스네트워크",
    "콜랩 아시아": "콜랩아시아",
    "다이아TV": "씨제이이엔엠",  # 사업부 — skip 가능성 큼
    "메이크어스": "메이크어스",
    "트레져헌터": "트레져헌터",
    "비고라이브": "비고테크놀로지",
    "셀럽TV": None,
    "엔플라이스튜디오": "엔플라이스튜디오",
    "디밀": "디퍼런트밀리언즈",
    "비라운드": "뷰스컴퍼니",
    "시너지(Synergy)": "시너지",
    "씨너지(Synergy)": "씨너지",
    "디지털인사이트": "디지털인사이트",
    "HS애드": "에이치에스애드",
    "TBWA": "티비더블유에이코리아",
}

SKIP_STATUSES = {"acquired", "defunct"}


def log(msg: str) -> None:
    ts = datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def fetch_url(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "jinho-playground/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def ensure_corp_xml() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stale = True
    if CORP_XML.exists():
        age = time.time() - CORP_XML.stat().st_mtime
        stale = age > CORP_XML_MAX_AGE_DAYS * 86400
    if stale:
        log("Downloading DART corpCode.xml")
        url = f"https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={DART_KEY}"
        blob = fetch_url(url, timeout=60)
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                names = zf.namelist()
                # CORPCODE.xml
                inner = next((n for n in names if n.lower().endswith(".xml")), None)
                if not inner:
                    raise RuntimeError(f"no xml in zip: {names}")
                with zf.open(inner) as fp:
                    CORP_XML.write_bytes(fp.read())
        except zipfile.BadZipFile:
            # 키 오류면 JSON으로 에러가 옴
            raise RuntimeError(f"corpCode 응답이 zip이 아님: {blob[:200]!r}")
        log(f"corpCode.xml saved ({CORP_XML.stat().st_size} bytes)")
    else:
        log(f"corpCode.xml cache hit (age {age/86400:.1f}d)")
    return CORP_XML


def load_corp_map(xml_path: Path):
    """
    반환: dict[normalized_name] -> list of (corp_code, corp_name, stock_code)
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()
    name_map = {}
    for el in root.iter("list"):
        name = (el.findtext("corp_name") or "").strip()
        code = (el.findtext("corp_code") or "").strip()
        stock = (el.findtext("stock_code") or "").strip()
        if not name or not code:
            continue
        key = normalize_name(name)
        name_map.setdefault(key, []).append((code, name, stock))
    return name_map


def normalize_name(s: str) -> str:
    s = s.strip()
    s = re.sub(r"\(주\)|㈜|주식회사", "", s)
    s = re.sub(r"\s+", "", s)
    s = s.lower()
    return s


def find_corp_code(query: str, name_map) -> tuple:
    """
    반환: (corp_code, matched_name, ambiguous_count)
          못 찾으면 (None, None, 0)
    """
    if not query:
        return (None, None, 0)
    key = normalize_name(query)
    if key in name_map:
        candidates = name_map[key]
        # 상장사 우선
        listed = [c for c in candidates if c[2].strip()]
        chosen = listed[0] if listed else candidates[0]
        return (chosen[0], chosen[1], len(candidates))
    # 부분 매치
    partials = []
    for k, cands in name_map.items():
        if key and (key in k or k in key) and abs(len(k) - len(key)) <= 3:
            partials.extend(cands)
    if partials:
        listed = [c for c in partials if c[2].strip()]
        chosen = listed[0] if listed else partials[0]
        return (chosen[0], chosen[1], len(partials))
    return (None, None, 0)


def fetch_financials(corp_code: str, year: int, reprt_code: str):
    """
    fs_div=CFS(연결) 우선 → 비어 있으면 OFS(개별).
    반환: (revenue_원, op_profit_원, sj_account_log) or (None, None, "...")
    """
    for fs_div in ("CFS", "OFS"):
        url = (
            "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json"
            f"?crtfc_key={DART_KEY}&corp_code={corp_code}"
            f"&bsns_year={year}&reprt_code={reprt_code}&fs_div={fs_div}"
        )
        try:
            data = json.loads(fetch_url(url, timeout=20).decode("utf-8"))
        except urllib.error.HTTPError as e:
            return (None, None, f"HTTP {e.code}")
        except Exception as e:
            return (None, None, f"err {e}")
        status = data.get("status")
        if status == "013":
            # 데이터 없음 → 다음 fs_div 시도
            continue
        if status != "000":
            return (None, None, f"status={status} {data.get('message','')}")
        rows = data.get("list", [])
        revenue = None
        op = None
        for row in rows:
            if row.get("sj_div") != "IS":
                continue
            acc = (row.get("account_nm") or "").strip()
            amt = row.get("thstrm_amount") or ""
            amt = amt.replace(",", "").strip()
            if not amt or amt in {"-"}:
                continue
            try:
                val = int(amt)
            except ValueError:
                continue
            if revenue is None and acc in {"매출액", "수익(매출액)", "영업수익", "매출"}:
                revenue = val
            elif op is None and acc in {"영업이익", "영업이익(손실)"}:
                op = val
        if revenue is not None or op is not None:
            return (revenue, op, f"{fs_div} ok")
        # 둘 다 못 찾으면 다음 fs_div
    return (None, None, "no IS rows")


def to_eok(amount_won):
    if amount_won is None:
        return None
    return round(amount_won / 100_000_000)


def pick_latest_financials(corp_code: str, year: int):
    """
    11011(사업보고서) → 11014(3분기) → 11012(반기) → 11013(1분기) 순으로 시도.
    """
    for reprt_code, label in [
        ("11011", "사업보고서"),
        ("11014", "3분기"),
        ("11012", "반기"),
        ("11013", "1분기"),
    ]:
        rev_w, op_w, note = fetch_financials(corp_code, year, reprt_code)
        if rev_w is not None or op_w is not None:
            return (rev_w, op_w, f"{year} {label} ({note})")
    return (None, None, f"{year} 모든 보고서 없음")


def send_telegram(text: str) -> None:
    try:
        subprocess.run(
            ["beaus-send", "result", text],
            check=False,
            timeout=15,
            capture_output=True,
        )
    except Exception as e:
        log(f"beaus-send 실패: {e}")


def main():
    if not JSON_PATH.exists():
        log(f"missing: {JSON_PATH}")
        sys.exit(2)

    today = datetime.now(KST).strftime("%Y%m%d")
    bak = JSON_PATH.with_suffix(f".json.bak{today}")

    raw = JSON_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    companies = data.get("companies", {})

    ensure_corp_xml()
    name_map = load_corp_map(CORP_XML)
    log(f"corp_map entries: {sum(len(v) for v in name_map.values())} (unique keys {len(name_map)})")

    target_year = 2025
    fallback_year = 2024

    mapped = 0
    unmapped = 0
    skipped = 0
    updated_companies = []
    ambiguous_companies = []
    error_companies = []

    company_items = list(companies.items())
    for name, info in company_items:
        status = (info.get("status") or "active").lower()
        if status in SKIP_STATUSES:
            skipped += 1
            continue

        corp_code = info.get("corp_code")
        matched_name = None
        ambiguous = 0
        if not corp_code:
            hint = NAME_HINTS.get(name, name)
            if hint is None:
                unmapped += 1
                continue
            corp_code, matched_name, ambiguous = find_corp_code(hint, name_map)
            if not corp_code and hint != name:
                corp_code, matched_name, ambiguous = find_corp_code(name, name_map)
            if not corp_code:
                unmapped += 1
                continue
            info["corp_code"] = corp_code
            if matched_name:
                info["dart_corp_name"] = matched_name
            if ambiguous > 1:
                info["_dart_ambiguous"] = ambiguous
                ambiguous_companies.append((name, matched_name, ambiguous))

        mapped += 1

        # API rate limit 완화
        time.sleep(0.15)
        rev_w, op_w, note = pick_latest_financials(corp_code, target_year)
        used_year = target_year
        if rev_w is None and op_w is None:
            time.sleep(0.15)
            rev_w, op_w, note = pick_latest_financials(corp_code, fallback_year)
            used_year = fallback_year

        if rev_w is None and op_w is None:
            error_companies.append((name, note))
            continue

        rev_eok = to_eok(rev_w)
        op_eok = to_eok(op_w)

        changed_fields = []
        if used_year == target_year:
            rev_key = "revenue_2025"
            op_key = "operating_profit_2025"
        else:
            rev_key = "revenue_2024"
            op_key = "operating_profit_2024"

        if rev_eok is not None and info.get(rev_key) != rev_eok:
            changed_fields.append((rev_key, info.get(rev_key), rev_eok))
            info[rev_key] = rev_eok
        if op_eok is not None and info.get(op_key) != op_eok:
            changed_fields.append((op_key, info.get(op_key), op_eok))
            info[op_key] = op_eok

        if changed_fields:
            updated_companies.append((name, used_year, changed_fields, note))
            info["_dart_last_year"] = used_year
            info["_dart_last_note"] = note

    meta = data.setdefault("_meta", {})
    meta["last_dart_refresh"] = datetime.now(KST).isoformat()
    meta["last_dart_summary"] = {
        "mapped": mapped,
        "unmapped": unmapped,
        "skipped": skipped,
        "updated": len(updated_companies),
        "errors": len(error_companies),
    }

    log(
        f"mapped={mapped} unmapped={unmapped} skipped={skipped} "
        f"updated={len(updated_companies)} errors={len(error_companies)}"
    )

    if updated_companies or mapped != 0:
        # 백업 후 저장 (변경 없어도 _meta는 갱신되므로 항상 저장)
        if not bak.exists():
            shutil.copy2(JSON_PATH, bak)
        JSON_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        log(f"saved {JSON_PATH} (backup {bak.name})")

    if updated_companies:
        lines = [f"DART 재무 갱신: {len(updated_companies)}건"]
        for name, year, changes, note in updated_companies[:10]:
            parts = []
            for key, old, new in changes:
                short = "매출" if key.startswith("revenue") else "영익"
                parts.append(f"{short} {old}→{new}억")
            lines.append(f"- {name} ({year} {note.split('(')[0].strip()}): {', '.join(parts)}")
        if len(updated_companies) > 10:
            lines.append(f"... 외 {len(updated_companies)-10}건")
        if error_companies:
            lines.append(f"실패 {len(error_companies)}건")
        send_telegram("\n".join(lines))

    if error_companies:
        for name, note in error_companies:
            log(f"ERR {name}: {note}")

    if ambiguous_companies:
        for name, matched, n in ambiguous_companies:
            log(f"AMBIG {name} -> {matched} (후보 {n}개)")


if __name__ == "__main__":
    main()

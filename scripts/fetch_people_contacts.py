#!/usr/bin/env python3
"""
fetch_people_contacts.py — 인맥별 lastContact 자동 추출
- Source 1: ceo_mail.db (from_addr, from_name, to_raw, subject, body_full)
- Source 2: events.json (Google Calendar) — event summary keyword match
- 결과: people.json 의 lastContact / lastContactTs / lastContactSource / overdue 갱신
- 두 소스 중 더 최근 timestamp 채택
"""
import json, sqlite3, os, sys, re
from datetime import datetime, timezone, timedelta

PEOPLE_PATH = "/root/jinho-playground/src/data/people.json"
EVENTS_PATH = "/root/jinho-playground/public/events.json"
MAIL_DB = "/root/jinho-playground/data/ceo_mail.db"

def parse_event_ts(s):
    """events.json 형식: ISO datetime or YYYY-MM-DD"""
    if not s: return 0
    try:
        if "T" in s:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return 0

def ago(ts):
    if not ts: return ""
    s = int(datetime.now(timezone.utc).timestamp()) - ts
    if s < 60: return f"{s}초 전"
    if s < 3600: return f"{s // 60}분 전"
    if s < 86400: return f"{s // 3600}시간 전"
    if s < 86400 * 30: return f"{s // 86400}일 전"
    d = datetime.fromtimestamp(ts, timezone.utc).astimezone(timezone(timedelta(hours=9)))
    return f"{d.year}-{d.month:02d}"

def main():
    with open(PEOPLE_PATH, encoding="utf-8") as f:
        pdoc = json.load(f)
    with open(EVENTS_PATH, encoding="utf-8") as f:
        _raw = json.load(f); events = _raw["events"] if isinstance(_raw, dict) else _raw

    conn = sqlite3.connect(MAIL_DB, timeout=30)
    cur = conn.cursor()

    now_ts = int(datetime.now(timezone.utc).timestamp())
    updated = 0
    for person in pdoc["people"]:
        emails = [e.lower() for e in person.get("matchEmails", [])]
        keywords = person.get("matchKeywords", [])
        best_ts = 0
        best_source = ""

        # Mail match (sender or any keyword in subject)
        if emails:
            placeholders = ",".join("?" * len(emails))
            q = f"SELECT MAX(date_ts) FROM messages WHERE LOWER(from_addr) IN ({placeholders})"
            cur.execute(q, emails)
            row = cur.fetchone()
            if row and row[0]:
                if row[0] > best_ts:
                    best_ts = row[0]
                    best_source = "mail"

        for kw in keywords:
            if not kw: continue
            # match subject OR from_name OR body_full (limited)
            cur.execute("""
                SELECT MAX(date_ts) FROM messages
                WHERE subject LIKE ? OR from_name LIKE ? OR body_full LIKE ?
            """, (f"%{kw}%", f"%{kw}%", f"%{kw}%"))
            row = cur.fetchone()
            if row and row[0] and row[0] > best_ts:
                best_ts = row[0]
                best_source = f"mail (kw:{kw})"

        # Calendar match (event summary keyword)
        for ev in events:
            title = (ev.get("title") or "")
            for kw in keywords:
                if kw and kw in title:
                    ts = parse_event_ts(ev.get("start"))
                    # Skip future events
                    if 0 < ts <= now_ts and ts > best_ts:
                        best_ts = ts
                        best_source = f"calendar ({title[:30]})"
                    break

        if best_ts:
            person["lastContactTs"] = best_ts
            person["lastContact"] = ago(best_ts)
            person["lastContactSource"] = best_source
            days_since = (now_ts - best_ts) // 86400
            person["overdue"] = days_since > person.get("freqDays", 30)
            updated += 1
        else:
            person["lastContact"] = "기록 없음"
            person["lastContactTs"] = 0
            person["lastContactSource"] = ""
            person["overdue"] = True

    pdoc["updatedAt"] = now_ts

    # Write back to people.json (in src/data — picked up at build) and also public for client read
    with open(PEOPLE_PATH, "w", encoding="utf-8") as f:
        json.dump(pdoc, f, ensure_ascii=False, indent=2)
    # Also dump to /public so client can fetch dynamically without rebuild
    PUB = "/root/jinho-playground/public/people.json"
    with open(PUB, "w", encoding="utf-8") as f:
        json.dump(pdoc, f, ensure_ascii=False)
    print(f"[people] updated {updated}/{len(pdoc['people'])} from mail+calendar")

    for p in pdoc["people"]:
        flag = "⚑" if p["overdue"] else " "
        print(f"  {flag} {p['name']:20s} | {p['lastContact']:15s} | {p['lastContactSource']}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
fetch_calendar.py — Google Calendar (SA) → public/events.json
- Calendars: beauskorea / beautysketch / beauscontents / 한국 공휴일
- Range: 오늘 기준 -60일 ~ +180일
- Schema: [{id,title,start,end,allDay,cal}]  (cal = beauskorea|beautysketch|beauscontents|holiday)
"""
import json, os, sys, traceback
from datetime import datetime, timezone, timedelta
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SA_PATH = "/root/.openclaw/workspace/data/google-calendar-sa.json"
OUT = "/root/jinho-playground/public/events.json"

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

CALENDARS = [
    ("beauskorea",     "beauskorea@gmail.com"),
    ("beautysketch",   "beautysketchkorea@gmail.com"),
    ("beauscontents",  "beauscontents@gmail.com"),
    ("holiday",        "ko.south_korea#holiday@group.v.calendar.google.com"),
]

def to_event(item, cal_key):
    s = item.get("start", {})
    e = item.get("end", {})
    start = s.get("date") or s.get("dateTime")
    end   = e.get("date") or e.get("dateTime")
    all_day = "date" in s
    return {
        "id":     item.get("id"),
        "title":  item.get("summary","(제목없음)"),
        "start":  start,
        "end":    end,
        "allDay": all_day,
        "cal":    cal_key,
    }

def fetch_one(svc, cal_id, time_min, time_max):
    events = []
    page_token = None
    while True:
        resp = svc.events().list(
            calendarId=cal_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
            maxResults=2500,
            pageToken=page_token,
        ).execute()
        events.extend(resp.get("items", []))
        page_token = resp.get("nextPageToken")
        if not page_token: break
    return events

def main():
    creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
    svc = build("calendar", "v3", credentials=creds, cache_discovery=False)

    now = datetime.now(timezone.utc)
    tmin = (now - timedelta(days=730)).isoformat()
    tmax = (now + timedelta(days=180)).isoformat()

    out = []
    summary = []
    for key, cal_id in CALENDARS:
        try:
            items = fetch_one(svc, cal_id, tmin, tmax)
            for it in items:
                if it.get("status") == "cancelled": continue
                ev = to_event(it, key)
                if ev["start"] and ev["end"]:
                    out.append(ev)
            summary.append(f"{key}={len(items)}")
        except Exception as ex:
            summary.append(f"{key}=ERR({ex.__class__.__name__})")
            print(f"[fetch_calendar] {key} failed: {ex}", file=sys.stderr)

    # sort: allDay first per day, then by start
    out.sort(key=lambda x: (x["start"], not x["allDay"]))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = {
        "updatedAt": int(now.timestamp()),
        "rangeMinDays": -60,
        "rangeMaxDays": 180,
        "count": len(out),
        "events": out,
    }
    # 클라이언트가 fetch 하는 위치만 갱신 (build-time seed 폐기)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print("[fetch_calendar] " + str(len(out)) + " events | " + " ".join(summary) + " -> " + OUT)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)

#!/usr/bin/env python3
"""
chairman_chat.py — /api/schedule/chat 백엔드.
stdin JSON: {"message": str}
stdout JSON: {ok, summary, added, skipped, errored, notes, weekLabel, inputsCount}

처리:
1) Claude로 메시지 분석 → 일정(events) + 메모(notes) 추출
2) isCEOInvolved=true 이벤트만 Google Calendar add (충돌 시 skip)
3) 모든 입력을 data/chairman_inputs/<thisWeek_label>.json 에 누적
   → 다음 cron 실행 시 generate_chairman_weekly_draft.py가 컨텍스트로 사용
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import error, request

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

KST = timezone(timedelta(hours=9))
ROOT = Path("/root/jinho-playground")
SA_PATH = "/root/.openclaw/workspace/data/google-calendar-sa.json"
INPUTS_DIR = ROOT / "data" / "chairman_inputs"
INPUTS_DIR.mkdir(parents=True, exist_ok=True)
ENV_FILES = ["/root/.openclaw/secrets/nerve.env", str(ROOT / ".env.local")]
CAL_ID = "beauskorea@gmail.com"
TZ = "Asia/Seoul"
SCOPES = ["https://www.googleapis.com/auth/calendar"]

MODEL_PRIMARY = "claude-sonnet-4-6"
MODEL_FALLBACK = "claude-haiku-4-5-20251001"


def load_env():
    e = {}
    for p in ENV_FILES:
        try:
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    k, _, v = line.partition("=")
                    if k:
                        e[k] = v.strip().strip('"').strip("'")
        except Exception:
            pass
    return e


def kst_now():
    return datetime.now(KST)


def upcoming_workweek_label():
    """Return ('XX주', mon_date) for the upcoming Mon~Fri."""
    now = kst_now()
    wd = now.weekday()
    if wd == 6:
        mon = now + timedelta(days=1)
    else:
        mon = now - timedelta(days=wd)
    week_no = int(mon.strftime("%V"))
    return f"{week_no}주", mon


def call_claude(api_key, system, user, max_tokens=3500, model=None):
    body = {
        "model": model or MODEL_PRIMARY,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    }
    if "-oat" in api_key or api_key.startswith("oat"):
        headers["Authorization"] = "Bearer " + api_key
        headers["anthropic-beta"] = "oauth-2025-04-20"
    else:
        headers["x-api-key"] = api_key
    req = request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def parse_json_response(raw):
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"```\s*$", "", raw)
    s = raw.find("{")
    e = raw.rfind("}")
    if s < 0 or e < 0:
        raise ValueError(f"no JSON: {raw[:200]}")
    return json.loads(raw[s : e + 1])


SYSTEM_TPL = """너는 박진호 대표(뷰스컴퍼니/비라운드 MCN)의 주간 일정 관리 어시스턴트.
사용자가 잔디로 받은 상무님 일정 텍스트, 또는 자연어 메모/지시사항을 입력한다.

처리 규칙:

1. 일정(events) 추출
   - 필드: date(YYYY-MM-DD), startTime("HH:MM"), endTime("HH:MM"), title, isCEOInvolved, raw
   - 상무님 텍스트에 "(대표참여)", "(대표님)", "대표 참여" 표시가 있으면 isCEOInvolved=true
   - 자연어 메시지("내 일정에 추가", "내가 미팅") 도 isCEOInvolved=true
   - 그 외 (실무진끼리 미팅, 자료 리뷰 등) isCEOInvolved=false
   - 날짜는 컨텍스트("5월18일 (월요일)" 같은 주차 헤더)에서 정확히 추출. 연도는 오늘 기준으로 추론.
   - 시간이 "09:30~10:30" 또는 "09;30~10:30" 같은 변형도 정확히 09:30/10:30으로 파싱
   - title은 시간/괄호 빼고 핵심만

2. 메모/지시사항(notes) 추출
   - 일정이 아닌 모든 메모. 예: "마녀공장 전무님 미팅 재조율 필요", "글로벌 영업 추가 필요", "AI Summit 거절"
   - 사용자가 자연어로 "안지영 미팅 5/26으로 옮겨" 같이 지시하면 type="instruction"
   - 그 외 일반 메모는 type="memo"

3. summary: 사용자가 한눈에 볼 1줄 요약 (예: "월~금 17건 일정 인식, 대표참여 6건 캘린더 추가 예정 / 메모 3건")

today = {today}
upcoming_workweek = {upcoming}

JSON으로만 출력 (코드펜스 금지):
{{
  "events": [
    {{
      "date": "2026-05-18",
      "startTime": "09:30",
      "endTime": "10:30",
      "title": "주간업무보고",
      "isCEOInvolved": true,
      "raw": "09:30~10:30 주간업무보고 (대표참여)"
    }}
  ],
  "notes": [
    {{"text":"마녀공장 전무님 미팅 일정 재조율 필요","type":"memo"}},
    {{"text":"글로벌 추가 영업 가능 업체 소개 부탁","type":"instruction"}}
  ],
  "summary": "한 줄 요약"
}}"""


def calendar_service():
    creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def check_conflict(svc, start_iso, end_iso):
    """Return list of busy intervals overlapping [start, end)."""
    try:
        body = {
            "timeMin": start_iso,
            "timeMax": end_iso,
            "timeZone": TZ,
            "items": [{"id": CAL_ID}],
        }
        fb = svc.freebusy().query(body=body).execute()
        return fb.get("calendars", {}).get(CAL_ID, {}).get("busy") or []
    except Exception as e:
        print(f"[chat] freebusy err: {e}", file=sys.stderr)
        return []


def add_event(svc, ev):
    start_iso = f"{ev['date']}T{ev['startTime']}:00+09:00"
    end_iso = f"{ev['date']}T{ev['endTime']}:00+09:00"
    body = {
        "summary": ev["title"],
        "start": {"dateTime": start_iso, "timeZone": TZ},
        "end": {"dateTime": end_iso, "timeZone": TZ},
        "description": "via chairman_chat (상무님 잔디 → 진호 OS)",
    }
    return svc.events().insert(calendarId=CAL_ID, body=body).execute()


def main():
    raw_in = sys.stdin.read()
    try:
        payload = json.loads(raw_in) if raw_in.strip() else {}
    except Exception:
        payload = {"message": raw_in}

    message = (payload.get("message") or "").strip()
    if not message:
        print(json.dumps({"ok": False, "error": "empty message"}, ensure_ascii=False))
        return 1

    week_label, mon = upcoming_workweek_label()
    today = kst_now().strftime("%Y-%m-%d (%a)")
    upcoming = f"{week_label} (Mon={mon.strftime('%Y-%m-%d')})"

    env = load_env()
    api_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "error": "no ANTHROPIC_API_KEY"}, ensure_ascii=False))
        return 1

    system = SYSTEM_TPL.format(today=today, upcoming=upcoming)

    parsed = None
    used_model = MODEL_PRIMARY
    last_err = ""
    for m in (MODEL_PRIMARY, MODEL_FALLBACK):
        try:
            d = call_claude(api_key, system, message, model=m)
            raw = (d.get("content") or [{}])[0].get("text", "")
            parsed = parse_json_response(raw)
            used_model = m
            break
        except error.HTTPError as he:
            body_txt = ""
            try:
                body_txt = he.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            last_err = f"HTTP {he.code} model={m}: {body_txt[:200]}"
            print(f"[chat] {last_err}", file=sys.stderr)
            if he.code != 429:
                break
        except Exception as e:
            last_err = f"err model={m}: {e}"
            print(f"[chat] {last_err}", file=sys.stderr)
    if parsed is None:
        print(json.dumps({"ok": False, "error": "ai_parse_failed", "detail": last_err}, ensure_ascii=False))
        return 1

    events = parsed.get("events") or []
    notes = parsed.get("notes") or []
    summary = parsed.get("summary") or ""

    added, skipped, errored = [], [], []
    svc = None
    sa_err = ""
    try:
        svc = calendar_service()
    except Exception as e:
        sa_err = str(e)
        print(f"[chat] SA init: {sa_err}", file=sys.stderr)

    for ev in events:
        if not ev.get("isCEOInvolved"):
            skipped.append({**ev, "reason": "대표 미참여"})
            continue
        if not (ev.get("date") and ev.get("startTime") and ev.get("endTime") and ev.get("title")):
            skipped.append({**ev, "reason": "필드 부족"})
            continue
        if svc is None:
            errored.append({**ev, "reason": f"SA init 실패: {sa_err}"})
            continue
        start_iso = f"{ev['date']}T{ev['startTime']}:00+09:00"
        end_iso = f"{ev['date']}T{ev['endTime']}:00+09:00"
        busy = check_conflict(svc, start_iso, end_iso)
        if busy:
            skipped.append({**ev, "reason": f"기존 일정 {len(busy)}건과 충돌", "busy": busy})
            continue
        try:
            res = add_event(svc, ev)
            added.append({**ev, "eventId": res.get("id"), "htmlLink": res.get("htmlLink")})
        except Exception as e:
            errored.append({**ev, "reason": str(e)})

    inputs_path = INPUTS_DIR / f"{week_label}.json"
    try:
        if inputs_path.exists():
            existing = json.loads(inputs_path.read_text(encoding="utf-8"))
            items = existing.get("items") if isinstance(existing, dict) else existing
            if items is None:
                items = []
        else:
            items = []
    except Exception:
        items = []
    items.append(
        {
            "at": int(datetime.now(timezone.utc).timestamp()),
            "message": message[:4000],
            "events": events,
            "notes": notes,
            "added": [
                {"date": a["date"], "title": a["title"], "eventId": a.get("eventId")}
                for a in added
            ],
            "skipped": [
                {"date": s.get("date"), "title": s.get("title"), "reason": s["reason"]}
                for s in skipped
            ],
        }
    )
    inputs_path.write_text(
        json.dumps(
            {
                "weekLabel": week_label,
                "updatedAt": int(datetime.now(timezone.utc).timestamp()),
                "items": items,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "ok": True,
                "weekLabel": week_label,
                "model": used_model,
                "summary": summary,
                "added": added,
                "skipped": skipped,
                "errored": errored,
                "notes": notes,
                "totalEvents": len(events),
                "inputsCount": len(items),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

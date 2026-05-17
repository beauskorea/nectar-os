#!/usr/bin/env python3
"""
generate_evening_wrap.py
- 오늘 일정 (지난 것 + 진행도) + 오늘 처리된 메일 + 미답장 high/action 메일 + 내일 일정
- → Gemini Flash로 "오늘 회고 + 내일 1순위" 분석
- 결과: /root/jinho-playground/public/evening_wrap.json
"""
import json, os, sys, sqlite3
from datetime import datetime, timezone, timedelta
from urllib import request

KST = timezone(timedelta(hours=9))
DB = "/root/jinho-playground/data/ceo_mail.db"
EVENTS_PATH = "/root/jinho-playground/src/data/events.json"
PEOPLE_PATH = "/root/jinho-playground/public/people.json"
OUT_PATH = "/root/jinho-playground/public/evening_wrap.json"

def load_env():
    e = {}
    with open("/root/.openclaw/secrets/nerve.env") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip('"').strip("'")
    return e

def main():
    env = load_env()
    api_key = env.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[evening] missing GEMINI_API_KEY", file=sys.stderr); sys.exit(1)

    now_kst = datetime.now(KST)
    today = now_kst.strftime("%Y-%m-%d")
    tomorrow = (now_kst + timedelta(days=1)).strftime("%Y-%m-%d")

    # 일정: 오늘 / 내일
    with open(EVENTS_PATH, encoding="utf-8") as f:
        events = json.load(f)
    today_events, tomorrow_events = [], []
    for e in events:
        s = e.get("start", "")
        item = {
            "time": s.split("T")[1][:5] if "T" in s else "all-day",
            "title": e.get("title", ""), "cal": e.get("cal", ""),
        }
        if s.startswith(today): today_events.append(item)
        elif s.startswith(tomorrow): tomorrow_events.append(item)
    today_events.sort(key=lambda x: x["time"])
    tomorrow_events.sort(key=lambda x: x["time"])

    # 오늘 들어온 메일 + 미답장 high/action
    conn = sqlite3.connect(DB, timeout=30)
    day_start = int(now_kst.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    today_mails = conn.execute("""
      SELECT subject, from_name, ai_summary, priority, ai_category
      FROM messages
      WHERE trashed_at IS NULL AND date_ts >= ?
      ORDER BY priority='high' DESC, date_ts DESC
      LIMIT 25
    """, (day_start,)).fetchall()
    pending = conn.execute("""
      SELECT subject, from_name, ai_summary, priority, ai_category, date_ts
      FROM messages
      WHERE trashed_at IS NULL AND unread=1
        AND (priority='high' OR ai_category='action')
      ORDER BY date_ts DESC LIMIT 15
    """).fetchall()
    conn.close()

    # Overdue 인맥
    overdue = []
    try:
        with open(PEOPLE_PATH, encoding="utf-8") as f:
            pdoc = json.load(f)
        for p in pdoc.get("people", []):
            if p.get("overdue"):
                overdue.append(f"{p['name']} ({p.get('lastContact','')})")
    except Exception: pass

    sys_prompt = """당신은 박진호 (뷰스컴퍼니 대표, ENTP) 의 비서입니다.
오늘의 이브닝 랩 (저녁 회고) 을 작성합니다.

원칙:
1. 짧고 명확한 한국어, 결론 우선
2. 3섹션 (todayWins / unfinished / tomorrowFocus)
3. 추측 금지 — 데이터 기반
4. todayWins: 오늘 들어온 high/action 메일 또는 일정 중 처리/진행됐을 가능성 큰 것
5. unfinished: 아직 unread + high/action 인 메일 + overdue 인맥
6. tomorrowFocus: 내일 일정 중 가장 중요한 1-3건 + 내일 처리할 메일/인맥 액션 1-2건

응답 JSON only:
{
  "headline": "오늘 한 줄 (40자)",
  "todayWins": ["...","...","..."],
  "unfinished": ["...","...","..."],
  "tomorrowFocus": ["...","...","..."],
  "energyPrompt": "내일을 위한 한 문장 (선택)"
}"""

    user_prompt = f"""현재: {now_kst.strftime('%Y-%m-%d %H:%M')} KST

[오늘 일정 {len(today_events)}건]
""" + ("\n".join(f"- {e['time']} {e['title']}" for e in today_events) if today_events else "(없음)") + f"""

[오늘 들어온 메일 (high/action 우선) {len(today_mails)}건]
""" + ("\n".join(f"- [{r[3] or r[4] or 'med'}] {r[1]}: {r[2] or r[0]}" for r in today_mails[:15]) if today_mails else "(없음)") + f"""

[미답장 high/action 메일 {len(pending)}건]
""" + ("\n".join(f"- {r[1]}: {r[2] or r[0]}" for r in pending[:10]) if pending else "(없음)") + f"""

[내일 일정 {len(tomorrow_events)}건]
""" + ("\n".join(f"- {e['time']} {e['title']}" for e in tomorrow_events) if tomorrow_events else "(없음)") + f"""

[연락 필요 인맥 {len(overdue)}명]
""" + ("\n".join(f"- {n}" for n in overdue) if overdue else "(없음)")

    body = json.dumps({
        "systemInstruction": {"parts": [{"text": sys_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "maxOutputTokens": 4096,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }).encode("utf-8")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    req = request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        if text.lower().startswith("json"): text = text[4:].strip()
    try:
        wrap = json.loads(text)
    except Exception as e:
        print(f"[evening] parse err: {e}\nRaw: {text[:1500]}", file=sys.stderr); sys.exit(1)

    payload = {
        "date": today,
        "generatedAt": int(datetime.now(timezone.utc).timestamp()),
        "inputs": {
            "todayEvents": len(today_events),
            "todayMails": len(today_mails),
            "pendingMails": len(pending),
            "tomorrowEvents": len(tomorrow_events),
            "overdueCount": len(overdue),
        },
        "wrap": wrap,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[evening] wrote {OUT_PATH}")
    print(f"[evening] headline: {wrap.get('headline','')}")
    print(f"  wins: {wrap.get('todayWins', [])}")
    print(f"  unfinished: {wrap.get('unfinished', [])}")
    print(f"  tomorrow: {wrap.get('tomorrowFocus', [])}")

if __name__ == "__main__":
    main()

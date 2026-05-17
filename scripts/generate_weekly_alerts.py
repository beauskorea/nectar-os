#!/usr/bin/env python3
"""
generate_weekly_alerts.py
- 이번 주 raw 데이터 (캘린더 ±7일 + unread high 메일 + overdue 인맥) 종합
- Gemini Flash 로 1차 분류:
  - 축하: 진호님 관련성 + 임팩트로 priority(high/med/low) + reason
  - 위기: severity (urgent/important/watch) + reason + 어떤 액션 필요한지
- 결과: /root/jinho-playground/public/weekly_alerts.json (4시간 캐시)
"""
import json, os, sys, sqlite3
from datetime import datetime, timezone, timedelta
from urllib import request

KST = timezone(timedelta(hours=9))
DB = "/root/jinho-playground/data/ceo_mail.db"
EVENTS_PATH_PUB = "/root/jinho-playground/public/events.json"
EVENTS_PATH_SRC = "/root/jinho-playground/src/data/events.json"
PEOPLE_PATH = "/root/jinho-playground/public/people.json"
OUT_PATH = "/root/jinho-playground/public/weekly_alerts.json"

def load_env():
    e = {}
    with open("/root/.openclaw/secrets/nerve.env") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip("\"'")
    return e

def load_events():
    for p in (EVENTS_PATH_PUB, EVENTS_PATH_SRC):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict) and "events" in d: return d["events"]
            if isinstance(d, list): return d
        except Exception:
            continue
    return []

def main():
    env = load_env()
    api_key = env.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[alerts] missing GEMINI_API_KEY", file=sys.stderr); sys.exit(1)

    now = datetime.now(KST)
    today = now.strftime("%Y-%m-%d")
    week_start = (now - timedelta(days=3)).strftime("%Y-%m-%d")
    week_end = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    # 일정 (±range)
    events = load_events()
    cal_in_range = []
    for e in events:
        s = (e.get("start") or "")[:10]
        if not s: continue
        if week_start <= s <= week_end:
            cal_in_range.append({"date": s, "title": e.get("title", ""), "cal": e.get("cal", "")})
    cal_in_range.sort(key=lambda x: x["date"])

    # 메일 unread + high/action
    conn = sqlite3.connect(DB, timeout=30)
    rows = conn.execute("""
      SELECT message_id, subject, from_name, ai_summary, priority, ai_category, date_ts
      FROM messages
      WHERE trashed_at IS NULL AND unread=1
        AND (priority='high' OR ai_category IN ('action','urgent'))
      ORDER BY date_ts DESC LIMIT 30
    """).fetchall()
    mails = [{
        "id": r[0], "subject": r[1], "from": r[2], "summary": r[3],
        "priority": r[4], "category": r[5],
        "hours_ago": round((datetime.now(timezone.utc).timestamp() - r[6])/3600, 1) if r[6] else None,
    } for r in rows]
    conn.close()

    # Overdue 인맥
    overdue = []
    try:
        with open(PEOPLE_PATH, encoding="utf-8") as f:
            pdoc = json.load(f)
        for p in pdoc.get("people", []):
            if p.get("overdue"):
                overdue.append({
                    "name": p["name"], "role": p.get("role", ""),
                    "lastContact": p.get("lastContact", ""),
                    "freqDays": p.get("freqDays", 30),
                })
    except Exception:
        pass

    sys_prompt = """너는 박진호 (뷰스컴퍼니 대표) 의 raw 데이터를 받아 **1차 분류** 하는 비서다.

받는 데이터:
- 일정: 지난 3일~다음 7일 캘린더
- 메일: 미답장 high/action
- 인맥: 권장 컨택 주기 초과

너의 작업:
1. 🎉 **축하 (celebrate)** — 일정 중 직원 입사·생일·런칭·기념일·체결·진급·1주년 등 **사람에게 축하/감사 메시지가 필요한 것**만 선별. importance: high/med/low + why 한 줄.
2. 🚨 **위기 (crisis)** — 메일/일정/인맥 중 **박진호가 액션 안 하면 손해 보는 것**. severity: urgent/important/watch + 한 줄 reason + suggested_action (있으면)
3. 둘 다 최대 5개씩. 우선순위 순. 중복 X.

응답 JSON only:
{
  "celebrate": [
    {"label": "...", "when": "YYYY-MM-DD", "importance": "high|med|low", "why": "30자 이내 이유"}
  ],
  "crisis": [
    {"label": "...", "kind": "calendar|mail|people", "severity": "urgent|important|watch", "reason": "30자 이내", "action": "어떻게 처리할지 한 줄", "ref": "<원본 id 또는 keyword>"}
  ]
}

규칙:
- raw 데이터 그대로 나열 X, 진짜 의미 있는 것만 골라 골라
- 일상적인 회의·정례 일정은 무시
- 추측 금지 (없으면 빈 배열)"""

    user_prompt = f"""기준: {now.strftime('%Y-%m-%d %H:%M')} KST

[일정 ±range {len(cal_in_range)}건]
""" + "\n".join(f"- {e['date']} {e['title']} ({e['cal']})" for e in cal_in_range[:60]) + f"""

[미답장 high/action 메일 {len(mails)}건]
""" + "\n".join(f"- [{m['priority'] or m['category']}] {m['from']}: {m['summary'] or m['subject']} ({m['hours_ago']}h 전, id={m['id']})" for m in mails[:25]) + f"""

[연락 필요 인맥 {len(overdue)}명 (권장 주기 초과)]
""" + "\n".join(f"- {p['name']} ({p['role']}, 마지막 {p['lastContact']}, 권장 {p['freqDays']}일)" for p in overdue[:25])

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
        classified = json.loads(text)
    except Exception as e:
        print(f"[alerts] parse err: {e}\nRaw: {text[:1000]}", file=sys.stderr); sys.exit(1)

    payload = {
        "generatedAt": int(datetime.now(timezone.utc).timestamp()),
        "date": today,
        "inputs": {
            "events": len(cal_in_range),
            "mails": len(mails),
            "overdue": len(overdue),
        },
        "celebrate": classified.get("celebrate", []),
        "crisis": classified.get("crisis", []),
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[alerts] wrote {OUT_PATH}")
    print(f"  celebrate: {len(payload['celebrate'])} / crisis: {len(payload['crisis'])}")
    for c in payload["celebrate"][:3]:
        print(f"    🎉 {c.get('importance')} · {c.get('label','')[:50]}")
    for c in payload["crisis"][:3]:
        print(f"    🚨 {c.get('severity')} · {c.get('label','')[:50]}")

if __name__ == "__main__":
    main()

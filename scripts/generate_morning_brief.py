#!/usr/bin/env python3
"""
generate_morning_brief.py
- 오늘 일정 + high/action 메일 + overdue 인맥 종합 → Sonnet에게 "오늘의 5건" 분석 요청
- 결과: /root/jinho-playground/public/morning_brief.json
- Optionally: beaus-send result 채널에 푸시 (env BEAUS_SEND_PUSH=1)
"""
import json, os, sys, sqlite3, subprocess
from datetime import datetime, timezone, timedelta
from urllib import request

KST = timezone(timedelta(hours=9))
DB = "/root/jinho-playground/data/ceo_mail.db"
EVENTS_PATH = "/root/jinho-playground/src/data/events.json"
PEOPLE_PATH = "/root/jinho-playground/public/people.json"
OUT_PATH = "/root/jinho-playground/public/morning_brief.json"

def load_env():
    e = {}
    with open("/root/.openclaw/secrets/nerve.env") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip('"').strip("'")
    return e

def today_kst():
    return datetime.now(KST).strftime("%Y-%m-%d")

def gather_inputs():
    today = today_kst()

    # 오늘 일정
    try:
        with open(EVENTS_PATH, encoding="utf-8") as f:
            events = json.load(f)
        today_events = []
        for e in events:
            s = e.get("start", "")
            if s.startswith(today):
                today_events.append({
                    "time": s.split("T")[1][:5] if "T" in s else "all-day",
                    "title": e.get("title", ""),
                    "cal": e.get("cal", ""),
                })
        today_events.sort(key=lambda x: x["time"])
    except Exception as e:
        print(f"[brief] events load err: {e}", file=sys.stderr)
        today_events = []

    # 최근 24h high/action 메일
    conn = sqlite3.connect(DB, timeout=30)
    rows = conn.execute("""
      SELECT message_id, subject, from_name, from_addr, ai_summary, priority, ai_category, date_ts
      FROM messages
      WHERE trashed_at IS NULL
        AND (priority='high' OR ai_category='action')
        AND date_ts > ?
      ORDER BY date_ts DESC
      LIMIT 20
    """, (int(datetime.now(timezone.utc).timestamp()) - 86400 * 3,)).fetchall()
    mails = [
        {
            "id": r[0], "subject": r[1], "fromName": r[2], "fromAddr": r[3],
            "summary": r[4], "priority": r[5], "category": r[6],
            "ago_hours": round((datetime.now(timezone.utc).timestamp() - r[7]) / 3600, 1) if r[7] else None,
        } for r in rows
    ]
    conn.close()

    # Overdue 인맥
    overdue = []
    try:
        with open(PEOPLE_PATH, encoding="utf-8") as f:
            pdoc = json.load(f)
        for p in pdoc.get("people", []):
            if p.get("overdue"):
                overdue.append({
                    "name": p["name"], "role": p["role"],
                    "lastContact": p.get("lastContact", ""),
                    "freqDays": p.get("freqDays", 30),
                })
    except Exception as e:
        print(f"[brief] people load err: {e}", file=sys.stderr)

    return today, today_events, mails, overdue

def call_llm(today, events, mails, overdue, api_key):
    sys_prompt = """당신은 박진호 (뷰스컴퍼니 대표, ENTP) 의 비서입니다.
오늘 처리할 최우선 5건을 골라 모닝 브리프를 작성합니다.

원칙:
1. 결론 우선, 짧고 명확한 한국어
2. 5건은 우선순위 순. 각 1줄 액션 + 30자 이유.
3. 메일/일정/인맥/내부일 골고루 (한 카테고리만 5건 X)
4. 시간 임박 일정 최우선
5. 추측 금지 — 데이터 없으면 적지 말 것

응답 형식 (JSON only):
{
  "headline": "오늘 한 줄 요약 (40자 이내)",
  "top5": [
    {"rank": 1, "kind": "meeting|mail|people|task", "title": "...", "why": "..."},
    ...
  ],
  "watchouts": "주의할 점 1-2줄 (선택)"
}"""

    user_prompt = f"""오늘 날짜: {today}

[오늘 일정 {len(events)}건]
""" + ("\n".join(f"- {e['time']} {e['title']} ({e['cal']})" for e in events) if events else "(없음)") + f"""

[최근 72h high/action 메일 {len(mails)}건] — kind=mail 항목 선택 시 messageId 에 mid 복사할 것
""" + ("\n".join(f"- [mid={m['id']}] [{m['priority'] or m['category']}] {m['fromName'] or m['fromAddr']}: {m['summary'] or m['subject']} ({m['ago_hours']}h 전)" for m in mails[:15]) if mails else "(없음)") + f"""

[연락 필요 인맥 {len(overdue)}명]
""" + ("\n".join(f"- {p['name']} ({p['role']}): {p['lastContact']} · 권장 {p['freqDays']}일" for p in overdue) if overdue else "(없음)")

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
        return json.loads(text)
    except Exception as e:
        print(f"[brief] parse err: {e}\n--- raw text ---\n{text[:1500]}\n--- end ---", file=sys.stderr)
        raise

def push_to_telegram(brief, today):
    if os.environ.get("BEAUS_SEND_PUSH") != "1": return
    lines = [f"🌅 *모닝 브리프 {today}*", "", f"_{brief.get('headline','')}_", ""]
    for item in brief.get("top5", []):
        kind_emoji = {"meeting":"📅","mail":"📧","people":"👥","task":"✅"}.get(item.get("kind"), "•")
        lines.append(f"{item.get('rank','?')}. {kind_emoji} {item.get('title','')}")
        if item.get("why"): lines.append(f"   _{item['why']}_")
    if brief.get("watchouts"):
        lines += ["", f"⚠️ {brief['watchouts']}"]
    msg = "\n".join(lines)
    try:
        subprocess.run(["beaus-send", "result", msg], check=False, timeout=15)
    except Exception as e:
        print(f"[brief] tg push err: {e}", file=sys.stderr)

def main():
    env = load_env()
    api_key = env.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[brief] missing GEMINI_API_KEY", file=sys.stderr); sys.exit(1)

    today, events, mails, overdue = gather_inputs()
    print(f"[brief] inputs: {len(events)} events, {len(mails)} mails, {len(overdue)} overdue people")

    try:
        brief = call_llm(today, events, mails, overdue, api_key)
    except Exception as e:
        print(f"[brief] llm err: {e}", file=sys.stderr)
        sys.exit(1)

    payload = {
        "date": today,
        "generatedAt": int(datetime.now(timezone.utc).timestamp()),
        "inputs": {
            "eventsCount": len(events),
            "mailsCount": len(mails),
            "overdueCount": len(overdue),
        },
        "brief": brief,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[brief] wrote {OUT_PATH}")
    print(f"[brief] headline: {brief.get('headline','')}")
    for it in brief.get("top5", []):
        print(f"  {it.get('rank','?')}. [{it.get('kind','')}] {it.get('title','')}")

    push_to_telegram(brief, today)

if __name__ == "__main__":
    main()

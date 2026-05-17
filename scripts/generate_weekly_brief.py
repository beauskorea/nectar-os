#!/usr/bin/env python3
"""
generate_weekly_brief.py
- 지난 7일 일정 + 다음 7일 일정 + 메일 카테고리별 카운트 + 결정 기록 종합
- Gemini 2.5 Flash → 주간 헤드라인 + 진전 / 미해결 / 다음 주 focus
- 출력: /root/jinho-playground/public/weekly_brief.json
- Cron 일요일 18:00 KST
"""
import json, os, sys, sqlite3
from datetime import datetime, timezone, timedelta
from urllib import request

KST = timezone(timedelta(hours=9))
DB = "/root/jinho-playground/data/ceo_mail.db"
EVENTS_PATH = "/root/jinho-playground/src/data/events.json"
PEOPLE_PATH = "/root/jinho-playground/public/people.json"
DECISIONS_PATH = "/root/jinho-playground/data/decisions.json"
OUT_PATH = "/root/jinho-playground/public/weekly_brief.json"

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
        print("[weekly] missing GEMINI_API_KEY", file=sys.stderr); sys.exit(1)

    now_kst = datetime.now(KST)
    today = now_kst.strftime("%Y-%m-%d")
    week_start = (now_kst - timedelta(days=now_kst.weekday())).strftime("%Y-%m-%d")  # this Monday
    last7_start = (now_kst - timedelta(days=7)).strftime("%Y-%m-%d")
    next7_end = (now_kst + timedelta(days=7)).strftime("%Y-%m-%d")

    # 일정 (지난 7일 + 다음 7일)
    past_events, future_events = [], []
    try:
        with open(EVENTS_PATH, encoding="utf-8") as f:
            events = json.load(f)
        for e in events:
            s = e.get("start", "")[:10]
            if not s: continue
            item = {
                "date": s,
                "time": e.get("start", "").split("T")[1][:5] if "T" in e.get("start", "") else "all-day",
                "title": e.get("title", ""),
            }
            if last7_start <= s < today: past_events.append(item)
            elif today <= s <= next7_end: future_events.append(item)
    except Exception as e:
        print(f"[weekly] events err: {e}", file=sys.stderr)

    past_events.sort(key=lambda x: (x["date"], x["time"]))
    future_events.sort(key=lambda x: (x["date"], x["time"]))

    # 메일 (지난 7일 카테고리별)
    conn = sqlite3.connect(DB, timeout=30)
    week_ago_ts = int((now_kst - timedelta(days=7)).timestamp())
    cat_counts = {}
    high_mails = []
    rows = conn.execute("""
      SELECT ai_category, COUNT(*)
      FROM messages
      WHERE trashed_at IS NULL AND date_ts >= ?
      GROUP BY ai_category
    """, (week_ago_ts,)).fetchall()
    for r in rows:
        cat_counts[r[0] or "pending"] = r[1]

    rows = conn.execute("""
      SELECT subject, from_name, ai_summary, priority, ai_category
      FROM messages
      WHERE trashed_at IS NULL AND date_ts >= ?
        AND (priority='high' OR ai_category IN ('action','urgent'))
      ORDER BY date_ts DESC LIMIT 15
    """, (week_ago_ts,)).fetchall()
    for r in rows:
        high_mails.append({
            "subject": r[0], "from": r[1],
            "summary": r[2] or "", "priority": r[3], "cat": r[4],
        })
    conn.close()

    # Decisions (지난 7일)
    decisions = []
    try:
        with open(DECISIONS_PATH, encoding="utf-8") as f:
            ddoc = json.load(f)
        for d in ddoc.get("items", []):
            if d.get("date", "") >= last7_start:
                decisions.append({"date": d["date"], "q": d.get("question", ""), "summary": d["text"].split("\n")[0][:100]})
    except Exception:
        pass

    # Overdue 인맥
    overdue = []
    try:
        with open(PEOPLE_PATH, encoding="utf-8") as f:
            pdoc = json.load(f)
        for p in pdoc.get("people", []):
            if p.get("overdue"):
                overdue.append(f"{p['name']} ({p.get('lastContact', '')})")
    except Exception:
        pass

    sys_prompt = """당신은 박진호 (뷰스컴퍼니 대표, ENTP) 의 주간 비서다.
지난 7일 + 다음 7일 데이터로 **주간 브리핑** 을 작성한다.

원칙:
1. 짧고 명확한 한국어, 결론 우선
2. 3섹션: 이번 주 성과 / 미해결 이월 / 다음 주 focus
3. 추측 금지 — 데이터 기반
4. 큰 그림 (5건 미팅을 그냥 나열하지 말고, "토니모리/YouTube 관련 미팅 5건 진행" 같이 묶기)

응답 JSON only:
{
  "headline": "이번 주 한 줄 (40자 이내)",
  "thisWeekWins": ["...","...","..."],
  "carryOver": ["...","...","..."],
  "nextWeekFocus": ["...","...","..."],
  "energyNote": "주간 회고 한 줄 (선택)"
}"""

    user_prompt = f"""기준 시각: {now_kst.strftime('%Y-%m-%d %H:%M')} KST

[지난 7일 일정 {len(past_events)}건]
""" + ("\n".join(f"- {e['date']} {e['time']} {e['title']}" for e in past_events[:30]) if past_events else "(없음)") + f"""

[다음 7일 일정 {len(future_events)}건]
""" + ("\n".join(f"- {e['date']} {e['time']} {e['title']}" for e in future_events[:30]) if future_events else "(없음)") + f"""

[지난 7일 메일 — 카테고리별 카운트]
""" + ", ".join(f"{k}: {v}" for k, v in cat_counts.items()) + f"""

[지난 7일 high/action 메일 핵심 {len(high_mails)}건]
""" + ("\n".join(f"- [{m['priority'] or m['cat']}] {m['from']}: {m['summary'] or m['subject']}" for m in high_mails[:12]) if high_mails else "(없음)") + f"""

[지난 7일 결정 기록 {len(decisions)}건]
""" + ("\n".join(f"- {d['date']} \"{d['q']}\" → {d['summary']}" for d in decisions[:10]) if decisions else "(없음)") + f"""

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
        brief = json.loads(text)
    except Exception as e:
        print(f"[weekly] parse err: {e}\nRaw: {text[:1500]}", file=sys.stderr); sys.exit(1)

    payload = {
        "date": today,
        "weekStart": week_start,
        "generatedAt": int(datetime.now(timezone.utc).timestamp()),
        "inputs": {
            "pastEvents": len(past_events),
            "futureEvents": len(future_events),
            "mailCatCounts": cat_counts,
            "highMails": len(high_mails),
            "decisions": len(decisions),
            "overdueCount": len(overdue),
        },
        "brief": brief,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[weekly] wrote {OUT_PATH}")
    print(f"[weekly] headline: {brief.get('headline','')}")

if __name__ == "__main__":
    main()

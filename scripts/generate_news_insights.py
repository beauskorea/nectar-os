#!/usr/bin/env python3
"""
generate_news_insights.py — news 카테고리 메일에 대해 3줄 인사이트 추출.
Gemini Flash Lite 사용. 매 30분 cron에서 호출.

스키마: ai_insight TEXT (DB messages 테이블)
형식: "🔑 핵심: ...\n📊 숫자: ...\n💡 시사점: ..."
"""
import os, sys, json, sqlite3, urllib.request, urllib.error, time
from datetime import datetime, timezone

DB = "/root/jinho-playground/data/ceo_mail.db"
ENV = "/root/.openclaw/secrets/nerve.env"
MODEL = "gemini-2.5-flash-lite"
BATCH = 3
MAX_PER_RUN = 30
MAX_INPUT = 3000
SLEEP_BETWEEN = 2.0

def load_env():
    e = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip('"').strip("'")
    return e

env = load_env()
API_KEY = env.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("ERR: GEMINI_API_KEY not found", file=sys.stderr); sys.exit(1)

SYSTEM = """너는 박진호(뷰스컴퍼니 대표·K-뷰티 마케팅·MCN)의 정보 분석가다.
주어진 뉴스레터·정보성 메일에서 박진호에게 유용한 3줄 인사이트를 추출하라.

각 항목 스키마:
{"id": <메일 id>, "insight": "🔑 핵심: ...\\n📊 숫자: ...\\n💡 시사점: ..."}

3줄 포맷 (반드시 줄바꿈 \\n으로 구분):
🔑 핵심: 메일의 핵심 메시지 한 줄 (40자 이내)
📊 숫자: 메일에 나온 구체적인 숫자·데이터·이름 (없으면 "—")
💡 시사점: 박진호(K-뷰티 마케팅 CEO)에게 적용 가능한 시사점 한 줄

JSON 배열만 반환. 다른 텍스트 금지."""

def call_gemini(items):
    user_msg = "다음 메일 " + str(len(items)) + "건의 인사이트:\n\n" + "\n---\n".join(
        f"[id={it['id']}]\nFrom: {it['from']}\nSubject: {it['subject']}\nBody: {it['body'][:MAX_INPUT]}"
        for it in items
    )
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": user_msg}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "maxOutputTokens": 2048,
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTPError {e.code}: {e.read().decode('utf-8', errors='ignore')[:300]}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"net err: {e}", file=sys.stderr); return None
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError):
        print(f"Bad response: {json.dumps(data)[:400]}", file=sys.stderr); return None
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0].strip()
        if text.lower().startswith("json"): text = text[4:].strip()
    try:
        return json.loads(text)
    except Exception as e:
        print(f"JSON parse fail: {e}\nRaw: {text[:300]}", file=sys.stderr); return None

def main():
    conn = sqlite3.connect(DB, timeout=20.0)
    cur = conn.cursor()
    # 컬럼 보장
    try:
        cur.execute("ALTER TABLE messages ADD COLUMN ai_insight TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    rows = cur.execute("""
      SELECT message_id, from_name, from_addr, subject, COALESCE(body_full, snippet, '')
      FROM messages
      WHERE ai_category = 'news'
        AND ai_insight IS NULL
      ORDER BY date_ts DESC
      LIMIT ?
    """, (MAX_PER_RUN,)).fetchall()
    print(f"[news-insight] {len(rows)} pending")
    if not rows: return

    processed = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        items = [
            {"id": r[0], "from": f"{r[1]} <{r[2]}>" if r[1] else r[2], "subject": r[3] or "", "body": r[4] or ""}
            for r in chunk
        ]
        result = call_gemini(items)
        if not result:
            time.sleep(3); continue
        for entry in result:
            try:
                cur.execute("UPDATE messages SET ai_insight=? WHERE message_id=?",
                            (entry.get("insight"), entry.get("id")))
                processed += 1
            except Exception as e:
                print(f"[news-insight] update err id={entry.get('id')}: {e}", file=sys.stderr)
        conn.commit()
        time.sleep(SLEEP_BETWEEN)
    print(f"[news-insight] processed={processed}")

if __name__ == "__main__":
    main()

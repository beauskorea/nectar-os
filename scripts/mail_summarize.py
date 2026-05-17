#!/usr/bin/env python3
"""
mail_summarize.py — 메일 상세 요약 (5섹션) 생성/캐시.

input args: <message_id> [--force]
output: stdout JSON {ok, summary, model, cached, elapsed_ms}

스토리지: DB messages.ai_full_summary (TEXT) — 없으면 ALTER로 추가
모델: Perplexity Sonar Pro (fallback Claude Opus via real API key, fallback OpenAI gpt-4o-mini)
"""
import sys, os, json, sqlite3, urllib.request, urllib.error, time

DB = "/root/jinho-playground/data/ceo_mail.db"
ENV = "/root/.openclaw/secrets/nerve.env"
MAX_BODY = 5000

SYSTEM = """너는 박진호(뷰스컴퍼니 대표·K-뷰티 마케팅·MCN)의 메일 비서다.
주어진 메일을 박진호가 빠르게 파악할 수 있게 한국어로 요약하라.

출력 형식 (반드시 이 구조, 다른 텍스트·머리말·꼬리말 없이):

📌 핵심: <한 문장, 40자 이내>

🎯 발신자 의도:
- <불릿 1~2개>

📋 박진호 액션 아이템:
- <불릿 1~4개>

⏰ 기한·일정: <명시된 기한·날짜 또는 "—">

💡 참고: <맥락·뉘앙스·놓치면 안 되는 디테일 40자 이내, 없으면 생략>

규칙:
- 본문에 없는 정보 만들지 말 것. 모르면 "본문에 없음".
- 영문 메일도 한국어로 요약.
- 마크다운 헤더 # 사용 금지."""

def load_env():
    e = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip("\"'")
    return e

def call_perplexity(api_key, user_msg):
    body = {
        "model": "sonar-pro",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 800,
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        "https://api.perplexity.ai/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d["choices"][0]["message"]["content"].strip(), "sonar-pro"

def call_openai(api_key, user_msg):
    body = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 800,
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d["choices"][0]["message"]["content"].strip(), "gpt-4o-mini"

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: mail_summarize.py <message_id> [--force]"}))
        sys.exit(2)
    msgid = sys.argv[1]
    force = "--force" in sys.argv

    conn = sqlite3.connect(DB, timeout=15.0)
    cur = conn.cursor()

    # 컬럼 보장
    try:
        cur.execute("ALTER TABLE messages ADD COLUMN ai_full_summary TEXT")
        cur.execute("ALTER TABLE messages ADD COLUMN ai_full_summary_model TEXT")
        cur.execute("ALTER TABLE messages ADD COLUMN ai_full_summary_at INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    row = cur.execute("""
      SELECT from_name, from_addr, subject, date_ts,
             COALESCE(body_full, snippet, ''),
             priority, ai_category, ai_summary,
             ai_full_summary, ai_full_summary_model, ai_full_summary_at
      FROM messages WHERE message_id=?
    """, (msgid,)).fetchone()
    if not row:
        conn.close()
        print(json.dumps({"ok": False, "error": "message not found"}))
        sys.exit(1)
    (from_name, from_addr, subject, date_ts, body, priority, category,
     short_summary, cached_summary, cached_model, cached_at) = row

    # 캐시 hit
    if cached_summary and not force:
        conn.close()
        print(json.dumps({
            "ok": True,
            "cached": True,
            "summary": cached_summary,
            "model": cached_model,
            "generatedAt": cached_at,
        }, ensure_ascii=False))
        return

    user_msg = (
        f"From: {from_name} <{from_addr}>\n"
        f"Date: {date_ts}\n"
        f"Subject: {subject}\n"
        f"AI 분류: {category or '-'} / priority={priority or '-'}\n"
        f"AI 한줄: {short_summary or '-'}\n\n"
        f"--- 본문 ---\n{(body or '')[:MAX_BODY]}"
    )

    env = load_env()
    pkey = env.get("PERPLEXITY_API_KEY")
    okey = env.get("OPENAI_API_KEY")
    akey = env.get("ANTHROPIC_API_KEY")
    # OAuth 토큰은 직접 API 호출 불가 → skip
    use_anthropic = akey and akey.startswith("sk-ant-api")

    t0 = time.time()
    try:
        if pkey:
            summary, model = call_perplexity(pkey, user_msg)
        elif okey:
            summary, model = call_openai(okey, user_msg)
        elif use_anthropic:
            # 단순화를 위해 anthropic은 미구현 (필요 시 추가)
            raise RuntimeError("no api key available")
        else:
            raise RuntimeError("no api key available")
    except urllib.error.HTTPError as e:
        conn.close()
        print(json.dumps({"ok": False, "error": f"http {e.code}: {e.read()[:200].decode(errors='ignore')}"}))
        sys.exit(1)
    except Exception as e:
        conn.close()
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
    elapsed = int((time.time() - t0) * 1000)
    now = int(time.time())

    # 캐시 저장
    cur.execute(
        "UPDATE messages SET ai_full_summary=?, ai_full_summary_model=?, ai_full_summary_at=? WHERE message_id=?",
        (summary, model, now, msgid),
    )
    conn.commit()
    conn.close()

    print(json.dumps({
        "ok": True,
        "cached": False,
        "summary": summary,
        "model": model,
        "elapsedMs": elapsed,
        "generatedAt": now,
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()

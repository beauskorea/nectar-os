#!/usr/bin/env python3
"""
classify_priority.py — Gemini Flash Lite 로 unclassified 메일 분류.
(Anthropic OAuth 토큰은 rate-limit 빡빡해 폴백)
- priority: high | med | low
- category: action (응답/액션 필요) | info (참고) | noise (광고/알림/스팸)
- summary: 한 줄 한국어 요약
"""
import os, sys, json, sqlite3, urllib.request, urllib.error, time
from datetime import datetime, timezone

DB = "/root/jinho-playground/data/ceo_mail.db"
ENV = "/root/.openclaw/secrets/nerve.env"
MODEL = "gemini-2.5-flash-lite"
BATCH = 5
MAX_PER_RUN = int(os.environ.get("MAX_PER_RUN", "80"))
MAX_INPUT = 1200
SLEEP_BETWEEN = 1.5

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
    print("ERR: GEMINI_API_KEY not found", file=sys.stderr)
    sys.exit(1)

SYSTEM = """너는 박진호(뷰스컴퍼니 대표, ceo@beaus.co.kr · K-뷰티 마케팅·MCN)의 메일 비서다.
각 메일을 분류하라. JSON 배열만 반환.

각 항목 스키마:
{"id": <메일 id>, "priority": "high"|"med"|"low", "category": "sales"|"client"|"finance"|"urgent"|"event"|"lecture"|"news"|"noise", "summary": "한국어 한 줄 요약, 최대 50자"}

category 8종:
- sales   = 외부에서 들어온 신규 영업/협업 제안, RFP 작성 요청, 콜드 아웃리치 (한국 브랜드·에이전시의 첫 제안)
- client  = 진행 중인 클라이언트/캠페인 후속 소통 (일정 조율, 기획안 회신, 미팅 후속, 진행 보고)
- finance = 인보이스·계약서·NDA·송금·정산·세금계산서 (금전/문서 관련)
- urgent  = 즉시 회신·수정 필요 (기한 임박, 오류·수정 요청, 클레임·이슈, "X일 내 회신")
- event   = 행사·컨퍼런스·커피챗·웨비나 초청, RSVP 요청
- lecture = 박진호 본인이 강사·연사·패널·인터뷰이·기고자로 초빙받는 건 (정식 기관·매체에서 한국어로 정중하게 요청, 보통 발신 도메인이 국내 매체·기관·강의 플랫폼)
- news    = 뉴스레터·정보성 메일·시황·산업 동향 (Long Black, Substack, 뷰티뉴리 등)
- noise   = 무시 OK — 다음 모두 포함:
    · 마케팅 광고, 인증코드, 시스템 알림, 자동 알림
    · **약탈적 학술지 / Predatory journal** ("Invitation to contribute your research", "Submit your paper to vol.X", "stop the follow ups", "we contacted you earlier"). 발신 도메인이 articlesquality, journal*, .biz, scientific* 등 의심스러우면 거의 100% 스팸
    · 영문 cold outreach 중 발신자 회사가 검증 안 되거나 "Dear Sir/Madam" 시작인 것
    · 부동산·물류·세일즈 콜드 메일 (booking, sourcing, factory 영업)

분류 우선순위 (충돌 시):
1) noise — 위 noise 패턴이 있으면 다른 카테고리보다 우선. 특히 학술지 invitation·논문 투고 요청은 절대 lecture가 아니라 noise.
2) urgent — 기한·이슈가 분명하면 다음 우선
3) lecture — 박진호를 정식 강사로 초빙하는 건만 (학술지 논문 투고는 lecture 아님)
4) finance — 돈·계약 관련은 client보다 finance
5) sales vs client — 기존 거래 관계 = client, 신규 제안 = sales
6) event — 박진호가 단순 참가자/스폰서. 박진호가 발표자=lecture

priority:
- high = 24h 안 (CEO 직접 결정, 외부 미팅, 결재, 기한 임박)
- med  = 1주일 안 (직원 보고, 정보 회신, 후속 진행)
- low  = 무시해도 OK (noise는 거의 항상 low)"""

def call_gemini(items):
    user_msg = "다음 메일 " + str(len(items)) + "건을 분류해 JSON 배열로 반환 (다른 텍스트 금지):\n\n" + "\n---\n".join(
        f"[id={it['id']}]\nFrom: {it['from']}\nSubject: {it['subject']}\nBody: {it['body'][:MAX_INPUT]}"
        for it in items
    )
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": user_msg}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
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
        msg = e.read().decode("utf-8", errors="ignore")
        print(f"HTTPError {e.code}: {msg[:300]}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"net err: {e}", file=sys.stderr)
        return None
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError) as e:
        print(f"Bad response: {json.dumps(data)[:400]}", file=sys.stderr)
        return None
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0].strip()
        if text.lower().startswith("json"): text = text[4:].strip()
    try:
        return json.loads(text)
    except Exception as e:
        print(f"JSON parse fail: {e}\nRaw: {text[:300]}", file=sys.stderr)
        return None

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute("""
      SELECT message_id, from_name, from_addr, subject, COALESCE(body_full, snippet, '')
      FROM messages
      WHERE (priority IS NULL OR ai_category IS NULL)
        AND (ai_category IS NULL OR ai_category != 'noise')
      ORDER BY date_ts DESC
      LIMIT ?
    """, (MAX_PER_RUN,)).fetchall()
    print(f"[classify] {len(rows)} pending")
    if not rows: return

    now_ts = int(datetime.now(timezone.utc).timestamp())
    classified = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        items = [
            {
                "id": r[0],
                "from": f"{r[1]} <{r[2]}>" if r[1] else r[2],
                "subject": r[3] or "",
                "body": r[4] or "",
            }
            for r in chunk
        ]
        result = call_gemini(items)
        if not result:
            print(f"[classify] batch {i // BATCH} skipped", file=sys.stderr)
            time.sleep(3)
            continue
        for entry in result:
            try:
                cur.execute("""
                  UPDATE messages
                  SET priority=?, ai_category=?, ai_summary=?, classified_at=?
                  WHERE message_id=?
                """, (entry.get("priority"), entry.get("category"), entry.get("summary"), now_ts, entry.get("id")))
                classified += 1
            except Exception as e:
                print(f"[classify] update err id={entry.get('id')}: {e}", file=sys.stderr)
        conn.commit()
        time.sleep(SLEEP_BETWEEN)

    # 추가 컬럼 보장
    for col in ("ai_insight", "ai_full_summary", "body_html"):
        try:
            cur.execute(f"ALTER TABLE messages ADD COLUMN {col} TEXT")
        except sqlite3.OperationalError:
            pass  # 이미 존재
    conn.commit()

    # Refresh JSON dump
    rows = cur.execute("""
      SELECT message_id, date_ts, from_name, from_addr, subject, snippet, body_full, unread,
             priority, ai_category, ai_summary, ai_insight, attachments, trashed_at, ai_full_summary, body_html
      FROM messages ORDER BY date_ts DESC LIMIT 300
    """).fetchall()
    out = []
    for r in rows:
        atts = None
        if len(r) > 12 and r[12]:
            try: atts = json.loads(r[12])
            except Exception: atts = None
        out.append({
            "id": r[0], "ts": r[1],
            "date": datetime.fromtimestamp(r[1], tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M") if r[1] else "",
            "fromName": r[2], "fromAddr": r[3], "subject": r[4],
            "snippet": r[5], "body": r[6] or "", "unread": bool(r[7]),
            "priority": r[8], "category": r[9], "aiSummary": r[10],
            "aiInsight": r[11] if len(r) > 11 else None,
            "attachments": atts,
            "trashed": bool(r[13]) if len(r) > 13 else False,
            "aiFullSummary": r[14] if len(r) > 14 else None,
            "bodyHtml": r[15] if len(r) > 15 else None,
        })
    JSON_OUT = "/root/jinho-playground/public/mail.json"
    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump({
            "account": "ceo@beaus.co.kr",
            "count": len(out),
            "updatedAt": now_ts,
            "days": 90,
            "messages": out,
        }, f, ensure_ascii=False)
    print(f"[classify] classified={classified}, json refreshed")

if __name__ == "__main__":
    main()

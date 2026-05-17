#!/usr/bin/env python3
"""Parse exported macOS Notes, strip HTML, send to Gemini for classification, save JSON."""
import re, json, sys, os
from urllib import request
from datetime import datetime, timezone

DUMP = "/tmp/notes_dump.txt"
OUT = "/tmp/notes_classified.json"

def strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</?(div|p|h\d|li|ul|ol)[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"&nbsp;", " ", s)
    s = re.sub(r"&lt;", "<", s); s = re.sub(r"&gt;", ">", s); s = re.sub(r"&amp;", "&", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s

def parse_dump(text: str):
    blocks = text.split("===NOTE===")
    out = []
    for b in blocks:
        b = b.strip()
        if not b: continue
        title = None; mod = None; body = ""
        for line in b.split("\n"):
            if line.startswith("TITLE:"): title = line[6:].strip()
            elif line.startswith("MOD:"): mod = line[4:].strip()
            elif line.startswith("BODY:"):
                body = line[5:].strip()
                # rest of lines are body continuation
                idx = b.find("BODY:")
                body = b[idx+5:].strip()
                break
        body_plain = strip_html(body)
        if not title and not body_plain: continue
        out.append({"title": title or "(제목없음)", "mod": mod or "", "body": body_plain[:600]})
    return out

def classify_batch(notes, api_key):
    sys_prompt = """너는 박진호 (뷰스컴퍼니 대표) 의 메모를 분류하는 비서다.

각 메모를 아래 카테고리 중 하나로 분류하라:

- "crisis"     : 위기/문제/리스크 (계약 분쟁, 이슈, 사고, 마감 임박 등)
- "celebrate"  : 축하/성과 (입사·생일·런칭·체결·진급·1주년 등)
- "todo"       : 할 일 (실행해야 할 액션)
- "meeting"    : 미팅 메모 (고문 미팅·외부 미팅·내부 회의 회고)
- "advisor"    : 고문 미팅 전용 (최병곤 고문, 승진 고문 등 자문 메모)
- "idea"       : 아이디어 (사업 인사이트, 컨셉)
- "people"     : 인맥/연락처
- "research"   : 조사/리서치 (브랜드 분석, 경쟁사 등)
- "personal"   : 개인 (운동, 가족, 일상)
- "scratch"    : 빈 메모 / 단순 임시 / 분류 불가

각 메모에 대해 다음도 추가:
- priority: high | med | low (CEO 관점에서 즉시 처리 필요 여부)
- summary: 30자 이내 한 줄
- team: 회사 / 주간회의 / 바이럴파트 / 임원 / 마케팅 / 운영 / 디자인 / 개발 / 재무 / 개인 / 외부 중 하나 (애매하면 personal=개인)

응답 JSON only:
{
  "items": [
    {"index": 0, "category": "advisor", "team": "임원", "priority": "high", "summary": "최병곤 고문 5/14 미팅 회의록"},
    ...
  ]
}

규칙:
- 미팅 메모 중 고문 관련 (최병곤/승진/기타 자문) 은 advisor 로 분류 (meeting 아님)
- 빈 메모 (title 만 있고 body 거의 없음) 는 scratch
- priority high 는 명확한 즉시 액션만 (모호하면 med/low)"""

    user_lines = []
    for i, n in enumerate(notes):
        user_lines.append(f"[{i}] TITLE: {n['title']}\nMOD: {n['mod'][:30]}\nBODY: {n['body'][:300]}")
    user = "\n\n".join(user_lines)

    body = json.dumps({
        "systemInstruction": {"parts": [{"text": sys_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 8192,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }).encode("utf-8")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    req = request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        if text.lower().startswith("json"): text = text[4:].strip()
    return json.loads(text)

def main():
    text = open(DUMP, encoding="utf-8").read()
    notes = parse_dump(text)
    print(f"[notes] parsed {len(notes)} notes", flush=True)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # try nerve.env
        try:
            for line in open("/root/.openclaw/secrets/nerve.env"):
                if line.startswith("GEMINI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip("\"'")
                    break
        except Exception:
            pass
    if not api_key:
        print("[notes] missing GEMINI_API_KEY", file=sys.stderr); sys.exit(1)

    result = classify_batch(notes, api_key)
    items = result.get("items", [])
    merged = []
    by_idx = {it["index"]: it for it in items if "index" in it}
    for i, n in enumerate(notes):
        cls = by_idx.get(i, {})
        merged.append({
            "index": i,
            "title": n["title"],
            "mod": n["mod"],
            "body": n["body"],
            "category": cls.get("category", "scratch"),
            "team": cls.get("team", "개인"),
            "priority": cls.get("priority", "low"),
            "summary": cls.get("summary", ""),
        })

    payload = {
        "generatedAt": int(datetime.now(timezone.utc).timestamp()),
        "totalNotes": len(merged),
        "items": merged,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[notes] wrote {OUT}")
    # quick summary
    cats = {}
    for it in merged:
        cats[it["category"]] = cats.get(it["category"], 0) + 1
    for c, n in sorted(cats.items(), key=lambda x: -x[1]):
        print(f"  {c}: {n}")

if __name__ == "__main__":
    main()

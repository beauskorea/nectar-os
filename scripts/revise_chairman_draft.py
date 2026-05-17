#!/usr/bin/env python3
"""
revise_chairman_draft.py — chairman_draft.json 을 사용자 피드백으로 부분/전체 수정.

stdin JSON:
  { "prompt": "수정 지시...",
    "scope": "thisWeek" | "prevWeek",        # 기본 thisWeek
    "sectionIndex": 2 }                        # 옵션 — 특정 섹션만 수정. 없으면 전체

stdout JSON: 수정 후 draft (chairman_draft.json 그대로) + 메타
"""
import json, os, sys
from pathlib import Path
from urllib import request, error

DRAFT_PATH = Path("/root/jinho-playground/public/chairman_draft.json")
ENV_PATH = Path("/root/jinho-playground/.env.local")
MODEL = "claude-sonnet-4-6"
FALLBACK_MODEL = "claude-opus-4-7"


def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def call_claude(api_key, system, user, max_tokens=4500, model=None):
    body = {
        "model": model or MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": api_key,
    }
    req = request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def extract_json(raw: str):
    s = raw.find("{")
    e = raw.rfind("}")
    if s < 0 or e <= s:
        raise ValueError(f"no JSON in response: {raw[:200]}")
    return json.loads(raw[s:e + 1])


def sections_to_sheet_text(sections):
    out = []
    for s in sections:
        out.append(f"{s.get('emoji', '')} {s.get('title', '')}")
        body = s.get("body", "").rstrip()
        if body:
            out.append(body)
        out.append("")
    return "\n".join(out).strip()


SYS_FULL = """너는 박진호 대표(뷰스컴퍼니/비라운드)의 주간회의 초안 어시스턴트.
사용자가 기존 초안에 대한 수정 지시를 준다.
지시를 반영해 전체 sections 배열을 다시 출력한다.

규칙:
1. 한국어. 결론·팩트 우선. 추측·과장 금지.
2. 카테고리 순서: 📊 매출/수치 → 📌 핵심이슈 → 💼 영업관리 → 🚀 New BM → 🛠️ 고정TF → 👤 비라운드/발굴 크리에이터 → 🏢 내부사항 → ⭐ 팔로업
3. 각 섹션 body 패턴: "1. 주요항목\\n  ㄴ 세부\\n  → 다음 단계"
4. 연계팀(제니하우스 ↔ 커머스팀) 등장 시 짝꿍 명시.
5. 사용자 지시에 명확히 반영된 변경만. 다른 섹션은 가급적 유지.
6. JSON으로만 출력. 코드펜스 금지.

스키마:
{
  "headline": "한 줄 (매출/수치 포함)",
  "sections": [{"emoji":"📊","title":"...","body":"..."}, ...]
}"""


SYS_SECTION = """너는 박진호 대표의 주간회의 초안 어시스턴트.
하나의 섹션만 사용자 지시에 맞춰 수정한다. 다른 섹션은 건드리지 않는다.

규칙:
1. 한국어. 결론·팩트 우선. 추측 금지.
2. body 패턴 유지: "1. 주요항목\\n  ㄴ 세부\\n  → 다음 단계"
3. 사용자 지시 반영 + 기존 좋은 내용은 보존.
4. 연계팀(제니하우스 ↔ 커머스팀) 등장 시 짝꿍 명시.
5. JSON으로만 출력. 코드펜스 금지.

스키마:
{"emoji":"...","title":"...","body":"..."}"""


def main():
    payload = json.load(sys.stdin)
    prompt = (payload.get("prompt") or "").strip()
    scope = payload.get("scope") or "thisWeek"
    section_idx = payload.get("sectionIndex")
    if not prompt:
        print(json.dumps({"ok": False, "error": "empty prompt"}, ensure_ascii=False))
        return 1

    env = load_env()
    api_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "error": "missing ANTHROPIC_API_KEY"}, ensure_ascii=False))
        return 1

    draft = json.loads(DRAFT_PATH.read_text(encoding="utf-8"))
    block = draft.get(scope)
    if not block:
        print(json.dumps({"ok": False, "error": f"scope {scope} not in draft"}, ensure_ascii=False))
        return 1

    sections = block.get("sections") or []

    if isinstance(section_idx, int) and 0 <= section_idx < len(sections):
        # ── 섹션 1개만 수정 ──
        target = sections[section_idx]
        user_msg = (
            f"수정할 섹션 (scope: {scope}, 주차: {block.get('label')} {block.get('period')}):\n"
            f"```json\n{json.dumps(target, ensure_ascii=False, indent=2)}\n```\n\n"
            f"전체 섹션 목록 (컨텍스트 참고):\n"
            f"{', '.join([s.get('emoji','')+' '+s.get('title','') for s in sections])}\n\n"
            f"=== 사용자 수정 지시 ===\n{prompt}\n=== 끝 ===\n\n"
            f"위 지시대로 위 섹션을 수정해서 JSON 1개로만 출력."
        )
        try:
            d = call_claude(api_key, SYS_SECTION, user_msg, max_tokens=2000, model=MODEL)
            raw = (d.get("content") or [{}])[0].get("text", "")
            new_sec = extract_json(raw)
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"claude failed: {e}"}, ensure_ascii=False))
            return 1
        sections[section_idx] = new_sec
        block["sections"] = sections
        block["sheetText"] = sections_to_sheet_text(sections)
        revised_target = "section"
    else:
        # ── 전체 sections 재생성 ──
        user_msg = (
            f"현재 초안 (scope: {scope}, 주차: {block.get('label')} {block.get('period')}):\n"
            f"headline: {block.get('headline','')}\n"
            f"sections:\n```json\n{json.dumps(sections, ensure_ascii=False, indent=2)}\n```\n\n"
            f"=== 사용자 수정 지시 ===\n{prompt}\n=== 끝 ===\n\n"
            f"위 지시를 반영해 headline + 전체 sections 를 다시 출력."
        )
        try:
            d = call_claude(api_key, SYS_FULL, user_msg, max_tokens=6000, model=MODEL)
            raw = (d.get("content") or [{}])[0].get("text", "")
            new_block = extract_json(raw)
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"claude failed: {e}"}, ensure_ascii=False))
            return 1
        if "headline" in new_block:
            block["headline"] = new_block["headline"]
        if "sections" in new_block and isinstance(new_block["sections"], list):
            block["sections"] = new_block["sections"]
        block["sheetText"] = sections_to_sheet_text(block.get("sections") or [])
        revised_target = "full"

    DRAFT_PATH.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "scope": scope,
        "revised": revised_target,
        "sectionIndex": section_idx if revised_target == "section" else None,
        "headline": block.get("headline", "")[:200],
        "sectionsCount": len(block.get("sections") or []),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
generate_chairman_weekly_draft.py
- 매주 일요일 19:00 KST: 박진호 대표(본인) 칸 주간회의 초안 생성
- 입력: 캘린더 last7+next7, ceo_mail.db high/action(last7), decisions(last7),
        people overdue, schedule_insights(다른팀 컨텍스트)
- 출력: public/chairman_draft.json
- 모델: claude-sonnet-4-6
"""
import json, os, sys, sqlite3, subprocess, re
from datetime import datetime, timezone, timedelta
from urllib import request, error
from pathlib import Path

KST = timezone(timedelta(hours=9))
ROOT = Path("/root/jinho-playground")
DB = ROOT / "data" / "ceo_mail.db"
EVENTS_PATH = ROOT / "public" / "events.json"
PEOPLE_PATH = ROOT / "public" / "people.json"
DECISIONS_PATH = ROOT / "data" / "decisions.json"
INSIGHTS_PATH = ROOT / "data" / "schedule_insights.json"
OUT_PATH = ROOT / "public" / "chairman_draft.json"
ENV_FILES = ["/root/.openclaw/secrets/nerve.env", str(ROOT / ".env.local")]

MODEL = "claude-sonnet-4-6"
FALLBACK_MODEL = "claude-haiku-4-5-20251001"


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


def gather_events():
    now = kst_now()
    today = now.strftime("%Y-%m-%d")
    last7 = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    next7 = (now + timedelta(days=7)).strftime("%Y-%m-%d")
    past, future = [], []
    try:
        d = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
        events = d.get("events", []) if isinstance(d, dict) else d
        seen = set()
        for e in events:
            s = (e.get("start", "") or "")[:10]
            title = (e.get("title", "") or "").strip()
            if not s or not title:
                continue
            cal = e.get("cal", "")
            key = (s, title, cal)
            if key in seen:
                continue
            seen.add(key)
            time_str = (e.get("start", "").split("T")[1][:5]
                        if "T" in e.get("start", "") else "all-day")
            item = {"date": s, "time": time_str, "title": title, "cal": cal}
            if last7 <= s < today:
                past.append(item)
            elif today <= s <= next7:
                future.append(item)
    except Exception as err:
        print(f"[chairman] events err: {err}", file=sys.stderr)
    past.sort(key=lambda x: (x["date"], x["time"]))
    future.sort(key=lambda x: (x["date"], x["time"]))
    return past, future


def gather_mail():
    cutoff = int((kst_now() - timedelta(days=7)).timestamp())
    high, cat_counts = [], {}
    try:
        conn = sqlite3.connect(str(DB), timeout=30)
        rows = conn.execute("""
          SELECT ai_category, COUNT(*) FROM messages
          WHERE trashed_at IS NULL AND date_ts >= ?
          GROUP BY ai_category
        """, (cutoff,)).fetchall()
        for r in rows:
            cat_counts[r[0] or "pending"] = r[1]
        rows = conn.execute("""
          SELECT subject, from_name, ai_summary, priority, ai_category, date_ts
          FROM messages
          WHERE trashed_at IS NULL AND date_ts >= ?
            AND (priority='high' OR ai_category IN ('action','urgent','sales','client'))
          ORDER BY date_ts DESC LIMIT 40
        """, (cutoff,)).fetchall()
        for r in rows:
            high.append({
                "subject": r[0],
                "from": r[1],
                "summary": (r[2] or "").strip()[:280],
                "priority": r[3],
                "cat": r[4],
                "date": datetime.fromtimestamp(r[5], KST).strftime("%m/%d"),
            })
        conn.close()
    except Exception as e:
        print(f"[chairman] mail err: {e}", file=sys.stderr)
    return high, cat_counts


def gather_decisions():
    cutoff = (kst_now() - timedelta(days=7)).strftime("%Y-%m-%d")
    items = []
    try:
        d = json.loads(DECISIONS_PATH.read_text(encoding="utf-8"))
        for x in d.get("items", []):
            if (x.get("date", "") or "") >= cutoff:
                items.append({
                    "date": x.get("date", ""),
                    "q": (x.get("question", "") or "").strip()[:120],
                    "summary": ((x.get("text", "") or "").split("\n")[0])[:200],
                })
    except Exception:
        pass
    return items


def gather_overdue_people():
    out = []
    try:
        d = json.loads(PEOPLE_PATH.read_text(encoding="utf-8"))
        for p in d.get("people", []):
            if p.get("overdue"):
                out.append({
                    "name": p.get("name", ""),
                    "role": p.get("role", ""),
                    "kind": p.get("kind", ""),
                    "lastContact": p.get("lastContact", ""),
                })
        out.sort(key=lambda x: x.get("name", ""))
    except Exception:
        pass
    return out[:30]


def gather_insights():
    try:
        return json.loads(INSIGHTS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def upcoming_workweek():
    """Return ("XX주", "M/D~M/D", mon_date) for the upcoming Mon~Fri.
       Run on Sunday => returns NEXT Mon~Fri. Run other days => returns THIS Mon~Fri."""
    now = kst_now()
    wd = now.weekday()
    if wd == 6:
        mon = now + timedelta(days=1)
    else:
        mon = now - timedelta(days=wd)
    fri = mon + timedelta(days=4)
    week_no = int(mon.strftime("%V"))
    period = f"{mon.month}/{mon.day}~{fri.month}/{fri.day}"
    return f"{week_no}주", period, mon


def previous_workweek(this_mon):
    last_mon = this_mon - timedelta(days=7)
    last_fri = last_mon + timedelta(days=4)
    week_no = int(last_mon.strftime("%V"))
    period = f"{last_mon.month}/{last_mon.day}~{last_fri.month}/{last_fri.day}"
    return f"{week_no}주", period


SYSTEM_PROMPT = """너는 박진호 대표(뷰스컴퍼니/비라운드 MCN)의 주간회의 초안 어시스턴트야.
출력 양식은 회사의 주간 업무회의 통합양식 — 대표님 칸 — 을 그대로 따른다.

⭐ 숫자 자릿수 검산 (필수):
- 1억 = 100,000,000 (1억 = 100M = 0.1B)
- 10억 = 1,000,000,000
- 16.9억 = 1,690,000,000 (≈ 1,692,800,000)
- 100억 = 10,000,000,000
- 169억 = 16,900,000,000  (← 절대 1,692,800,000 = 16.9억과 혼동 금지)
- 소스 데이터의 원화 금액을 "N억" 또는 "N천만원"으로 변환할 때 반드시 자리수를 검산해라.
- 1,692,800,000원 = 16.9억 (X 169억 아님)
- 553,830,000원 = 5.5억
- 737,112,500원 = 7.4억
- 85,001,587원 = 0.85억 (8,500만원)

⭐ 최우선 원칙 — 두괄식 매출 정리:
주간회의의 핵심은 "모든 팀의 매출 보고와 매출 관리"다. 항상 매출/수치를 가장 위에 둔다.
1. headline(한 줄)은 반드시 매출/이익 숫자가 포함된 헤드라인. (예: "5월 누계 매출 13.6억(+34% MoM)·세포랩 5억·티르티르 16.9억 계약")
2. sections 배열의 첫 번째는 반드시 "📊 매출/수치" 섹션. context_other_teams.changes에서 매출·예산·집행액 숫자를 추출해 팀별로 정리한다. 데이터가 없는 팀은 생략.
3. 매출 섹션 다음에는 핵심이슈/New BM/내부 등 대표 의사결정 섹션만 둔다. "영업관리", "고정TF", "팔로업" 섹션은 생성하지 않는다.

⭐ 메인 섹션 vs 관리/위임 영역 분리:
대표가 직접 결정·외부미팅·이동·계약 사인·면접·중대 의사결정해야 하는 것만 메인 섹션(sections)에 둔다.
정기 1:1, 팀 내부 자료 리뷰, 팀 회의 등 실무자가 들고오는 정기성 참여건은 management 영역으로 옮긴다.
회사 전체 영업관리/파이프라인/미팅 리스트는 대표 세부 스케줄이 아니므로 메인 섹션(sections)에 두지 않는다.
정기 TF/주간회의/고정회의는 아래 management 영역과 중복되므로 메인 섹션(sections)에 두지 않는다.
팔로업/마감/대표 직접 액션 목록은 아래 my_todos, must_resolve, people_to_reach와 중복되므로 메인 섹션(sections)에 두지 않는다.

메인(sections)에 둘 것:
- 외부 클라이언트/파트너 미팅 (대표 직접 미팅)
- 의사결정·계약·면접
- 매출/예산 결정
- 신규 BM·전략 미팅
- 발표·강의·외부 행사

management 영역으로 분리할 것:
- 실무자 1:1 (이후승 팀장 1:1, 유예나 파트장 1:1 등)
- 자료 리뷰 미팅 (헤비메이크업 자료 리뷰, 세포랩 자료 2차 리뷰 등)
- 정기 팀 회의 참여 (주간 영업회의, 주간 콘텐츠 미팅 등 — 대표 의사결정 사항 없는 경우)
- 단순 보고/참여건
- 회사 전체 영업관리 묶음, 파이프라인 관리, 개별 영업 미팅 나열
- 고정 TF, 주간회의, 주간글로벌, 커머스 고정회의 등 정기 일정 묶음
- 팔로업, 마감 체크, 대표 직접 액션 목록

작성 규칙:
1. 한국어. 결론·팩트 우선. 추측·과장 금지. 불확실하면 (?) 표시.
2. 각 항목은 시트 셀에 그대로 붙여넣을 수 있는 텍스트.
3. 카테고리 emoji + 라벨로 섹션 구분 (이 순서로):
   📊 매출/수치 → 📌 핵심이슈 → 🚀 New BM → 👤 비라운드/발굴 크리에이터 → 🏢 내부사항
4. 각 섹션 내부 패턴 (시트 양식 그대로):
   1. 주요항목 (날짜·미팅명·숫자 포함)
     ㄴ 세부 진행사항
     → 다음 단계 또는 결과
5. 비어있는 섹션은 생략. 무리하게 채우지 마. 데이터에서 근거가 보이는 것만 적어.
6. user_inputs 컨텍스트가 있으면 그 내용을 우선 반영 (사용자가 직접 추가한 메모/일정/지시사항).
7. JSON으로만 출력. 코드펜스 금지.

⭐ 시트 업로드용 요약 — 2종 분리 출력:

(A) sheetSummary — "전체" 행에 들어갈 회사 전체 두괄식 요약
- 매출/팀별/핵심이슈/내부 등 회사 전체 시점.
- 회사 전체 영업관리 현황이 꼭 필요하면 여기에서만 1~2줄로 압축하고, sections에는 별도 "영업관리" 섹션을 만들지 않는다.
- 형식:
  📊 매출(두괄식)
  1. 마케팅1팀 5.5억 · 세포랩 5억 집행
  2. 콘텐츠 7.4억 · 운영 안정
  📌 핵심이슈
  1. ⭐올리브영 공식 대행사 — 신규 파이프라인, 지속관리
  ...
- 8~12줄 이내, 1셀 가독성.

(B) personalSheetSummary — "대표님" 행에 들어갈 박진호 대표 개인 요약
- 회사 전체 매출/팀 보고는 제외. 본인이 어디서 누구를 만나고 무엇을 결정·회신해야 하는지에 집중.
- 회사 전체 영업관리 섹션/파이프라인 목록/일괄 미팅 리스트는 제외.
- 포함 항목:
   1. 이번주 본인 외부 미팅·고문 만남·핵심 의사결정 일정 (날짜·시간)
   2. 직접 회신/사인/결정해야 하는 액션 (마감일 포함)
   3. 외부 인맥 컨택 (소개·재연결)
- 형식:
  📅 이번주 외부 미팅
  1. 5/18 11:00 최병곤 고문
  2. 5/19 16:00 안지영 애널 (명동)
  3. 5/20 15:00 유튜브 코리아 — CSP
  ✍ 직접 액션 (마감)
  1. AI Summit CV 회신 (5/18)
  2. 클리오 제안서 결정 (5/22)
  3. 티르티르 16.9억 날인 확인 (5/22)
  📞 컨택
  1. 글로벌 영업 업체 소개 (상무님)
  2. 백아람 대표 (4개월+)
- 8~12줄 이내. 회사 매출 숫자는 빼고, 본인 시점 액션·일정만.

JSON 스키마:
{
  "prev_week_summary": {
    "headline": "매출·이익 숫자가 포함된 한 줄 (지난주)",
    "sections": [
      {"emoji":"📊","title":"매출/수치","body":"1. 팀별 매출 ...\\n  ㄴ 세부 ...\\n  → 시사점"},
      {"emoji":"📌","title":"핵심이슈","body":"..."}
    ],
    "sheetSummary": "📊 매출(두괄식)\\n1. 마케팅1팀 5.5억 ...\\n📌 핵심이슈\\n1. ⭐ ...",
    "personalSheetSummary": "📅 본인 외부 미팅\\n1. ...\\n✍ 직접 액션\\n1. ...",
    "management": [
      {"date":"5/12","time":"10:00","title":"주간 영업회의","note":"위임"}
    ]
  },
  "this_week_plan": {
    "headline": "매출·이익 목표/관리 헤드라인 (이번주)",
    "sections": [
      {"emoji":"📊","title":"매출/수치","body":"..."},
      {"emoji":"📌","title":"핵심이슈","body":"..."}
    ],
    "sheetSummary": "📊 매출(두괄식)\\n...\\n📌 핵심이슈\\n...",
    "personalSheetSummary": "📅 본인 외부 미팅\\n...\\n✍ 직접 액션\\n...",
    "management": [
      {"date":"5/19","time":"10:30","title":"주간 매니지먼트+커머스","note":"참여만"}
    ]
  },
  "must_resolve": [
    {"item":"...", "why":"...", "by":"YYYY-MM-DD or N주차"}
  ],
  "people_to_reach": [
    {"name":"...", "reason":"...", "channel":"메일/카톡/미팅", "lastContact":"YYYY-MM 또는 N일 전"}
  ],
  "my_todos": [
    {"item":"대표 본인이 직접 액션해야 하는 to-do (회사 양식과 별개)",
     "category":"결정|회신|미팅준비|계약사인|채용면접|외부소개|기타",
     "by":"YYYY-MM-DD",
     "priority":"high|med|low",
     "note":"맥락 한 줄"}
  ]
}

⭐ my_todos 작성 원칙:
- sections/management/must_resolve와 별개로, 대표 본인 손이 직접 가야 하는 액션만.
  예: 회신 보낼 메일, 사인할 계약서, 결정해야 할 안건, 직접 소개해 줄 인맥, 외부 미팅 준비 자료 검토.
- 회사 양식(sections)에 들어가는 보고/관리 항목과 중복되지 않게.
- 5~12개 이내. 너무 많이 뽑지 마. 정말 본인이 해야 하는 것만."""


def gather_user_inputs(label):
    """Load any user-pasted notes/schedule for this_week label (e.g. '22주').
       File: data/chairman_inputs/<week>.json with {items: [...]} or list."""
    path = ROOT / "data" / "chairman_inputs" / f"{label}.json"
    if not path.exists():
        return None
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(d, list):
            return d
        return d.get("items") or d.get("inputs") or []
    except Exception:
        return None


def build_user(prev_label, this_label, past, future, mail, mail_cats, decisions, overdue, insights, user_inputs):
    today = kst_now().strftime("%Y-%m-%d (%a)")
    blob = {
        "today": today,
        "prev_week": {"label": prev_label[0], "period": prev_label[1]},
        "this_week": {"label": this_label[0], "period": this_label[1]},
        "calendar_last7": past,
        "calendar_next7": future,
        "mail_categories_last7": mail_cats,
        "mail_high_last7": mail,
        "decisions_last7": decisions,
        "overdue_people": overdue,
        "context_other_teams": (insights and {
            "summary": insights.get("summary"),
            "changes": (insights.get("changes") or [])[:8],
            "must_resolve": (insights.get("mustResolve") or [])[:8],
        }) or None,
        "user_inputs_this_week": user_inputs or [],
    }
    return (
        "아래 데이터로 박진호 대표 칸 주간회의 초안을 작성해.\n"
        "- prev_week_summary: 지난주 진행결과 (캘린더+메일+결정 기반)\n"
        "- this_week_plan: 이번주 계획 (다음 7일 캘린더+팔로업+미해결)\n"
        "- must_resolve / people_to_reach: 회의에서 합의 필요한 사항\n\n"
        "DATA:\n" + json.dumps(blob, ensure_ascii=False, indent=1)
    )


def parse_claude_json(raw):
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'```\s*$', '', raw)
    s = raw.find("{")
    e = raw.rfind("}")
    if s < 0 or e < 0:
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


def main():
    env = load_env()
    api_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[chairman] missing ANTHROPIC_API_KEY", file=sys.stderr)
        return 1

    past, future = gather_events()
    mail, mail_cats = gather_mail()
    decisions = gather_decisions()
    overdue = gather_overdue_people()
    insights = gather_insights()

    this_label_full = upcoming_workweek()
    this_label = (this_label_full[0], this_label_full[1])
    prev_label = previous_workweek(this_label_full[2])
    user_inputs = gather_user_inputs(this_label[0])

    system = SYSTEM_PROMPT
    user = build_user(prev_label, this_label, past, future, mail, mail_cats,
                      decisions, overdue, insights, user_inputs)

    used_model = MODEL
    draft = None
    for attempt, (m, mt) in enumerate([(MODEL, 4500), (FALLBACK_MODEL, 8000), (FALLBACK_MODEL, 8000)]):
        try:
            d = call_claude(api_key, system, user, max_tokens=mt, model=m)
            raw = (d.get("content") or [{}])[0].get("text", "")
            try:
                Path(f"/tmp/chairman_raw_{attempt+1}.txt").write_text(raw, encoding="utf-8")
            except Exception:
                pass
            draft = parse_claude_json(raw)
            used_model = m
            break
        except error.HTTPError as he:
            body_txt = ""
            try:
                body_txt = he.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            print(f"[chairman] attempt {attempt+1} HTTP {he.code} model={m} mt={mt}: {body_txt[:300]}", file=sys.stderr)
            if he.code == 429 and attempt < 2:
                continue
            return 1
        except Exception as e:
            print(f"[chairman] attempt {attempt+1} err: {e}", file=sys.stderr)
            if attempt < 2:
                continue
            return 1
    if draft is None:
        return 1

    prev = draft.get("prev_week_summary") or {}
    this = draft.get("this_week_plan") or {}
    prev_sections = prev.get("sections") or []
    this_sections = this.get("sections") or []
    prev_management = prev.get("management") or []
    this_management = this.get("management") or []

    out = {
        "generatedAt": int(datetime.now(timezone.utc).timestamp()),
        "model": used_model,
        "prevWeek": {
            "label": prev_label[0],
            "period": prev_label[1],
            "headline": prev.get("headline", ""),
            "sections": prev_sections,
            "management": prev_management,
            "sheetText": sections_to_sheet_text(prev_sections),
            "sheetSummary": prev.get("sheetSummary", "") or sections_to_sheet_text(prev_sections),
            "personalSheetSummary": prev.get("personalSheetSummary", ""),
        },
        "thisWeek": {
            "label": this_label[0],
            "period": this_label[1],
            "headline": this.get("headline", ""),
            "sections": this_sections,
            "management": this_management,
            "sheetText": sections_to_sheet_text(this_sections),
            "sheetSummary": this.get("sheetSummary", "") or sections_to_sheet_text(this_sections),
            "personalSheetSummary": this.get("personalSheetSummary", ""),
        },
        "mustResolve": draft.get("must_resolve") or [],
        "peopleToReach": draft.get("people_to_reach") or [],
        "myTodos": draft.get("my_todos") or [],
        "stats": {
            "calendarPast": len(past),
            "calendarFuture": len(future),
            "mailHigh": len(mail),
            "mailCategories": mail_cats,
            "overduePeople": len(overdue),
            "userInputs": len(user_inputs) if user_inputs else 0,
        },
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[chairman] wrote {OUT_PATH} prev={len(prev_sections)} this={len(this_sections)}")

    if os.environ.get("CHAIRMAN_PUSH", "1") == "1":
        try:
            msg = (f"📝 {this_label[0]} 주간회의 초안 생성됨\n"
                   f"기간: {this_label[1]}\n"
                   f"지난주 섹션 {len(prev_sections)} / 이번주 섹션 {len(this_sections)}\n"
                   f"이슈 {len(out['mustResolve'])} · 팔로업 {len(out['peopleToReach'])}\n"
                   f"→ http://100.71.196.83:3740/schedule")
            subprocess.run(["/usr/local/bin/beaus-send", "result", msg],
                           capture_output=True, timeout=20, check=False)
        except Exception as e:
            print(f"[chairman] notify failed: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

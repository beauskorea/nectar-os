import { NextRequest, NextResponse } from "next/server";
import {
  insertEvent,
  listEvents,
  deleteEvent,
  CAL_ID,
  type GCalEvent,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type ParsedEvent = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
};

type ParseResult = {
  intent: "add" | "delete";
  events: ParsedEvent[];
};

function kstNow(): string {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const SYSTEM = `너는 한국어 자연어를 캘린더 명령으로 변환한다.
지금 시각(KST): ${kstNow()}

출력은 반드시 STRICT JSON 한 객체:
{
  "intent": "add" | "delete",
  "events": [{"title": "...", "start": "...", "end": "...", "allDay": false}]
}

intent 판별:
- "삭제", "지워", "취소", "빼", "없애" 등 → "delete"
- 그 외 일정 추가/언급 → "add"

events 규칙:
- start/end는 ISO8601에 +09:00 오프셋 포함 (예: "2026-05-15T15:00:00+09:00")
- 종일 일정이면 allDay=true, start/end는 "YYYY-MM-DD" 형식
- 시간 미지정 시 기본 길이 60분
- "내일", "다음주 월요일" 같은 상대 표현은 KST 기준 절대 날짜로 변환
- delete 시에도 title은 사용자가 언급한 키워드 (없으면 빈 문자열)
- 여러 일정이 한 문장에 있으면 배열에 다 담는다

JSON 외의 텍스트(설명, 마크다운, code fence)는 절대 출력 금지.`;

function authHeaders(apiKey: string): Record<string, string> {
  // Support both standard API keys (sk-ant-api...) and Claude Code OAT (sk-ant-oat...).
  // OAT must be sent as Bearer with the oauth beta header.
  const isOat = apiKey.includes("oat");
  if (isOat) {
    return {
      authorization: `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
      "content-type": "application/json",
    };
  }
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
}

async function parseWithClaude(text: string, apiKey: string): Promise<ParseResult | { error: string; detail?: string }> {
  let r: Response;
  try {
    r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: text }],
      }),
    });
  } catch (e) {
    return { error: "fetch_failed", detail: (e as Error).message };
  }
  if (!r.ok) {
    return { error: "anthropic_error", detail: `${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}` };
  }
  const data = (await r.json()) as { content?: Array<{ text?: string }> };
  const raw = data?.content?.[0]?.text ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { error: "no_json_in_response", detail: raw.slice(0, 300) };
  let parsed: { intent?: string; events?: ParsedEvent[] };
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    return { error: "json_invalid", detail: (e as Error).message };
  }
  const intent: ParseResult["intent"] = parsed.intent === "delete" ? "delete" : "add";
  const events = (parsed.events || []).map((ev) => ({
    title: String(ev.title || "").slice(0, 200),
    start: String(ev.start || ""),
    end: String(ev.end || ev.start || ""),
    allDay: Boolean(ev.allDay),
  }));
  return { intent, events };
}

function windowFor(ev: ParsedEvent): { timeMin: string; timeMax: string } {
  if (ev.allDay) {
    const d = ev.start; // YYYY-MM-DD
    return {
      timeMin: `${d}T00:00:00+09:00`,
      timeMax: `${d}T23:59:59+09:00`,
    };
  }
  const start = new Date(ev.start);
  const min = new Date(start.getTime() - 30 * 60 * 1000);
  const max = new Date(start.getTime() + 90 * 60 * 1000);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

function summarizeMatch(m: GCalEvent): string {
  const t = m.summary || "(제목없음)";
  const s = m.start?.dateTime || m.start?.date || "";
  return `${t} @ ${s}`;
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "no_api_key" }, { status: 503 });

  let text = "";
  let cal = "beautysketch";
  try {
    const body = (await req.json()) as { text?: string; cal?: string };
    text = (body.text || "").trim();
    if (body.cal && CAL_ID[body.cal]) cal = body.cal;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });

  const parsed = await parseWithClaude(text, key);
  if ("error" in parsed) {
    return NextResponse.json(parsed, { status: 502 });
  }

  if (parsed.intent === "delete") {
    const results = await Promise.all(
      parsed.events.map(async (ev) => {
        try {
          const win = windowFor(ev);
          const matches = await listEvents(cal, { timeMin: win.timeMin, timeMax: win.timeMax, q: ev.title || undefined });
          if (matches.length === 0) {
            return { ...ev, cal, deleted: false as const, error: "찾지 못함 (해당 시간대 이벤트 없음)" };
          }
          if (matches.length > 1) {
            return {
              ...ev,
              cal,
              deleted: false as const,
              error: `${matches.length}개 후보 — 제목으로 더 구체화: ${matches.map(summarizeMatch).join(" / ")}`,
            };
          }
          await deleteEvent(cal, matches[0].id);
          return { ...ev, cal, deleted: true as const, google_id: matches[0].id, summary: matches[0].summary };
        } catch (e) {
          return { ...ev, cal, deleted: false as const, error: (e as Error).message.slice(0, 300) };
        }
      }),
    );
    const allOk = results.every((r) => r.deleted);
    return NextResponse.json({ intent: "delete", cal, events: results, ok: allOk });
  }

  // intent === "add"
  const results = await Promise.all(
    parsed.events.map(async (ev) => {
      try {
        const g = await insertEvent(cal, ev);
        return { ...ev, cal, synced: true as const, google_id: g.id, htmlLink: g.htmlLink };
      } catch (e) {
        return { ...ev, cal, synced: false as const, error: (e as Error).message.slice(0, 300) };
      }
    }),
  );
  const allOk = results.every((r) => r.synced);
  return NextResponse.json({ intent: "add", cal, events: results, ok: allOk });
}

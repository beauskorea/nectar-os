import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const EVENTS_PATH = "/root/projects/nectar-os/public/events.json";
const MAIL_PATH = "/root/projects/nectar-os/public/mail.json";

function authHeaders(apiKey: string): Record<string, string> {
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

// 1차 휴리스틱 — 명백한 시그널 키워드만 후보로
const SIGNAL_RE = /오픈|런칭|계약|사인|체결|MOU|협약|파트너|IPO|투자유치|기념|수상|성과|마감|제출|발표|간담|취재|위기|이슈|갈등|연기|취소|실패|대응|컴플레인|이탈|퇴사|면담|보고/;

type Event = { id: string; title: string; start: string; allDay: boolean; cal: string };
type Mail = {
  id: string;
  ts: number;
  date: string;
  fromName?: string;
  subject?: string;
  snippet?: string;
  aiSummary?: string | null;
  priority?: string | null;
  category?: string | null;
};

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "no_api_key" }, { status: 503 });

  // Load events & mail
  let events: Event[] = [];
  let mails: Mail[] = [];
  try {
    const eRaw = await fs.readFile(EVENTS_PATH, "utf-8");
    const eParsed = JSON.parse(eRaw);
    events = Array.isArray(eParsed?.events) ? eParsed.events : Array.isArray(eParsed) ? eParsed : [];
  } catch {}
  try {
    const mRaw = await fs.readFile(MAIL_PATH, "utf-8");
    const mParsed = JSON.parse(mRaw);
    mails = mParsed?.messages || [];
  } catch {}

  const now = Date.now();
  const past7 = now - 7 * 86400 * 1000;
  const fut14 = now + 14 * 86400 * 1000;

  // 1차 필터 — 종일 OR 키워드 매칭 OR mail high priority
  const evCandidates = events
    .filter((e) => {
      const t = new Date(e.start).getTime();
      if (Number.isNaN(t)) return false;
      if (t < past7 || t > fut14) return false;
      return e.allDay || SIGNAL_RE.test(e.title || "");
    })
    .slice(0, 30);

  const mailCandidates = mails
    .filter((m) => m.ts && m.ts * 1000 >= past7)
    .filter((m) => {
      const sig = SIGNAL_RE.test(`${m.subject || ""} ${m.snippet || ""}`);
      const urgent = m.priority === "urgent" || m.priority === "high";
      return sig || urgent;
    })
    .slice(0, 20);

  if (evCandidates.length === 0 && mailCandidates.length === 0) {
    return NextResponse.json({ items: [], note: "1차 휴리스틱 매칭 결과 없음" });
  }

  // 2차 — Claude로 분류 + 정제
  const evPart = evCandidates.map((e) => ({
    src: "event" as const,
    id: e.id,
    title: e.title,
    start: e.start,
    allDay: e.allDay,
  }));
  const mailPart = mailCandidates.map((m) => ({
    src: "mail" as const,
    id: m.id,
    from: m.fromName || "",
    subject: m.subject || "",
    snippet: (m.snippet || "").slice(0, 200),
    priority: m.priority || null,
    summary: m.aiSummary || null,
  }));

  const SYSTEM = `너는 박진호(뷰스컴퍼니 대표·K-뷰티 MCN) 의 운영 시그널 분석가다.
캘린더 이벤트 + 메일 후보 리스트를 보고 박진호가 신경 써야 할 시그널만 추려낸다.

응답 STRICT JSON 한 객체:
{"items":[{"src":"event|mail","id":"...","kind":"risk|issue|win","title":"...","action":"...","owner":"...","due":"YYYY-MM-DD 또는 null"}]}

분류:
- risk 🚨 — 매출/관계/법무 위험, 컴플레인, 이탈, 위기
- issue ⚠️ — 결정 필요, 마감 임박, 정체, 후속 작업 미정
- win 🎉 — 계약/파트너십/체결, 출시, 수상, 좋은 PR

규칙:
- 정기 회의, 광고 메일, 자동 알림, 일상 잡일은 결과에서 제외
- title 40자 내 한 줄 요약
- action: 박진호의 다음 액션 (구체적, 짧게). 없으면 빈 문자열
- owner: 담당/관련자 (이름). 모르면 빈 문자열
- due: 명시된 마감만, 없으면 null

JSON 외 텍스트(설명, 마크다운, code fence) 절대 금지.`;

  const userPayload = JSON.stringify({ events: evPart, mails: mailPart }, null, 2);

  let r: Response;
  try {
    r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: "user", content: userPayload }],
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: "fetch_failed", detail: (e as Error).message }, { status: 502 });
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return NextResponse.json({ error: "anthropic_error", body: t.slice(0, 300) }, { status: 502 });
  }
  const data = (await r.json()) as { content?: Array<{ text?: string }> };
  const raw = data?.content?.[0]?.text ?? "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return NextResponse.json({ error: "no_json", raw }, { status: 502 });
  let parsed: { items?: Array<{ src?: string; id?: string; kind?: string; title?: string; action?: string; owner?: string; due?: string | null }> };
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    return NextResponse.json({ error: "json_invalid", detail: (e as Error).message }, { status: 502 });
  }
  const items = (parsed.items || []).map((it) => ({
    src: it.src === "mail" ? "mail" : "event",
    sourceId: String(it.id || ""),
    kind: (it.kind === "risk" || it.kind === "issue" || it.kind === "win" ? it.kind : "issue") as "risk" | "issue" | "win",
    title: String(it.title || "").slice(0, 100),
    action: String(it.action || "").slice(0, 200),
    owner: String(it.owner || "").slice(0, 60),
    due: it.due && /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? it.due : null,
  }));
  return NextResponse.json({
    items,
    stats: {
      events_scanned: events.length,
      mails_scanned: mails.length,
      event_candidates: evCandidates.length,
      mail_candidates: mailCandidates.length,
      ai_matched: items.length,
    },
  });
}

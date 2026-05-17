import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

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

const SYSTEM = `너는 박진호(뷰스컴퍼니 대표 · K-뷰티 MCN) 의 운영 시그널 분석가다.
사용자가 던지는 짧은 메모를 받아 구조화된 JSON으로 변환한다.

출력 STRICT JSON 한 객체:
{"items":[{"kind":"risk|issue|win","title":"...","action":"...","owner":"...","due":"YYYY-MM-DD 또는 null"}]}

분류 규칙:
- "risk" 🚨 — 매출 하락, 갈등, 컴플레인, 사건사고, 법무 이슈, 인력 이탈 위험
- "issue" ⚠️ — 의사결정 필요, 정체, 협업 잡음, 후속 미정
- "win" 🎉 — 계약 체결, 파트너십, 성과 달성, 출시, 수상, 매출 마일스톤, 좋은 PR

필드 규칙:
- title: 한 줄 요약 (40자 내)
- action: 박진호가 해야 할 다음 액션 (예: "마케팅팀에 보상 챙기기", "박창현 전무와 계약서 검토"). 모르면 빈 문자열.
- owner: 책임/관련 사람 (예: "성지영 상무", "신승아"). 메모에 없으면 빈 문자열.
- due: 명시된 마감만. 없으면 null.

한 메모에 여러 시그널이 섞여 있으면 items 배열에 다 담는다.
JSON 외 텍스트(설명, 마크다운, code fence) 절대 금지.`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "no_api_key" }, { status: 503 });

  let text = "";
  try {
    const b = (await req.json()) as { text?: string };
    text = (b.text || "").trim();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });

  let r: Response;
  try {
    r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: text }],
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
  let parsed: { items?: Array<{ kind?: string; title?: string; action?: string; owner?: string; due?: string | null }> };
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    return NextResponse.json({ error: "json_invalid", detail: (e as Error).message }, { status: 502 });
  }
  const items = (parsed.items || []).map((it) => ({
    kind: (it.kind === "risk" || it.kind === "issue" || it.kind === "win" ? it.kind : "issue") as "risk" | "issue" | "win",
    title: String(it.title || "").slice(0, 100),
    action: String(it.action || "").slice(0, 200),
    owner: String(it.owner || "").slice(0, 60),
    due: it.due && /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? it.due : null,
  }));
  return NextResponse.json({ items });
}

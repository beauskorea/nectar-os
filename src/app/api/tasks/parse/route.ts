import { NextRequest, NextResponse } from "next/server";
import * as gt from "@/lib/google-tasks";

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

const SYSTEM = `너는 한국어 자연어를 할일 목록으로 변환한다.
출력은 반드시 STRICT JSON 한 객체:
{"todos":[{"text":"...","priority":"high"}]}

규칙:
- 한 입력에서 여러 할일이 발견되면 모두 분리하여 todos 배열에 담는다
- text는 입력 문장에서 핵심 행동만 추출 (불필요한 접속사, 시간 표현 제외 단 중요한 마감은 text에 유지)
- priority 결정:
  - "급한","긴급","ASAP","당장","바로","오늘","내일까지","마감" → "high"
  - "여유","나중에","언젠가","천천히" → "low"
  - 그 외 기본 → "med"
- 마감일이나 시간이 명시되었으면 text 끝에 "(마감 5/20)" 같이 자연스럽게 추가

JSON 외의 텍스트(설명, 마크다운, code fence)는 절대 출력 금지.`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "no_api_key" }, { status: 503 });

  let text = "";
  let status: gt.Status = "todo";
  let board: gt.Board = "company";
  try {
    const b = (await req.json()) as { text?: string; status?: gt.Status; board?: gt.Board };
    text = (b.text || "").trim();
    if (b.status === "doing" || b.status === "done") status = b.status;
    if (b.board === "personal") board = "personal";
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });

  if (!(await gt.isConfigured())) {
    return NextResponse.json({ error: "tasks_not_configured" }, { status: 503 });
  }

  // 1) Claude parse
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
    return NextResponse.json(
      { error: "fetch_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return NextResponse.json(
      { error: "anthropic_error", status: r.status, body: t.slice(0, 300) },
      { status: 502 },
    );
  }
  const data = (await r.json()) as { content?: Array<{ text?: string }> };
  const raw = data?.content?.[0]?.text ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return NextResponse.json({ error: "no_json_in_response", raw }, { status: 502 });
  let parsed: { todos?: Array<{ text?: string; priority?: "high" | "med" | "low" }> };
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    return NextResponse.json(
      { error: "json_invalid", detail: (e as Error).message, raw },
      { status: 502 },
    );
  }
  const todos = (parsed.todos || []).filter((t) => (t.text || "").trim());

  // 2) create each via Google Tasks
  const results = await Promise.all(
    todos.map(async (t) => {
      const txt = (t.text || "").trim();
      const pri: "high" | "med" | "low" = t.priority === "high" || t.priority === "low" ? t.priority : "med";
      try {
        const created = await gt.createTodo(txt, pri, status, board);
        return { text: txt, priority: pri, ok: true as const, id: created.id };
      } catch (e) {
        return { text: txt, priority: pri, ok: false as const, error: (e as Error).message.slice(0, 300) };
      }
    }),
  );

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({
    todos: results,
    count: results.length,
    ok: allOk,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

type Msg = {
  id: string;
  ts: number;
  date?: string;
  fromName: string;
  fromAddr: string;
  subject: string;
  snippet?: string;
  body?: string;
  category?: string | null;
  priority?: string | null;
  aiSummary?: string | null;
};

const ANTHROPIC_MODEL = "claude-opus-4-7";
const PERPLEXITY_MODEL = "sonar-pro";
const MAX_BODY = 4000;

const SYSTEM = `너는 박진호(뷰스컴퍼니 대표·ceo@beaus.co.kr)의 답장 초안을 한국어로 작성한다.
회사 컨텍스트: 뷰스컴퍼니/비라운드 — K-뷰티 마케팅·MCN. 11개 K-뷰티 클라이언트(투쿨포스쿨, 토코보 등), 전속 크리에이터 66명·연습생 38명.

작성 규칙:
- 비즈니스 톤(정중하지만 군더더기 없이), 본문 3~6문장
- 인사 1문장 → 본문 → 다음 액션 1문장 → 마무리
- 결정해야 할 사항은 옵션을 제시하고 박진호 선택을 기다리는 표현 사용
- 모르는 사실은 [확인 필요], [내부 협의 후 회신] 같은 플레이스홀더로 명시
- 서명은 자동으로 붙으니 본문만 작성
- 영문 메일이면 영문으로 답장 작성

출력 형식: 답장 본문만 (다른 설명·머리말 금지).`;

async function loadMail(id: string): Promise<Msg | null> {
  const p = path.join(process.cwd(), "public", "mail.json");
  const raw = await readFile(p, "utf-8");
  const data = JSON.parse(raw) as { messages: Msg[] };
  return data.messages.find((m) => m.id === id) ?? null;
}

type DraftResult = { draft: string; model: string; usage?: unknown };

async function callAnthropic(apiKey: string, userMsg: string): Promise<DraftResult> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: unknown;
  };
  return {
    draft:
      j.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text as string)
        .join("\n")
        .trim() || "(빈 응답)",
    model: ANTHROPIC_MODEL,
    usage: j.usage,
  };
}

async function callPerplexity(apiKey: string, userMsg: string): Promise<DraftResult> {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });
  if (!r.ok) throw new Error(`perplexity ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: unknown;
  };
  return {
    draft: j.choices?.[0]?.message?.content?.trim() || "(빈 응답)",
    model: PERPLEXITY_MODEL,
    usage: j.usage,
  };
}

export async function POST(req: NextRequest) {
  let body: { messageId?: string; hint?: string; engine?: "anthropic" | "perplexity" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = body.messageId;
  if (!id) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const msg = await loadMail(id);
  if (!msg) return NextResponse.json({ error: "message not found" }, { status: 404 });

  const userMsg =
    `다음 메일에 대한 답장 초안을 작성하라.\n\n` +
    `From: ${msg.fromName} <${msg.fromAddr}>\n` +
    `Date: ${msg.date ?? ""}\n` +
    `Subject: ${msg.subject}\n` +
    `AI 분류: ${msg.category ?? "-"} / priority=${msg.priority ?? "-"}\n` +
    `AI 요약: ${msg.aiSummary ?? "-"}\n\n` +
    `--- 본문 ---\n${(msg.body || msg.snippet || "").slice(0, MAX_BODY)}` +
    (body.hint ? `\n\n--- 박진호 메모(초안에 반영) ---\n${body.hint}` : "");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  // OAuth 토큰(sk-ant-oat01-)은 직접 API 호출 불가 → Anthropic 강제 요청이 아니라면 Perplexity로 폴백
  const preferAnthropic =
    body.engine === "anthropic" || (anthropicKey && anthropicKey.startsWith("sk-ant-api"));

  const t0 = Date.now();
  try {
    let result: DraftResult;
    if (preferAnthropic && anthropicKey) {
      result = await callAnthropic(anthropicKey, userMsg);
    } else if (perplexityKey) {
      result = await callPerplexity(perplexityKey, userMsg);
    } else if (anthropicKey) {
      result = await callAnthropic(anthropicKey, userMsg); // fallback (이 경우 401 가능)
    } else {
      return NextResponse.json({ error: "no API key configured" }, { status: 500 });
    }
    return NextResponse.json({
      draft: result.draft,
      model: result.model,
      elapsedMs: Date.now() - t0,
      usage: result.usage ?? null,
      replyToUrl: `https://mail.worksmobile.com`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}

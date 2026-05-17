import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const PERPLEXITY_MODEL = "sonar-pro";
const OPENAI_MODEL = "gpt-4o-mini";

type Msg = {
  id: string;
  ts: number;
  fromName?: string;
  fromAddr?: string;
  subject?: string;
  aiSummary?: string | null;
  aiInsight?: string | null;
  category?: string | null;
};

const SYSTEM = `너는 박진호(뷰스컴퍼니 대표·K-뷰티 마케팅·MCN)의 뉴스 큐레이터다.
주어진 뉴스레터·정보성 메일들을 종합해서 한국어로 박진호 맞춤 다이제스트를 작성하라.

출력 형식 (반드시 이 구조, 다른 텍스트·머리말·꼬리말 없이):

📊 이번주 핵심 3가지
1. <핵심 주제 한 줄 + 출처(매체명) 1~2개>
2. <...>
3. <...>

💡 박진호에게 유용한 시사점
- <불릿 2-4개, 뷰티·K-뷰티·MCN 마케팅 맥락에서 적용 가능한 인사이트>

🎯 다음 액션 후보
- <불릿 1-3개, 박진호가 검토하거나 액션할 항목>

📰 미언급·스킵 가능
- <불릿 1-3개, 큰 가치 없는 뉴스레터들 묶음 — 발신자·주제만 짧게>

규칙:
- 본문에 없는 사실 만들지 말 것.
- 같은 매체 여러 건이면 묶어서 한 줄로.
- 마크다운 헤더 # 사용 금지.`;

async function callPerplexity(apiKey: string, userMsg: string) {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
      max_tokens: 1500,
      temperature: 0.3,
    }),
  });
  if (!r.ok) throw new Error(`perplexity ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return { text: j.choices?.[0]?.message?.content?.trim() || "", model: PERPLEXITY_MODEL };
}

async function callOpenAI(apiKey: string, userMsg: string) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
      max_tokens: 1500,
      temperature: 0.3,
    }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return { text: j.choices?.[0]?.message?.content?.trim() || "", model: OPENAI_MODEL };
}

export async function POST(req: NextRequest) {
  let body: { days?: number };
  try { body = await req.json(); } catch { body = {}; }
  const days = Math.max(1, Math.min(30, body.days || 7));

  // mail.json에서 news 카테고리만 로드
  const p = path.join(process.cwd(), "public", "mail.json");
  const raw = await readFile(p, "utf-8");
  const data = JSON.parse(raw) as { messages: Msg[] };
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const news = data.messages
    .filter((m) => m.category === "news" && m.ts >= cutoff && (m.aiInsight || m.aiSummary || m.subject))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 60); // 토큰 제한

  if (news.length === 0) {
    return NextResponse.json({ ok: false, error: `최근 ${days}일 뉴스레터 없음` }, { status: 404 });
  }

  const userMsg =
    `최근 ${days}일 뉴스레터·정보성 메일 ${news.length}건의 핵심 데이터:\n\n` +
    news
      .map((m, i) => {
        const sender = m.fromName || (m.fromAddr || "?").split("@")[0];
        return `[${i + 1}] ${sender} · ${m.subject || ""}\n   요약: ${m.aiSummary || "-"}${m.aiInsight ? `\n   인사이트: ${m.aiInsight.slice(0, 300)}` : ""}`;
      })
      .join("\n\n") +
    `\n\n위 메일들을 종합해 박진호 맞춤 주간 다이제스트를 작성.`;

  const openaiKey = process.env.OPENAI_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const t0 = Date.now();
  try {
    let result;
    if (perplexityKey) result = await callPerplexity(perplexityKey, userMsg);
    else if (openaiKey) result = await callOpenAI(openaiKey, userMsg);
    else return NextResponse.json({ error: "no API key" }, { status: 500 });

    return NextResponse.json({
      ok: true,
      digest: result.text,
      model: result.model,
      sourceCount: news.length,
      days,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

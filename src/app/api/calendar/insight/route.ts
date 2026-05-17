import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 in-memory

const cache = new Map<string, { ts: number; text: string }>();

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

type StatsPayload = {
  window: string;
  total: number;
  categories: Record<string, number>;
  calendars: Record<string, number>;
  busiestDay: { day: string; count: number };
  busiestSlot: { slot: string; count: number };
  topPeople: Array<{ name: string; count: number }>;
  specialPct: number;
  weekendCount: number;
  monthly?: Array<{ label: string; total: number; isCurrent?: boolean }>;
};

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "no_api_key" }, { status: 503 });
  }
  let stats: StatsPayload;
  try {
    stats = (await req.json()) as StatsPayload;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const cacheKey = JSON.stringify(stats);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json({ text: hit.text, cached: true });
  }
  if (stats.total === 0) {
    return NextResponse.json({ text: "분석할 일정이 없습니다.", cached: false });
  }

  const prompt = `너는 박진호(뷰스컴퍼니 대표 · K-뷰티 MCN 운영) 의 캘린더 분석 어시스턴트다.
아래 통계를 보고 **2~3줄**, 한국어, 친근하지만 압축된 비즈니스 톤으로:
1줄째 — 핵심 패턴 한 문장 (예: "이번 달은 외부 미팅이 평소보다 많고...")
2~3줄째 — 구체적 액션 제안 (예: "수요일 오전을 deep work로 비워보세요")
마크다운/이모지/인사말 금지. 결과 문장만.

통계 (window=${stats.window}):
${JSON.stringify(stats, null, 2)}`;

  let r: Response;
  try {
    r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: "fetch_failed", detail: (e as Error).message }, { status: 502 });
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return NextResponse.json({ error: "anthropic_error", status: r.status, body: t.slice(0, 300) }, { status: 502 });
  }
  const data = (await r.json()) as { content?: Array<{ text?: string }> };
  const text = (data.content?.[0]?.text || "").trim();
  cache.set(cacheKey, { ts: Date.now(), text });
  return NextResponse.json({ text, cached: false });
}

// /api/finance/ai-analyze?month=2024-12 — Gemini Flash 기반
// Anthropic 키는 다른 서비스와 공유돼서 rate limit 자주 걸림. Gemini가 빠르고 안정적.

import { promises as fs } from "fs";
import path from "path";
import { loadKbTransactions, kbMonthlyTotals } from "@/lib/finance/kb-loader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_DIR = path.join(process.cwd(), "data", "ai-cache");

async function readCache(month: string) {
  try { return await fs.readFile(path.join(CACHE_DIR, `${month}.md`), "utf-8"); }
  catch { return null; }
}
async function writeCache(month: string, content: string) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, `${month}.md`), content, "utf-8");
}

function buildPrompt(month: string, monthTxs: Array<{ category: string; vendor: string; amount: number; subcategory?: string | null; date: string }>, allTotals: Array<{ month: string; total_man: number }>) {
  const total = monthTxs.reduce((s, t) => s + t.amount, 0);
  const byCategory = new Map<string, { total: number; count: number }>();
  const byVendor = new Map<string, { total: number; count: number }>();
  for (const t of monthTxs) {
    const c = byCategory.get(t.category) ?? { total: 0, count: 0 };
    c.total += t.amount; c.count += 1; byCategory.set(t.category, c);
    const v = byVendor.get(t.vendor) ?? { total: 0, count: 0 };
    v.total += t.amount; v.count += 1; byVendor.set(t.vendor, v);
  }
  const catLines = [...byCategory.entries()]
    .sort(([,a],[,b]) => b.total - a.total)
    .map(([k, v]) => `- ${k}: ₩${v.total.toLocaleString()} (${v.count}회)`).join("\n");
  const topVendors = [...byVendor.entries()]
    .sort(([,a],[,b]) => b.total - a.total).slice(0, 15)
    .map(([k, v]) => `- ${k}: ₩${v.total.toLocaleString()} (${v.count}회)`).join("\n");
  const monthIdx = allTotals.findIndex((m) => m.month === month);
  const prevMonth = monthIdx > 0 ? allTotals[monthIdx - 1] : null;
  const last6 = allTotals.slice(Math.max(0, monthIdx - 5), monthIdx + 1);
  const trendLine = last6.map((m) => `${m.month}: ₩${(m.total_man * 10000).toLocaleString()}`).join(", ");

  return `당신은 박진호님의 개인 재정 분석가입니다. 박진호님은 뷰스컴퍼니 대표(MCN 비라운드 운영)고 KB국민체크 4901(기업) 카드를 메인으로 씁니다. 출장·외식·골프·이자카야 등 회식 비중이 높습니다.

# 분석 대상: ${month}

총 지출: ₩${total.toLocaleString()} (${monthTxs.length}건)
전월 (${prevMonth?.month ?? "없음"}): ₩${prevMonth ? (prevMonth.total_man * 10000).toLocaleString() : "—"}
최근 6개월 trend: ${trendLine}

## 카테고리별 합계
${catLines}

## Top 15 가맹점
${topVendors}

# 작성 요구사항

**정량적 + 짧게**. 모든 줄에 반드시 숫자/금액/비율 포함. 추상 표현 금지 ("많다", "적다" X). 한국어 마크다운. 박진호님 호칭.

## 한 줄 요약
₩(총액)만 (전월 +/- 비율%). 가장 큰 카테고리 한 단어.

## 핵심 3개 (각 1줄, 모두 숫자 포함)
- Top 카테고리 ₩(금액)만 (전체 %, 전월 +/- %)
- 가장 큰 거래 1건: 가맹점 ₩(금액)
- 두 번째 큰 카테고리 ₩(금액)만 (% 차지)

## 액션 1개
구체적 절약 금액 (예: "X 줄이면 월 ₩Y 절약")

총 7줄 이내. 숫자 빠진 줄 금지.`;
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no text)";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const refresh = url.searchParams.get("refresh") === "1";
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ error: "month=YYYY-MM 필수" }, { status: 400 });
  }

  if (!refresh) {
    const cached = await readCache(month);
    if (cached) return Response.json({ month, cached: true, analysis: cached });
  }

  const txs = await loadKbTransactions();
  const monthTxs = txs.filter((t) => t.date.startsWith(month));
  if (monthTxs.length === 0) {
    return Response.json({ month, cached: false, analysis: `_이 달 KB 카드 거래 없음._` });
  }

  const totals = await kbMonthlyTotals();
  const prompt = buildPrompt(month, monthTxs, totals);
  try {
    const analysis = await callGemini(prompt);
    await writeCache(month, analysis);
    return Response.json({ month, cached: false, analysis });
  } catch (e) {
    return Response.json({ month, cached: false, error: String(e), analysis: `_AI 호출 실패: ${String(e).slice(0, 200)}_` }, { status: 500 });
  }
}

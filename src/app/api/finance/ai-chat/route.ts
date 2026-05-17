// POST /api/finance/ai-chat
// body: { month: "2024-12", messages: [{role, text}, ...] }
// 이전 분석 + 그 달 데이터 컨텍스트 위에 박진호님과 대화.

import { promises as fs } from "fs";
import path from "path";
import { loadKbTransactions } from "@/lib/finance/kb-loader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_DIR = path.join(process.cwd(), "data", "ai-cache");

async function readAnalysis(month: string) {
  try { return await fs.readFile(path.join(CACHE_DIR, `${month}.md`), "utf-8"); }
  catch { return null; }
}
async function saveAnalysis(month: string, content: string) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, `${month}.md`), content, "utf-8");
}

type ChatMsg = { role: "user" | "model"; text: string };

function buildContextSystem(month: string, monthTxs: Array<{ category: string; vendor: string; amount: number; date: string; subcategory?: string | null }>) {
  const total = monthTxs.reduce((s, t) => s + t.amount, 0);
  const byCat = new Map<string, number>();
  const byVendor = new Map<string, number>();
  for (const t of monthTxs) {
    byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
    byVendor.set(t.vendor, (byVendor.get(t.vendor) ?? 0) + t.amount);
  }
  const cat = [...byCat.entries()].sort(([,a],[,b]) => b-a).map(([k,v]) => `${k}: ₩${v.toLocaleString()}`).join(", ");
  const top = [...byVendor.entries()].sort(([,a],[,b]) => b-a).slice(0, 20).map(([k,v]) => `${k}: ₩${v.toLocaleString()}`).join(", ");
  return `당신은 박진호님(뷰스컴퍼니 대표, MCN 비라운드 운영)의 개인 재정 분석가입니다. 항상 매우 짧게 (3-5줄), 결론 우선, 한국어. 박진호님 호칭.

분석 대상: ${month}
총: ₩${total.toLocaleString()} (${monthTxs.length}건)
카테고리: ${cat}
Top 20 가맹점: ${top}

박진호님 요청에 따라:
- 카테고리 재분류 / 가맹점 정정 등 박진호님이 수정 요청하면, 새 분류 룰을 한 줄 제안 + 적용 후 영향 추정
- 특정 가맹점/거래에 대한 질문 답
- 분석 다시 써달라 하면 새로운 마크다운 분석 작성
- 절약 / 패턴 인사이트 추가 요청`;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { month, messages, save } = body as { month: string; messages: ChatMsg[]; save?: boolean };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ error: "month required" }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const txs = await loadKbTransactions();
  const monthTxs = txs.filter((t) => t.date.startsWith(month));
  const prev = await readAnalysis(month);
  const system = buildContextSystem(month, monthTxs);

  // Gemini contents 구조
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  // 첫 컨텍스트는 user role로 system + 이전 분석
  contents.push({ role: "user", parts: [{ text: `[시스템]\n${system}\n\n[이전 분석]\n${prev ?? "(아직 없음)"}` }] });
  contents.push({ role: "model", parts: [{ text: "네, 박진호님. 분석 데이터를 모두 파악했습니다. 무엇을 도와드릴까요?" }] });
  // 박진호님 대화 추가
  for (const m of messages) {
    contents.push({ role: m.role, parts: [{ text: m.text }] });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY missing" }, { status: 500 });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 4000,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return Response.json({ error: `Gemini ${r.status}: ${t.slice(0,300)}` }, { status: 500 });
  }
  const data = await r.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";

  // save=true 면 분석 캐시 덮어쓰기
  if (save && reply) {
    await saveAnalysis(month, reply);
  }

  return Response.json({ month, reply, saved: !!save });
}

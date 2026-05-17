// POST /api/finance/ai-vendor-guide
// body: { vendor, monthly, count, first_date, last_date, category, total }
// → AI가 어떤 회사/서비스인지 추측 + 해지 방법 안내
import { loadKbTransactions } from "@/lib/finance/kb-loader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json();
  const { vendor } = body as { vendor: string };
  if (!vendor) return Response.json({ error: "vendor required" }, { status: 400 });

  const txs = await loadKbTransactions();
  const items = txs.filter((t) => t.vendor === vendor).sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = items.reduce((s, t) => s + t.amount, 0);
  const recent5 = items.slice(0, 5).map((t) => `${t.date} ₩${t.amount.toLocaleString()} (${t.card})`).join(", ");

  const prompt = `당신은 박진호님(뷰스컴퍼니 대표)의 재정 비서입니다. 다음 가맹점이 어떤 회사인지 추측하고 해지 방법을 안내하세요.

# 가맹점 정보
- 이름: ${vendor}
- 거래 ${items.length}건, 누적 ₩${total.toLocaleString()}
- 첫 결제: ${items[items.length - 1]?.date ?? "?"} / 마지막: ${items[0]?.date ?? "?"}
- 최근 5건: ${recent5}
- 카테고리: ${items[0]?.category ?? "?"} > ${items[0]?.subcategory ?? "?"}
- 카드: ${[...new Set(items.map((t) => t.card))].join(", ")}

# 작성
짧고 정량적으로 (총 8줄 이내). 한국어 마크다운. 박진호님 호칭.

## 1. 추정: 어떤 회사/서비스인지 (1-2줄)
- 가맹점명/패턴/금액 기반 추측. 확실하면 단정, 불확실하면 "추정" 명시.

## 2. 박진호님 행동 추정 (1-2줄)
- 왜 이걸 결제했을 가능성 (출장? 구독? 자동결제?)

## 3. 해지 방법 (2-3줄)
- 정확한 앱/사이트/메뉴 경로 (예: "KB국민카드 앱 → MY → 자동결제 관리 → X 해지")
- 또는 직접 해당 서비스 사이트 (예: "naver.com 마이페이지 → 결제수단 관리")
- 연락처 (전화/이메일) 있으면 추가

## 4. 결정 추천 (1줄)
- "월 ₩X, 1년에 ₩Y. 추천: 해지" 또는 "유지" 결론.`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY missing" }, { status: 500 });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1500, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return Response.json({ error: `Gemini ${r.status}: ${t.slice(0, 300)}` }, { status: 500 });
  }
  const data = await r.json();
  const guide = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";
  return Response.json({ vendor, guide, count: items.length, total });
}

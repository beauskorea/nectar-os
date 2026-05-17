// /api/finance/kb-search?q=&card=&year=&category=&limit=200
// 가맹점 검색 + 필터 + 페이징.

import { loadKbTransactions } from "@/lib/finance/kb-loader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const card = url.searchParams.get("card");        // "KB국민체크 4901 (기업)" 등
  const year = url.searchParams.get("year");        // "2024"
  const month = url.searchParams.get("month");      // "2024-12"
  const category = url.searchParams.get("category"); // FinanceCategory
  const kind = url.searchParams.get("kind");        // biz / personal
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 1000);

  const txs = await loadKbTransactions();
  let items = txs;
  if (q) items = items.filter((t) => t.vendor.toLowerCase().includes(q));
  if (card) items = items.filter((t) => t.subcategory === card || (t.raw_text ?? "").includes(card));
  if (year) items = items.filter((t) => t.date.startsWith(year));
  if (month) items = items.filter((t) => t.date.startsWith(month));
  if (category) items = items.filter((t) => t.category === category);
  if (kind) items = items.filter((t) => t.business_or_personal === kind);

  const total = items.reduce((s, t) => s + t.amount, 0);
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  return Response.json({
    count: items.length,
    total,
    items: items.slice(0, limit),
    filters: { q, card, year, month, category, kind, limit },
  });
}

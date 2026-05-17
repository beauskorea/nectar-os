// /api/finance/kb-summary?month=2024-12 → MoneyKpi
// KB 카드 4년치 실데이터 기반.

import { loadKbTransactions, kbMonthlyTotals, listKbMonths, kbMonthlyTotalsExcludingHousing } from "@/lib/finance/kb-loader";
import { generateMonthlySummary } from "@/lib/finance/summary";
import { DEFAULT_BUDGET_KRW } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const allTxs = await loadKbTransactions();
  // housing 분리 — 일반 spent 에서 제외
  const housingTxs = allTxs.filter((t) => (t as unknown as { housing?: boolean }).housing);
  const txs = allTxs.filter((t) => !(t as unknown as { housing?: boolean }).housing);
  const totals = await kbMonthlyTotalsExcludingHousing();
  const months = await listKbMonths();
  const targetMonth = month && months.includes(month) ? month : months[months.length - 1];

  // Trend: 마지막 12개월
  const last12 = totals.slice(-12);

  const kpi = generateMonthlySummary({
    transactions: txs,
    monthLabel: targetMonth,
    budget: DEFAULT_BUDGET_KRW,
    monthlyTotalsManWon: last12,
    subscriptions: [],
    topCategoryNameOverrides: {
      "Food/Meeting": "식비/외식",
      "Personal": "일상",
      "Commerce": "쇼핑/커머스",
      "Travel/Global": "출장/여행",
      "SaaS/Subscription": "SaaS",
      "AI/LLM": "AI/툴",
    },
  });

  return Response.json({
    month: targetMonth,
    available_months: months,
    monthly_totals: totals,
    kpi,
    source: "kb_card_history",
    record_count: txs.length,
    housing_total: housingTxs.reduce((s, x) => s + x.amount, 0),
    subscriptions_monthly: txs.filter((x) => x.date.startsWith(targetMonth) && ["SaaS","스트리밍","광고","통신/공과금"].includes(x.category as string)).reduce((s, x) => s + x.amount, 0),
    subscriptions_monthly_items: txs.filter((x) => x.date.startsWith(targetMonth) && ["SaaS","스트리밍","광고","통신/공과금"].includes(x.category as string)).sort((a,b) => b.amount - a.amount).slice(0, 15).map((x) => ({ date: x.date, vendor: x.vendor, amount: x.amount, category: x.category })),
    subscriptions_annual: txs.filter((x) => ["SaaS","스트리밍","광고","통신/공과금"].includes(x.category as string)).reduce((s, x) => s + x.amount, 0),
    housing_monthly: housingTxs.filter((x) => x.date.startsWith(targetMonth)).reduce((s, x) => s + x.amount, 0),
    housing_monthly_count: housingTxs.filter((x) => x.date.startsWith(targetMonth)).length,
    housing_by_month: Object.fromEntries(
      Object.entries(
        housingTxs.reduce((acc: Record<string, number>, x) => {
          const m = x.date.slice(0, 7);
          acc[m] = (acc[m] ?? 0) + x.amount;
          return acc;
        }, {}),
      ).sort(([a],[b]) => a.localeCompare(b)),
    ),
    housing_top_this_month: housingTxs
      .filter((x) => x.date.startsWith(targetMonth))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((x) => ({ date: x.date, vendor: x.vendor, amount: x.amount })),
  });
}

// 넥타 — Telegram 명령어용 dispatcher
// /api/finance/query?q=expense_today | expense_month | ai_cost | infra_cost | subscriptions | burn_rate
//
// 응답 형식:
//   { q, month?, total, count, items?, breakdown?, text }
//
// `text` 는 Telegram 메시지로 그대로 사용 가능한 한국어 1-2줄 요약.

import {
  SAMPLE_TRANSACTIONS,
  SAMPLE_SUBSCRIPTIONS,
  expenseToday,
  expenseMonth,
  categoryCost,
  listSubscriptions,
  burnRate,
  DEFAULT_MONTH,
} from "@/lib/finance";

export const dynamic = "force-dynamic";

function won(n: number): string {
  if (n >= 1_000_000) return `₩${(n / 10_000).toFixed(0)}만`;
  if (n >= 10_000) return `₩${(n / 10_000).toFixed(1)}만`;
  return `₩${n.toLocaleString()}`;
}

type QueryKind =
  | "expense_today"
  | "expense_month"
  | "ai_cost"
  | "infra_cost"
  | "subscriptions"
  | "burn_rate";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "") as QueryKind;
  const month = url.searchParams.get("month") ?? DEFAULT_MONTH;
  const today = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  switch (q) {
    case "expense_today": {
      const r = expenseToday(SAMPLE_TRANSACTIONS, today);
      return Response.json({
        q,
        date: today,
        total: r.total,
        count: r.count,
        items: r.items,
        text: r.count === 0
          ? `오늘(${today}) 지출 내역 없음.`
          : `오늘(${today}) 지출 ${won(r.total)} · ${r.count}건`,
      });
    }
    case "expense_month": {
      const r = expenseMonth(SAMPLE_TRANSACTIONS, month);
      return Response.json({
        q,
        month,
        total: r.total,
        count: r.count,
        text: `${month} 누적 지출 ${won(r.total)} · ${r.count}건`,
      });
    }
    case "ai_cost": {
      const r = categoryCost(SAMPLE_TRANSACTIONS, "AI/LLM", month);
      return Response.json({
        q,
        month,
        total: r.total,
        count: r.count,
        items: r.items,
        text: `${month} AI/LLM 비용 ${won(r.total)} · ${r.count}건`,
      });
    }
    case "infra_cost": {
      const r = categoryCost(SAMPLE_TRANSACTIONS, "Infra/VPS", month);
      return Response.json({
        q,
        month,
        total: r.total,
        count: r.count,
        items: r.items,
        text: `${month} 인프라 비용 ${won(r.total)} · ${r.count}건`,
      });
    }
    case "subscriptions": {
      const derived = listSubscriptions(SAMPLE_TRANSACTIONS);
      const monthlyTotal = SAMPLE_SUBSCRIPTIONS.reduce((s, x) => s + x.monthly, 0);
      const lines = SAMPLE_SUBSCRIPTIONS.map((s) => `• ${s.name} ${s.amount}`).join("\n");
      return Response.json({
        q,
        monthly_total_krw: monthlyTotal,
        subscriptions: SAMPLE_SUBSCRIPTIONS,
        derived_from_transactions: derived,
        text: `구독 합계 ${won(monthlyTotal)}/mo\n${lines}`,
      });
    }
    case "burn_rate": {
      const r = burnRate(SAMPLE_TRANSACTIONS, month);
      return Response.json({
        q,
        ...r,
        text: `${month} 일평균 ${won(r.burn_per_day)} · 월말 예상 ${won(r.projected_month_end)}`,
      });
    }
    default:
      return Response.json(
        {
          error: "unknown query",
          allowed: [
            "expense_today",
            "expense_month",
            "ai_cost",
            "infra_cost",
            "subscriptions",
            "burn_rate",
          ],
        },
        { status: 400 },
      );
  }
}

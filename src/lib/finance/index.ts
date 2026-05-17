// 진호 OS — finance barrel export
// /money 페이지와 API route 들이 여기서 import.

export * from "./types";
export * from "./classifier";
export * from "./parser";
export * from "./summary";
export * from "./gmail";
export {
  SAMPLE_TRANSACTIONS,
  SAMPLE_SUBSCRIPTIONS,
  MONTHLY_TOTALS_MAN_WON,
  LUMP_SUM_TRANSACTIONS,
} from "./transactions";
export { REAL_MONTHLY_DATA, realMonth } from "./real-monthly";

import { SAMPLE_TRANSACTIONS, SAMPLE_SUBSCRIPTIONS, LUMP_SUM_TRANSACTIONS } from "./transactions";
import { REAL_MONTHLY_DATA, realMonth } from "./real-monthly";
import { generateMonthlySummary } from "./summary";
import type { MoneyKpi, Transaction } from "./types";

export const DEFAULT_BUDGET_KRW = 4_500_000;
export const DEFAULT_MONTH = "2026-05";

// 토스 실데이터(REAL_MONTHLY_DATA) 기반 5개월 trend (만원 단위)
function realTrendManWon(): Array<{ month: string; total_man: number }> {
  return REAL_MONTHLY_DATA.map((m) => ({
    month: m.month,
    total_man: Math.round(m.total_spent / 10_000),
  }));
}

// 5월 외 다른 월은 일별 합계만 알려져 있음 → daily aggregate 1건씩을 Transaction 으로 변환.
// 카테고리는 모름 → "Unknown" (UI Top 에서 필터됨), 가맹점은 "{날짜} 합계".
function dailyAggregatesAsTransactions(monthLabel: string): Transaction[] {
  const m = realMonth(monthLabel);
  if (!m) return [];
  return m.daily
    .filter((d) => d.spent > 0)
    .map((d) => ({
      id: `daily-${d.date}`,
      date: d.date,
      vendor: `${d.date.slice(5)} 일별 합계`,
      amount: d.spent,
      currency: "KRW" as const,
      category: "Unknown" as const,
      subcategory: undefined,
      business_or_personal: "personal" as const,
      recurring: false,
      source: "toss_export" as const,
      raw_text: `토스 가계부 일별 합계 (이체 제외): ${d.date} -${d.spent.toLocaleString()}원`,
      created_at: new Date(d.date + "T12:00:00+09:00").toISOString(),
    }));
}

// 이체로 분리된 LUMP_SUM 거래도 Transaction 으로 변환 — bigTransactions 카드용
function lumpSumAsTransactions(monthLabel: string): Transaction[] {
  const m = realMonth(monthLabel);
  if (!m) return [];
  return m.lumpSumTransfers.map((t, i) => ({
    id: `lump-${monthLabel}-${i}`,
    date: t.date,
    vendor: t.note,
    amount: t.amount,
    currency: "KRW" as const,
    category: "Unknown" as const,
    subcategory: "이체",
    business_or_personal: "biz" as const,
    recurring: false,
    source: "toss_export" as const,
    raw_text: t.note,
    created_at: new Date(t.date + "T12:00:00+09:00").toISOString(),
  }));
}

export function getDefaultMoneyKpi(monthLabel: string = DEFAULT_MONTH): MoneyKpi {
  const trend = realTrendManWon();

  if (monthLabel === "2026-05") {
    // 5월은 mock 19건 (카테고리/가맹점 디테일) 기반
    return generateMonthlySummary({
      transactions: SAMPLE_TRANSACTIONS,
      extraBigTransactions: LUMP_SUM_TRANSACTIONS,
      monthLabel,
      budget: DEFAULT_BUDGET_KRW,
      monthlyTotalsManWon: trend,
      subscriptions: SAMPLE_SUBSCRIPTIONS,
      topCategoryNameOverrides: {
        "AI/LLM": "구독 (AI/툴)",
        "Infra/VPS": "VPS·인프라",
        "Team Ops": "팀 운영",
        "Food/Meeting": "식비/외식",
        "Personal": "일상",
        "SaaS/Subscription": "SaaS",
        "Commerce": "커머스/팝업",
      },
    });
  }

  // 1~4월: 토스 일별 합계 기반 (카테고리 분석 X, 큰 거래만 노출)
  const daily = dailyAggregatesAsTransactions(monthLabel);
  const lump = lumpSumAsTransactions(monthLabel);
  return generateMonthlySummary({
    transactions: daily,
    extraBigTransactions: lump,
    monthLabel,
    budget: DEFAULT_BUDGET_KRW,
    monthlyTotalsManWon: trend,
    subscriptions: SAMPLE_SUBSCRIPTIONS,
  });
}

// /money 페이지가 월 셀렉터에 띄울 월 목록 (오래된 것 → 최신)
export function availableMonths(): string[] {
  return REAL_MONTHLY_DATA.map((m) => m.month);
}

// 진호 OS — Transaction[] → MoneyKpi (UI 호환 모양) + 추가 통계
// /money 페이지가 import 해서 쓰는 진입점.

import { CATEGORY_LABEL_KO } from "./classifier";
import type {
  Transaction,
  MoneyKpi,
  FinanceCategory,
  FinanceKind,
} from "./types";

// "2026-05-12" → "2026-05"
function monthOf(date: string): string {
  return date.slice(0, 7);
}

function sum(arr: number[]): number {
  return arr.reduce((s, n) => s + n, 0);
}

export interface MonthSummaryInput {
  transactions: Transaction[];
  monthLabel: string;       // "2026-05"
  budget: number;
  monthlyTotalsManWon: Array<{ month: string; total_man: number }>; // 6개월 trend 시드
  subscriptions: MoneyKpi["subscriptions"];
  topCategoryNameOverrides?: Partial<Record<FinanceCategory, string>>;
  /**
   * Personal 카테고리는 subcategory 단위(교통/건강/마트 등)로 쪼개서 표시.
   * 기본 true — 기존 /money UI 의 "교통", "건강/운동" 라벨을 살림.
   */
  splitPersonalBySubcategory?: boolean;
  /** Top 카테고리에는 안 들어가지만 큰거래 카드에는 보여줘야 하는 lump-sum 거래. */
  extraBigTransactions?: Transaction[];
}

// 카테고리 → 표시 이름 (override + 기본 라벨)
function labelFor(
  cat: FinanceCategory,
  overrides: MonthSummaryInput["topCategoryNameOverrides"],
): string {
  return overrides?.[cat] ?? CATEGORY_LABEL_KO[cat] ?? cat;
}

// group key — Personal 은 subcategory level
function groupKey(t: Transaction, split: boolean): string {
  if (split && t.category === "Personal" && t.subcategory) return `Personal:${t.subcategory}`;
  return t.category;
}

// group key → 표시 라벨
function labelForKey(
  key: string,
  overrides: MonthSummaryInput["topCategoryNameOverrides"],
): string {
  if (key.startsWith("Personal:")) return key.slice("Personal:".length);
  return labelFor(key as FinanceCategory, overrides);
}

// 한 카테고리 안에 biz / personal 이 섞이는 경우, 큰 쪽 kind 로 라벨링
function dominantKind(txs: Transaction[]): FinanceKind {
  let biz = 0;
  let personal = 0;
  for (const t of txs) {
    if (t.business_or_personal === "biz") biz += t.amount;
    else personal += t.amount;
  }
  return biz >= personal ? "biz" : "personal";
}

// 큰 거래 추출 — amount desc top N
function pickBigTransactions(txs: Transaction[], n: number): MoneyKpi["bigTransactions"] {
  return [...txs]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n)
    .map((t) => ({
      date: t.date.slice(5).replace("-", "/"), // "MM/DD"
      merchant: t.source_email_subject?.includes("invoice")
        ? `${t.vendor} ${t.source_email_subject.replace(/^\[[^\]]+\]\s*/, "")}`.trim()
        : t.vendor,
      amount: t.amount,
      kind: t.business_or_personal,
    }));
}

// 메인 — moneyKpi 호환 객체 생성
export function generateMonthlySummary(input: MonthSummaryInput): MoneyKpi {
  const {
    transactions,
    monthLabel,
    budget,
    monthlyTotalsManWon,
    subscriptions,
    topCategoryNameOverrides,
    splitPersonalBySubcategory = true,
  } = input;

  const thisMonth = transactions.filter((t) => monthOf(t.date) === monthLabel);
  const spent = sum(thisMonth.map((t) => t.amount));

  // group key 기준 (Personal 은 subcategory 단위)
  const byKey = new Map<string, Transaction[]>();
  for (const t of thisMonth) {
    const k = groupKey(t, splitPersonalBySubcategory);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(t);
  }

  const topCategories = [...byKey.entries()]
    .map(([key, txs]) => {
      const amount = sum(txs.map((t) => t.amount));
      return {
        name: labelForKey(key, topCategoryNameOverrides),
        amount,
        share: spent > 0 ? Math.round((amount / spent) * 100) : 0,
        kind: dominantKind(txs),
      };
    })
    .sort((a, b) => b.amount - a.amount)
    // 미분류 / 단발성 Commerce(보증금/팝업) 는 Top 에 노출하지 않음 — bigTransactions 에서 충분히 표시됨
    .filter(
      (c) =>
        c.name !== CATEGORY_LABEL_KO["Unknown"] &&
        c.name !== CATEGORY_LABEL_KO["Commerce"] &&
        c.name !== "커머스/팝업",
    )
    .slice(0, 6);

  // trend — 시드 배열에서 이번 달은 실제 spent 로 덮어쓰기
  const trendMonths = monthlyTotalsManWon.map((m) => m.month);
  const trend = monthlyTotalsManWon.map((m) =>
    m.month === monthLabel ? Math.round(spent / 10_000) : m.total_man,
  );

  // 큰 거래 — 이번 달 거래 + lump-sum (Modash 분기결제 등) 합쳐서 큰 순서 4개
  const bigPool = [...thisMonth];
  if (input.extraBigTransactions) {
    for (const t of input.extraBigTransactions) {
      if (monthOf(t.date) === monthLabel) bigPool.push(t);
    }
  }
  const bigTransactions = pickBigTransactions(bigPool, 4);

  // 추가 통계
  const prev = monthlyTotalsManWon[monthlyTotalsManWon.length - 2];
  const prevMonthDelta =
    prev && prev.total_man > 0
      ? (Math.round(spent / 10_000) - prev.total_man) / prev.total_man
      : undefined;

  // burn rate — 이번 달 일평균 (오늘까지의 일자 기준; 안전하게 monthLabel 기준 일수)
  const today = new Date();
  const [yStr, mStr] = monthLabel.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const isCurrent = today.getFullYear() === y && today.getMonth() + 1 === m;
  const daysIn = new Date(y, m, 0).getDate();
  const daysSoFar = isCurrent ? today.getDate() : daysIn;
  const burnRatePerDay = daysSoFar > 0 ? Math.round(spent / daysSoFar) : 0;
  const projectedMonthEnd = burnRatePerDay * daysIn;

  return {
    monthLabel,
    income: 0,
    spent,
    budget,
    topCategories,
    trend,
    trendMonths,
    subscriptions,
    bigTransactions,
    prevMonthDelta,
    burnRatePerDay,
    projectedMonthEnd,
  };
}

// Telegram 명령어용 헬퍼들 ────────────────────────────────────────

export function expenseToday(transactions: Transaction[], today: string = new Date().toISOString().slice(0, 10)) {
  const items = transactions.filter((t) => t.date === today);
  return {
    date: today,
    count: items.length,
    total: sum(items.map((t) => t.amount)),
    items,
  };
}

export function expenseMonth(transactions: Transaction[], monthLabel: string) {
  const items = transactions.filter((t) => monthOf(t.date) === monthLabel);
  return {
    month: monthLabel,
    count: items.length,
    total: sum(items.map((t) => t.amount)),
    items,
  };
}

export function categoryCost(
  transactions: Transaction[],
  category: FinanceCategory,
  monthLabel?: string,
) {
  let items = transactions.filter((t) => t.category === category);
  if (monthLabel) items = items.filter((t) => monthOf(t.date) === monthLabel);
  return {
    category,
    month: monthLabel,
    count: items.length,
    total: sum(items.map((t) => t.amount)),
    items,
  };
}

export function listSubscriptions(transactions: Transaction[]) {
  const seen = new Map<string, Transaction>();
  for (const t of transactions) {
    if (!t.recurring) continue;
    const existing = seen.get(t.vendor);
    if (!existing || existing.date < t.date) seen.set(t.vendor, t);
  }
  return [...seen.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((t) => ({
      vendor: t.vendor,
      category: t.category,
      kind: t.business_or_personal,
      latest_amount: t.amount,
      latest_date: t.date,
    }));
}

export function burnRate(transactions: Transaction[], monthLabel: string, today: Date = new Date()) {
  const thisMonth = transactions.filter((t) => monthOf(t.date) === monthLabel);
  const spent = sum(thisMonth.map((t) => t.amount));
  const [yStr, mStr] = monthLabel.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const isCurrent = today.getFullYear() === y && today.getMonth() + 1 === m;
  const daysIn = new Date(y, m, 0).getDate();
  const daysSoFar = isCurrent ? today.getDate() : daysIn;
  const perDay = daysSoFar > 0 ? Math.round(spent / daysSoFar) : 0;
  return {
    month: monthLabel,
    spent,
    days_so_far: daysSoFar,
    days_in_month: daysIn,
    burn_per_day: perDay,
    projected_month_end: perDay * daysIn,
  };
}

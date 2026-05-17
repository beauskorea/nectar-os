// 진호 OS — KB 카드 4년치 거래 로더 (v2 — 한글 카테고리 그대로)

import { promises as fs } from "fs";
import path from "path";
import type { Transaction, FinanceCategory, FinanceKind } from "./types";

interface KbRecord {
  date: string;
  time: string;
  ts: number;
  amount: number;
  vendor: string;
  card: string;
  card_last4: string;
  card_kind: string;
  action: "use" | "cancel";
  category: string;
  subcategory: string | null;
  business_or_personal: "biz" | "personal";
}

let _cache: Transaction[] | null = null;

export async function loadKbTransactions(): Promise<Transaction[]> {
  if (_cache) return _cache;
  const jsonPath = path.join(process.cwd(), "data", "kb-card-history.json");
  const raw = await fs.readFile(jsonPath, "utf-8");
  const records: KbRecord[] = JSON.parse(raw);
  _cache = records.map((r): Transaction => ({
    id: `kb-${r.ts}`,
    date: r.date,
    vendor: r.vendor,
    amount: r.amount,
    currency: "KRW",
    // 한글 카테고리를 그대로 사용 (FinanceCategory enum 우회 — string으로 처리)
    category: (r.category ?? "미분류") as FinanceCategory,
    subcategory: r.subcategory ?? r.card,
    business_or_personal: r.business_or_personal as FinanceKind,
    recurring: false,
    source: "gmail_card_approval",
    raw_text: `[${r.card}] ${r.date} ${r.time} ${r.amount.toLocaleString()}원 ${r.vendor}`,
    created_at: new Date(r.ts).toISOString(),
    housing: (r as unknown as { housing?: boolean }).housing,
  }));
  return _cache;
}

export async function listKbMonths(): Promise<string[]> {
  const txs = await loadKbTransactions();
  const set = new Set<string>();
  for (const t of txs) set.add(t.date.slice(0, 7));
  return [...set].sort();
}

export async function kbMonthlyTotals(): Promise<Array<{ month: string; total_man: number }>> {
  const txs = await loadKbTransactions();
  const sums = new Map<string, number>();
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    sums.set(m, (sums.get(m) ?? 0) + t.amount);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total_man: Math.round(total / 10_000) }));
}


export async function kbMonthlyTotalsExcludingHousing(): Promise<Array<{ month: string; total_man: number }>> {
  const txs = await loadKbTransactions();
  const sums = new Map<string, number>();
  for (const t of txs) {
    if ((t as unknown as { housing?: boolean }).housing) continue;
    const m = t.date.slice(0, 7);
    sums.set(m, (sums.get(m) ?? 0) + t.amount);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total_man: Math.round(total / 10_000) }));
}

// /api/finance/kb-yearly → 연도별 합계 + 월별
import { loadKbTransactions } from "@/lib/finance/kb-loader";

export const dynamic = "force-dynamic";

export async function GET() {
  const txs = await loadKbTransactions();
  const byYear = new Map<string, { year: string; total: number; count: number; byMonth: Map<string, number>; byCategory: Map<string, number> }>();
  for (const t of txs) {
    const y = t.date.slice(0, 4);
    const m = t.date.slice(0, 7);
    let row = byYear.get(y);
    if (!row) {
      row = { year: y, total: 0, count: 0, byMonth: new Map(), byCategory: new Map() };
      byYear.set(y, row);
    }
    row.total += t.amount;
    row.count += 1;
    row.byMonth.set(m, (row.byMonth.get(m) ?? 0) + t.amount);
    row.byCategory.set(t.category, (row.byCategory.get(t.category) ?? 0) + t.amount);
  }
  return Response.json({
    years: [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year)).map((r) => ({
      year: r.year,
      total: r.total,
      count: r.count,
      monthly: [...r.byMonth.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([m, v]) => ({ month: m, total: v })),
      categories: [...r.byCategory.entries()].sort(([,a],[,b]) => b-a).map(([k, v]) => ({ category: k, total: v })),
    })),
  });
}

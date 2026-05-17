// /api/finance/kb-vendors?year=  → 가맹점별 누적 Top
import { loadKbTransactions } from "@/lib/finance/kb-loader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = url.searchParams.get("year");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const txs = await loadKbTransactions();
  const filtered = year ? txs.filter((t) => t.date.startsWith(year)) : txs;
  const map = new Map<string, { vendor: string; total: number; count: number; first: string; last: string }>();
  for (const t of filtered) {
    const cur = map.get(t.vendor) ?? { vendor: t.vendor, total: 0, count: 0, first: t.date, last: t.date };
    cur.total += t.amount;
    cur.count += 1;
    if (t.date < cur.first) cur.first = t.date;
    if (t.date > cur.last) cur.last = t.date;
    map.set(t.vendor, cur);
  }
  const top = [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
  return Response.json({ year, vendor_count: map.size, top });
}

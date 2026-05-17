import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const STORE = path.join(process.cwd(), "data", "expenses.json");

type Tx = {
  id: string;
  ts: number;
  date: string;        // YYYY-MM-DD (KST)
  kind: "personal" | "biz";
  category: string;
  amount: number;      // KRW
  note?: string;
};

type Store = {
  transactions: Tx[];
  budget: Record<string, number>; // {"2026-05": 4_500_000}
};

async function read(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      transactions: parsed.transactions ?? [],
      budget: parsed.budget ?? {},
    };
  } catch {
    return { transactions: [], budget: {} };
  }
}

async function write(s: Store) {
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(s, null, 2), "utf-8");
}

function todayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  return kst.toISOString().slice(0, 10);
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? todayKst().slice(0, 7);
  const store = await read();
  const monthTx = store.transactions.filter((t) => monthOf(t.date) === month);

  const byCategory: Record<string, number> = {};
  const byKind: Record<string, number> = { personal: 0, biz: 0 };
  let total = 0;
  let todayTotal = 0;
  const today = todayKst();
  for (const t of monthTx) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + t.amount;
    byKind[t.kind] = (byKind[t.kind] ?? 0) + t.amount;
    total += t.amount;
    if (t.date === today) todayTotal += t.amount;
  }
  const topCategories = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return NextResponse.json({
    month,
    today,
    budget: store.budget[month] ?? 0,
    total,
    todayTotal,
    byKind,
    topCategories,
    transactions: monthTx.sort((a, b) => b.ts - a.ts),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.amount !== "number" || body.amount <= 0) {
    return NextResponse.json({ error: "amount required" }, { status: 400 });
  }
  const tx: Tx = {
    id: crypto.randomUUID(),
    ts: Math.floor(Date.now() / 1000),
    date: typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : todayKst(),
    kind: body.kind === "biz" ? "biz" : "personal",
    category: typeof body.category === "string" && body.category.trim()
      ? body.category.trim()
      : "기타",
    amount: Math.round(body.amount),
    note: typeof body.note === "string" ? body.note.slice(0, 200) : undefined,
  };
  const s = await read();
  s.transactions.push(tx);
  await write(s);
  return NextResponse.json({ ok: true, tx });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const s = await read();
  const before = s.transactions.length;
  s.transactions = s.transactions.filter((t) => t.id !== id);
  await write(s);
  return NextResponse.json({ ok: true, removed: before - s.transactions.length });
}

export async function PATCH(req: NextRequest) {
  // Budget update: PATCH /api/finance/expense  body={ month: "2026-05", budget: 4500000 }
  const body = await req.json().catch(() => null);
  if (!body?.month || typeof body.budget !== "number") {
    return NextResponse.json({ error: "month + budget required" }, { status: 400 });
  }
  const s = await read();
  s.budget[body.month] = Math.round(body.budget);
  await write(s);
  return NextResponse.json({ ok: true });
}

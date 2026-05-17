import { NextRequest } from "next/server";
import { readFile, writeFile } from "fs/promises";

const SUPP = "/root/projects/nectar-os/public/partners_supplement.json";
const LEDGER = "/root/projects/nectar-os/data/partner_ingest_seen.json";
const REJECTED = "/root/projects/nectar-os/data/partner_rejected.json";

// POST { name: string, reason?: string }
// supplement.additional_partners 에서 해당 partner 제거
// + rejected ledger 에 기록 (재인입 방지)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body?.name || "").trim();
    if (!name) {
      return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
    }
    const reason = String(body?.reason || "사용자 reject");

    // 1) supplement 에서 partner 제거
    const supp = JSON.parse(await readFile(SUPP, "utf-8"));
    const before = (supp.additional_partners || []).length;
    supp.additional_partners = (supp.additional_partners || []).filter(
      (p: { name: string }) => p.name !== name,
    );
    const removed = before - supp.additional_partners.length;
    supp.updatedAt = Math.floor(Date.now() / 1000);
    await writeFile(SUPP, JSON.stringify(supp, null, 2));

    // 2) rejected ledger 기록 — 같은 이름 다시 인입되지 않도록
    let rejected: { rejected: Array<{ name: string; reason: string; at: number }> };
    try {
      rejected = JSON.parse(await readFile(REJECTED, "utf-8"));
    } catch {
      rejected = { rejected: [] };
    }
    rejected.rejected.push({ name, reason, at: Math.floor(Date.now() / 1000) });
    await writeFile(REJECTED, JSON.stringify(rejected, null, 2));

    return new Response(
      JSON.stringify({ ok: true, removed, name, rejected_count: rejected.rejected.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e: unknown) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500 },
    );
  }
}

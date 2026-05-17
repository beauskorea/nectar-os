import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/ceo_mail.db";
const PERPLEXITY_MODEL = "sonar-pro";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const MAX_BODY = 1500;
const MAX_NEW_PER_REFRESH = 8;

const SYSTEM = [
  "너는 한국어 메일을 보고 브랜드 협업/광고 제안인지 판단하고 정보를 추출하는 분류기다.",
  "반드시 JSON만 출력. 다른 텍스트·머리말·꼬리말 금지.",
  "",
  "스키마:",
  "{",
  "  \"is_brand_proposal\": true|false,",
  "  \"brand\": \"브랜드/회사명 또는 null\",",
  "  \"budget\": \"예산/단가/광고비 표현 또는 null (예: '월 300만원', '편당 50만원', 'TBD')\",",
  "  \"conditions\": \"핵심 조건 한 줄 또는 null (예: '인스타 릴스 2건+스토리 3건')\",",
  "  \"deadline\": \"기한/캠페인 기간 또는 null\",",
  "  \"summary\": \"한 줄 요약 (30자 이내)\"",
  "}",
  "",
  "판단 기준:",
  "- 브랜드 협업/광고/PPL/콘텐츠 제휴/시딩 제안 메일이면 true",
  "- 단순 안내·뉴스레터·내부 메일·이미 진행 중인 클라이언트 후속 메일이면 false",
  "- 정보가 본문에 없으면 null. 추측 금지.",
].join("\n");

function runPython(args: string[], timeoutMs = 30000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, out, err });
    });
  });
}

const FIND_CANDIDATES_PY = `import sqlite3, json, sys
db = sys.argv[1]
limit = int(sys.argv[2])
conn = sqlite3.connect(db, timeout=30)
conn.row_factory = sqlite3.Row
KW = ['예산','단가','광고비','캠페인비','협업','제안','광고','PPL','콘텐츠 제휴','seeding','시딩','광고비용','광고 단가','rfp','RFP','budget','fee','offer','collab','sponsor']
existing = {r['message_id'] for r in conn.execute("SELECT message_id FROM brand_proposals").fetchall()}
rows = conn.execute("""
  SELECT message_id, date_ts, from_name, from_addr, subject, snippet, body_full, ai_category
  FROM messages
  WHERE trashed_at IS NULL
    AND date_ts >= strftime('%s','now','-30 days')
    AND (ai_category IN ('sales','urgent') OR ai_category IS NULL)
  ORDER BY date_ts DESC
""").fetchall()
out = []
for r in rows:
    if r['message_id'] in existing:
        continue
    text = ((r['subject'] or '') + ' ' + (r['snippet'] or '') + ' ' + (r['body_full'] or '')[:2000]).lower()
    if not any(k.lower() in text for k in KW):
        continue
    out.append({
      'message_id': r['message_id'],
      'date_ts': r['date_ts'],
      'from': r['from_name'] or r['from_addr'] or '',
      'subject': r['subject'] or '',
      'body': (r['body_full'] or r['snippet'] or '')[:1500],
      'category': r['ai_category'],
    })
    if len(out) >= limit:
        break
sys.stdout.write(json.dumps(out, ensure_ascii=False))
`;

const LIST_CACHED_PY = `import sqlite3, json, sys
db = sys.argv[1]
conn = sqlite3.connect(db, timeout=30)
conn.row_factory = sqlite3.Row
rows = conn.execute("""
  SELECT message_id, date_ts, source_subject, source_sender, brand, budget, conditions, deadline, summary, status, model, created_at
  FROM brand_proposals
  WHERE date_ts >= strftime('%s','now','-30 days')
  ORDER BY date_ts DESC LIMIT 50
""").fetchall()
sys.stdout.write(json.dumps([dict(r) for r in rows], ensure_ascii=False))
`;

const INSERT_PY = `import sqlite3, json, sys
db = sys.argv[1]
payload = json.loads(sys.argv[2])
conn = sqlite3.connect(db, timeout=30)
for p in payload:
    conn.execute("""
      INSERT OR REPLACE INTO brand_proposals
        (message_id, date_ts, source_subject, source_sender, brand, budget, conditions, deadline, summary, model, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,strftime('%s','now'))
    """, (p['message_id'], p['date_ts'], p['source_subject'], p['source_sender'],
          p['brand'], p['budget'], p['conditions'], p['deadline'], p['summary'], p['model']))
conn.commit()
sys.stdout.write(json.dumps({'inserted': len(payload)}))
`;

type Candidate = { message_id: string; date_ts: number; from: string; subject: string; body: string; category: string | null };
type Extracted = { is_brand_proposal: boolean; brand: string | null; budget: string | null; conditions: string | null; deadline: string | null; summary: string };

async function callPerplexity(apiKey: string, userMsg: string): Promise<string> {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
      max_tokens: 400,
      temperature: 0.1,
    }),
  });
  if (!r.ok) throw new Error(`perplexity ${r.status}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic(apiKey: string, userMsg: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const j = (await r.json()) as { content: Array<{ type: string; text?: string }> };
  return j.content.filter((c) => c.type === "text" && c.text).map((c) => c.text as string).join("").trim();
}

function parseJsonLoose(s: string): Extracted | null {
  // Strip code fences and find first {...}
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Extracted;
  } catch {
    return null;
  }
}

function buildPrompt(c: Candidate): string {
  return [
    `From: ${c.from}`,
    `Subject: ${c.subject}`,
    `Category: ${c.category || "unclassified"}`,
    ``,
    `--- 본문 ---`,
    c.body.replace(/\s+/g, " ").slice(0, MAX_BODY),
  ].join("\n");
}

async function listCached() {
  const r = await runPython(["-c", LIST_CACHED_PY, DB_PATH]);
  if (!r.ok) throw new Error(`list failed: ${r.err}`);
  return JSON.parse(r.out);
}

export async function GET() {
  try {
    return NextResponse.json({ proposals: await listCached() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(Math.max(body.limit || MAX_NEW_PER_REFRESH, 1), 20);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const preferAnthropic = !!anthropicKey && anthropicKey.startsWith("sk-ant-api");
  if (!preferAnthropic && !perplexityKey) {
    return NextResponse.json({ error: "no API key" }, { status: 500 });
  }

  const fr = await runPython(["-c", FIND_CANDIDATES_PY, DB_PATH, String(limit)]);
  if (!fr.ok) return NextResponse.json({ error: `candidates: ${fr.err}` }, { status: 500 });
  const candidates = JSON.parse(fr.out) as Candidate[];

  if (candidates.length === 0) {
    return NextResponse.json({ added: 0, proposals: await listCached() });
  }

  const t0 = Date.now();
  const modelUsed = preferAnthropic ? ANTHROPIC_MODEL : PERPLEXITY_MODEL;
  const toInsert: Array<{
    message_id: string;
    date_ts: number;
    source_subject: string;
    source_sender: string;
    brand: string | null;
    budget: string | null;
    conditions: string | null;
    deadline: string | null;
    summary: string;
    model: string;
  }> = [];

  let skipped = 0;
  for (const c of candidates) {
    try {
      const text = preferAnthropic
        ? await callAnthropic(anthropicKey!, buildPrompt(c))
        : await callPerplexity(perplexityKey!, buildPrompt(c));
      const parsed = parseJsonLoose(text);
      if (!parsed) { skipped++; continue; }
      if (!parsed.is_brand_proposal) { skipped++; continue; }
      toInsert.push({
        message_id: c.message_id,
        date_ts: c.date_ts,
        source_subject: c.subject,
        source_sender: c.from,
        brand: parsed.brand,
        budget: parsed.budget,
        conditions: parsed.conditions,
        deadline: parsed.deadline,
        summary: parsed.summary || "",
        model: modelUsed,
      });
    } catch {
      skipped++;
    }
  }

  if (toInsert.length > 0) {
    const ir = await runPython(["-c", INSERT_PY, DB_PATH, JSON.stringify(toInsert)], 30000);
    if (!ir.ok) return NextResponse.json({ error: `insert: ${ir.err}` }, { status: 500 });
  }

  return NextResponse.json({
    added: toInsert.length,
    skipped,
    examined: candidates.length,
    elapsed_ms: Date.now() - t0,
    model: modelUsed,
    proposals: await listCached(),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/ceo_mail.db";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const PERPLEXITY_MODEL = "sonar-pro";
const MAX_BODY_PER_MSG = 1000;
const MAX_MSGS = 25;

const SYSTEM = [
  "너는 박진호(뷰스컴퍼니 대표)의 메일 비서다.",
  "그날(또는 지정 일자) 받은 메일 데이터와 캐시된 일일 요약이 컨텍스트로 주어진다.",
  "박진호의 질문에 한국어로 정확하고 간결하게 답한다.",
  "",
  "규칙:",
  "- 본문에 없는 사실 만들지 말 것. 없으면 '본문에 없음'.",
  "- 길게 쓰지 말 것. 한 문장 또는 불릿 3개 이내.",
  "- 영문 메일도 한국어로 요약.",
  "- 마크다운 헤더 # 금지.",
].join("\n");

function runPython(args: string[], timeoutMs = 20000): Promise<{ ok: boolean; out: string; err: string }> {
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

const FETCH_PY = `import sqlite3, json, sys
db, date = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db, timeout=10)
conn.row_factory = sqlite3.Row
rows = conn.execute("""
  SELECT from_name, from_addr, subject, body_full, snippet, ai_category, priority
  FROM messages
  WHERE trashed_at IS NULL
    AND date(date_ts, 'unixepoch', '+9 hours') = ?
  ORDER BY date_ts DESC
  LIMIT 40
""", (date,)).fetchall()
summary = conn.execute("SELECT summary FROM daily_summaries WHERE date=?", (date,)).fetchone()
sys.stdout.write(json.dumps({
  "messages": [dict(r) for r in rows],
  "summary": summary["summary"] if summary else None,
}, ensure_ascii=False))
`;

function isoToday(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

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
      max_tokens: 600,
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`perplexity ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic(apiKey: string, userMsg: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { content: Array<{ type: string; text?: string }> };
  return j.content.filter((c) => c.type === "text" && c.text).map((c) => c.text as string).join("").trim();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { question?: string; date?: string };
  const question = (body.question || "").trim();
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });
  const date = (body.date || isoToday()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const fr = await runPython(["-c", FETCH_PY, DB_PATH, date]);
  if (!fr.ok) return NextResponse.json({ error: `fetch: ${fr.err}` }, { status: 500 });
  const ctx = JSON.parse(fr.out) as {
    messages: Array<{ from_name: string | null; from_addr: string | null; subject: string | null; body_full: string | null; snippet: string | null; ai_category: string | null; priority: string | null }>;
    summary: string | null;
  };

  const lines: string[] = [
    `날짜: ${date} (KST)`,
    `메일 수: ${ctx.messages.length}건`,
  ];
  if (ctx.summary) {
    lines.push("");
    lines.push("--- 캐시된 일일 요약 ---");
    lines.push(ctx.summary);
  }
  lines.push("");
  lines.push("--- 메일 목록 ---");
  ctx.messages.slice(0, MAX_MSGS).forEach((m, i) => {
    const body = (m.body_full || m.snippet || "").replace(/\s+/g, " ").slice(0, MAX_BODY_PER_MSG);
    lines.push("");
    lines.push(`[${i + 1}] (${m.ai_category || "?"}/${m.priority || "-"}) ${m.from_name || m.from_addr}: ${m.subject || ""}`);
    if (body) lines.push(`    ${body}`);
  });
  lines.push("");
  lines.push("--- 박진호 질문 ---");
  lines.push(question);

  const userMsg = lines.join("\n");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const preferAnthropic = !!anthropicKey && anthropicKey.startsWith("sk-ant-api");
  if (!preferAnthropic && !perplexityKey) {
    return NextResponse.json({ error: "no API key" }, { status: 500 });
  }

  const t0 = Date.now();
  try {
    let answer: string;
    let modelUsed: string;
    if (preferAnthropic) {
      answer = await callAnthropic(anthropicKey!, userMsg);
      modelUsed = ANTHROPIC_MODEL;
    } else {
      answer = await callPerplexity(perplexityKey!, userMsg);
      modelUsed = PERPLEXITY_MODEL;
    }
    return NextResponse.json({
      date,
      question,
      answer,
      model: modelUsed,
      message_count: ctx.messages.length,
      elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

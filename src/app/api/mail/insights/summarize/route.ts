import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/ceo_mail.db";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const PERPLEXITY_MODEL = "sonar-pro";
const MAX_BODY_PER_MSG = 800;
const MAX_MSGS = 20;

const SYSTEM = [
  "너는 박진호(뷰스컴퍼니 대표)의 **30초 브리핑** 비서다.",
  "하루치 메일을 보고 CEO가 5초 안에 핵심을 잡을 수 있게 **극단적으로 짧게** 요약한다.",
  "",
  "❌ 절대 금지:",
  "- 직원 실무 (기획안 정리·메일 회신·이미지 첨부 등 — 정민주/조아해/신승아가 처리)",
  "- 뉴스레터/콘텐츠 레퍼런스/글쓰기 참고 인풋을 CEO 결정이나 중요 뉴스처럼 승격",
  "- 주간 체크리스트에 이미 올라갈 업무를 그대로 반복",
  "- 장문 설명, 하위 불릿, 조건 나열, 부가 정보",
  "- \"이런 상황이고 저런 협의 중\" 식 묘사",
  "",
  "✅ 출력 형식 (이것만, 추가 텍스트 금지):",
  "",
  "📊 <한 줄 (40자 이내). 오늘 회사 상황. 예: \"client 7건 진행, 신규 4·리스크 1\">",
  "",
  "🎯 핵심 3가지:",
  "- [신규/리스크/임박/결정] <브랜드명> — <한 줄, 30자 이내>",
  "- [신규/리스크/임박/결정] <브랜드명> — <한 줄>",
  "- [신규/리스크/임박/결정] <브랜드명> — <한 줄>",
  "",
  "⚠️ CEO 결정 필요: <한 줄 또는 \"없음\">",
  "",
  "규칙:",
  "- 전체 출력 400자 이내. 길면 잘라낸다.",
  "- 3개 핵심만 — 4개부터 무시. 가장 임팩트 큰 것 위주.",
  "- 직원이 알아서 처리할 일은 안 쓴다. 박진호만 결정할 수 있는 사안만.",
  "- 크넥처럼 쓰레드 글쓰기/콘텐츠 톤 참고용 발신자는 '참고 인풋'으로만 본다. 시장/경쟁사 리스크가 본문에 명시되지 않으면 핵심 3가지에 넣지 않는다.",
  "- 중요한 뉴스는 회사 의사결정에 영향을 주는 브랜드·시장·경쟁사·계약·정산 이슈만 포함한다.",
  "- 신규 브랜드 제안의 예산·조건 검토는 주간 체크리스트 후보이므로, 요약에서는 중복 나열하지 말고 정말 CEO 결정이 필요한 경우만 1줄로 남긴다.",
  "- 본문에 없는 정보 만들지 말 것.",
  "- **컨텍스트에 \"이미 박진호가 처리/결정한 항목\" 섹션이 있으면 그 항목들은 절대 다시 언급하지 말 것.** 새로 발생한 사안만 출력.",
].join("\n");

type Row = {
  from_name: string | null;
  from_addr: string | null;
  subject: string | null;
  body_full: string | null;
  snippet: string | null;
  ai_category: string | null;
  priority: string | null;
};

function isoToday(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function runPython(args: string[], timeoutMs = 15000): Promise<{ ok: boolean; out: string; err: string }> {
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
conn = sqlite3.connect(db, timeout=30)
conn.row_factory = sqlite3.Row
rows = conn.execute("""
  SELECT from_name, from_addr, subject, body_full, snippet, ai_category, priority
  FROM messages
  WHERE trashed_at IS NULL
    AND date(date_ts, 'unixepoch', '+9 hours') = ?
    AND (ai_category IN ('client','sales','event','finance','urgent') OR ai_category IS NULL)
  ORDER BY CASE ai_category
    WHEN 'urgent' THEN 0
    WHEN 'client' THEN 1
    WHEN 'event' THEN 2
    WHEN 'finance' THEN 3
    WHEN 'sales' THEN 4
    ELSE 5 END,
    date_ts DESC
  LIMIT 40
""", (date,)).fetchall()
sys.stdout.write(json.dumps([dict(r) for r in rows], ensure_ascii=False))
`;

async function fetchMessagesForDate(date: string): Promise<Row[]> {
  const r = await runPython(["-c", FETCH_PY, DB_PATH, date]);
  if (!r.ok) throw new Error(`db query failed: ${r.err}`);
  return JSON.parse(r.out) as Row[];
}

const GET_CACHE_PY = `import sqlite3, json, sys
db, date = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db, timeout=30)
conn.row_factory = sqlite3.Row
row = conn.execute("SELECT summary, model, created_at FROM daily_summaries WHERE date=?", (date,)).fetchone()
sys.stdout.write(json.dumps(dict(row)) if row else '')
`;

async function getCached(date: string): Promise<{ summary: string; model: string; created_at: number } | null> {
  const r = await runPython(["-c", GET_CACHE_PY, DB_PATH, date]);
  if (!r.ok || !r.out.trim()) return null;
  return JSON.parse(r.out);
}

const SET_CACHE_PY = `import sqlite3, sys
db, date, summary, model, count = sys.argv[1:6]
conn = sqlite3.connect(db, timeout=30)
conn.execute("INSERT OR REPLACE INTO daily_summaries(date, summary, model, message_count, created_at) VALUES (?,?,?,?,strftime('%s','now'))", (date, summary, model, int(count)))
conn.commit()
sys.stdout.write('OK')
`;

async function setCached(date: string, summary: string, model: string, count: number): Promise<void> {
  const r = await runPython(["-c", SET_CACHE_PY, DB_PATH, date, summary, model, String(count)], 40000);
  if (!r.ok) throw new Error(`cache write failed: ${r.err}`);
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
      max_tokens: 500,
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`perplexity ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic(apiKey: string, userMsg: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { content: Array<{ type: string; text?: string }> };
  return j.content.filter((c) => c.type === "text" && c.text).map((c) => c.text as string).join("\n").trim();
}

function buildUserMsg(date: string, rows: Row[], decisions: Array<{ line_text: string; decision: string }> = []): string {
  const picked = rows.slice(0, MAX_MSGS);
  const lines = [
    `날짜: ${date} (KST)`,
    `메일 수: ${rows.length}건 (요약 대상 ${picked.length}건)`,
  ];
  if (decisions.length > 0) {
    lines.push(``);
    lines.push(`--- 이미 박진호가 처리/결정한 항목 (다시 언급 금지) ---`);
    decisions.slice(0, 20).forEach((d) => {
      const label = d.decision === "done" ? "✅ 처리완료" : d.decision === "skip" ? "⏭ 스킵" : "🚫 무시";
      lines.push(`  ${label}: ${d.line_text}`);
    });
  }
  lines.push(``);
  lines.push(`--- 메일 목록 ---`);
  picked.forEach((m, i) => {
    const body = (m.body_full || m.snippet || "").replace(/\s+/g, " ").slice(0, MAX_BODY_PER_MSG);
    lines.push(``);
    lines.push(`[${i + 1}] (${m.ai_category || "?"}/${m.priority || "-"}) ${m.from_name || m.from_addr}: ${m.subject || ""}`);
    if (body) lines.push(`    ${body}`);
  });
  return lines.join("\n");
}

const GET_DECISIONS_PY = `import sqlite3, json, sys
db, date = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db, timeout=10)
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT line_text, decision FROM action_decisions WHERE date=?", (date,)).fetchall()
sys.stdout.write(json.dumps([dict(r) for r in rows], ensure_ascii=False))
`;

async function getDecisions(date: string): Promise<Array<{ line_text: string; decision: string }>> {
  const r = await runPython(["-c", GET_DECISIONS_PY, DB_PATH, date]);
  if (!r.ok || !r.out.trim()) return [];
  try { return JSON.parse(r.out); } catch { return []; }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { date?: string; force?: boolean };
  const date = (body.date || isoToday()).slice(0, 10);
  const force = !!body.force;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  if (!force) {
    const cached = await getCached(date);
    if (cached) {
      return NextResponse.json({ date, cached: true, summary: cached.summary, model: cached.model, created_at: cached.created_at });
    }
  }

  const rows = await fetchMessagesForDate(date);
  if (rows.length === 0) {
    return NextResponse.json({ date, cached: false, summary: "해당 일자에 분석 대상 메일이 없습니다.", model: "none", message_count: 0 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const preferAnthropic = !!anthropicKey && anthropicKey.startsWith("sk-ant-api");
  if (!preferAnthropic && !perplexityKey) {
    return NextResponse.json({ error: "no usable API key (need sk-ant-api… or PERPLEXITY_API_KEY)" }, { status: 500 });
  }

  const t0 = Date.now();
  const decisions = await getDecisions(date);
  const userMsg = buildUserMsg(date, rows, decisions);
  try {
    let summary: string;
    let modelUsed: string;
    if (preferAnthropic) {
      summary = await callAnthropic(anthropicKey!, userMsg);
      modelUsed = ANTHROPIC_MODEL;
    } else {
      summary = await callPerplexity(perplexityKey!, userMsg);
      modelUsed = PERPLEXITY_MODEL;
    }
    await setCached(date, summary, modelUsed, rows.length);
    return NextResponse.json({ date, cached: false, summary, model: modelUsed, message_count: rows.length, elapsed_ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

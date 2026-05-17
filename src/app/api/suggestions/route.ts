import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";

export const dynamic = "force-dynamic";

type MailMsg = {
  id: string;
  ts: number;
  date: string;
  fromName?: string;
  fromAddr?: string;
  subject?: string;
  snippet?: string;
  aiSummary?: string | null;
  priority?: "high" | "med" | "low" | "urgent" | null;
  category?: string | null;
};

type Person = {
  name: string;
  role?: string;
  kind?: string;
  lastContact?: string;
  lastContactTs?: number;
  overdue?: boolean;
  freqDays?: number;
  note?: string;
};

type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
};

type Owner = "me" | "influencer" | "brand" | "partner" | "evp" | "people";

type Suggestion = {
  id: string;
  source: "mail" | "people" | "calendar";
  owner: Owner;
  ownerReason: string;
  title: string;
  detail: string;
  ts: number;
  priority: "high" | "med" | "low";
  link?: string;
};

const MAIL_PATH = "/root/projects/nectar-os/public/mail.json";
const PEOPLE_PATH = "/root/projects/nectar-os/public/people.json";
const EVENTS_PATH = "/root/projects/nectar-os/public/events.json";
const SUGGEST_WINDOW_DAYS = 14;
const CAL_LOOKAHEAD_HOURS = 36;
const MAX_PER_OWNER = 12;
const SKIP_CATEGORIES = new Set(["noise", "news"]);

const KEYWORDS: { owner: Owner; kw: string[] }[] = [
  {
    owner: "evp",
    kw: [
      "인보이스",
      "invoice",
      "송금",
      "지급",
      "정산",
      "환율",
      "세금",
      "부가세",
      "청구",
      "계산서",
      "급여",
      "환불",
      "출금",
      "결제",
    ],
  },
  {
    owner: "influencer",
    kw: [
      "크리에이터",
      "creator",
      "인플루언서",
      "influencer",
      "자청",
      "스카웃",
      "scout",
      "영입",
      "캐스팅",
      "casting",
    ],
  },
  {
    owner: "brand",
    kw: [
      "rfp",
      "광고 대행",
      "광고대행",
      "신규 캠페인",
      "캠페인 제안",
      "마케팅 제안",
      "신규 브랜드",
      "브랜드 영업",
      "제안서",
      "견적 요청",
    ],
  },
  {
    owner: "partner",
    kw: [
      "파트너십",
      "파트너 십",
      "협력",
      "협업",
      "입점",
      "콜라보",
      "콜라보레이션",
      "mou",
      "제휴",
      "공동 사업",
      "합작",
    ],
  },
];

function classifyText(title: string, subject = ""): { owner: Owner; reason: string } {
  const t = title.toLowerCase();
  const s = subject.toLowerCase();
  for (const { owner, kw } of KEYWORDS) {
    for (const k of kw) {
      if (t.includes(k.toLowerCase()) || s.includes(k.toLowerCase())) {
        return { owner, reason: `kw=${k}` };
      }
    }
  }
  return { owner: "me", reason: "default" };
}

function stableId(prefix: string, raw: string): string {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `${prefix}_${Math.abs(h).toString(36)}`;
}

async function loadMailSuggestions(cutoff: number): Promise<Suggestion[]> {
  const raw = await fs.readFile(MAIL_PATH, "utf-8");
  const data = JSON.parse(raw) as { messages: MailMsg[] };
  const out: Suggestion[] = [];
  for (const m of data.messages) {
    if (!m.ts || m.ts < cutoff) continue;
    const pri = m.priority;
    const cat = m.category || "";
    if (pri !== "high" && pri !== "urgent") continue;
    if (SKIP_CATEGORIES.has(cat)) continue;
    const sender = m.fromName || (m.fromAddr || "?").split("@")[0];
    const summary = (m.aiSummary || m.subject || "").trim();
    if (!summary) continue;
    let owner: Owner;
    let reason: string;
    if ((m.category || "").toLowerCase() === "finance") {
      owner = "evp";
      reason = "category=finance";
    } else {
      const c = classifyText(summary, m.subject || "");
      owner = c.owner;
      reason = c.reason;
    }
    out.push({
      id: stableId("mail", m.id || `${m.ts}-${summary}`),
      source: "mail",
      owner,
      ownerReason: reason,
      title: summary,
      detail: `📧 ${sender} · ${(m.subject || "").slice(0, 60)}`,
      ts: m.ts,
      priority: "high",
      link: "/mail",
    });
  }
  return out;
}

async function loadPeopleSuggestions(): Promise<Suggestion[]> {
  try {
    const raw = await fs.readFile(PEOPLE_PATH, "utf-8");
    const data = JSON.parse(raw);
    const list: Person[] = Array.isArray(data) ? data : data.people || data.items || [];
    const out: Suggestion[] = [];
    for (const p of list) {
      if (!p.overdue) continue;
      out.push({
        id: stableId("person", p.name),
        source: "people",
        owner: "people",
        ownerReason: `overdue (freq=${p.freqDays}d)`,
        title: `${p.name} 안부 / 컨택 — 마지막: ${p.lastContact || "기록 없음"}`,
        detail: `👥 ${p.role || ""} ${p.note ? `· ${p.note}` : ""}`.trim(),
        ts: p.lastContactTs || 0,
        priority: "med",
        link: "/people",
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function loadCalendarSuggestions(): Promise<Suggestion[]> {
  try {
    const raw = await fs.readFile(EVENTS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const list: CalEvent[] = Array.isArray(parsed) ? parsed : (parsed.events || []);
    const now = Date.now();
    const horizon = now + CAL_LOOKAHEAD_HOURS * 3600 * 1000;
    const out: Suggestion[] = [];
    for (const e of list) {
      if (e.cal === "holiday") continue;
      if (!e.start) continue;
      const startMs = e.start.length === 10
        ? new Date(`${e.start}T00:00:00+09:00`).getTime()
        : new Date(e.start).getTime();
      if (Number.isNaN(startMs)) continue;
      if (startMs < now - 3600 * 1000) continue; // skip past events (>1h ago)
      if (startMs > horizon) continue;
      const title = (e.title || "").trim();
      if (!title) continue;
      const { owner, reason } = classifyText(title);
      const when = e.allDay
        ? "오늘"
        : new Date(startMs).toLocaleString("ko-KR", {
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
          });
      out.push({
        id: stableId("cal", e.id || `${startMs}-${title}`),
        source: "calendar",
        owner,
        ownerReason: `calendar · ${reason}`,
        title: `📅 ${title} — 준비`,
        detail: `🕒 ${when} · ${e.cal}`,
        ts: Math.floor(startMs / 1000),
        priority: "high",
        link: "/calendar",
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - SUGGEST_WINDOW_DAYS * 86400;
    const [mailSugs, peopleSugs, calSugs] = await Promise.all([
      loadMailSuggestions(cutoff),
      loadPeopleSuggestions(),
      loadCalendarSuggestions(),
    ]);

    const all = [...calSugs, ...mailSugs, ...peopleSugs];
    all.sort((a, b) => b.ts - a.ts);

    const seen = new Set<string>();
    const buckets: Record<Owner, Suggestion[]> = {
      me: [],
      influencer: [],
      brand: [],
      partner: [],
      evp: [],
      people: [],
    };
    for (const c of all) {
      const k = `${c.source}:${c.title.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (buckets[c.owner].length < MAX_PER_OWNER) buckets[c.owner].push(c);
    }

    return NextResponse.json({
      suggestions: ([] as Suggestion[]).concat(...Object.values(buckets)),
      byOwner: buckets,
      generatedAt: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    return NextResponse.json(
      { suggestions: [], byOwner: {}, error: (e as Error).message },
      { status: 500 },
    );
  }
}

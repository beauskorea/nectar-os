import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";

export const dynamic = "force-dynamic";

const SUMMARY_PATH = "/root/nerve-preview/data/marketing_summary.json";

type WeekItem = {
  no: string;
  name: string;
  biz: string;
  issue: string;
};

type WeekData = {
  week: number;
  period: string;
  items: WeekItem[];
};

type Owner = "me" | "influencer" | "brand" | "partner" | "evp" | "people";

type ParsedItem = {
  id: string;
  text: string;
  owner: Owner;
  priority: "high" | "med" | "low";
};

type Section = {
  emoji: string;
  label: string;
  defaultOwner: Owner;
  defaultPriority: "high" | "med" | "low";
  items: ParsedItem[];
};

// Section heading detector: starts with one of the emojis OR "고정TF"
// Pattern: emoji + space + label (or 고정TF)
const SECTION_RULES: { match: RegExp; label: string; owner: Owner; pri: "high" | "med" | "low"; emoji: string }[] = [
  { match: /^📌\s*핵심\s*이슈/i, label: "핵심 이슈", emoji: "📌", owner: "me", pri: "high" },
  { match: /^💼\s*영업\s*관리/i, label: "영업 관리", emoji: "💼", owner: "me", pri: "high" },
  { match: /^🚀\s*New\s*BM/i, label: "New BM", emoji: "🚀", owner: "me", pri: "high" },
  { match: /^고정\s*TF/i, label: "고정 TF", emoji: "🛠️", owner: "me", pri: "med" },
  { match: /^👤\s*비라운드\s*크리에이터/i, label: "비라운드 크리에이터", emoji: "👤", owner: "influencer", pri: "med" },
  { match: /^👤\s*발굴\s*크리에이터/i, label: "발굴 크리에이터", emoji: "👤", owner: "influencer", pri: "high" },
  { match: /^👤\s*스카웃\s*크리에이터/i, label: "스카웃 크리에이터", emoji: "👤", owner: "influencer", pri: "med" },
  { match: /^🏢\s*내부\s*사항/i, label: "내부 사항", emoji: "🏢", owner: "me", pri: "med" },
  { match: /^🎯/, label: "체크 항목", emoji: "🎯", owner: "me", pri: "med" },
  { match: /^⭐\s*크리에이터\s*팔로업/i, label: "크리에이터 팔로업", emoji: "⭐", owner: "influencer", pri: "med" },
  { match: /^⭐\s*파트너\s*팔로업/i, label: "파트너 팔로업", emoji: "⭐", owner: "partner", pri: "med" },
];

function stableId(prefix: string, raw: string): string {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `${prefix}_${Math.abs(h).toString(36)}`;
}

function parseBiz(biz: string, week: number): Section[] {
  const lines = biz.split(/\r?\n/);
  let current: Section | null = null;
  const out: Section[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // section heading?
    const rule = SECTION_RULES.find((r) => r.match.test(line));
    if (rule) {
      current = {
        emoji: rule.emoji,
        label: rule.label,
        defaultOwner: rule.owner,
        defaultPriority: rule.pri,
        items: [],
      };
      out.push(current);
      continue;
    }
    // skip pure sub-header lines like "매니지먼트" without context
    // accept line as item if it's substantive (>2 chars after stripping bullets)
    const cleaned = line.replace(/^[-•·>→\s]+/, "").trim();
    if (cleaned.length < 3) continue;
    if (!current) {
      // create a default "기타" section if items appear before any heading
      current = {
        emoji: "•",
        label: "기타",
        defaultOwner: "me",
        defaultPriority: "med",
        items: [],
      };
      out.push(current);
    }
    current.items.push({
      id: stableId(`wk${week}`, `${current.label}-${cleaned}`),
      text: cleaned,
      owner: current.defaultOwner,
      priority: current.defaultPriority,
    });
  }
  // drop empty sections
  return out.filter((s) => s.items.length > 0);
}

export async function GET() {
  try {
    const raw = await fs.readFile(SUMMARY_PATH, "utf-8");
    const data = JSON.parse(raw) as { weekly?: { weeks?: WeekData[] }; generated_at?: string };
    const weeks = data.weekly?.weeks || [];
    if (weeks.length === 0) {
      return NextResponse.json({ available: false, reason: "no_weeks" });
    }
    const current = weeks[0];
    const ceo = current.items.find((it) => /대표/.test(it.name));
    if (!ceo) {
      return NextResponse.json({ available: false, reason: "no_ceo_row" });
    }
    const sections = parseBiz(ceo.biz || "", current.week);
    const total = sections.reduce((n, s) => n + s.items.length, 0);
    return NextResponse.json({
      available: true,
      week: current.week,
      period: current.period,
      sections,
      total,
      sourceUrl: `https://docs.google.com/spreadsheets/d/1OzFtdgXmgIqN4MjEi-w3Q6RqKPq65KY463eanSALw3A/edit?gid=2032315859`,
      generatedAt: data.generated_at,
    });
  } catch (e) {
    return NextResponse.json(
      { available: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

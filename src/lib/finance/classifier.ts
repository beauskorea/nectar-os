// 진호 OS — vendor → category / kind 자동 분류 룰
// 입력: 정규화된 vendor 명, 또는 raw text. 출력: category + kind + recurring 힌트.

import type { FinanceCategory, FinanceKind, Transaction } from "./types";

type Rule = {
  match: RegExp;
  vendor?: string;
  category: FinanceCategory;
  kind: FinanceKind;
  recurring?: boolean;
  subcategory?: string;
};

// 우선순위 위에서 아래. 첫 매치 채택.
const VENDOR_RULES: Rule[] = [
  // AI / LLM
  { match: /anthropic|claude\.ai/i, vendor: "Anthropic", category: "AI/LLM", kind: "biz", recurring: true, subcategory: "API" },
  { match: /chatgpt\s*pro|chatgpt\s*plus/i, vendor: "ChatGPT Pro", category: "AI/LLM", kind: "biz", recurring: true, subcategory: "Subscription" },
  { match: /openai|chatgpt/i, vendor: "OpenAI", category: "AI/LLM", kind: "biz", recurring: true, subcategory: "API" },
  { match: /gemini|google\s*ai/i, vendor: "Google AI", category: "AI/LLM", kind: "biz", recurring: true, subcategory: "API" },
  { match: /groq/i, vendor: "Groq", category: "AI/LLM", kind: "biz", recurring: true, subcategory: "API" },
  { match: /perplexity/i, vendor: "Perplexity", category: "AI/LLM", kind: "biz", recurring: true, subcategory: "API" },
  { match: /fal\.ai|fal\b/i, vendor: "fal.ai", category: "AI/LLM", kind: "biz", recurring: true, subcategory: "API" },

  // Infra / VPS
  { match: /hostinger/i, vendor: "Hostinger", category: "Infra/VPS", kind: "biz", recurring: true, subcategory: "VPS" },
  { match: /cloudflare/i, vendor: "Cloudflare", category: "Infra/VPS", kind: "biz", recurring: true, subcategory: "CDN/DNS" },
  { match: /vercel/i, vendor: "Vercel", category: "Infra/VPS", kind: "biz", recurring: true, subcategory: "Hosting" },
  { match: /aws|amazon\s*web/i, vendor: "AWS", category: "Infra/VPS", kind: "biz", recurring: true, subcategory: "Cloud" },
  { match: /digitalocean/i, vendor: "DigitalOcean", category: "Infra/VPS", kind: "biz", recurring: true, subcategory: "VPS" },
  { match: /supabase/i, vendor: "Supabase", category: "Infra/VPS", kind: "biz", recurring: true, subcategory: "DB" },
  { match: /upstash/i, vendor: "Upstash", category: "Infra/VPS", kind: "biz", recurring: true, subcategory: "DB" },

  // SaaS / Subscription
  { match: /notion/i, vendor: "Notion", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "Productivity" },
  { match: /slack/i, vendor: "Slack", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "Comms" },
  { match: /linear\.app/i, vendor: "Linear", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "PM" },
  { match: /figma/i, vendor: "Figma", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "Design" },
  { match: /github/i, vendor: "GitHub", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "Dev" },
  { match: /modash/i, vendor: "Modash", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "Creator-DB" },
  { match: /trendier/i, vendor: "Trendier", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "Creator-DB" },
  { match: /apple\.com\/bill|itunes|apple/i, vendor: "Apple", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "AppStore" },
  { match: /google\s*workspace|gsuite/i, vendor: "Google Workspace", category: "SaaS/Subscription", kind: "biz", recurring: true, subcategory: "Email" },
  { match: /\bgoogle\b/i, vendor: "Google", category: "SaaS/Subscription", kind: "biz", recurring: false, subcategory: "Misc" },

  // Team Ops
  { match: /(회식|단체석|한정식|법인카드)/i, category: "Team Ops", kind: "biz", subcategory: "회식" },
  { match: /(사무실|임대료|관리비)/i, category: "Team Ops", kind: "biz", subcategory: "오피스" },

  // Creator (전속/연습생 운영)
  { match: /(매니지먼트|연습생|전속)/i, category: "Creator", kind: "biz", subcategory: "Roster" },

  // Commerce / 광고집행 / 보증금
  { match: /(보증금|팝업|edid)/i, category: "Commerce", kind: "biz", subcategory: "팝업/리테일" },
  { match: /(올영|올리브영|cj\s*올영)/i, category: "Commerce", kind: "biz", subcategory: "올영" },

  // Travel / 항공 / 해외
  { match: /(대한항공|아시아나|jeju|진에어|티웨이|skyscanner|airbnb|booking|expedia)/i, category: "Travel/Global", kind: "biz", subcategory: "출장" },

  // Food / 외식
  { match: /(스타벅스|투썸|이디야|배달의민족|쿠팡이츠|요기요)/i, category: "Food/Meeting", kind: "personal", subcategory: "외식/배달" },

  // Personal — 일상 (교통, 마트, 건강 등)
  { match: /(코레일|srt|ktx|타다|카카오\s*t|티머니|지하철)/i, category: "Personal", kind: "personal", subcategory: "교통" },
  { match: /(헬스|필라테스|골프|러닝)/i, category: "Personal", kind: "personal", subcategory: "건강/운동" },
  { match: /(롯데마트|이마트|홈플러스|편의점|gs25|cu)/i, category: "Personal", kind: "personal", subcategory: "마트" },
];

const RECURRING_HINT = /(구독|결제 갱신|월 정기|invoice|subscription|monthly|renew|auto-?pay)/i;

export interface ClassifyResult {
  category: FinanceCategory;
  kind: FinanceKind;
  recurring: boolean;
  vendor?: string;
  subcategory?: string;
}

export function classify(
  text: string,
  hints: { vendor?: string; recurring?: boolean } = {},
): ClassifyResult {
  const haystack = `${hints.vendor ?? ""} ${text}`;
  for (const rule of VENDOR_RULES) {
    if (rule.match.test(haystack)) {
      return {
        category: rule.category,
        kind: rule.kind,
        recurring: hints.recurring ?? rule.recurring ?? false,
        vendor: rule.vendor ?? hints.vendor,
        subcategory: rule.subcategory,
      };
    }
  }
  // 미매치 — Unknown
  return {
    category: "Unknown",
    kind: "personal",
    recurring: hints.recurring ?? RECURRING_HINT.test(haystack),
    vendor: hints.vendor,
  };
}

// 한국어 사용자 친화 라벨 — UI 카테고리 Top 등에서 표시용
export const CATEGORY_LABEL_KO: Record<FinanceCategory, string> = {
  "AI/LLM": "구독 (AI/툴)",
  "Infra/VPS": "VPS·인프라",
  "SaaS/Subscription": "SaaS",
  "Team Ops": "팀 운영",
  "Creator": "크리에이터",
  "Commerce": "커머스/팝업",
  "Travel/Global": "출장",
  "Food/Meeting": "식비/외식",
  "Personal": "일상",
  "Unknown": "미분류",
};

// 전체 Transaction 후처리 — classify 결과로 category/kind 보정 (이미 채워진 값은 우선)
export function enrichTransaction(t: Transaction): Transaction {
  if (t.category && t.category !== "Unknown") return t;
  const result = classify(`${t.vendor} ${t.raw_text ?? ""}`);
  return {
    ...t,
    category: result.category,
    business_or_personal: t.business_or_personal ?? result.kind,
    recurring: t.recurring ?? result.recurring,
    subcategory: t.subcategory ?? result.subcategory,
  };
}

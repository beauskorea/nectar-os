// 진호 OS — Gmail 카드 승인 / 인보이스 / 구독 결제 메일 파서
// 실제 메일 본문이 와도 ParseInput 인터페이스만 맞으면 동작. 토큰/API 키 의존 없음.

import { classify } from "./classifier";
import type { ParseInput, ParsedDraft, Transaction, FinanceCategory } from "./types";

const FX_RATE: Record<string, number> = {
  USD: 1380,
  EUR: 1500,
  JPY: 9.2,
  KRW: 1,
};

// 금액 추출 — 한글/영문 카드사 + 영문 인보이스 패턴
// 1순위: ₩/원 표시. 2순위: $/USD. 3순위: 1,234.56 단독.
const AMOUNT_PATTERNS = [
  // ₩123,456 / 123,456원
  { re: /(?:₩|KRW\s*)\s*([\d,]+(?:\.\d+)?)/i, currency: "KRW" as const },
  { re: /([\d,]+(?:\.\d+)?)\s*원/i, currency: "KRW" as const },
  // $123.45 / USD 123 / US$123
  { re: /(?:\$|USD\s*|US\$)\s*([\d,]+(?:\.\d+)?)/i, currency: "USD" as const },
  // €123 / EUR 123
  { re: /(?:€|EUR\s*)\s*([\d,]+(?:\.\d+)?)/i, currency: "EUR" as const },
  // ¥123 / JPY 123
  { re: /(?:¥|JPY\s*)\s*([\d,]+(?:\.\d+)?)/i, currency: "JPY" as const },
];

// 카드 승인 메일 — 가맹점 명 추출
const VENDOR_PATTERNS = [
  /가맹점\s*[:：]\s*(.+?)(?:\s|$|\n)/, // "가맹점 : 스타벅스"
  /at\s+([A-Z][A-Za-z0-9\-_. ]+?)(?:\s+on|\s+for|\s*$)/, // "Charged at OpenAI for ..."
  /from\s+([A-Z][A-Za-z0-9\-_. ]+?)(?:\s+for|\s*$)/i,
  /receipt\s+from\s+(.+?)(?:\s|$|\n)/i, // "Receipt from Anthropic"
];

const DATE_PATTERNS = [
  /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/, // 2026-05-12
  /(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*\/)/, // 05/12 (MM/DD, no third group)
  /(\d{1,2})월\s*(\d{1,2})일/,            // 5월 12일
];

function extractAmount(body: string): { amount: number; currency: ParsedDraft["currency"]; original_amount?: number; original_currency?: string } | null {
  for (const { re, currency } of AMOUNT_PATTERNS) {
    const m = body.match(re);
    if (!m) continue;
    const raw = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(raw) || raw <= 0) continue;
    if (currency === "KRW") {
      return { amount: Math.round(raw), currency: "KRW" };
    }
    const rate = FX_RATE[currency] ?? 1;
    return {
      amount: Math.round(raw * rate),
      currency: "KRW",
      original_amount: raw,
      original_currency: currency,
    };
  }
  return null;
}

function extractVendor(body: string, subject?: string): string | undefined {
  for (const re of VENDOR_PATTERNS) {
    const m = (subject ?? "").match(re) ?? body.match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}

function extractDate(body: string, received_at?: string): string | undefined {
  for (const re of DATE_PATTERNS) {
    const m = body.match(re);
    if (!m) continue;
    if (m.length === 4) {
      // YYYY-MM-DD
      return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
    if (m.length === 3) {
      // MM/DD — year from received_at (default this year)
      const year = received_at ? new Date(received_at).getFullYear() : new Date().getFullYear();
      return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
  }
  if (received_at) return received_at.slice(0, 10);
  return undefined;
}

export function parseEmail(input: ParseInput): ParsedDraft {
  const body = input.body ?? "";
  const subject = input.subject;
  const amt = extractAmount(`${subject ?? ""}\n${body}`);
  const vendor = extractVendor(body, subject);
  const date = extractDate(body, input.received_at);

  return {
    date,
    vendor,
    amount: amt?.amount,
    currency: amt?.currency,
    original_amount: amt?.original_amount,
    original_currency: amt?.original_currency,
    raw_text: `${subject ? `[${subject}] ` : ""}${body}`.slice(0, 1000),
    source: input.source,
    source_email_subject: subject,
  };
}

// ParsedDraft → 완전한 Transaction (classifier + id + created_at 채움)
let _idCounter = 0;
export function draftToTransaction(draft: ParsedDraft, opts: { id?: string } = {}): Transaction | null {
  if (!draft.amount || !draft.currency || !draft.date) {
    return null; // 핵심 필드 누락 — 드롭
  }
  const cls = classify(`${draft.vendor ?? ""} ${draft.raw_text}`, { vendor: draft.vendor });
  const id = opts.id ?? `auto-${Date.now()}-${++_idCounter}`;
  return {
    id,
    date: draft.date,
    vendor: cls.vendor ?? draft.vendor ?? "Unknown",
    amount: draft.amount,
    currency: draft.currency,
    category: cls.category,
    subcategory: cls.subcategory,
    business_or_personal: cls.kind,
    recurring: cls.recurring,
    source: draft.source,
    source_email_subject: draft.source_email_subject,
    raw_text: draft.raw_text,
    original_amount: draft.original_amount,
    original_currency: draft.original_currency,
    created_at: new Date().toISOString(),
  };
}

// 한 방에: 이메일 입력 → Transaction (or null)
export function parseEmailToTransaction(input: ParseInput): Transaction | null {
  return draftToTransaction(parseEmail(input));
}

// 카테고리 강제 override 가 필요한 케이스용 (테스트/수기 보정)
export function forceCategory(t: Transaction, category: FinanceCategory): Transaction {
  return { ...t, category };
}

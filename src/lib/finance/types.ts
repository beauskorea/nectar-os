// 진호 OS — finance domain types
// 토스/뱅크샐러드 raw / Gmail 카드 승인 메일 / 인보이스 → 통합 Transaction 모양

export type FinanceKind = "biz" | "personal";

// 자동 분류 카테고리 (top-level)
// 세부 분류는 subcategory 에 자유 문자열로
export type FinanceCategory =
  | "AI/LLM"
  | "Infra/VPS"
  | "SaaS/Subscription"
  | "Team Ops"
  | "Creator"
  | "Commerce"
  | "Travel/Global"
  | "Food/Meeting"
  | "Personal"
  | "Unknown";

export type FinanceSource =
  | "gmail_card_approval"   // 카드 승인 알림 메일
  | "gmail_invoice"         // 인보이스/영수증 메일
  | "gmail_subscription"    // 구독 결제 알림 메일
  | "toss_export"           // 토스 가계부 export
  | "banksalad_export"      // 뱅크샐러드 export
  | "manual"                // 수기 입력
  | "mock";                 // 샘플 데이터

export interface Transaction {
  id: string;
  date: string;             // "YYYY-MM-DD"
  vendor: string;           // 정규화된 벤더명 ("Anthropic", "ChatGPT Pro" 등)
  amount: number;           // 원화 단위 (외화는 환산 후 저장, original_* 별도)
  currency: "KRW" | "USD" | "EUR" | "JPY";
  category: FinanceCategory;
  subcategory?: string;     // "API", "VPS", "Hosting" 등 자유 문자열
  business_or_personal: FinanceKind;
  recurring: boolean;
  source: FinanceSource;
  source_email_subject?: string;
  raw_text?: string;        // 원문 텍스트 (마스킹 후)
  ai_summary?: string;      // 1줄 요약 (선택)
  original_amount?: number; // 환산 전 원금액 (외화일 때)
  original_currency?: string;
  created_at: string;
  housing?: boolean;       // ISO timestamp
}

// /money 페이지가 소비하는 KPI 모양 — 기존 mockData.moneyKpi 호환
export interface MoneyKpi {
  monthLabel: string;
  income: number;
  spent: number;
  budget: number;
  topCategories: Array<{
    name: string;
    amount: number;
    share: number;
    kind: FinanceKind;
  }>;
  trend: number[];          // 만원 단위
  trendMonths: string[];    // "YYYY-MM"
  subscriptions: Array<{
    name: string;
    amount: string;         // 표시용 ("$200", "변동", "₩28k/mo")
    kind: FinanceKind;
    monthly: number;        // 환산 월 원화
  }>;
  bigTransactions: Array<{
    date: string;           // "MM/DD"
    merchant: string;
    amount: number;
    kind: FinanceKind;
  }>;
  // 확장 필드 (UI는 안 써도 API 응답에는 포함)
  prevMonthDelta?: number;       // 전월 대비 증감률 (소수)
  burnRatePerDay?: number;       // 이번 달 일평균 burn
  projectedMonthEnd?: number;    // burn rate × 남은일 + 이번달 누적
}

// 파서가 받는 원시 입력
export interface ParseInput {
  source: FinanceSource;
  subject?: string;
  body: string;
  received_at?: string;     // ISO
}

// 파서 출력 — Transaction 의 일부만 채우고 나머지는 후처리에서
export interface ParsedDraft {
  date?: string;
  vendor?: string;
  amount?: number;
  currency?: Transaction["currency"];
  original_amount?: number;
  original_currency?: string;
  hint_category?: FinanceCategory;
  hint_recurring?: boolean;
  raw_text: string;
  source: FinanceSource;
  source_email_subject?: string;
}

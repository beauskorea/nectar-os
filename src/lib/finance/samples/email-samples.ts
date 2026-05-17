// 진호 OS — 마스킹된 가상 이메일 샘플 (parser 테스트용)
// ⚠️ 실제 카드번호 / 이메일 주소 / 토큰 / 인보이스 PDF 링크 절대 포함 금지.

import type { FinanceSource } from "../types";

export interface SampleEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  received_at: string;       // ISO
  kind: FinanceSource;        // gmail_card_approval / gmail_invoice / gmail_subscription
}

export const GMAIL_EMAIL_SAMPLES: SampleEmail[] = [
  // ── 카드 승인 메일 일반 패턴 (한글 카드사 톤) ──
  {
    id: "mail-card-approval-1",
    from: "no-reply@example-card.kr",
    subject: "[카드사] 카드 승인 — 2026-05-06",
    body: `[국내] 카드 승인
승인일시 : 2026-05-06 20:48
승인금액 : 287,000원
가맹점 : 한정식 식당
승인번호 : ****`,
    received_at: "2026-05-06T20:48:30+09:00",
    kind: "gmail_card_approval",
  },
  {
    id: "mail-card-approval-2",
    from: "no-reply@example-card.kr",
    subject: "[카드사] 카드 승인 — 2026-05-03",
    body: `[해외] 카드 승인
승인일시 : 2026-05-03 08:01
승인금액 : $200.00 (₩270,000)
가맹점 : OpenAI ChatGPT Pro
승인번호 : ****`,
    received_at: "2026-05-03T08:01:00+09:00",
    kind: "gmail_card_approval",
  },

  // ── 인보이스 메일 (영문) ──
  {
    id: "mail-invoice-anthropic",
    from: "billing@anthropic.com",
    subject: "[Anthropic] Usage invoice — $97.10",
    body: `Hi Jinho,

This is your Anthropic API usage receipt for May 2026.

Total: $97.10
Date: 2026-05-10
Plan: Pay-as-you-go

Receipt from Anthropic. Charged to card ending in ****.`,
    received_at: "2026-05-10T10:00:00+09:00",
    kind: "gmail_invoice",
  },
  {
    id: "mail-invoice-openai",
    from: "receipts@openai.com",
    subject: "[OpenAI] Usage receipt — $60.14",
    body: `Your OpenAI API usage for the month.

Amount: $60.14
Date: 2026-05-11

Receipt from OpenAI.`,
    received_at: "2026-05-11T10:00:00+09:00",
    kind: "gmail_invoice",
  },
  {
    id: "mail-invoice-modash",
    from: "billing@modash.io",
    subject: "[Modash] Q2 2026 invoice — paid",
    body: `Hi Jinho,

Your Q2 2026 Modash subscription is paid in full.

Amount: $1,240.00
Date: 2026-05-12
Plan: Pro Quarterly

Receipt from Modash.`,
    received_at: "2026-05-12T09:14:00+09:00",
    kind: "gmail_invoice",
  },

  // ── 구독 결제 알림 메일 ──
  {
    id: "mail-sub-hostinger",
    from: "no-reply@hostinger.com",
    subject: "[Hostinger] VPS monthly invoice",
    body: `Your Hostinger KVM 4 VPS subscription has renewed.

Amount: ₩28,000
Date: 2026-05-01
Auto-renewal: Yes`,
    received_at: "2026-05-01T03:00:00+09:00",
    kind: "gmail_subscription",
  },
  {
    id: "mail-sub-cloudflare",
    from: "billing@cloudflare.com",
    subject: "[Cloudflare] Receipt — $20.00",
    body: `Cloudflare Pro plan monthly receipt.

Amount: $20.00
Date: 2026-05-02

Receipt from Cloudflare.`,
    received_at: "2026-05-02T05:00:00+09:00",
    kind: "gmail_subscription",
  },
  {
    id: "mail-sub-notion",
    from: "team@notion.so",
    subject: "[Notion] Receipt",
    body: `Notion Personal Pro receipt.

Amount: ₩12,000
Date: 2026-05-02`,
    received_at: "2026-05-02T05:00:00+09:00",
    kind: "gmail_subscription",
  },
  {
    id: "mail-sub-apple",
    from: "no_reply@email.apple.com",
    subject: "Your receipt from Apple.",
    body: `Apple Receipt
Date: 2026-05-04
Order: ****
iCloud+ 200GB
Total: ₩3,300`,
    received_at: "2026-05-04T05:00:00+09:00",
    kind: "gmail_subscription",
  },
  {
    id: "mail-sub-google",
    from: "payments-noreply@google.com",
    subject: "Your Google Workspace invoice",
    body: `Google Workspace Business Starter

Amount: $7.20
Date: 2026-05-05
Receipt from Google.`,
    received_at: "2026-05-05T05:00:00+09:00",
    kind: "gmail_subscription",
  },
];

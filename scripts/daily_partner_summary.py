#!/usr/bin/env python3
"""
daily_partner_summary.py — 매일 09:00 KST 자동 인입 요약 텔레그램 발송.
지난 24시간 ingestedAt / reviewedAt / rejectedAt 카운트 + 현재 미검토 N건.
cron: 0 0 * * * (UTC = 09:00 KST)
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/root/jinho-playground')
SUPP = ROOT / 'public' / 'partners_supplement.json'
REJECTED = ROOT / 'data' / 'partner_rejected.json'


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def main():
    now = int(time.time())
    cutoff = now - 24 * 3600  # 지난 24시간

    supp = load_json(SUPP, {'additional_partners': []})
    rejected = load_json(REJECTED, {'rejected': []})

    partners = supp.get('additional_partners', []) or []
    rej = rejected.get('rejected', []) or []

    # 어제 통계
    ingested_24h = [p for p in partners if (p.get('ingestedAt') or 0) >= cutoff]
    reviewed_24h = [p for p in partners if (p.get('reviewedAt') or 0) >= cutoff]
    rejected_24h = [r for r in rej if (r.get('at') or 0) >= cutoff]

    # 현재 미검토 (autoIngested=true && reviewedAt 없음)
    pending = [p for p in partners if p.get('autoIngested') and not p.get('reviewedAt')]

    # 누적
    total_supp = len(partners)
    total_rejected = len(rej)

    date_str = time.strftime('%Y-%m-%d', time.localtime(now + 9 * 3600))
    lines = [f'📊 Partner 자동 인입 요약 — {date_str}']
    lines.append(f'지난 24h: 신규 {len(ingested_24h)} · approved {len(reviewed_24h)} · rejected {len(rejected_24h)}')
    if pending:
        lines.append(f'⚠ 미검토 {len(pending)}건 → /partners 검토 필요')
        for p in pending[:5]:
            t_cnt = len(p.get('talents') or [])
            lines.append(f"  · {p['name']} (talents {t_cnt})")
    else:
        lines.append('✓ 미검토 0건')
    lines.append(f'누적: supplement {total_supp} · 차단 {total_rejected}')

    msg = '\n'.join(lines)

    # 빈 결과면 발송 안 함 (노이즈 방지) — pending 있거나 24h 활동 있을 때만
    if not (len(ingested_24h) + len(reviewed_24h) + len(rejected_24h) + len(pending)):
        print('[daily_partner_summary] no activity, no telegram')
        return 0

    # 사용자 요청으로 발신 OFF (2026-05-16) — 메시지만 stdout 출력 (cron log에 남음)
    _DISABLED_BY_USER = True
    if _DISABLED_BY_USER:
        print(f'[daily_partner_summary] push OFF — would send: {msg!r}')
        return 0
    try:
        subprocess.run(
            ['/usr/local/bin/beaus-send', 'result', msg],
            capture_output=True, timeout=30, check=False,
        )
        print(f'[daily_partner_summary] sent: {msg!r}')
    except Exception as e:
        print(f'[daily_partner_summary] notify failed: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

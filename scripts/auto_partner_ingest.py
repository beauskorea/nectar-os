#!/usr/bin/env python3
"""
auto_partner_ingest.py — 협업 제안 메일을 자동으로 /partners 에 적재.

흐름:
1. ceo_mail.db 에서 협업/매니지먼트 제안 패턴 메일 후보 추출
2. 첨부 PDF 있으면 pdftotext 로 텍스트 추출 → 본문에 합침
3. Claude Haiku 로 파싱 — {company, talents[]} 또는 null
4. partners_supplement.json 의 additional_partners 에 append/merge
5. ledger 갱신 — 처리한 message_id 기록

cron: 매시간 15분
저장 위치: partners_supplement.json (다른 세션 sweep 회피)
"""
from __future__ import annotations
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path('/root/jinho-playground')
DB = ROOT / 'data' / 'ceo_mail.db'
SUPP = ROOT / 'public' / 'partners_supplement.json'
LEDGER = ROOT / 'data' / 'partner_ingest_seen.json'
REJECTED = ROOT / 'data' / 'partner_rejected.json'
LOG = Path('/var/log/auto_partner_ingest.log')
ENV_FILE = ROOT / '.env.local'

LOOKBACK_DAYS = 30
MAX_PER_RUN = 5

KEYWORDS = [
    # 한국어
    '협업', '콜라보', '파트너십', '매니지먼트', '소속 아티스트', '소속 모델',
    '소속 크리에이터', '소속 셀럽', '소속 인플루언서', '인플루언서', '섭외', '캐스팅',
    '배우 소개', '모델 소개', '아티스트 소개', '크리에이터 소개', '소개드립니다',
    '소개합니다', '광고 모델', '뷰티 협업', '브랜드 협업', '광고/협찬', '룩북',
    '캠페인 브리프', '제안서 요청', '콘텐츠 협업', '광고 캠페인', '단가 안내',
    '협업 안내', '협찬 안내', '화보 패키지', '단독 화보',
    # 영어
    'Brand deal', 'Collaboration', 'collaboration', 'sponsorship',
    'partnership', 'casting', 'talent introduction',
]

SYSTEM_PROMPT = '''You are an expert at parsing Korean media/entertainment partnership emails into structured JSON.

Decide: IS this email a partnership/collaboration proposal from an agency/management company, or from someone introducing talents (artists/models/influencers/creators) for brand work?

Output ONLY a JSON object:

If YES, the email is a real partner proposal:
{
  "is_partner": true,
  "company": {
    "name": string,
    "category": "talent" | "makeup" | "media" | "expansion" | "mentor",
    "note": string,
    "contact": string,
    "introducedBy": "메일 콜드 인입"
  },
  "talents": [
    { "name": string, "role": string, "manager": string, "contact": string }
  ]
}

If NO (just generic sales/ad/newsletter/spam):
{ "is_partner": false, "reason": string }

Rules:
- Real partnership emails describe artists/models/creators by name + portfolio. Generic ads/promos are NOT.
- category: "talent" for celebrity/idol/influencer/엔터 agencies. "makeup" for 메이크업샵. "media" for 콘텐츠 회사. "mentor" for 개인 멘토/고문.
- Korean names stay Korean. Contact info as-is.
- talents: include all named talents from the email. If none specifically named, empty array.
- role: short summary of talent's career (방송/광고/매거진 highlights).
- manager: name of the sender if mentioned, else empty.
- Output JSON only, no commentary, no markdown fences.

CRITICAL REJECTIONS (set is_partner=false):
1. Sender is from 뷰스컴퍼니 (beaus.co.kr / beauscompany / 박진호) — these are OUR OWN emails, never a partner.
2. Email is a REPLY/answer to client requests (대행 문의 답변, 진행 상황, 회신, 답변의 건 etc) — these are existing clients, not new partners.
3. B2B networking platforms (로켓펀치, 리멤버, etc) pitching their service — not a talent agency.
4. Brand product newsletters/promos (광고 메일, 신상품 출시) — not a partnership proposal.
5. Investment/funding/loan offers — not relevant.
6. Recruiting/HR (이력서, 채용 지원) — not a partner agency.

Only accept if: external agency or representative proposing artists/talents/influencers for collaboration with us as a client/buyer.'''


def log(msg: str):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
    print(line, end='', file=sys.stderr)
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open('a', encoding='utf-8') as f:
            f.write(line)
    except Exception:
        pass


def notify(text: str):
    """beaus-send result <text> — 사용자 요청으로 발신 push OFF (2026-05-16).
    재활성 시 _DISABLE 라인 제거하면 됨."""
    _DISABLED_BY_USER = True
    if _DISABLED_BY_USER:
        log(f"  notify skipped (push OFF): {text[:80]}")
        return
    try:
        subprocess.run(
            ["/usr/local/bin/beaus-send", "result", text],
            capture_output=True, timeout=30,
        )
    except Exception as e:
        log(f"  notify failed: {e}")


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for raw in path.read_text().splitlines():
        if not raw or raw.startswith('#') or '=' not in raw:
            continue
        k, _, v = raw.partition('=')
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_ledger() -> set:
    if not LEDGER.exists():
        return set()
    try:
        return set(json.loads(LEDGER.read_text())['seen'])
    except Exception:
        return set()


def load_rejected_names() -> set:
    """사용자가 reject한 partner 이름 — 재인입 방지."""
    if not REJECTED.exists():
        return set()
    try:
        data = json.loads(REJECTED.read_text())
        return {r['name'] for r in data.get('rejected', []) if r.get('name')}
    except Exception:
        return set()


def save_ledger(seen: set):
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps({'seen': sorted(seen), 'updatedAt': int(time.time())}, ensure_ascii=False, indent=2))


def keyword_match(text: str) -> bool:
    for kw in KEYWORDS:
        if kw in text:
            return True
    return False


def pdftotext(path: str) -> str:
    try:
        r = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, timeout=30)
        if r.returncode == 0:
            return r.stdout.decode('utf-8', errors='replace')
    except Exception as e:
        log(f'pdftotext failed: {e}')
    return ''


def attachments_text(attachments_json):
    if not attachments_json:
        return ''
    try:
        atts = json.loads(attachments_json)
    except Exception:
        return ''
    parts = []
    for a in atts:
        if a.get('mime') != 'application/pdf':
            continue
        url = a.get('url', '')
        if not url:
            continue
        path = ROOT / 'public' / url.lstrip('/')
        if not path.exists():
            log(f'  PDF not on disk: {path}')
            continue
        txt = pdftotext(str(path))
        if txt:
            parts.append(f"--- PDF: {a.get('name','')} ---\n{txt[:8000]}")
    return '\n\n'.join(parts)


def _claude_once(api_key, body, max_tokens):
    payload = json.dumps({
        'model': 'claude-haiku-4-5-20251001',
        'max_tokens': max_tokens,
        'system': SYSTEM_PROMPT,
        'messages': [{'role': 'user', 'content': body[:16000]}],
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=payload, method='POST',
        headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + api_key,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'oauth-2025-04-20',
        })
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def call_claude(api_key, body):
    # 1차: max_tokens=4000. JSON parse 실패 시 max_tokens=8000으로 1회 재시도.
    for attempt, mt in enumerate([4000, 8000]):
        try:
            d = _claude_once(api_key, body, mt)
            raw = (d.get('content') or [{}])[0].get('text', '')
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'```\s*$', '', raw)
            start = raw.find('{')
            end = raw.rfind('}')
            if start < 0 or end < 0:
                log(f'  no JSON in response (attempt {attempt+1}): {raw[:200]}')
                continue
            return json.loads(raw[start:end+1])
        except json.JSONDecodeError as e:
            log(f'  parse fail (attempt {attempt+1}, mt={mt}): {e}')
            continue
        except urllib.error.HTTPError as e:
            log(f'  HTTP {e.code}: {e.read()[:200]}')
            return None
        except Exception as e:
            log(f'  claude error: {e}')
            return None
    return None


def load_supp():
    if not SUPP.exists():
        return {'updatedAt': int(time.time()), 'members_by_talent': {}, 'additional_partners': []}
    try:
        d = json.loads(SUPP.read_text())
    except Exception:
        d = {}
    d.setdefault('members_by_talent', {})
    d.setdefault('additional_partners', [])
    return d


def save_supp(d):
    d['updatedAt'] = int(time.time())
    SUPP.write_text(json.dumps(d, ensure_ascii=False, indent=2))


def merge_partner(supp, parsed, msg_meta):
    comp = parsed.get('company') or {}
    name = (comp.get('name') or '').strip()
    if not name:
        return ''
    existing = next((p for p in supp['additional_partners'] if p.get('name') == name), None)
    partner_obj = {
        'name': name,
        'category': comp.get('category') or 'talent',
        'status': 'watching',
        'contact': comp.get('contact') or '',
        'note': comp.get('note') or '',
        'introducedBy': comp.get('introducedBy') or '메일 콜드 인입',
        'lastTouch': msg_meta.get('date_kst', ''),
        'nextAction': '메일 검토 후 회신',
        'briefUrl': msg_meta.get('pdf_url') or '',
        'autoIngested': True,
        'ingestedAt': int(time.time()),
        'talents': [],
    }
    new_talents = []
    for t in (parsed.get('talents') or []):
        n = (t.get('name') or '').strip()
        if not n:
            continue
        new_talents.append({
            'name': n,
            'role': t.get('role') or '',
            'manager': t.get('manager') or '',
            'contact': t.get('contact') or '',
            'status': 'reviewing',
            'briefUrl': msg_meta.get('pdf_url') or '',
        })

    if existing:
        existing_names = {t.get('name') for t in existing.get('talents', [])}
        for t in new_talents:
            if t['name'] not in existing_names:
                existing.setdefault('talents', []).append(t)
        if not existing.get('briefUrl') and partner_obj['briefUrl']:
            existing['briefUrl'] = partner_obj['briefUrl']
        if not existing.get('note') and partner_obj['note']:
            existing['note'] = partner_obj['note']
        return 'update'
    partner_obj['talents'] = new_talents
    supp['additional_partners'].append(partner_obj)
    return 'add'


def main():
    env = load_env(ENV_FILE)
    api_key = env.get('ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        log('ANTHROPIC_API_KEY missing')
        return 1

    ledger = load_ledger()
    rejected_names = load_rejected_names()
    cutoff = int(time.time()) - LOOKBACK_DAYS * 86400

    con = sqlite3.connect(str(DB))
    cur = con.execute("""
        SELECT message_id, date_ts, from_name, from_addr, subject, snippet, body_full, attachments, ai_category
        FROM messages
        WHERE date_ts > ?
          AND ai_category IN ('sales', 'client')
          AND subject NOT LIKE 'RE:%'
          AND subject NOT LIKE 'Re:%'
          AND subject NOT LIKE 'FW:%'
          AND subject NOT LIKE 'Fw:%'
          AND (trashed_at IS NULL OR trashed_at = 0)
        ORDER BY date_ts DESC
        LIMIT 200
    """, (cutoff,))
    rows = cur.fetchall()
    con.close()

    log(f'후보 {len(rows)}건 (최근 {LOOKBACK_DAYS}일 sales/client)')

    supp = load_supp()
    processed = 0
    added = 0
    updated = 0
    skipped = 0
    rejected = 0

    for row in rows:
        if processed >= MAX_PER_RUN:
            break
        msg_id, ts, from_name, from_addr, subject, snippet, body, atts, cat = row
        if msg_id in ledger:
            continue

        body = body or snippet or ''
        merged_text = f'From: {from_name} <{from_addr}>\nSubject: {subject}\n\n{body}'
        if not keyword_match(merged_text):
            ledger.add(msg_id)
            skipped += 1
            continue

        pdf_text = attachments_text(atts)
        pdf_url = ''
        try:
            if atts:
                first_pdf = next((a for a in json.loads(atts) if a.get('mime') == 'application/pdf'), None)
                if first_pdf:
                    pdf_url = first_pdf.get('url') or ''
        except Exception:
            pass

        full = merged_text
        if pdf_text:
            full += '\n\n=== 첨부 PDF 텍스트 ===\n' + pdf_text

        log(f'→ {from_name} | {subject[:50]}')
        parsed = call_claude(api_key, full)
        processed += 1

        if not parsed or not parsed.get('is_partner'):
            reason = (parsed or {}).get('reason', '')
            log(f'  ✗ partner 아님 ({reason[:80]})')
            ledger.add(msg_id)
            rejected += 1
            continue

        parsed_name = ((parsed.get('company') or {}).get('name') or '').strip()
        if parsed_name and parsed_name in rejected_names:
            log(f'  ⊘ 사용자 reject 목록에 있음 → skip ({parsed_name})')
            ledger.add(msg_id)
            rejected += 1
            continue

        date_kst = time.strftime('%Y-%m-%d', time.localtime(ts + 9 * 3600))
        msg_meta = {'date_kst': date_kst, 'pdf_url': pdf_url}
        action = merge_partner(supp, parsed, msg_meta)
        if action == 'add':
            added += 1
            log(f'  ✓ ADD {parsed["company"]["name"]} (talents={len(parsed.get("talents") or [])})')
        elif action == 'update':
            updated += 1
            log(f'  ↻ UPDATE {parsed["company"]["name"]} (talents merge)')
        ledger.add(msg_id)

    save_supp(supp)
    save_ledger(ledger)
    log(f'== 완료: processed={processed} add={added} update={updated} reject={rejected} skip={skipped} ==')

    # 새로 추가된 partner 있으면 텔레그램 result 채널에 알림
    if added > 0 or updated > 0:
        recent_names = []
        for p in supp.get("additional_partners", [])[-(added + updated):]:
            t_count = len(p.get("talents") or [])
            recent_names.append(f"{p['name']} (talents {t_count})")
        msg = (
            f"🤝 협업 메일 자동 인입 — {added}건 신규 / {updated}건 업데이트\n"
            + "\n".join("· " + n for n in recent_names[-5:])
            + "\n→ /partners 페이지에서 검토"
        )
        notify(msg)


if __name__ == '__main__':
    sys.exit(main() or 0)

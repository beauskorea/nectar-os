#!/usr/bin/env python3
"""ceo_mail.db 집계 → JSON stdout. /api/mail/insights 에서 spawn."""
import sqlite3, json, sys, re, time, collections, os

DB = "/root/jinho-playground/data/ceo_mail.db"

# 뷰스/Beaus 는 우리 회사 발송 표식 — 단독 태그는 카운트 제외, 콜라보는 회사명 부분만 남김
BRAND_ALIASES = {
    "beaus company": "뷰스컴퍼니",
    "beauscompany": "뷰스컴퍼니",
}
_BEAUS_ALONE_RE = re.compile(r"^(뷰스컴퍼니|뷰스|beaus( company)?)$", re.IGNORECASE)
_BEAUS_PREFIX_RE = re.compile(
    r"^\s*(뷰스컴퍼니|뷰스|beaus( company)?)\s*[/xX×·]\s*", re.IGNORECASE
)
_BEAUS_SUFFIX_RE = re.compile(
    r"\s*[/xX×·]\s*(뷰스컴퍼니|뷰스|beaus( company)?)\s*$", re.IGNORECASE
)
_BEAUS_MIDDLE_RE = re.compile(
    r"\s*[/xX×·]\s*(뷰스컴퍼니|뷰스|beaus( company)?)\s*[/xX×·]\s*", re.IGNORECASE
)


def normalize_brand(tag):
    """브랜드 태그 정규화. None 반환 = 우리 회사 단독 표식이라 카운트 제외."""
    if not tag:
        return None
    t = str(tag).strip()
    if not t:
        return None
    t = BRAND_ALIASES.get(t.lower(), t)
    if _BEAUS_ALONE_RE.match(t):
        return None
    t = _BEAUS_PREFIX_RE.sub("", t)
    t = _BEAUS_SUFFIX_RE.sub("", t)
    t = _BEAUS_MIDDLE_RE.sub("/", t)
    t = t.strip().strip("/").strip()
    return t or None

def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cats_known = ['client', 'sales', 'finance', 'urgent', 'event', 'lecture', 'news', 'noise']

    # totals
    total = cur.execute("SELECT COUNT(*) c FROM messages WHERE trashed_at IS NULL").fetchone()['c']
    classified = cur.execute("SELECT COUNT(*) c FROM messages WHERE trashed_at IS NULL AND ai_category IS NOT NULL").fetchone()['c']

    # today list (KST)
    today_rows = cur.execute("""
        SELECT message_id, date_ts, from_name, from_addr, subject, ai_category, priority, ai_summary
        FROM messages
        WHERE trashed_at IS NULL
          AND date(date_ts, 'unixepoch', '+9 hours') = date('now', '+9 hours')
        ORDER BY date_ts DESC
    """).fetchall()

    today = [{
        "id": r['message_id'],
        "ts": r['date_ts'],
        "from": r['from_name'] or r['from_addr'] or '',
        "subject": r['subject'] or '',
        "category": r['ai_category'],
        "priority": r['priority'],
        "summary": (r['ai_summary'] or '')[:200],
    } for r in today_rows]

    # 14d & 30d matrices (date × category)
    def build_matrix(days):
        rows = cur.execute("""
            SELECT date(date_ts, 'unixepoch', '+9 hours') d,
                   COALESCE(ai_category, 'pending') cat,
                   COUNT(*) n
            FROM messages
            WHERE trashed_at IS NULL
              AND date_ts >= strftime('%s', 'now', ?)
            GROUP BY 1, 2
        """, (f'-{days} days',)).fetchall()
        bucket = collections.defaultdict(lambda: {c: 0 for c in cats_known + ['pending']})
        for r in rows:
            bucket[r['d']][r['cat']] = r['n']
        out = []
        for d, vals in sorted(bucket.items(), reverse=True):
            row = {"date": d, **vals}
            row["total"] = sum(vals.values())
            out.append(row)
        return out

    matrix_14d = build_matrix(14)
    matrix_30d = build_matrix(30)

    # brand tag leaderboard (client/sales/event, 30d)
    subs = cur.execute("""
        SELECT subject
        FROM messages
        WHERE trashed_at IS NULL
          AND ai_category IN ('client', 'sales', 'event')
          AND date_ts >= strftime('%s', 'now', '-30 days')
          AND subject LIKE '%[%]%'
    """).fetchall()
    brand_re = re.compile(r"\[([^\]]+)\]")
    counter = collections.Counter()
    for r in subs:
        for m in brand_re.findall(r['subject'] or ''):
            tag = normalize_brand(m)
            if tag:
                counter[tag] += 1
    brands = [{"tag": t, "n": n} for t, n in counter.most_common(40)]

    # top senders per category (30d)
    def top_senders(cat, limit=12):
        rows = cur.execute("""
            SELECT COALESCE(NULLIF(from_name, ''), from_addr) sender, COUNT(*) n
            FROM messages
            WHERE trashed_at IS NULL
              AND ai_category = ?
              AND date_ts >= strftime('%s', 'now', '-30 days')
            GROUP BY 1
            ORDER BY n DESC
            LIMIT ?
        """, (cat, limit)).fetchall()
        return [{"sender": r['sender'] or '(unknown)', "n": r['n']} for r in rows]

    # hourly distribution today
    hours = cur.execute("""
        SELECT CAST(strftime('%H', date_ts, 'unixepoch', '+9 hours') AS INT) h,
               COUNT(*) n
        FROM messages
        WHERE trashed_at IS NULL
          AND date(date_ts, 'unixepoch', '+9 hours') = date('now', '+9 hours')
        GROUP BY 1
        ORDER BY 1
    """).fetchall()

    # weekday distribution (30d)
    weekday = cur.execute("""
        SELECT CAST(strftime('%w', date_ts, 'unixepoch', '+9 hours') AS INT) w,
               COUNT(*) n
        FROM messages
        WHERE trashed_at IS NULL
          AND date_ts >= strftime('%s', 'now', '-30 days')
        GROUP BY 1
        ORDER BY 1
    """).fetchall()


    # per-day rollups (last 30d): brands, senders, sample subjects, cached summary
    day_rows = cur.execute("""
        SELECT date(date_ts, 'unixepoch', '+9 hours') d,
               ai_category, COALESCE(NULLIF(from_name,''), from_addr) sender,
               subject, priority
        FROM messages
        WHERE trashed_at IS NULL AND date_ts >= strftime('%s', 'now', '-30 days')
        ORDER BY date_ts DESC
    """).fetchall()
    days_map = collections.defaultdict(lambda: {
        'brands': collections.Counter(),
        'senders': collections.Counter(),
        'subjects_client': [],
        'subjects_event': [],
        'subjects_sales': [],
        'high_priority': [],
    })
    brand_re2 = re.compile(r"\[([^\]]+)\]")
    for r in day_rows:
        bucket = days_map[r['d']]
        sender = r['sender'] or '(unknown)'
        bucket['senders'][sender] += 1
        subj = r['subject'] or ''
        for m in brand_re2.findall(subj):
            tag = m.strip()
            if tag and len(tag) < 30:
                bucket['brands'][tag] += 1
        if r['ai_category'] == 'client' and len(bucket['subjects_client']) < 6:
            bucket['subjects_client'].append({'sender': sender, 'subject': subj[:80]})
        elif r['ai_category'] == 'event' and len(bucket['subjects_event']) < 4:
            bucket['subjects_event'].append({'sender': sender, 'subject': subj[:80]})
        elif r['ai_category'] == 'sales' and len(bucket['subjects_sales']) < 4:
            bucket['subjects_sales'].append({'sender': sender, 'subject': subj[:80]})
        if r['priority'] == 'high' and len(bucket['high_priority']) < 4:
            bucket['high_priority'].append({'sender': sender, 'subject': subj[:80], 'cat': r['ai_category']})

    # cached LLM summaries
    cache_rows = cur.execute("""
        SELECT date, summary, model, message_count, created_at
        FROM daily_summaries
        WHERE date >= date('now', '+9 hours', '-30 days')
    """).fetchall()
    cache_map = {r['date']: dict(r) for r in cache_rows}

    days = []
    for d in sorted(days_map.keys(), reverse=True):
        b = days_map[d]
        days.append({
            'date': d,
            'top_brands': [{'tag': t, 'n': n} for t, n in b['brands'].most_common(8)],
            'top_senders': [{'sender': s, 'n': n} for s, n in b['senders'].most_common(5)],
            'subjects': {
                'client': b['subjects_client'],
                'event': b['subjects_event'],
                'sales': b['subjects_sales'],
                'high_priority': b['high_priority'],
            },
            'summary': cache_map.get(d, {}).get('summary'),
            'summary_model': cache_map.get(d, {}).get('model'),
            'summary_created_at': cache_map.get(d, {}).get('created_at'),
        })


    # cleanup candidates
    noise_rows = cur.execute("""
        SELECT message_id, date_ts, COALESCE(NULLIF(from_name,''), from_addr) sender, subject
        FROM messages
        WHERE trashed_at IS NULL AND ai_category='noise'
          AND date_ts >= strftime('%s','now','-30 days')
        ORDER BY date_ts DESC LIMIT 30
    """).fetchall()
    cleanup_noise = [{'id': r['message_id'], 'ts': r['date_ts'], 'sender': r['sender'] or '', 'subject': r['subject'] or ''} for r in noise_rows]

    nl_rows = cur.execute("""
        SELECT COALESCE(NULLIF(from_name,''), from_addr) sender, from_addr, COUNT(*) n
        FROM messages
        WHERE trashed_at IS NULL AND ai_category IN ('news','lecture')
          AND date_ts >= strftime('%s','now','-30 days')
        GROUP BY 1 HAVING n >= 3 ORDER BY n DESC LIMIT 20
    """).fetchall()
    cleanup_newsletters = [{'sender': r['sender'] or '', 'from_addr': r['from_addr'] or '', 'n': r['n']} for r in nl_rows]

    mb_rows = cur.execute("""
        SELECT COALESCE(NULLIF(from_name,''), from_addr) sender, from_addr, COUNT(*) n
        FROM messages
        WHERE trashed_at IS NULL AND ai_category IN ('news','sales','noise') OR ai_category IS NULL
        AND date_ts >= strftime('%s','now','-30 days')
        GROUP BY 1 HAVING n >= 5 ORDER BY n DESC LIMIT 15
    """).fetchall()
    # Note: above WHERE clauses had OR precedence issue. Rewriting cleanly:
    mb_rows = cur.execute("""
        SELECT COALESCE(NULLIF(from_name,''), from_addr) sender, from_addr, COUNT(*) n
        FROM messages
        WHERE trashed_at IS NULL
          AND (ai_category IN ('news','sales','noise') OR ai_category IS NULL)
          AND date_ts >= strftime('%s','now','-30 days')
        GROUP BY 1 HAVING n >= 5 ORDER BY n DESC LIMIT 15
    """).fetchall()
    cleanup_mass_blast = [{'sender': r['sender'] or '', 'from_addr': r['from_addr'] or '', 'n': r['n']} for r in mb_rows]

    pending_count = cur.execute("""
        SELECT COUNT(*) c FROM messages WHERE trashed_at IS NULL AND ai_category IS NULL
    """).fetchone()['c']

    out = {
        "updated_at": int(time.time()),
        "totals": {
            "total": total,
            "classified": classified,
            "pending": total - classified,
            "coverage_pct": round(100 * classified / total, 1) if total else 0,
        },
        "today": today,
        "today_hours": [{"hour": r['h'], "n": r['n']} for r in hours],
        "weekday_30d": [{"w": r['w'], "n": r['n']} for r in weekday],
        "matrix_14d": matrix_14d,
        "matrix_30d": matrix_30d,
        "brands_30d": brands,
        "top_senders": {
            "client": top_senders("client"),
            "sales": top_senders("sales"),
            "finance": top_senders("finance"),
            "event": top_senders("event"),
        },
        "days": days,
        "cleanup": {
            "noise_to_trash": cleanup_noise,
            "newsletters": cleanup_newsletters,
            "mass_blasters": cleanup_mass_blast,
            "pending_uncategorized": pending_count,
        },
        "sales_inbox": build_sales_inbox(cur),
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


def build_sales_inbox(cur):
    """조아해 영업 큐레이션 — from_addr LIKE '%ahaejo%' 기준 (어느 계정 라우팅이든).
       옛날엔 beautysketchkorea@ 로 forwarding 했고 지금은 ceo@beaus.co.kr 로 들어옴.
       최근 90일 위주 분석, 옛날 메일은 legacy_total로 참고용 표시.
    """
    import time
    now_ts = int(time.time())
    SENDER_PATTERN = "%ahaejo%"  # from_addr에서 조아해 패턴
    WINDOW_DAYS = 90
    cutoff_ts = now_ts - WINDOW_DAYS * 86400

    legacy_total = cur.execute(
        "SELECT COUNT(*) FROM messages WHERE from_addr LIKE ? AND trashed_at IS NULL",
        (SENDER_PATTERN,),
    ).fetchone()[0]
    last_activity_ts = cur.execute(
        "SELECT MAX(date_ts) FROM messages WHERE from_addr LIKE ? AND trashed_at IS NULL",
        (SENDER_PATTERN,),
    ).fetchone()[0]

    if legacy_total == 0:
        return {
            "total": 0, "legacy_total": 0, "window_days": WINDOW_DAYS,
            "last_activity_ts": None,
            "companies_count": 0, "recent": [], "today_actions": [], "recent_mails": [],
        }

    # 최근 90일 메일만 가져옴
    rows = cur.execute(
        """
        SELECT message_id, date_ts, COALESCE(NULLIF(from_name,''), from_addr) sender,
               from_addr, to_raw, subject, snippet
        FROM messages
        WHERE from_addr LIKE ? AND trashed_at IS NULL AND date_ts >= ?
        ORDER BY date_ts DESC
        """,
        (SENDER_PATTERN, cutoff_ts),
    ).fetchall()
    total_window = len(rows)

    if total_window == 0:
        # 최근 90일 활동 없음 — 옛날 데이터는 안 보냄
        return {
            "total": 0,
            "legacy_total": legacy_total,
            "window_days": WINDOW_DAYS,
            "last_activity_ts": last_activity_ts,
            "companies_count": 0,
            "recent": [],
            "today_actions": [],
            "recent_mails": [],
        }

    # company extraction: 우선 subject [회사명] 패턴, 없으면 from_addr 도메인
    import re, collections
    bracket_re = re.compile(r"\[([^\]]+)\]")
    company_buckets = collections.defaultdict(lambda: {
        "company": None,
        "n": 0,
        "last_ts": 0,
        "last_subject": "",
        "last_sender": "",
        "samples": [],
    })

    for r in rows:
        subject = r["subject"] or ""
        from_addr = (r["from_addr"] or "").lower()
        # 1) try bracket pattern [Meeting Request-Zando Agency] → "Zando Agency"
        tag = None
        for m in bracket_re.findall(subject):
            t = m.strip()
            # skip pure noise
            if t.lower() in {"fw", "fwd", "re", "ad", "광고"}:
                continue
            if "meeting request" in t.lower():
                # "Meeting Request-Zando Agency" → after dash
                m2 = re.split(r"[-—:]", t, 1)
                if len(m2) == 2 and m2[1].strip():
                    cand = m2[1].strip()
                    cand = normalize_brand(cand) or None
                    if cand:
                        tag = cand
                        break
                    else:
                        continue
            # normalize: 뷰스컴퍼니 단독은 skip, 콜라보면 회사명만 추출
            cand = normalize_brand(t)
            if cand:
                tag = cand
                break
        if not tag:
            # fall back: 조아해 발신이면 to_raw(외부 수신자) 도메인이 진짜 영업 상대.
            # 우리 회사 도메인(beaus, beautysketch, beauscontents) 은 skip.
            INTERNAL = {"beaus", "beauskorea", "beautysketch", "beautysketchkorea", "beauscontents", "gmail", "naver"}
            cand_domains = []
            to_raw = (r["to_raw"] or "").lower()
            for em in re.findall(r"[\w\.\-]+@[\w\.\-]+", to_raw):
                dom = em.split("@", 1)[1].split(".")[0]
                if dom and dom not in INTERNAL:
                    cand_domains.append(dom)
            if cand_domains:
                tag = cand_domains[0]
            elif "@" in from_addr:
                dom = from_addr.split("@")[1].split(".")[0]
                if dom and dom not in INTERNAL:
                    tag = dom
                else:
                    tag = "기타"
            else:
                tag = "기타"

        key = tag.lower()[:40]
        b = company_buckets[key]
        b["company"] = tag
        b["n"] += 1
        if r["date_ts"] > b["last_ts"]:
            b["last_ts"] = r["date_ts"]
            b["last_subject"] = subject[:90]
            b["last_sender"] = r["sender"] or ""
        if len(b["samples"]) < 3:
            b["samples"].append({
                "id": r["message_id"],
                "ts": r["date_ts"],
                "subject": subject[:90],
            })

    companies = sorted(
        company_buckets.values(),
        key=lambda b: (-b["last_ts"], -b["n"]),
    )

    # 모든 회사가 90일 윈도우 내 (옛날은 위에서 필터됨)
    recent = [
        {
            "company": b["company"],
            "n": b["n"],
            "last_ts": b["last_ts"],
            "last_subject": b["last_subject"],
            "last_sender": b["last_sender"],
            "days_since": (now_ts - b["last_ts"]) // 86400,
        }
        for b in companies
    ]

    # follow-up 필요한 회사 = 최근 30일 내 활동
    SECONDS_30D = 30 * 86400
    today_actions = []
    for b in companies[:30]:
        if now_ts - b["last_ts"] > SECONDS_30D:
            continue
        subj = b["last_subject"]
        action = "회신 follow-up" if re.match(r"^(re|RE|Re|fwd|FWD|Fwd|fw|FW|Fw):", subj.strip()) else "초기 회신 필요"
        today_actions.append({
            "company": b["company"],
            "action": action,
            "last_ts": b["last_ts"],
            "last_subject": subj,
            "days_since": (now_ts - b["last_ts"]) // 86400,
        })

    recent_mails = [
        {
            "id": r["message_id"],
            "ts": r["date_ts"],
            "sender": r["sender"] or "",
            "subject": r["subject"] or "",
        }
        for r in rows[:30]
    ]

    return {
        "total": total_window,
        "legacy_total": legacy_total,
        "window_days": WINDOW_DAYS,
        "last_activity_ts": last_activity_ts,
        "companies_count": len(companies),
        "recent": recent[:25],
        "today_actions": today_actions[:10],
        "recent_mails": recent_mails,
    }

if __name__ == "__main__":
    main()

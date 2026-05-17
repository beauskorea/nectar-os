#!/usr/bin/env python3
"""
fetch_ceo_mail.py v2 — ceo@beaus.co.kr IMAP fetcher.
Changes vs v1:
  - DAYS 30 -> 90
  - body_full column (HTML stripped, up to 8000 chars)
  - JSON dump includes priority/category/ai_summary (from classify_priority.py)
"""
import imaplib, ssl, os, email, sqlite3, json, sys, re
from email.header import decode_header
from email.utils import parsedate_to_datetime, getaddresses
from datetime import datetime, timedelta, timezone

HOST = "imap.worksmobile.com"
PORT = 993
ENV  = "/root/.openclaw/secrets/nerve.env"
DB   = "/root/jinho-playground/data/ceo_mail.db"
JSON_OUT = "/root/jinho-playground/public/mail.json"
DAYS = 90
JSON_LIMIT = 600
BODY_MAX = 8000

# Rule-based pre-classification (skip AI for known noise)
NOISE_SENDERS = re.compile(
    r"(noreply|no-reply|donotreply|notification|security@|alerts?@|"
    r"newsletter|marketing|info@instagram|mail\.instagram|"
    r"facebookmail|tiktok|linkedin|youtube\.com|gmail\.com.*noreply)",
    re.I,
)

def load_env():
    e = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip('"').strip("'")
    return e

def dec(s):
    if not s: return ""
    parts = decode_header(s)
    return "".join(
        (b.decode(c or "utf-8", errors="ignore") if isinstance(b, bytes) else b)
        for b, c in parts
    ).strip()

def first_addr(s):
    if not s: return ("", "")
    addrs = getaddresses([s])
    if not addrs: return ("", s)
    name, addr = addrs[0]
    return (dec(name), addr.lower())

ATTACH_DIR = "/root/jinho-playground/public/mail-images"  # 디렉토리명 유지 (이미지+파일 공용)
MAX_IMAGE_BYTES = 5 * 1024 * 1024     # 5MB
MAX_FILE_BYTES = 15 * 1024 * 1024     # 15MB (PDF·Excel·DOC 등)
IMAGE_MIMES = ("image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "image/bmp")
# 위험 확장자 (실행파일) 차단
BLOCKED_EXTS = (".exe", ".bat", ".cmd", ".scr", ".msi", ".dll", ".sh", ".com", ".vbs", ".js", ".jar")

def _safe_dir_name(s):
    return re.sub(r"[^a-zA-Z0-9_-]", "_", s)[:80]

def _safe_filename(s):
    s = re.sub(r"[/\\\x00-\x1f]", "_", s)
    return s[:120] or "file"

def extract_attachments(msg, msgid):
    """첨부 메타데이터 추출 + 이미지/파일 디스크 저장 + Content-ID 매핑.
    반환: {"attachments": [...meta], "cid_map": {cid: url}}
    """
    out = []
    cid_map = {}
    if not msg.is_multipart(): return {"attachments": out, "cid_map": cid_map}
    msg_dir_name = _safe_dir_name(msgid)
    msg_dir = None
    seen_names = set()
    for part in msg.walk():
        disp = (part.get("Content-Disposition") or "").lower()
        ctype = (part.get_content_type() or "").lower()
        filename = part.get_filename()
        is_attachment = "attachment" in disp or (filename and "inline" in disp)
        is_named_inline = filename and ctype not in ("text/plain", "text/html")
        is_image_inline = ctype.startswith("image/")  # cid:로 박혀있는 인라인 이미지도 잡기
        if not (is_attachment or is_named_inline or is_image_inline): continue

        try:
            payload = part.get_payload(decode=True) or b""
            size = len(payload)
            if size == 0: continue
        except Exception:
            continue

        name = dec(filename) if filename else f"inline_{len(out)+1}"
        name = _safe_filename(name)
        # 중복 파일명 방지
        base = name; suffix = 1
        while name in seen_names:
            suffix += 1
            if "." in base:
                stem, ext = base.rsplit(".", 1)
                name = f"{stem}_{suffix}.{ext}"
            else:
                name = f"{base}_{suffix}"
        seen_names.add(name)

        meta = {"name": name, "mime": ctype, "size": size}
        cid_header = part.get("Content-ID") or part.get("Content-Id") or ""
        cid_clean = cid_header.strip().strip("<>")
        if cid_clean:
            meta["cid"] = cid_clean

        # 디스크 저장 결정: 이미지 5MB / 그 외 15MB / 위험 확장자 차단
        is_image = ctype in IMAGE_MIMES
        ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
        is_blocked = ext in BLOCKED_EXTS
        size_ok = (size <= MAX_IMAGE_BYTES) if is_image else (size <= MAX_FILE_BYTES)
        should_save = (not is_blocked) and size_ok

        if should_save:
            if msg_dir is None:
                msg_dir = os.path.join(ATTACH_DIR, msg_dir_name)
                os.makedirs(msg_dir, exist_ok=True)
            try:
                path = os.path.join(msg_dir, name)
                with open(path, "wb") as f:
                    f.write(payload)
                meta["url"] = f"/mail-images/{msg_dir_name}/{name}"
                if cid_clean and is_image:
                    cid_map[cid_clean] = meta["url"]
            except Exception as e:
                print(f"[ceo_mail] save err id={msgid} name={name}: {e}", file=sys.stderr)

        out.append(meta)
    return {"attachments": out, "cid_map": cid_map}

HTML_MAX = 200_000  # 200KB per message

def body_html(msg, cid_map):
    """원본 HTML 추출 + script/iframe/on* attrs 제거 + cid: → 디스크 URL 치환."""
    html_part = None
    if msg.is_multipart():
        for part in msg.walk():
            ctype = (part.get_content_type() or "").lower()
            disp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disp: continue
            if ctype == "text/html":
                try:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    html_part = payload.decode(charset, errors="ignore")
                    if html_part.strip(): break
                except Exception:
                    continue
    elif (msg.get_content_type() or "").lower() == "text/html":
        try:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            html_part = payload.decode(charset, errors="ignore")
        except Exception:
            pass

    if not html_part: return None

    # 보안 sanitize
    html_part = re.sub(r"<script[^>]*>.*?</script>", "", html_part, flags=re.S | re.I)
    html_part = re.sub(r"<iframe[^>]*>.*?</iframe>", "", html_part, flags=re.S | re.I)
    html_part = re.sub(r"<object[^>]*>.*?</object>", "", html_part, flags=re.S | re.I)
    html_part = re.sub(r"<embed[^>]*/?>", "", html_part, flags=re.I)
    html_part = re.sub(r"\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]*)", "", html_part, flags=re.I)
    html_part = re.sub(r"javascript:", "", html_part, flags=re.I)

    # cid: 치환
    for cid_id, url in cid_map.items():
        html_part = html_part.replace(f"cid:{cid_id}", url)
        html_part = html_part.replace(f"CID:{cid_id}", url)
        # angle brackets variant
        html_part = html_part.replace(f"cid:<{cid_id}>", url)

    # 외부 추적 이미지 차단 (옵션) — 일단 그대로 두고 사용자 차후 결정
    return html_part[:HTML_MAX]

def body_text(msg):
    text = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disp: continue
            if ctype == "text/plain":
                try:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    text = payload.decode(charset, errors="ignore")
                    if text.strip(): break
                except Exception:
                    continue
        if not text:
            for part in msg.walk():
                if part.get_content_type() == "text/html":
                    try:
                        payload = part.get_payload(decode=True) or b""
                        charset = part.get_content_charset() or "utf-8"
                        text = payload.decode(charset, errors="ignore")
                        break
                    except Exception:
                        continue
    else:
        try:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="ignore")
        except Exception:
            text = msg.get_payload() or ""
    # HTML 정리 — 줄바꿈을 유지하기 위해 block 태그를 \n 으로 변환
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?\s*>", "\n", text, flags=re.I)
    text = re.sub(r"</?(p|div|li|tr|h[1-6]|blockquote|article|section|table|thead|tbody)[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"<li[^>]*>", "\n- ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&#39;|&apos;", "'", text)
    text = re.sub(r"&quot;", '"', text)
    # 공백 정리: 연속 스페이스/탭만 1개로, 줄바꿈은 보존 (3+ 연속 → 2개로 압축)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()
    return text[:BODY_MAX]

def ensure_db():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      uid INTEGER,
      folder TEXT,
      date_ts INTEGER,
      from_name TEXT,
      from_addr TEXT,
      to_raw TEXT,
      subject TEXT,
      snippet TEXT,
      body_full TEXT,
      unread INTEGER DEFAULT 0,
      priority TEXT,
      ai_category TEXT,
      ai_summary TEXT,
      classified_at INTEGER,
      fetched_at INTEGER
    )""")
    # Migrate existing DB (add columns if missing)
    cur = conn.execute("PRAGMA table_info(messages)")
    cols = {row[1] for row in cur.fetchall()}
    for col, ddl in [
        ("body_full", "ALTER TABLE messages ADD COLUMN body_full TEXT"),
        ("priority", "ALTER TABLE messages ADD COLUMN priority TEXT"),
        ("ai_category", "ALTER TABLE messages ADD COLUMN ai_category TEXT"),
        ("ai_summary", "ALTER TABLE messages ADD COLUMN ai_summary TEXT"),
        ("classified_at", "ALTER TABLE messages ADD COLUMN classified_at INTEGER"),
        ("ai_insight", "ALTER TABLE messages ADD COLUMN ai_insight TEXT"),
        ("attachments", "ALTER TABLE messages ADD COLUMN attachments TEXT"),
        ("body_html", "ALTER TABLE messages ADD COLUMN body_html TEXT"),
    ]:
        if col not in cols:
            conn.execute(ddl)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON messages(date_ts DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_priority ON messages(priority)")
    conn.commit()
    return conn

def main():
    env = load_env()
    user = env["NAVERWORKS_SMTP_USER"]
    pw   = env["NAVERWORKS_SMTP_PASS"]

    conn = ensure_db()
    cur = conn.cursor()

    since_dt = datetime.now(timezone.utc) - timedelta(days=DAYS)
    since_str = since_dt.strftime("%d-%b-%Y")

    M = imaplib.IMAP4_SSL(HOST, PORT)
    M.login(user, pw)
    M.select("INBOX", readonly=True)

    typ, data = M.uid("SEARCH", None, "SINCE", since_str)
    uids = data[0].split()
    print(f"[ceo_mail] {len(uids)} UIDs since {since_str}")

    typ, unseen_data = M.uid("SEARCH", None, "UNSEEN")
    unseen_set = set(unseen_data[0].split())

    # only fetch UIDs we don't already have OR whose body_full is missing
    existing = {row[0]: row[1] for row in cur.execute("SELECT message_id, body_full IS NOT NULL FROM messages")}

    now_ts = int(datetime.now(timezone.utc).timestamp())
    new_count = 0; upd_count = 0; skip_count = 0

    for uid in uids:
        uid_s = uid.decode()
        try:
            # peek header first to compute message_id, decide skip
            typ, msg_data = M.uid("FETCH", uid, "(BODY.PEEK[])")
            if not msg_data or not msg_data[0]: continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)

            msgid = dec(msg.get("Message-ID") or msg.get("Message-Id") or "") or f"uid:{uid_s}"
            subject = dec(msg.get("Subject") or "")
            from_name, from_addr = first_addr(msg.get("From") or "")
            to_raw = dec(msg.get("To") or "")
            date_str = msg.get("Date") or ""
            try:
                dt = parsedate_to_datetime(date_str)
                if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
                date_ts = int(dt.timestamp())
            except Exception:
                date_ts = 0
            body = body_text(msg)
            snippet = body[:400]
            unread = 1 if uid in unseen_set else 0
            att_result = extract_attachments(msg, msgid)
            atts = att_result.get("attachments", [])
            cid_map = att_result.get("cid_map", {})
            html_body = body_html(msg, cid_map)
            atts_json = json.dumps(atts, ensure_ascii=False) if atts else None

            # rule-based noise pre-tag
            is_noise = bool(NOISE_SENDERS.search(from_addr) or NOISE_SENDERS.search(from_name))

            cur.execute("SELECT priority FROM messages WHERE message_id=?", (msgid,))
            row = cur.fetchone()
            existing_priority = row[0] if row else None
            preset_priority = "low" if (is_noise and not existing_priority) else existing_priority
            preset_category = "noise" if (is_noise and not existing_priority) else None

            cur.execute("""
              INSERT INTO messages(message_id, uid, folder, date_ts, from_name, from_addr, to_raw, subject, snippet, body_full, body_html, unread, priority, ai_category, attachments, fetched_at)
              VALUES(?, ?, 'INBOX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(message_id) DO UPDATE SET
                uid=excluded.uid, date_ts=excluded.date_ts, from_name=excluded.from_name,
                from_addr=excluded.from_addr, to_raw=excluded.to_raw, subject=excluded.subject,
                snippet=excluded.snippet, body_full=excluded.body_full, body_html=excluded.body_html,
                unread=excluded.unread, attachments=excluded.attachments, fetched_at=excluded.fetched_at
            """, (msgid, int(uid_s), date_ts, from_name, from_addr, to_raw, subject, snippet, body, html_body, unread, preset_priority, preset_category, atts_json, now_ts))
            if row: upd_count += 1
            else: new_count += 1
        except Exception as e:
            print(f"[ceo_mail] uid={uid_s} err: {e}", file=sys.stderr)

        if (new_count + upd_count) % 50 == 0 and (new_count + upd_count):
            conn.commit()

    conn.commit()
    M.logout()
    print(f"[ceo_mail] new={new_count} updated={upd_count}")

    # JSON dump
    rows = cur.execute("""
      SELECT message_id, date_ts, from_name, from_addr, subject, snippet, body_full, unread,
             priority, ai_category, ai_summary, ai_insight, attachments, trashed_at, account, body_html
      FROM messages
      ORDER BY date_ts DESC
      LIMIT ?
    """, (JSON_LIMIT,)).fetchall()
    out = []
    for r in rows:
        atts = None
        if r[12]:
            try: atts = json.loads(r[12])
            except Exception: atts = None
        out.append({
            "id": r[0],
            "ts": r[1],
            "date": datetime.fromtimestamp(r[1], tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M") if r[1] else "",
            "fromName": r[2],
            "fromAddr": r[3],
            "subject": r[4],
            "snippet": r[5],
            "body": r[6] or "",
            "unread": bool(r[7]),
            "priority": r[8],
            "category": r[9],
            "aiSummary": r[10],
            "aiInsight": r[11],
            "attachments": atts,
            "trashed": bool(r[13]),
            "account": r[14] or 'ceo@beaus.co.kr',
            "bodyHtml": r[15] if len(r) > 15 else None,
        })
    os.makedirs(os.path.dirname(JSON_OUT), exist_ok=True)
    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump({"account": user, "count": len(out), "updatedAt": now_ts, "days": DAYS, "messages": out}, f, ensure_ascii=False)
    print(f"[ceo_mail] dumped {len(out)} -> {JSON_OUT}")

if __name__ == "__main__":
    main()

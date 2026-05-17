#!/usr/bin/env python3
"""
fetch_beautysketch_mail.py — beautysketchkorea@gmail.com Gmail IMAP fetcher.

조아해(ahaejo@beaus.co.kr)가 영업조사 후 포워딩한 메일만 수집.
ceo_mail.db 의 messages 테이블을 account 컬럼으로 공유.
"""
import imaplib, ssl, os, email, sqlite3, re, sys
from email.header import decode_header
from email.utils import parsedate_to_datetime, getaddresses
from datetime import datetime, timedelta, timezone

ENV  = "/root/.openclaw/secrets/nerve.env"
DB   = "/root/jinho-playground/data/ceo_mail.db"
ACCOUNT = "beautysketchkorea@gmail.com"
# DAYS=0 → 날짜 필터 끔 (조아해 fwd 487건 누적, 2025-04~2025-11 분포)
DAYS = int(os.environ.get("FETCH_DAYS", "0"))
BODY_MAX = 8000

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

def extract_text(msg):
    text = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                try:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    text = payload.decode(charset, errors="ignore")
                    if text.strip(): break
                except Exception:
                    continue
        if not text:
            for part in msg.walk():
                ct = part.get_content_type()
                if ct == "text/html":
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
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:BODY_MAX]

def ensure_account_column(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(messages)").fetchall()}
    if "account" not in cols:
        conn.execute("ALTER TABLE messages ADD COLUMN account TEXT DEFAULT 'ceo@beaus.co.kr'")
        conn.execute("UPDATE messages SET account='ceo@beaus.co.kr' WHERE account IS NULL")
        conn.commit()
    conn.execute("CREATE INDEX IF NOT EXISTS idx_account_date ON messages(account, date_ts DESC)")
    conn.commit()

def main():
    env = load_env()
    host = env.get("BEAUTYSKETCH_IMAP_HOST", "imap.gmail.com")
    user = env["BEAUTYSKETCH_IMAP_USER"]
    pw   = env["BEAUTYSKETCH_IMAP_PASS"]
    filter_from = env.get("BEAUTYSKETCH_FILTER_FROM", "ahaejo@beaus.co.kr")

    conn = sqlite3.connect(DB, timeout=30)
    ensure_account_column(conn)
    cur = conn.cursor()

    M = imaplib.IMAP4_SSL(host, 993)
    M.login(user, pw)
    M.select("INBOX", readonly=True)

    if DAYS > 0:
        since_dt = datetime.now(timezone.utc) - timedelta(days=DAYS)
        since_str = since_dt.strftime("%d-%b-%Y")
        typ, data = M.uid("SEARCH", None, "FROM", filter_from, "SINCE", since_str)
        scope = f"since {since_str}"
    else:
        typ, data = M.uid("SEARCH", None, "FROM", filter_from)
        scope = "all-time"
    uids = data[0].split() if data and data[0] else []
    print(f"[beautysketch] {len(uids)} UIDs from {filter_from} ({scope})")

    existing = {row[0] for row in cur.execute(
        "SELECT message_id FROM messages WHERE account=?", (ACCOUNT,)).fetchall()}

    now_ts = int(datetime.now(timezone.utc).timestamp())
    new_count = upd_count = err_count = 0

    for uid in uids:
        uid_s = uid.decode()
        try:
            typ, msg_data = M.uid("FETCH", uid, "(BODY.PEEK[])")
            if not msg_data or not msg_data[0]: continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)

            msgid = dec(msg.get("Message-ID") or msg.get("Message-Id") or "") or f"uid:{ACCOUNT}:{uid_s}"
            if msgid in existing:
                continue

            subject = dec(msg.get("Subject") or "")
            from_name, from_addr = first_addr(msg.get("From"))
            to_raw = msg.get("To") or ""
            try:
                date_dt = parsedate_to_datetime(msg.get("Date"))
                date_ts = int(date_dt.timestamp())
            except Exception:
                date_ts = now_ts

            body_full = extract_text(msg)
            snippet = body_full[:300]

            cur.execute("""
                INSERT OR REPLACE INTO messages
                  (message_id, uid, folder, date_ts, from_name, from_addr, to_raw,
                   subject, snippet, body_full, fetched_at, account)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """, (msgid, int(uid_s), "INBOX", date_ts, from_name, from_addr,
                  to_raw, subject, snippet, body_full, now_ts, ACCOUNT))
            new_count += 1
        except Exception as e:
            err_count += 1
            print(f"  err uid={uid_s}: {e!r}", file=sys.stderr)
        if (new_count + err_count) % 50 == 0 and (new_count + err_count) > 0:
            conn.commit()

    conn.commit()
    M.logout()
    total = cur.execute("SELECT COUNT(*) FROM messages WHERE account=?", (ACCOUNT,)).fetchone()[0]
    print(f"[beautysketch] new={new_count} err={err_count} total_in_db={total}")

if __name__ == "__main__":
    main()

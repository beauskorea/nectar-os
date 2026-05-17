#!/usr/bin/env python3
"""
trash_noise.py v2 — noise 분류 메일을 Trash 폴더로 MOVE
- busy_timeout, reconnect every N, slower pace, retry on SSL error
"""
import imaplib, ssl, os, sqlite3, sys, time, json
from datetime import datetime, timezone

HOST = "imap.worksmobile.com"
PORT = 993
ENV = "/root/.openclaw/secrets/nerve.env"
DB = "/root/jinho-playground/data/ceo_mail.db"
JSON_OUT = "/root/jinho-playground/public/mail.json"
TRASH_FOLDER = "\"Deleted Messages\""
MAX_PER_RUN = 500
RECONNECT_EVERY = 40
RATE_SLEEP = 0.4
DRY_RUN = os.environ.get("DRY_RUN") == "1"

def load_env():
    e = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip('"').strip("'")
    return e

def ensure_column(conn):
    cur = conn.execute("PRAGMA table_info(messages)")
    cols = {row[1] for row in cur.fetchall()}
    if "trashed_at" not in cols:
        conn.execute("ALTER TABLE messages ADD COLUMN trashed_at INTEGER")
        conn.commit()
        print("[trash] added trashed_at column", flush=True)

def imap_connect(user, pw):
    M = imaplib.IMAP4_SSL(HOST, PORT)
    M.login(user, pw)
    M.select("INBOX")
    return M

def main():
    env = load_env()
    user = env["NAVERWORKS_SMTP_USER"]
    pw = env["NAVERWORKS_SMTP_PASS"]

    conn = sqlite3.connect(DB, timeout=120)
    conn.execute("PRAGMA busy_timeout = 120000")
    ensure_column(conn)
    cur = conn.cursor()
    rows = cur.execute("""
      SELECT message_id, uid, subject, from_addr
      FROM messages
      WHERE ai_category = 'noise' AND trashed_at IS NULL
      ORDER BY date_ts ASC
      LIMIT ?
    """, (MAX_PER_RUN,)).fetchall()
    print(f"[trash] {len(rows)} noise messages pending (dry_run={DRY_RUN})", flush=True)
    if not rows:
        return

    M = imap_connect(user, pw)
    moved = 0; failed = 0; ops = 0
    now_ts = int(datetime.now(timezone.utc).timestamp())

    for msgid, uid, subject, from_addr in rows:
        if DRY_RUN:
            print(f"  [DRY] uid={uid} {from_addr[:30]:30s} | {(subject or '')[:50]}", flush=True)
            continue
        try:
            if ops > 0 and ops % RECONNECT_EVERY == 0:
                try: M.logout()
                except Exception: pass
                M = imap_connect(user, pw)
                print(f"  [trash] reconnected after {ops} ops", flush=True)
            typ, _ = M.uid("MOVE", str(uid), TRASH_FOLDER)
            if typ != "OK":
                typ_c, _ = M.uid("COPY", str(uid), TRASH_FOLDER)
                if typ_c != "OK":
                    failed += 1
                    continue
                M.uid("STORE", str(uid), "+FLAGS", "(\\Deleted)")
            cur.execute("UPDATE messages SET trashed_at=? WHERE message_id=?", (now_ts, msgid))
            moved += 1
            ops += 1
            if moved % 25 == 0:
                conn.commit()
                print(f"  [trash] progress {moved}/{len(rows)}", flush=True)
        except (imaplib.IMAP4.abort, imaplib.IMAP4.error, OSError) as e:
            print(f"  [trash] imap err uid={uid}: {e} — reconnecting", flush=True)
            try: M.logout()
            except Exception: pass
            try:
                M = imap_connect(user, pw)
            except Exception as e2:
                print(f"  [trash] reconnect failed: {e2}", flush=True)
                failed += 1
                break
            failed += 1
        except Exception as e:
            print(f"  [trash] err uid={uid}: {e}", flush=True)
            failed += 1
        time.sleep(RATE_SLEEP)

    conn.commit()
    if not DRY_RUN:
        try:
            M.expunge()
        except Exception:
            pass
        try:
            M.logout()
        except Exception:
            pass
    print(f"[trash] moved={moved} failed={failed}", flush=True)

    # JSON dump refresh
    rows = conn.execute("""
      SELECT message_id, date_ts, from_name, from_addr, subject, snippet, body_full, unread,
             priority, ai_category, ai_summary, trashed_at
      FROM messages
      ORDER BY date_ts DESC LIMIT 300
    """).fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r[0], "ts": r[1],
            "date": datetime.fromtimestamp(r[1], tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M") if r[1] else "",
            "fromName": r[2], "fromAddr": r[3], "subject": r[4],
            "snippet": r[5], "body": r[6] or "", "unread": bool(r[7]),
            "priority": r[8], "category": r[9], "aiSummary": r[10],
            "trashed": bool(r[11]),
        })
    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump({
            "account": user, "count": len(out),
            "updatedAt": now_ts, "days": 90,
            "messages": out,
        }, f, ensure_ascii=False)

if __name__ == "__main__":
    main()

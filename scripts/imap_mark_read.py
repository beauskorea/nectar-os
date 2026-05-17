#!/usr/bin/env python3
"""
imap_mark_read.py — message_id를 받아 Naver Works IMAP에서 \\Seen 플래그 설정.
Usage: imap_mark_read.py <message_id>
"""
import imaplib, sys, sqlite3, json

DB = "/root/jinho-playground/data/ceo_mail.db"
ENV = "/root/.openclaw/secrets/nerve.env"
HOST = "imap.worksmobile.com"
PORT = 993

def load_env():
    e = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip("\"'")
    return e

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: imap_mark_read.py <msgid>"}))
        sys.exit(2)
    msgid = sys.argv[1]

    conn = sqlite3.connect(DB, timeout=10.0)
    cur = conn.cursor()
    row = cur.execute("SELECT uid, folder, unread FROM messages WHERE message_id=?", (msgid,)).fetchone()
    if not row:
        print(json.dumps({"ok": False, "error": "message not found"}))
        sys.exit(1)
    uid, folder, unread = row
    folder = folder or "INBOX"

    # 이미 읽음이면 skip
    if not unread:
        conn.close()
        print(json.dumps({"ok": True, "skipped": True, "note": "already read"}))
        return

    e = load_env()
    try:
        M = imaplib.IMAP4_SSL(HOST, PORT)
        M.login(e["NAVERWORKS_SMTP_USER"], e["NAVERWORKS_SMTP_PASS"])
        M.select(folder)
        uid_s = str(uid).encode()
        typ, resp = M.uid("STORE", uid_s, "+FLAGS", "(\\Seen)")
        M.logout()
        if typ != "OK":
            conn.close()
            print(json.dumps({"ok": False, "error": f"IMAP STORE failed: {resp}"}))
            sys.exit(1)
    except Exception as ex:
        conn.close()
        print(json.dumps({"ok": False, "error": f"imap: {ex}"}))
        sys.exit(1)

    cur.execute("UPDATE messages SET unread=0 WHERE message_id=?", (msgid,))
    conn.commit()
    conn.close()

    print(json.dumps({"ok": True, "uid": uid, "folder": folder, "marked": "Seen"}))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
imap_triage.py — message_id를 받아 Naver Works IMAP에서 해당 메시지를 이동.
Usage: imap_triage.py <message_id> <trash|spam|restore>

폴더:
- INBOX -> "Deleted Messages" (trash)
- INBOX -> "Junk" (spam)
- restore: INBOX 그대로 둠 (DB만 복구)
"""
import imaplib, sys, sqlite3, json, os

DB = "/root/jinho-playground/data/ceo_mail.db"
ENV = "/root/.openclaw/secrets/nerve.env"
HOST = "imap.worksmobile.com"
PORT = 993

FOLDER = {
    "trash": "Deleted Messages",
    "spam": "Junk",
}

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
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: imap_triage.py <msgid> <trash|spam|restore>"}))
        sys.exit(2)
    msgid = sys.argv[1]
    action = sys.argv[2]
    if action not in ("trash", "spam", "restore"):
        print(json.dumps({"ok": False, "error": f"invalid action: {action}"}))
        sys.exit(2)

    # DB에서 uid 조회
    conn = sqlite3.connect(DB, timeout=10.0)
    cur = conn.cursor()
    row = cur.execute("SELECT uid, folder FROM messages WHERE message_id=?", (msgid,)).fetchone()
    if not row:
        print(json.dumps({"ok": False, "error": "message not found in DB"}))
        sys.exit(1)
    uid, src_folder = row
    src_folder = src_folder or "INBOX"

    if action == "restore":
        # DB만 복구 (실제 메일함은 INBOX에 그대로 있다고 가정)
        cur.execute("UPDATE messages SET trashed_at=NULL WHERE message_id=?", (msgid,))
        conn.commit()
        conn.close()
        print(json.dumps({"ok": True, "action": "restore", "note": "DB only — IMAP 위치 유지"}))
        return

    target = FOLDER[action]

    # IMAP 연결 및 이동
    e = load_env()
    try:
        M = imaplib.IMAP4_SSL(HOST, PORT)
        M.login(e["NAVERWORKS_SMTP_USER"], e["NAVERWORKS_SMTP_PASS"])
        M.select(src_folder)
    except Exception as ex:
        conn.close()
        print(json.dumps({"ok": False, "error": f"imap login/select: {ex}"}))
        sys.exit(1)

    uid_str = str(uid).encode() if isinstance(uid, int) else str(uid).encode()

    moved = False
    try:
        # 1) UID MOVE 시도 (RFC 6851)
        typ, resp = M.uid("MOVE", uid_str, f'"{target}"')
        if typ == "OK":
            moved = True
    except imaplib.IMAP4.error:
        pass

    if not moved:
        # 2) COPY + STORE \Deleted + EXPUNGE 폴백
        try:
            typ, resp = M.uid("COPY", uid_str, f'"{target}"')
            if typ != "OK":
                raise RuntimeError(f"COPY failed: {resp}")
            M.uid("STORE", uid_str, "+FLAGS", "(\\Deleted)")
            M.expunge()
            moved = True
        except Exception as ex:
            M.logout()
            conn.close()
            print(json.dumps({"ok": False, "error": f"copy/expunge: {ex}"}))
            sys.exit(1)

    M.logout()

    # DB 업데이트
    import time
    now = int(time.time())
    if action == "trash":
        cur.execute("UPDATE messages SET trashed_at=?, folder=? WHERE message_id=?",
                    (now, target, msgid))
    elif action == "spam":
        cur.execute("UPDATE messages SET trashed_at=?, folder=?, ai_category=? WHERE message_id=?",
                    (now, target, "noise", msgid))
    conn.commit()
    conn.close()

    print(json.dumps({"ok": True, "action": action, "moved_to": target, "uid": uid}))

if __name__ == "__main__":
    main()

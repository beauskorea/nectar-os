#!/usr/bin/env python3
"""
imap_triage_bulk.py — 여러 message_id를 한 번에 처리 (IMAP 세션 1개).
stdin JSON: {"messageIds":[...], "action":"trash|spam|restore"}
stdout JSON: {ok, processed:[...], failed:[...]}
"""
import imaplib, sys, sqlite3, json, time
from collections import defaultdict

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
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad json: {e}"})); sys.exit(2)

    ids = payload.get("messageIds") or []
    action = payload.get("action") or ""
    if not ids:
        print(json.dumps({"ok": True, "processed": [], "failed": []})); return
    if action not in ("trash", "spam", "restore"):
        print(json.dumps({"ok": False, "error": f"invalid action: {action}"})); sys.exit(2)

    conn = sqlite3.connect(DB, timeout=15.0)
    cur = conn.cursor()

    # restore는 DB만 처리
    if action == "restore":
        processed = []
        for mid in ids:
            try:
                cur.execute("UPDATE messages SET trashed_at=NULL WHERE message_id=?", (mid,))
                processed.append(mid)
            except Exception:
                pass
        conn.commit(); conn.close()
        print(json.dumps({"ok": True, "processed": processed, "failed": []})); return

    target = FOLDER[action]

    # uid 조회 — folder별로 묶기
    placeholders = ",".join("?" for _ in ids)
    rows = cur.execute(
        f"SELECT message_id, uid, folder FROM messages WHERE message_id IN ({placeholders})",
        ids,
    ).fetchall()
    by_folder = defaultdict(list)  # folder -> [(message_id, uid)]
    found = set()
    for mid, uid, folder in rows:
        if uid is None: continue
        by_folder[folder or "INBOX"].append((mid, str(uid)))
        found.add(mid)
    missing = [m for m in ids if m not in found]

    env = load_env()
    processed = []
    failed = [{"messageId": m, "reason": "not in DB or no uid"} for m in missing]

    try:
        M = imaplib.IMAP4_SSL(HOST, PORT)
        M.login(env["NAVERWORKS_SMTP_USER"], env["NAVERWORKS_SMTP_PASS"])
    except Exception as e:
        conn.close()
        print(json.dumps({"ok": False, "error": f"imap login: {e}"})); sys.exit(1)

    now = int(time.time())
    for folder, items in by_folder.items():
        try:
            M.select(folder)
        except Exception as e:
            for mid, _ in items:
                failed.append({"messageId": mid, "reason": f"select {folder}: {e}"})
            continue

        # 한번에 묶을 수 있는 uid 모음
        uid_csv = ",".join(uid for _, uid in items)
        moved = False
        try:
            typ, _ = M.uid("MOVE", uid_csv, f'"{target}"')
            moved = (typ == "OK")
        except imaplib.IMAP4.error:
            moved = False
        if not moved:
            # COPY + STORE \Deleted + EXPUNGE 폴백
            try:
                typ, _ = M.uid("COPY", uid_csv, f'"{target}"')
                if typ != "OK":
                    raise RuntimeError("COPY failed")
                M.uid("STORE", uid_csv, "+FLAGS", "(\\Deleted)")
                M.expunge()
                moved = True
            except Exception as e:
                for mid, _ in items:
                    failed.append({"messageId": mid, "reason": str(e)})
                continue

        if moved:
            for mid, _ in items:
                try:
                    if action == "spam":
                        cur.execute("UPDATE messages SET trashed_at=?, folder=?, ai_category=? WHERE message_id=?",
                                    (now, target, "noise", mid))
                    else:
                        cur.execute("UPDATE messages SET trashed_at=?, folder=? WHERE message_id=?",
                                    (now, target, mid))
                    processed.append(mid)
                except Exception as e:
                    failed.append({"messageId": mid, "reason": f"db update: {e}"})

    M.logout()
    conn.commit(); conn.close()

    print(json.dumps({"ok": True, "processed": processed, "failed": failed, "moved_to": target if action != "restore" else None, "count": len(processed)}, ensure_ascii=False))

if __name__ == "__main__":
    main()

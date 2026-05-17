#!/usr/bin/env python3
"""
mail_send_reply.py — 원본 메일에 대한 답장을 SMTP로 발송 (스레딩 헤더 포함).
입력: stdin JSON {messageId, bodyText, includeQuote?}
출력: stdout JSON {ok, ...}
"""
import sys, json, smtplib, ssl, sqlite3
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
import re, html

DB = "/root/jinho-playground/data/ceo_mail.db"
ENV = "/root/.openclaw/secrets/nerve.env"

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

    msgid = (payload.get("messageId") or "").strip()
    body  = (payload.get("bodyText") or "").strip()
    include_quote = bool(payload.get("includeQuote", True))

    if not msgid:
        print(json.dumps({"ok": False, "error": "messageId required"})); sys.exit(2)
    if not body:
        print(json.dumps({"ok": False, "error": "bodyText required"})); sys.exit(2)

    conn = sqlite3.connect(DB, timeout=10.0)
    cur = conn.cursor()
    row = cur.execute("""
      SELECT from_name, from_addr, subject, body_full, date_ts
      FROM messages WHERE message_id=?
    """, (msgid,)).fetchone()
    conn.close()
    if not row:
        print(json.dumps({"ok": False, "error": "original message not found"})); sys.exit(1)
    orig_name, orig_addr, orig_subject, orig_body, orig_ts = row

    if not orig_addr:
        print(json.dumps({"ok": False, "error": "original sender address missing"})); sys.exit(1)

    env = load_env()
    smtp_host = env.get("NAVERWORKS_SMTP_HOST") or "smtp.worksmobile.com"
    smtp_port = int(env.get("NAVERWORKS_SMTP_PORT") or 465)
    smtp_user = env.get("NAVERWORKS_SMTP_USER")
    smtp_pass = env.get("NAVERWORKS_SMTP_PASS")
    if not (smtp_user and smtp_pass):
        print(json.dumps({"ok": False, "error": "SMTP creds missing"})); sys.exit(2)

    # Subject: "Re: " 한 번만
    subj = orig_subject or "(제목 없음)"
    if not re.match(r"^\s*re\s*:", subj, re.I):
        subj = f"Re: {subj}"

    # 인용 블록
    full_body = body
    if include_quote and orig_body:
        from datetime import datetime, timezone
        when = datetime.fromtimestamp(orig_ts, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M") if orig_ts else ""
        quoted = "\n".join("> " + line for line in (orig_body or "").splitlines()[:80])
        full_body = (
            body
            + "\n\n\n"
            + f"────────────────\n"
            + f"On {when}, {orig_name or orig_addr} wrote:\n\n"
            + quoted
        )

    msg = EmailMessage()
    msg["From"] = formataddr(("박진호 (뷰스컴퍼니)", smtp_user))
    msg["To"] = formataddr((orig_name or "", orig_addr))
    msg["Subject"] = subj
    msg["In-Reply-To"] = msgid
    msg["References"] = msgid
    msg.set_content(full_body)

    # HTML alternative: URL → <a>, 줄바꿈 → <br>, 인용 줄(> ...) styled
    URL_RE = re.compile(r"(https?://[^\s<>\"]+)")
    def render_line(line: str) -> str:
        is_quote = line.startswith(">")
        esc = html.escape(line)
        esc = URL_RE.sub(r'<a href="\1" target="_blank">\1</a>', esc)
        if is_quote:
            return f'<span style="color:#888;border-left:3px solid #ccc;padding-left:8px;">{esc}</span>'
        return esc
    html_body = (
        '<html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;'
        'font-size:14px;line-height:1.7;color:#222;">' +
        "<br>".join(render_line(l) for l in full_body.split("\n")) +
        "</body></html>"
    )
    msg.add_alternative(html_body, subtype="html")

    try:
        ctx = ssl.create_default_context()
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx, timeout=30) as s:
                s.login(smtp_user, smtp_pass)
                s.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as s:
                s.ehlo(); s.starttls(context=ctx); s.ehlo()
                s.login(smtp_user, smtp_pass)
                s.send_message(msg)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"smtp: {e}"})); sys.exit(1)

    print(json.dumps({
        "ok": True,
        "to": orig_addr,
        "subject": subj,
        "in_reply_to": msgid,
        "quoted": include_quote and bool(orig_body),
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()

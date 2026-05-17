#!/usr/bin/env python3
"""
outreach_send.py — 외부 발송: SMTP로 본문 + 첨부 파일 전송.
입력: stdin JSON {to, name, subject, body, attachments: [<server-path>]}
출력: stdout JSON {ok, ...}
"""
import sys, json, smtplib, ssl, os, mimetypes, re, html
from email.message import EmailMessage
from email.utils import formataddr

ENV = "/root/.openclaw/secrets/nerve.env"
ALLOWED_ATTACH_DIRS = (
    "/root/jinho-playground/public/files/",
    "/root/jinho-playground/public/mail-images/",
)
MAX_TOTAL_ATTACH = 20 * 1024 * 1024  # 20MB

def load_env():
    e = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip("\"'")
    return e

def safe_path(p):
    """경로 traversal 방지: 허용된 디렉토리 안에만 있어야 한다."""
    real = os.path.realpath(p)
    return any(real.startswith(os.path.realpath(d)) for d in ALLOWED_ATTACH_DIRS)

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad json: {e}"})); sys.exit(2)

    to_addr = (payload.get("to") or "").strip()
    to_name = (payload.get("name") or "").strip()
    subject = (payload.get("subject") or "").strip()
    body    = (payload.get("body") or "").strip()
    attachments = payload.get("attachments") or []

    if not to_addr or "@" not in to_addr:
        print(json.dumps({"ok": False, "error": "invalid recipient"})); sys.exit(2)
    if not subject or not body:
        print(json.dumps({"ok": False, "error": "subject and body required"})); sys.exit(2)

    env = load_env()
    smtp_host = env.get("NAVERWORKS_SMTP_HOST") or "smtp.worksmobile.com"
    smtp_port = int(env.get("NAVERWORKS_SMTP_PORT") or 465)
    smtp_user = env.get("NAVERWORKS_SMTP_USER")
    smtp_pass = env.get("NAVERWORKS_SMTP_PASS")
    if not (smtp_user and smtp_pass):
        print(json.dumps({"ok": False, "error": "SMTP creds missing"})); sys.exit(2)

    msg = EmailMessage()
    msg["From"] = formataddr(("박진호 (뷰스컴퍼니)", smtp_user))
    msg["To"] = formataddr((to_name, to_addr)) if to_name else to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    # HTML alternative — plain text의 URL을 <a> 로 변환, 줄바꿈은 <br>
    URL_RE = re.compile(r"(https?://[^\s<>\"]+)")
    def linkify(line):
        return URL_RE.sub(r'<a href="\1" target="_blank">\1</a>', html.escape(line))
    html_lines = [linkify(l) for l in body.split("\n")]
    html_body = (
        '<html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;'
        'font-size:14px;line-height:1.7;color:#222;">' +
        "<br>".join(html_lines) +
        "</body></html>"
    )
    msg.add_alternative(html_body, subtype="html")

    total = 0
    added = []
    skipped = []
    for ap in attachments:
        # 클라이언트가 보내는 건 web 경로 ("/files/...") 또는 절대경로
        if ap.startswith("/files/"):
            path = "/root/jinho-playground/public" + ap
        elif ap.startswith("/mail-images/"):
            path = "/root/jinho-playground/public" + ap
        else:
            path = ap
        if not safe_path(path) or not os.path.isfile(path):
            skipped.append({"path": ap, "reason": "not found or out of bounds"})
            continue
        try:
            size = os.path.getsize(path)
            if total + size > MAX_TOTAL_ATTACH:
                skipped.append({"path": ap, "reason": f"exceeds 20MB total"})
                continue
            ctype, _ = mimetypes.guess_type(path)
            maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
            with open(path, "rb") as fp:
                data = fp.read()
            msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=os.path.basename(path))
            total += size
            added.append({"name": os.path.basename(path), "size": size})
        except Exception as e:
            skipped.append({"path": ap, "reason": str(e)})

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
        "to": to_addr,
        "subject": subject,
        "attachments_sent": added,
        "attachments_skipped": skipped,
        "total_bytes": total,
    }))

if __name__ == "__main__":
    main()

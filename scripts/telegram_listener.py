#!/usr/bin/env python3
"""
telegram_listener.py — @jinhorusbot DM 명령 listener
Commands:
  /help              사용 가능한 명령 안내
  /todo <텍스트>     할일 추가 (med priority)
  /inbox <텍스트>    인박스 캡쳐
  /spend <금액> <카테고리> [메모]   지출 추가 (개인)
  /note <텍스트>     메모 (자유 노트)
  /decide <텍스트>   결정 기록
  /done              오늘의 todo 카운트
- long polling (timeout=30s), 항상 살아있음 (systemd Restart=always)
- 처음 메시지 보낸 chat_id 자동 화이트리스트
- 처리 결과 즉시 답장
"""
import json, os, sys, time, sqlite3, traceback
from urllib import request, parse, error
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
ENV = "/root/.openclaw/secrets/nerve.env"
STATE = "/root/jinho-playground/data/tg_listener_state.json"
INBOX_FILE = "/root/jinho-playground/data/personal_inbox.json"
EXPENSES_FILE = "/root/jinho-playground/data/expenses.json"
DECISIONS_FILE = "/root/jinho-playground/data/decisions.json"
API_BASE = "http://100.71.196.83:3740"

def load_env():
    e = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            k, _, v = line.partition("=")
            if k: e[k] = v.strip("\"'")
    return e

TOKEN = load_env().get("TELEGRAM_JINHORUS_BOT_TOKEN") or "8283376326:AAEWXcF_QxD_zH4tcZoZPqrpfR9inoOBpcI"

def load_state():
    try:
        with open(STATE) as f: return json.load(f)
    except Exception:
        return {"offset": 0, "allowed_chats": []}

def save_state(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f: json.dump(s, f)

def tg_call(method, params=None, post=False, timeout=35):
    url = f"https://api.telegram.org/bot{TOKEN}/{method}"
    if post:
        data = parse.urlencode(params or {}).encode("utf-8")
        req = request.Request(url, data=data)
    else:
        if params:
            url += "?" + parse.urlencode(params)
        req = request.Request(url)
    try:
        with request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except error.HTTPError as e:
        return {"ok": False, "error_code": e.code, "description": e.read().decode("utf-8", errors="ignore")[:200]}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def send(chat_id, text, reply_to=None):
    params = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if reply_to: params["reply_to_message_id"] = reply_to
    return tg_call("sendMessage", params, post=True, timeout=10)

def http_json(method, path, body=None, timeout=20):
    url = API_BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with request.urlopen(req, timeout=timeout) as r:
            t = r.read()
            try: return r.status, json.loads(t)
            except: return r.status, t.decode("utf-8", errors="ignore")
    except error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="ignore")[:300]
    except Exception as e:
        return 0, str(e)

def append_json_list(path, key, item, max_keep=2000):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path) as f: doc = json.load(f)
    except Exception:
        doc = {}
    arr = doc.get(key, [])
    arr.append(item)
    doc[key] = arr[-max_keep:]
    with open(path, "w") as f: json.dump(doc, f, ensure_ascii=False)

def cmd_help(chat_id, body):
    txt = """*진호 OS Telegram*

`/todo <텍스트>` — 할일 추가
`/inbox <텍스트>` — 인박스 캡쳐
`/spend <금액> <카테고리> [메모]` — 지출 추가 (개인)
`/note <텍스트>` — 메모
`/decide <텍스트>` — 결정 기록
`/help` — 도움말

예: `/spend 12000 식비 점심`
예: `/todo 클리오 제안서 회신`
예: `/inbox AI 인플루언서 LIVE 가중치 다시 보기`"""
    send(chat_id, txt)

def cmd_todo(chat_id, body):
    text = body.strip()
    if not text: return send(chat_id, "사용법: `/todo <내용>`")
    code, resp = http_json("POST", "/api/tasks", {"text": text, "priority": "med", "status": "todo"})
    if code == 200:
        send(chat_id, f"✓ 할일 추가: _{text}_")
    else:
        send(chat_id, f"✗ 실패 ({code}): {str(resp)[:200]}")

def cmd_inbox(chat_id, body):
    text = body.strip()
    if not text: return send(chat_id, "사용법: `/inbox <내용>`")
    now_ms = int(time.time() * 1000)
    payload = {
        "id": f"tg_{now_ms}",
        "ts": now_ms,
        "text": text,
        "source": "telegram",
        "category": "action",
        "priority": "P2",
    }
    code, resp = http_json("POST", "/api/inbox", payload)
    # backup to JSON file so we don't lose captures if API is down
    try:
        append_json_list(INBOX_FILE, "items", {**payload, "ts": int(time.time())})
    except Exception:
        pass
    if code == 200:
        send(chat_id, f"✓ 인박스: _{text}_")
    else:
        send(chat_id, f"⚠️ 인박스 (로컬 백업만, API {code}): _{text}_")

def cmd_spend(chat_id, body):
    parts = body.split(None, 2)
    if len(parts) < 2:
        return send(chat_id, "사용법: `/spend <금액> <카테고리> [메모]`")
    try:
        amount = int(parts[0].replace(",", "").replace("원", "").strip())
    except:
        return send(chat_id, f"금액 인식 실패: `{parts[0]}`")
    category = parts[1].strip()
    note = parts[2].strip() if len(parts) > 2 else ""
    today = datetime.now(KST).strftime("%Y-%m-%d")
    code, resp = http_json("POST", "/api/finance/expense", {
        "amount": amount, "category": category, "kind": "personal",
        "note": note or None, "date": today,
    })
    if code == 200:
        won = f"{amount:,}원"
        send(chat_id, f"✓ 지출 추가: {won} · {category}{' · ' + note if note else ''}")
    else:
        send(chat_id, f"✗ 실패 ({code}): {str(resp)[:200]}")

def cmd_note(chat_id, body):
    text = body.strip()
    if not text: return send(chat_id, "사용법: `/note <내용>`")
    item = {
        "id": f"tg-note-{int(time.time()*1000)}",
        "ts": int(time.time()),
        "text": text,
        "source": "telegram",
    }
    append_json_list("/root/jinho-playground/data/personal_notes.json", "notes", item)
    send(chat_id, f"✓ 메모: _{text[:80]}_")

def cmd_decide(chat_id, body):
    text = body.strip()
    if not text: return send(chat_id, "사용법: `/decide <내용>`")
    today = datetime.now(KST).strftime("%Y-%m-%d")
    code, resp = http_json("POST", "/api/decisions", {
        "date": today, "question": text, "text": text, "source": "manual",
    })
    if code == 200:
        send(chat_id, f"✓ 결정 기록: _{text[:80]}_")
    else:
        send(chat_id, f"✗ 실패 ({code}): {str(resp)[:200]}")

HANDLERS = {
    "/help": cmd_help, "/start": cmd_help,
    "/todo": cmd_todo,
    "/inbox": cmd_inbox,
    "/spend": cmd_spend,
    "/note": cmd_note,
    "/decide": cmd_decide,
}

def handle_message(chat_id, text, msg_id):
    text = (text or "").strip()
    if not text: return
    parts = text.split(None, 1)
    cmd = parts[0].lower()
    body = parts[1] if len(parts) > 1 else ""
    handler = HANDLERS.get(cmd)
    if handler:
        try:
            handler(chat_id, body)
        except Exception as e:
            send(chat_id, f"✗ 처리 오류: {e}")
            traceback.print_exc()
    else:
        # 명령 없이 그냥 텍스트 던지면 자동으로 인박스
        cmd_inbox(chat_id, text)

def main():
    state = load_state()
    print(f"[tg] started; offset={state['offset']}, allowed={state.get('allowed_chats', [])}", flush=True)

    while True:
        try:
            data = tg_call("getUpdates", {"offset": state["offset"], "limit": 30, "timeout": 30}, timeout=45)
            if not data.get("ok"):
                print(f"[tg] getUpdates err: {data}", flush=True)
                time.sleep(5)
                continue
            for upd in data.get("result", []):
                state["offset"] = upd["update_id"] + 1
                msg = upd.get("message") or upd.get("edited_message")
                if not msg: continue
                chat = msg.get("chat") or {}
                chat_id = chat.get("id")
                chat_type = chat.get("type")
                if chat_type != "private":
                    continue  # ignore group/channel for now
                # 자동 화이트리스트 (첫 메시지 보낸 사람 등록)
                if chat_id not in state.get("allowed_chats", []):
                    state["allowed_chats"] = state.get("allowed_chats", []) + [chat_id]
                    print(f"[tg] new allowed_chat: {chat_id}", flush=True)
                text = msg.get("text") or ""
                msg_id = msg.get("message_id")
                print(f"[tg] {chat_id}: {text[:100]}", flush=True)
                handle_message(chat_id, text, msg_id)
            save_state(state)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[tg] loop err: {e}", flush=True)
            traceback.print_exc()
            time.sleep(3)

if __name__ == "__main__":
    main()

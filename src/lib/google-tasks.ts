// Server-side Google Tasks API wrapper for 진호 OS
// Auth: OAuth2 refresh token (in /root/.openclaw/secrets/google_tasks.env)
// Strategy: 6 dedicated tasklists — 회사·{To Do,Doing,Done} + 개인·{To Do,Doing,Done}
//
// Priority encoding:
//   v1 (legacy): title prefix [HIGH] / [MED] / [LOW]
//   v2 (legacy): first line of notes = "pri=high" (or med/low); user notes below
//   v3 (current): title emoji prefix 🔴 (high) / 🟡 med skipped / ⚪ (low); med default = no emoji
//   Reads accept v1/v2/v3; writes always v3.
//
// Completed state:
//   Independent of column — each task has Google Tasks status (needsAction / completed).
//   TasksBoard shows completed at bottom of each list.

import { promises as fs } from "node:fs";

const SECRETS_PATH = "/root/.openclaw/secrets/google_tasks.env";

type Env = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

let cachedEnv: Env | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedLists: Record<Board, Record<Status, string>> | null = null;

export type Board = "company" | "personal";
export type Status = "todo" | "doing" | "done";

export const LIST_NAMES: Record<Board, Record<Status, string>> = {
  company: {
    todo: "회사 · To Do",
    doing: "회사 · Doing",
    done: "회사 · Done",
  },
  personal: {
    todo: "개인 · To Do",
    doing: "개인 · Doing",
    done: "개인 · Done",
  },
};

const BOARDS: Board[] = ["company", "personal"];
const STATUSES: Status[] = ["todo", "doing", "done"];

async function loadEnv(): Promise<Env> {
  if (cachedEnv) return cachedEnv;
  let client_id = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  let client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  let refresh_token = process.env.GOOGLE_TASKS_REFRESH_TOKEN || "";
  if (!client_id || !client_secret || !refresh_token) {
    try {
      const raw = await fs.readFile(SECRETS_PATH, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const [, k, v] = m;
        const val = v.replace(/^"|"$/g, "");
        if (k === "GOOGLE_OAUTH_CLIENT_ID" && !client_id) client_id = val;
        if (k === "GOOGLE_OAUTH_CLIENT_SECRET" && !client_secret) client_secret = val;
        if (k === "GOOGLE_TASKS_REFRESH_TOKEN" && !refresh_token) refresh_token = val;
      }
    } catch {}
  }
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error("google-tasks: missing OAuth env");
  }
  cachedEnv = { client_id, client_secret, refresh_token };
  return cachedEnv;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;
  const env = await loadEnv();
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.client_id,
      client_secret: env.client_secret,
      refresh_token: env.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`google-tasks: token refresh failed ${resp.status}: ${t}`);
  }
  const j = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: now + (j.expires_in || 3600) };
  return j.access_token;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const tok = await getAccessToken();
  const resp = await fetch(`https://tasks.googleapis.com/tasks/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`google-tasks: ${method} ${path} failed ${resp.status}: ${t}`);
  }
  if (resp.status === 204) return {} as T;
  return (await resp.json()) as T;
}

export type TaskListItem = { id: string; title: string };
export type TaskItem = {
  id: string;
  title: string;
  status: "needsAction" | "completed";
  notes?: string;
  updated?: string;
  position?: string;
  completed?: string;
};

async function ensureLists(): Promise<Record<Board, Record<Status, string>>> {
  if (cachedLists) return cachedLists;
  const res = await api<{ items?: TaskListItem[] }>("GET", "/users/@me/lists?maxResults=100");
  const byTitle = new Map<string, string>();
  for (const it of res.items || []) byTitle.set(it.title, it.id);
  const map: Record<Board, Partial<Record<Status, string>>> = { company: {}, personal: {} };
  for (const b of BOARDS) {
    for (const s of STATUSES) {
      const name = LIST_NAMES[b][s];
      let id = byTitle.get(name);
      if (!id) {
        const created = await api<TaskListItem>("POST", "/users/@me/lists", { title: name });
        id = created.id;
      }
      map[b][s] = id;
    }
  }
  cachedLists = map as Record<Board, Record<Status, string>>;
  return cachedLists;
}

function boardOf(listId: string, lists: Record<Board, Record<Status, string>>): Board {
  for (const b of BOARDS) {
    for (const s of STATUSES) {
      if (lists[b][s] === listId) return b;
    }
  }
  return "company";
}

function statusOf(listId: string, lists: Record<Board, Record<Status, string>>): Status {
  for (const b of BOARDS) {
    for (const s of STATUSES) {
      if (lists[b][s] === listId) return s;
    }
  }
  return "todo";
}

const PRIORITY_PREFIX_RE = /^\[(HIGH|MED|LOW)\]\s*/i;
const NOTES_PRI_RE = /^pri=(high|med|low)\s*\n?/i;
const EMOJI_TO_PRI: Record<string, "high" | "med" | "low"> = {
  "🔴": "high",
  "🟡": "med",
  "⚪": "low",
};
const PRI_TO_EMOJI: Record<"high" | "med" | "low", string> = {
  high: "🔴",
  med: "",
  low: "⚪",
};

function decode(title: string, notes: string | undefined): {
  text: string;
  priority: "high" | "med" | "low";
  userNotes: string;
} {
  let text = (title || "").trim();
  let priority: "high" | "med" | "low" = "med";

  for (const [emo, pri] of Object.entries(EMOJI_TO_PRI)) {
    if (text.startsWith(emo)) {
      priority = pri;
      text = text.slice(emo.length).trimStart();
      break;
    }
  }
  const m = text.match(PRIORITY_PREFIX_RE);
  if (m) {
    priority = m[1].toLowerCase() as "high" | "med" | "low";
    text = text.replace(PRIORITY_PREFIX_RE, "");
  }
  let userNotes = notes || "";
  const nm = userNotes.match(NOTES_PRI_RE);
  if (nm) {
    priority = nm[1].toLowerCase() as "high" | "med" | "low";
    userNotes = userNotes.replace(NOTES_PRI_RE, "");
  }
  return { text, priority, userNotes };
}

function encodeTitle(text: string, priority: "high" | "med" | "low"): string {
  const emoji = PRI_TO_EMOJI[priority];
  return emoji ? `${emoji} ${text}` : text;
}

export type Todo = {
  id: string;
  listId: string;
  board: Board;
  text: string;
  status: Status;
  priority: "high" | "med" | "low";
  completed: boolean;
  userNotes: string;
  updated?: string;
};

function todoFromItem(it: TaskItem, listId: string, board: Board, s: Status): Todo {
  const { text, priority, userNotes } = decode(it.title || "", it.notes);
  return {
    id: it.id,
    listId,
    board,
    text,
    status: s,
    priority,
    completed: it.status === "completed",
    userNotes,
    updated: it.updated,
  };
}

export async function listAll(): Promise<Todo[]> {
  const lists = await ensureLists();
  const out: Todo[] = [];
  for (const b of BOARDS) {
    for (const s of STATUSES) {
      const r = await api<{ items?: TaskItem[] }>(
        "GET",
        `/lists/${lists[b][s]}/tasks?showCompleted=true&showHidden=true&maxResults=100`,
      );
      for (const it of r.items || []) {
        out.push(todoFromItem(it, lists[b][s], b, s));
      }
    }
  }
  out.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  return out;
}

export async function createTodo(
  text: string,
  priority: "high" | "med" | "low",
  status: Status = "todo",
  board: Board = "company",
): Promise<Todo> {
  const lists = await ensureLists();
  const created = await api<TaskItem>("POST", `/lists/${lists[board][status]}/tasks`, {
    title: encodeTitle(text, priority),
  });
  return todoFromItem(created, lists[board][status], board, status);
}

export async function moveTodo(
  id: string,
  fromListId: string,
  toStatus: Status,
): Promise<Todo> {
  const lists = await ensureLists();
  const board = boardOf(fromListId, lists);
  const cur = await api<TaskItem>("GET", `/lists/${fromListId}/tasks/${id}`);
  const created = await api<TaskItem>("POST", `/lists/${lists[board][toStatus]}/tasks`, {
    title: cur.title,
    notes: cur.notes,
    status: cur.status,
  });
  await api<unknown>("DELETE", `/lists/${fromListId}/tasks/${id}`);
  return todoFromItem(created, lists[board][toStatus], board, toStatus);
}

export async function deleteTodo(id: string, listId: string): Promise<void> {
  await api<unknown>("DELETE", `/lists/${listId}/tasks/${id}`);
}

export async function updateTodo(
  id: string,
  listId: string,
  patch: {
    text?: string;
    priority?: "high" | "med" | "low";
    completed?: boolean;
    userNotes?: string;
  },
): Promise<Todo> {
  const cur = await api<TaskItem>("GET", `/lists/${listId}/tasks/${id}`);
  const decoded = decode(cur.title || "", cur.notes);

  const newText = patch.text ?? decoded.text;
  const newPriority = patch.priority ?? decoded.priority;
  const newUserNotes = patch.userNotes ?? decoded.userNotes;

  const body: Partial<TaskItem> = {
    title: encodeTitle(newText, newPriority),
    notes: newUserNotes || "",
  };
  if (patch.completed !== undefined) {
    body.status = patch.completed ? "completed" : "needsAction";
    if (!patch.completed) body.completed = null as unknown as undefined;
  }

  const updated = await api<TaskItem>("PATCH", `/lists/${listId}/tasks/${id}`, body);
  let final = updated;
  if (patch.completed !== undefined && (updated.status === "completed") !== patch.completed) {
    final = await api<TaskItem>("PATCH", `/lists/${listId}/tasks/${id}`, {
      status: patch.completed ? "completed" : "needsAction",
    });
  }

  const lists = await ensureLists();
  const board = boardOf(listId, lists);
  const s = statusOf(listId, lists);
  return todoFromItem(final, listId, board, s);
}

export async function isConfigured(): Promise<boolean> {
  try {
    await loadEnv();
    return true;
  } catch {
    return false;
  }
}

// Server-only Google Calendar wrapper using existing service account.
// SA is already shared (readonly) to the two Beaus calendars for fetch_calendar.py.
// For insert/update we need "Make changes to events" on each calendar share.

import crypto from "node:crypto";
import { promises as fs } from "node:fs";

const SA_PATH = "/root/.openclaw/workspace/data/google-calendar-sa.json";

type SA = { client_email: string; private_key: string };

export const CAL_ID: Record<string, string> = {
  beautysketch: "beautysketchkorea@gmail.com",
  beauscontents: "beauscontents@gmail.com",
};

let cachedSA: SA | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

async function loadSA(): Promise<SA> {
  if (cachedSA) return cachedSA;
  const raw = await fs.readFile(SA_PATH, "utf-8");
  const j = JSON.parse(raw) as { client_email: string; private_key: string };
  cachedSA = { client_email: j.client_email, private_key: j.private_key };
  return cachedSA;
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;
  const sa = await loadSA();
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/calendar.events",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`gcal token failed: ${r.status} ${t.slice(0, 200)}`);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: now + (j.expires_in || 3600) };
  return j.access_token;
}

export type InsertResult = {
  id: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export type GCalEvent = {
  id: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  htmlLink?: string;
};

export async function listEvents(
  cal: string,
  opts: { timeMin: string; timeMax: string; q?: string },
): Promise<GCalEvent[]> {
  const calId = CAL_ID[cal];
  if (!calId) throw new Error(`unknown_calendar: ${cal}`);
  const token = await getAccessToken();
  const params = new URLSearchParams({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });
  if (opts.q) params.set("q", opts.q);
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`gcal list ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = (await r.json()) as { items?: GCalEvent[] };
  return j.items || [];
}

export async function deleteEvent(cal: string, eventId: string): Promise<void> {
  const calId = CAL_ID[cal];
  if (!calId) throw new Error(`unknown_calendar: ${cal}`);
  const token = await getAccessToken();
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
  );
  if (!r.ok && r.status !== 410) {
    const t = await r.text().catch(() => "");
    throw new Error(`gcal delete ${r.status}: ${t.slice(0, 300)}`);
  }
}

export async function insertEvent(
  cal: string,
  ev: { title: string; start: string; end: string; allDay: boolean },
): Promise<InsertResult> {
  const calId = CAL_ID[cal];
  if (!calId) throw new Error(`unknown_calendar: ${cal}`);
  const token = await getAccessToken();
  const body = ev.allDay
    ? {
        summary: ev.title,
        start: { date: ev.start },
        end: { date: ev.end || ev.start },
      }
    : {
        summary: ev.title,
        start: { dateTime: ev.start, timeZone: "Asia/Seoul" },
        end: { dateTime: ev.end || ev.start, timeZone: "Asia/Seoul" },
      };
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`gcal insert ${r.status}: ${t.slice(0, 300)}`);
  }
  return (await r.json()) as InsertResult;
}

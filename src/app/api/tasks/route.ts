import { NextRequest, NextResponse } from "next/server";
import * as gt from "@/lib/google-tasks";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await gt.isConfigured())) {
    return NextResponse.json({ configured: false, todos: [] });
  }
  try {
    const todos = await gt.listAll();
    return NextResponse.json({ configured: true, todos });
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: (e as Error).message, todos: [] },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await gt.isConfigured())) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const body = (await req.json()) as {
    text: string;
    priority?: "high" | "med" | "low";
    status?: gt.Status;
    board?: gt.Board;
  };
  if (!body?.text?.trim()) {
    return NextResponse.json({ error: "empty_text" }, { status: 400 });
  }
  try {
    const todo = await gt.createTodo(
      body.text.trim(),
      body.priority || "med",
      body.status || "todo",
      body.board === "personal" ? "personal" : "company",
    );
    return NextResponse.json({ todo });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import * as gt from "@/lib/google-tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    listId: string;
    toStatus?: gt.Status;
    text?: string;
    priority?: "high" | "med" | "low";
    completed?: boolean;
    userNotes?: string;
  };
  try {
    if (body.toStatus) {
      const updated = await gt.moveTodo(id, body.listId, body.toStatus);
      return NextResponse.json({ todo: updated });
    }
    if (
      body.text !== undefined ||
      body.priority !== undefined ||
      body.completed !== undefined ||
      body.userNotes !== undefined
    ) {
      const updated = await gt.updateTodo(id, body.listId, {
        text: body.text,
        priority: body.priority,
        completed: body.completed,
        userNotes: body.userNotes,
      });
      return NextResponse.json({ todo: updated });
    }
    return NextResponse.json({ error: "no_op" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const listId = new URL(req.url).searchParams.get("listId") || "";
  if (!listId) return NextResponse.json({ error: "listId required" }, { status: 400 });
  try {
    await gt.deleteTodo(id, listId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

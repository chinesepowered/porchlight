import { runPorchlight } from "@/lib/agent";
import type { AgentEvent, StreamMsg, World } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Simple per-IP limit so the public demo can't drain the model key.
const WINDOW_MS = 10 * 60_000;
const MAX_RUNS = 40;
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_RUNS;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return Response.json({ error: "Rate limit reached. Try again in a few minutes." }, { status: 429 });

  const raw = await req.text();
  if (raw.length > 200_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  let body: { event?: AgentEvent; world?: World };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { event, world } = body;
  if (!event || !["heat_check", "inbox", "decision"].includes(event.type) || !world?.residents) {
    return Response.json({ error: "Expected { event, world }" }, { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (m: StreamMsg) => controller.enqueue(enc.encode(JSON.stringify(m) + "\n"));
      try {
        await runPorchlight(event, world, send);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}

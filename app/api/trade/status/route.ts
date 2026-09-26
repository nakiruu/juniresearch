import { timingSafeEqual } from "node:crypto";
import { getSchedulerStatus } from "../../../../lib/trade/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // read state each call; never cache

export async function GET(req: Request): Promise<Response> {
  const token = process.env.TRADE_STATUS_TOKEN;
  // 503 (not configured) is checked BEFORE auth so an unconfigured route never looks merely unauthorized.
  if (!token) return Response.json({ error: "status route not configured (set TRADE_STATUS_TOKEN)" }, { status: 503 });
  // Constant-time bearer compare: a length-guarded timingSafeEqual avoids leaking the token via the
  // early-exit timing of `!==`. Different lengths → reject (timingSafeEqual throws on unequal lengths).
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return new Response("unauthorized", { status: 401 });
  }
  return Response.json(getSchedulerStatus());
}

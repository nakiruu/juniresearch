import { getSchedulerStatus } from "../../../../lib/trade/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // read state each call; never cache

export async function GET(req: Request): Promise<Response> {
  const token = process.env.TRADE_STATUS_TOKEN;
  if (!token) return Response.json({ error: "status route not configured (set TRADE_STATUS_TOKEN)" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
  return Response.json(getSchedulerStatus());
}

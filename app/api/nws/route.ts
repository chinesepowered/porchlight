import { fetchNws } from "@/lib/nws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await fetchNws(), { headers: { "Cache-Control": "s-maxage=300" } });
}

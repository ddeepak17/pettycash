// A delivered image, served by the id of the purchase that bought it. Only images we verified by file signature are stored.
import { getArtifact } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const artifact = await getArtifact(id).catch(() => null);
  if (!artifact) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(artifact.bytes), {
    headers: { "content-type": artifact.contentType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", "content-disposition": "inline" },
  });
}

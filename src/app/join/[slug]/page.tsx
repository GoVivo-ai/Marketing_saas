import { notFound } from "next/navigation";
import { accentForeground } from "@/lib/color";
import { getPublicWorkspace } from "@/lib/public-workspace";
import { PublicLeadForm } from "@/components/app/public-lead-form";

export const dynamic = "force-dynamic";

/**
 * Public, shareable lead-capture page (no session): /join/<workspace-slug>.
 * The team drops this link when answering ad comments so applicants land in
 * MarTech directly — instead of the client's own site taking the credit for
 * leads our comment management produced. An iframe-friendly variant lives at
 * /join/<slug>/embed.
 */
export default async function PublicJoinPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ws = await getPublicWorkspace(slug);
  if (!ws) notFound();

  const accent = ws.accentColor ?? "#0f172a";
  const fg = accentForeground(accent);

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div
          className="rounded-t-xl px-6 py-5"
          style={{ backgroundColor: accent, color: fg }}
        >
          <div className="flex items-center gap-3">
            {ws.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data-URL logo
              <img src={ws.logoUrl} alt="" className="h-9 w-auto" />
            )}
            <div>
              <h1 className="text-lg font-semibold leading-tight">{ws.name}</h1>
              <p className="text-sm opacity-75">Apply in less than a minute</p>
            </div>
          </div>
        </div>
        <div className="rounded-b-xl border border-t-0 bg-background p-6 shadow-sm">
          <PublicLeadForm workspaceSlug={ws.slug} accent={accent} />
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Powered by Vivo MarTech
        </p>
      </div>
    </main>
  );
}

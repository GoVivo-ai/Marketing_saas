import { notFound } from "next/navigation";
import { getPublicWorkspace } from "@/lib/public-workspace";
import { PublicLeadForm } from "@/components/app/public-lead-form";

export const dynamic = "force-dynamic";

/**
 * Iframe-friendly variant of /join/<slug>: just the form, no page chrome, so
 * a client site can embed it and still land the lead in MarTech:
 *
 *   <iframe src="https://…/join/<slug>/embed" style="border:0;width:100%;height:640px"></iframe>
 */
export default async function PublicJoinEmbedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ws = await getPublicWorkspace(slug);
  if (!ws) notFound();

  return (
    <main className="bg-background p-4">
      <PublicLeadForm
        workspaceSlug={ws.slug}
        accent={ws.accentColor ?? "#0f172a"}
      />
    </main>
  );
}

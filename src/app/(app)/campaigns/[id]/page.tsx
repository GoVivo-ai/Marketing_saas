import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdSetExplorer } from "@/components/app/adset-explorer";
import {
  getAdSetRows,
  getCampaignById,
  getWorkspaceContext,
} from "@/lib/data";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { active } = await getWorkspaceContext();
  if (!active) notFound();

  const campaign = await getCampaignById(active.id, id);
  if (!campaign) notFound();

  const adsets = await getAdSetRows(active.id, id);
  const totals = adsets.reduce(
    (acc, a) => ({ spend: acc.spend + a.spend, leads: acc.leads + a.leads }),
    { spend: 0, leads: 0 },
  );
  const cities = adsets.filter((a) => a.city).length;
  const cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Campañas
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {campaign.name}
          </h1>
          <Badge variant={campaign.status === "ACTIVE" ? "default" : "secondary"}>
            {campaign.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {cities} ciudades · {usd(totals.spend)} gastado · {totals.leads} leads
          · CPL {cpl ? usd(cpl) : "—"} · últimos 30 días
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conjuntos de anuncios por ciudad</CardTitle>
          <CardDescription>
            Cada conjunto apunta a una ciudad con un radio de audiencia. El mapa
            muestra ese radio; la tabla, el rendimiento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdSetExplorer adsets={adsets} />
        </CardContent>
      </Card>
    </div>
  );
}

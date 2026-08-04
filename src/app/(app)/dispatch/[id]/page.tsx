import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Video,
  Armchair,
  LifeBuoy,
  UserX,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getWorkspaceContext } from "@/lib/data";
import { getDriver360 } from "@/lib/dispatch-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const d = (v: Date | null) => (v ? format(v, "MMM d, yyyy") : "—");

const PRIORITY_TONE: Record<string, string> = {
  Critical: "text-destructive",
  High: "text-amber-500",
  Normal: "text-muted-foreground",
  Low: "text-muted-foreground",
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

export default async function DriverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { active } = await getWorkspaceContext();
  if (!active) notFound();
  const { id } = await params;
  const data = await getDriver360(active.id, id);
  if (!data) notFound();
  const { driver, covers, interactions } = data;

  const absences = covers.filter((c) => c.role === "absent").length;
  const rescues = covers.filter((c) => c.role === "rescue").length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dispatch"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All drivers
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{driver.name}</h1>
          <Badge
            variant={driver.status === "active" ? "default" : "secondary"}
            className="capitalize"
          >
            {driver.status}
          </Badge>
          {driver.status === "active" && !driver.hasRoutes && (
            <Badge variant="outline">No routes assigned</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          MDD{" "}
          <span className="font-mono text-foreground">{driver.mdd ?? "—"}</span>
          {" · "}the key that links this driver across EverDriven, SharePoint
          and dispatch.
        </p>
      </div>

      {/* Profile facts */}
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Area"
            value={
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {driver.area ?? "—"}
                {driver.state ? `, ${driver.state}` : ""}
              </span>
            }
          />
          <Fact
            label="Phone"
            value={
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {driver.phone ?? "—"}
              </span>
            }
          />
          <Fact
            label="Email"
            value={
              <span className="flex min-w-0 items-center gap-1">
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{driver.email ?? "—"}</span>
              </span>
            }
          />
          <Fact
            label="Equipment"
            value={
              <span className="flex items-center gap-3">
                {driver.camera && (
                  <span className="flex items-center gap-1">
                    <Video className="h-3.5 w-3.5" /> Camera
                  </span>
                )}
                {driver.carSeats > 0 && (
                  <span className="flex items-center gap-1">
                    <Armchair className="h-3.5 w-3.5" /> {driver.carSeats}
                  </span>
                )}
                {driver.boosterSeats > 0 && <span>Booster ×{driver.boosterSeats}</span>}
                {!driver.camera &&
                  driver.carSeats === 0 &&
                  driver.boosterSeats === 0 &&
                  "—"}
              </span>
            }
          />
          <Fact label="Address" value={driver.address ?? "—"} />
          <Fact
            label="Emergency contact"
            value={
              driver.emergencyName
                ? `${driver.emergencyName}${driver.emergencyRelation ? ` (${driver.emergencyRelation})` : ""}`
                : "—"
            }
          />
          <Fact label="Emergency phone" value={driver.emergencyPhone ?? "—"} />
          <Fact
            label="Activity"
            value={`${absences} ${absences === 1 ? "absence" : "absences"} · ${rescues} ${rescues === 1 ? "rescue" : "rescues"} · ${interactions.length} interactions`}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Ride covers */}
        <Card>
          <CardHeader>
            <CardTitle>Ride covers</CardTitle>
            <CardDescription>
              Times this driver couldn&apos;t make a trip — and times they rescued
              someone else&apos;s.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {covers.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No covers recorded.
              </p>
            )}
            {covers.slice(0, 30).map((c) => (
              <div key={`${c.id}-${c.role}`} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {c.role === "absent" ? (
                      <>
                        <UserX className="h-3.5 w-3.5 text-amber-500" />
                        Needed cover
                      </>
                    ) : (
                      <>
                        <LifeBuoy className="h-3.5 w-3.5 text-success" />
                        Rescued a route
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{d(c.date)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {c.reason ?? "No reason recorded"}
                  {c.area ? ` · ${c.area}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.role === "absent" ? "Covered by " : "Covering for "}
                  {c.counterpartId ? (
                    <Link
                      href={`/dispatch/${c.counterpartId}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {c.counterpartName}
                    </Link>
                  ) : (
                    <span className="font-medium">{c.counterpartName ?? "—"}</span>
                  )}
                  {c.payment ? ` · $${c.payment}` : ""}
                  {c.rescueDate ? ` · covers ${d(c.rescueDate)}` : ""}
                </p>
              </div>
            ))}
            {covers.length > 30 && (
              <p className="text-center text-xs text-muted-foreground">
                Showing the 30 most recent of {covers.length}.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Compliance interactions */}
        <Card>
          <CardHeader>
            <CardTitle>Compliance record</CardTitle>
            <CardDescription>
              Interactions from the SharePoint Driver Incidents Report — the
              company&apos;s official log.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {interactions.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No interactions recorded.
              </p>
            )}
            {interactions.slice(0, 30).map((i) => (
              <div key={i.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {i.category ?? "Interaction"}
                    {i.priority && (
                      <span
                        className={cn(
                          "text-xs",
                          PRIORITY_TONE[i.priority] ?? "text-muted-foreground",
                        )}
                      >
                        · {i.priority}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {d(i.spCreatedAt)}
                  </span>
                </div>
                {i.subCategories && i.subCategories.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {i.subCategories.map((s) => (
                      <Badge key={s} variant="secondary" className="h-4 px-1.5 text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
                {i.description && (
                  <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
                    {i.description}
                  </p>
                )}
                <Separator className="my-2" />
                <p className="text-xs text-muted-foreground">
                  {i.status ?? "—"}
                  {i.assignedTo ? ` · assigned to ${i.assignedTo}` : ""}
                  {i.createdBy ? ` · logged by ${i.createdBy}` : ""}
                  {i.resolvedAt ? ` · resolved ${d(i.resolvedAt)}` : ""}
                </p>
              </div>
            ))}
            {interactions.length > 30 && (
              <p className="text-center text-xs text-muted-foreground">
                Showing the 30 most recent of {interactions.length}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

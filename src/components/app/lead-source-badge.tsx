import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { leadSourceLabel } from "@/lib/lead-source";

/**
 * The lead's acquisition channel. Website is tinted because it's the channel
 * worth noticing — those leads went looking for the client themselves.
 */
export function LeadSourceBadge({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        source === "website" && "border-success/30 bg-success/10 text-success",
        className,
      )}
    >
      {leadSourceLabel(source)}
    </Badge>
  );
}

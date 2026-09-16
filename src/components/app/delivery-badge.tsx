import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Delivery } from "@/lib/delivery";

/**
 * The Ads Manager "Delivery" pill. Colour carries the read at a glance —
 * green is spending, amber is spending but not yet trustworthy, red needs
 * someone to act, grey is off — so the label never has to be read twice.
 */
export function DeliveryBadge({
  delivery,
  className,
}: {
  delivery: Delivery;
  className?: string;
}) {
  const tone = {
    active: "bg-success/15 text-success",
    learning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    issue: "bg-destructive/10 text-destructive",
    off: "bg-muted text-muted-foreground",
  }[delivery.tone];

  return (
    <Badge
      variant="outline"
      title={delivery.hint}
      className={cn("border-transparent capitalize", tone, className)}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          delivery.tone === "active" && "bg-success",
          delivery.tone === "learning" && "bg-amber-500",
          delivery.tone === "issue" && "bg-destructive",
          delivery.tone === "off" && "bg-muted-foreground/50",
        )}
      />
      {delivery.label}
    </Badge>
  );
}

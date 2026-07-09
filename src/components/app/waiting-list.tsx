import { formatDistanceToNow } from "date-fns";
import { Clock, Phone } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import type { WaitingItem } from "@/lib/data";

const channelLabel: Record<string, string> = {
  call: "Call",
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
};

/**
 * Read-only list of leads inside the follow-up window ("Waiting"). They were
 * contacted recently and are NOT workable yet — the queue brings them back
 * automatically once the window elapses, so this view only shows when.
 */
export function WaitingList({ items }: { items: WaitingItem[] }) {
  if (!items.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <Clock className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No leads waiting.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Leads you contact appear here during the follow-up window, then move
            back to the queue on their own.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Last touch</TableHead>
              <TableHead className="text-right">Comes back</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p className="font-medium">{item.name}</p>
                  {item.phone && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {item.phone}
                    </p>
                  )}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm">
                  {item.campaign ?? "—"}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {item.aiScore ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {item.lastChannel ? channelLabel[item.lastChannel] ?? item.lastChannel : "—"}
                  {" · "}
                  {formatDistanceToNow(item.lastTouchAt, { addSuffix: true })}
                </TableCell>
                <TableCell className="text-right text-sm">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDistanceToNow(item.dueAt, { addSuffix: true })}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

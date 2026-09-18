import { ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * What each role in a client organization can do. This is the reference the
 * team is onboarded with; the rules themselves live in lib/permissions.ts,
 * so if you change one, change the other.
 */
const ROWS: { area: string; admin: string; supervisor: string; agent: string }[] = [
  {
    area: "Leads, Contact Queue, Pipeline",
    admin: "Yes",
    supervisor: "Yes",
    agent: "Yes",
  },
  {
    area: "Marketing (Overview, Planner, Campaigns)",
    admin: "Yes",
    supervisor: "Yes",
    agent: "No",
  },
  {
    area: "Reports (AI Insights, Funnel, Agent Activity, Daily Calls)",
    admin: "Yes",
    supervisor: "Yes",
    agent: "No",
  },
  {
    area: "Download data (CSV, Excel, PDF)",
    admin: "Full, with phone and email",
    supervisor: "Without phone or email",
    agent: "No",
  },
  {
    area: "API access (Claude, ChatGPT, MCP clients)",
    admin: "Yes",
    supervisor: "No",
    agent: "No",
  },
  {
    area: "Connections, company profile, AI settings",
    admin: "Yes",
    supervisor: "Yes",
    agent: "No",
  },
  {
    area: "Manage users",
    admin: "Yes",
    supervisor: "Yes",
    agent: "No",
  },
  {
    area: "Own password and RingCentral line",
    admin: "Yes",
    supervisor: "Yes",
    agent: "Yes",
  },
];

export function RoleMatrix() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          What each role can do
        </CardTitle>
        <CardDescription>
          Contact details leave the platform only in an admin&apos;s hands.
          Supervisors run the floor with plain data; agents work their leads.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Area</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Supervisor</TableHead>
              <TableHead>Agent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((r) => (
              <TableRow key={r.area}>
                <TableCell className="font-medium">{r.area}</TableCell>
                <TableCell>{r.admin}</TableCell>
                <TableCell>{r.supervisor}</TableCell>
                <TableCell className="text-muted-foreground">{r.agent}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function GeneralSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Workspace configuration and team management
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team & permissions</CardTitle>
          <CardDescription>
            Invite Vivo team members and client users. Clients only see their own
            workspace with a read-oriented view; the agency sees everything.
            Coming with the database-backed release.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}

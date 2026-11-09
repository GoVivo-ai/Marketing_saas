import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMaintenance, isRingCentralConnected } from "@/lib/settings";
import { SoftphoneProvider } from "@/components/app/softphone";
import { Toaster } from "@/components/ui/sonner";

/**
 * The agents' phone app: the Vivo phone as a full screen, built for a
 * handset. It is what the Android app opens. It lives outside the (app)
 * layout on purpose — no sidebar, no desktop chrome — but registers the same
 * single softphone, so it must never be mounted alongside that layout.
 */

export const metadata: Metadata = { title: "Phone" };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // A dialer is tapped fast; pinch/double-tap zoom only gets in the way.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#011640",
};

export default async function PhoneLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/phone");

  const role = (session.user as { role?: string }).role;
  const maintenance = await getMaintenance();
  if (maintenance.active && role !== "developer") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <Wrench className="h-6 w-6 text-amber-500" />
        <p className="text-lg font-semibold">Under maintenance</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {maintenance.message ?? "We'll be back shortly. Your data is safe."}
        </p>
      </div>
    );
  }

  const connected = await isRingCentralConnected(session.user.id);
  return (
    <SoftphoneProvider connected={connected} panel={false}>
      {children}
      <Toaster position="top-center" />
    </SoftphoneProvider>
  );
}

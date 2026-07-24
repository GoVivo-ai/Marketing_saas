"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Filter, Headset } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/reports", label: "Funnel", icon: Filter },
  { href: "/reports/agents", label: "Agent Activity", icon: Headset },
];

/** Sub-navigation shared by every page under Reports. */
export function ReportsNav() {
  const pathname = usePathname();
  return (
    <div className="flex w-fit items-center gap-1 rounded-lg bg-muted/60 p-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            pathname === t.href
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <t.icon className="h-3.5 w-3.5" />
          {t.label}
        </Link>
      ))}
    </div>
  );
}

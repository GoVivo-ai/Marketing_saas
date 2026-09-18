"use client";

import { useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FORMATS = [
  {
    value: "csv",
    label: "CSV",
    hint: "For spreadsheets and scripts",
    Icon: Table2,
  },
  {
    value: "xlsx",
    label: "Excel",
    hint: "Formatted, with filters",
    Icon: FileSpreadsheet,
  },
  { value: "pdf", label: "PDF", hint: "To read or share", Icon: FileText },
] as const;

/**
 * Downloads the current view. The link carries the page's own search params,
 * so the file is the slice on screen — same period, same filters — rather
 * than whatever happens to be on the current page of the table.
 */
export function ExportMenu({
  dataset,
  label = "Export",
  formats = ["csv", "xlsx", "pdf"],
  access = "full",
}: {
  /** Dataset segment of /api/export/<dataset>. */
  dataset: "campaigns" | "leads" | "pipeline" | "dispatch" | "calls" | "agents";
  label?: string;
  /**
   * Narrow the menu when a view already ships a better-designed file — the
   * Agent Activity report has its own charted PDF, so it offers data formats
   * here and keeps that button.
   */
  formats?: ("csv" | "xlsx" | "pdf")[];
  /**
   * What the server will hand this user (lib/permissions exportAccess):
   * "none" renders nothing, "plain" says up front that contact details are
   * left out so nobody is surprised by the file.
   */
  access?: "full" | "plain" | "none";
}) {
  const searchParams = useSearchParams();
  if (access === "none") return null;

  const href = (format: string) => {
    const params = new URLSearchParams(searchParams.toString());
    // The deep-linked lead sheet and pagination don't belong in a file.
    params.delete("lead");
    params.delete("page");
    params.set("format", format);
    return `/api/export/${dataset}?${params.toString()}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Download className="h-3.5 w-3.5" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {access === "plain" && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Without phone or email — only admins download contact details.
          </p>
        )}
        {FORMATS.filter((f) => formats.includes(f.value)).map(
          ({ value, label: name, hint, Icon }) => (
            <DropdownMenuItem
              key={value}
              render={<a href={href(value)} download />}
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex flex-col">
                <span>{name}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * One-time secret display (e.g. a temp password): selectable text plus a
 * copy button that works outside secure contexts too — navigator.clipboard
 * is undefined over plain http, which made the old copy-only button a no-op.
 */
export function CopySecret({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        el.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the input below stays selectable for manual copy.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
        className="w-56 rounded-md border bg-muted px-2.5 py-1.5 font-mono text-sm"
        aria-label="Temporary password"
      />
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? (
          <>
            <Check className="mr-1 h-3.5 w-3.5 text-success" />
            Copied
          </>
        ) : (
          <>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copy
          </>
        )}
      </Button>
    </div>
  );
}

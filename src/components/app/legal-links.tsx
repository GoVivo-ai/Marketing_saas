import { cn } from "@/lib/utils";

/** The platform's legal documents live on govivo.ai. */
const LINKS = [
  { label: "Platform Terms", href: "https://www.govivo.ai/platform-terms" },
  { label: "Privacy Policy", href: "https://www.govivo.ai/privacy-policy" },
];

export function LegalLinks({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground hover:underline"
        >
          {l.label}
        </a>
      ))}
    </p>
  );
}

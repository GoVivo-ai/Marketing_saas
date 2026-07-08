"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Free-text search for a specific lead by name, phone or email. Mirrors the
 * URL-param pattern of the other leads filters (LeadsFilter): it writes `?q=`
 * and lets the server page refetch, preserving the other params. Keystrokes are
 * debounced so we don't refetch on every character; Enter searches immediately.
 */
export function LeadsSearch({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page"); // a new search starts at page 1
    const q = next.trim();
    if (q) params.set("q", q);
    else params.delete("q");
    const query = params.toString();
    startTransition(() =>
      router.push(query ? `${pathname}?${query}` : pathname),
    );
  };

  const onChange = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), 350);
  };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    commit("");
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        commit(value);
      }}
      className="relative"
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, phone, email…"
        aria-label="Search leads"
        className="h-9 w-[220px] pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {pending ? (
        <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : value ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </form>
  );
}

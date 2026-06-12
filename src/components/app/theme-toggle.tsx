"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

/** Day/night switch — day is the light gray canvas, night the navy theme. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known client-side; render a stable icon during SSR and
  // hydration so server and client markup match.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Switch to day mode" : "Switch to night mode"}
      aria-label={dark ? "Switch to day mode" : "Switch to night mode"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

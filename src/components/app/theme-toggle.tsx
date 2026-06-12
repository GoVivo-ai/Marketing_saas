"use client";

import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};

/**
 * Day/night switch — day is the light gray canvas, night the navy theme.
 * Switching plays a dawn/dusk reveal: the new theme washes over the screen
 * as a circle growing from the button (View Transitions API; browsers
 * without it just switch instantly).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known client-side; render a stable icon during SSR and
  // hydration so server and client markup match.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const dark = mounted && resolvedTheme === "dark";

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = dark ? "light" : "dark";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduceMotion) {
      setTheme(next);
      return;
    }

    // Grow the reveal from the click point to the farthest screen corner.
    const x = e.clientX;
    const y = e.clientY;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(() => {
      // next-themes flips the class via React state; flush it so the new
      // theme is painted into the transition's "new" snapshot.
      flushSync(() => setTheme(next));
    });
    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 700,
          easing: "cubic-bezier(0.33, 1, 0.68, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={dark ? "Switch to day mode" : "Switch to night mode"}
      aria-label={dark ? "Switch to day mode" : "Switch to night mode"}
      className="relative overflow-hidden"
    >
      {/* Sun sets / moon rises: the icons rotate and scale past each other. */}
      <Sun
        className={cn(
          "h-4 w-4 transition-all duration-500",
          dark ? "rotate-0 scale-100" : "-rotate-90 scale-0",
        )}
      />
      <Moon
        className={cn(
          "absolute h-4 w-4 transition-all duration-500",
          dark ? "rotate-90 scale-0" : "rotate-0 scale-100",
        )}
      />
    </Button>
  );
}

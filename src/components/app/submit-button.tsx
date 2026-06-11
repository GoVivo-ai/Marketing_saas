"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Submit button that reflects the enclosing <form>'s pending state — shows a
 * spinner and disables itself while a server action runs, so long operations
 * (like a sync) give immediate feedback instead of looking frozen.
 */
export function SubmitButton({
  children,
  pendingText,
  icon,
  variant,
  size = "sm",
  className,
}: {
  children: ReactNode;
  pendingText?: string;
  icon?: ReactNode;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      variant={variant}
      size={size}
      className={className}
    >
      {pending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : (
        icon
      )}
      {pending ? pendingText ?? children : children}
    </Button>
  );
}

import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * VIVO wordmark. Renders the navy version on light backgrounds and the white
 * version on dark backgrounds (toggled via the `dark` class on <html>).
 * Pass a height utility (e.g. `h-9`) via `className`; width stays auto.
 */
export function VivoLogo({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/brand/vivo-wordmark-blue.png"
        alt="VIVO"
        width={350}
        height={143}
        priority
        className={cn("h-7 w-auto dark:hidden", className)}
      />
      <Image
        src="/brand/vivo-wordmark-white.png"
        alt="VIVO"
        width={350}
        height={143}
        priority
        className={cn("hidden h-7 w-auto dark:block", className)}
      />
    </>
  );
}

/** VIVO isotipo ("VO" logomark) — for compact spots like avatars or tight headers. */
export function VivoMark({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/brand/vivo-mark-blue.png"
        alt="VIVO"
        width={350}
        height={257}
        priority
        className={cn("h-8 w-auto dark:hidden", className)}
      />
      <Image
        src="/brand/vivo-mark-white.png"
        alt="VIVO"
        width={350}
        height={257}
        priority
        className={cn("hidden h-8 w-auto dark:block", className)}
      />
    </>
  );
}

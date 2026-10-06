import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Native <select> (best on phones) styled like shadcn inputs, 44px tall. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn("h-11 w-full rounded-md border bg-background px-3 text-base dark:bg-input/30", className)}
      {...props}
    />
  );
}

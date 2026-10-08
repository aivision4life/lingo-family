import type { ComponentProps } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

type Props = ComponentProps<typeof Link> & Pick<ComponentProps<typeof Button>, "variant" | "size">;

/** A router link styled as a shadcn Button. */
export function LinkButton({ variant, size, className, ...linkProps }: Props) {
  // className goes to Button so it is merged with the variant classes (e.g. "hidden md:inline-flex");
  // Radix Slot would only concatenate it onto the Link.
  return (
    <Button asChild variant={variant} size={size} className={typeof className === "string" ? className : undefined}>
      <Link {...linkProps} />
    </Button>
  );
}

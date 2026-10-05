import type { ComponentProps } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

type Props = ComponentProps<typeof Link> & Pick<ComponentProps<typeof Button>, "variant" | "size">;

/** A router link styled as a shadcn Button. */
export function LinkButton({ variant, size, ...linkProps }: Props) {
  return (
    <Button asChild variant={variant} size={size}>
      <Link {...linkProps} />
    </Button>
  );
}

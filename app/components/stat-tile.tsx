import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card, CardContent } from "~/components/ui/card";

/** A headline figure on an analytics page, optionally linking somewhere. */
export function StatTile({
  label,
  value,
  icon,
  to,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  to?: string;
}) {
  const tile = (
    <Card
      className={to ? "h-full transition-colors hover:bg-muted/50" : "h-full"}
    >
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
        </div>
        <span className="text-muted-foreground">{icon}</span>
      </CardContent>
    </Card>
  );

  return to ? <Link to={to}>{tile}</Link> : tile;
}

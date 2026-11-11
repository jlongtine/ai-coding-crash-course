import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card, CardContent } from "~/components/ui/card";

/** A signed change against the previous 30 days, formatted by `format`. */
export type TileChange = { delta: number; format: (amount: number) => string };

function ChangeLine({ delta, format }: TileChange) {
  if (delta === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        No change vs previous 30 days
      </p>
    );
  }

  const sign = delta > 0 ? "+" : "−";
  const tone =
    delta > 0
      ? "text-green-700 dark:text-green-400"
      : "text-amber-700 dark:text-amber-400";

  return (
    <p className={`mt-1 text-xs ${tone}`}>
      <span className="tabular-nums">
        {sign}
        {format(Math.abs(delta))}
      </span>{" "}
      <span className="text-muted-foreground">vs previous 30 days</span>
    </p>
  );
}

/** A headline figure on an analytics page, optionally linking somewhere. */
export function StatTile({
  label,
  value,
  icon,
  to,
  change,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  to?: string;
  change?: TileChange;
}) {
  const tile = (
    <Card
      className={to ? "h-full transition-colors hover:bg-muted/50" : "h-full"}
    >
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">
            {value}
          </p>
          {change && <ChangeLine {...change} />}
        </div>
        <span className="shrink-0 text-muted-foreground">{icon}</span>
      </CardContent>
    </Card>
  );

  return to ? <Link to={to}>{tile}</Link> : tile;
}

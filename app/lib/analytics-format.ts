// Display formatting for analytics figures. analyticsService returns raw
// counts; pages turn them into strings here so every page reads the same way.

const numberFormat = new Intl.NumberFormat("en-US");

const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

export function formatCount(count: number) {
  return numberFormat.format(count);
}

/** `part` as a share of `whole`, or "—" when there is nothing to divide by. */
export function formatRate(part: number, whole: number) {
  return whole === 0 ? "—" : percentFormat.format(part / whole);
}

export function formatCompletionRate(
  completedStudents: number,
  students: number
) {
  return formatRate(completedStudents, students);
}

export function formatRating(rating: {
  average: number | null;
  count: number;
}) {
  return rating.average === null
    ? "—"
    : `${rating.average.toFixed(1)} (${numberFormat.format(rating.count)})`;
}

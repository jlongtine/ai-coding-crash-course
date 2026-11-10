import { Fragment } from "react";
import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.$courseId.analytics";
import {
  getCourseAnalytics,
  getLessonDropOff,
  type LessonDropOffRow,
} from "~/services/analyticsService";
import { requireStaff } from "~/lib/access.server";
import { formatCurrency } from "~/lib/utils";
import {
  formatCompletionRate,
  formatCount,
  formatRate,
  formatRating,
} from "~/lib/analytics-format";
import { StatTile } from "~/components/stat-tile";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  AlertTriangle,
  CircleCheck,
  DollarSign,
  Pencil,
  Star,
  Users,
} from "lucide-react";

// ─── Course Analytics ───
// One course's headline figures and how far students get through it, lesson by
// lesson. analyticsService supplies raw counts; drops, shares and the
// highlighted lesson are worked out here.

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course.title ?? "Course";
  return [
    { title: `Analytics: ${title} — Cadence` },
    { name: "description", content: `How students are doing in ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const courseId = Number(params.courseId);
  if (!Number.isInteger(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  await requireStaff(request, courseId);

  const course = getCourseAnalytics(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  return { course, dropOff: getLessonDropOff(courseId) };
}

type DropOffRow = LessonDropOffRow & {
  /** Fewer completions than the previous lesson; null for the first lesson. */
  drop: number | null;
};

function withDrops(lessons: LessonDropOffRow[]): DropOffRow[] {
  return lessons.map((lesson, i) => ({
    ...lesson,
    drop: i === 0 ? null : lessons[i - 1].completed - lesson.completed,
  }));
}

/** The lesson losing the most students, or null when nothing drops. */
function biggestDropLessonId(rows: DropOffRow[]) {
  let biggest: DropOffRow | null = null;
  for (const row of rows) {
    if (row.drop !== null && row.drop > 0 && row.drop > (biggest?.drop ?? 0)) {
      biggest = row;
    }
  }
  return biggest?.lessonId ?? null;
}

function formatDrop(drop: number | null, students: number) {
  if (drop === null) return "—";
  if (drop === 0) return "0";
  // Shown in students, and in percentage points of enrolled students.
  const sign = drop > 0 ? "−" : "+";
  const count = `${sign}${formatCount(Math.abs(drop))}`;
  return students === 0
    ? count
    : `${count} (${sign}${Math.round((Math.abs(drop) / students) * 100)} pts)`;
}

const headerCell =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground";
const numericHeaderCell = `${headerCell} text-right`;

export default function CourseAnalytics({ loaderData }: Route.ComponentProps) {
  const { course, dropOff } = loaderData;
  const rows = withDrops(dropOff.lessons);
  const biggestDropId = biggestDropLessonId(rows);
  const { students } = dropOff;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link
          to={`/instructor/${course.courseId}`}
          className="hover:text-foreground"
        >
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{course.title}</h1>
          <p className="mt-1 text-muted-foreground">
            How students are doing in this course
          </p>
        </div>
        <Link to={`/instructor/${course.courseId}`}>
          <Button variant="outline">
            <Pencil className="mr-2 size-4" />
            Edit course
          </Button>
        </Link>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Students"
          value={formatCount(course.students)}
          icon={<Users className="size-5" />}
        />
        <StatTile
          label="Gross sales"
          value={formatCurrency(course.grossSalesCents)}
          icon={<DollarSign className="size-5" />}
        />
        <StatTile
          label="Completion"
          value={formatCompletionRate(
            course.completedStudents,
            course.students
          )}
          icon={<CircleCheck className="size-5" />}
        />
        <StatTile
          label="Rating"
          value={formatRating(course.rating)}
          icon={<Star className="size-5" />}
        />
      </div>

      <h2 className="mb-1 text-xl font-semibold">Lesson drop-off</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Enrolled students who completed each lesson, in course order. Students
        who skip around, or lessons added later, can make the numbers rise
        between lessons.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          This course has no lessons yet.
        </div>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={headerCell}>Lesson</th>
                  <th className={numericHeaderCell}>Completed</th>
                  <th className={numericHeaderCell}>% of students</th>
                  <th className={`${headerCell} w-1/4`}>
                    <span className="sr-only">Share of students</span>
                  </th>
                  <th className={numericHeaderCell}>Drop from previous</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const startsModule =
                    i === 0 || rows[i - 1].moduleId !== row.moduleId;
                  const isBiggestDrop = row.lessonId === biggestDropId;
                  const share = students === 0 ? 0 : row.completed / students;

                  return (
                    <Fragment key={row.lessonId}>
                      {startsModule && (
                        <tr className="border-b border-border bg-muted/30">
                          <th
                            colSpan={5}
                            scope="colgroup"
                            className="px-4 py-2 text-left text-sm font-semibold"
                          >
                            {row.moduleTitle}
                          </th>
                        </tr>
                      )}
                      <tr
                        className={
                          isBiggestDrop
                            ? "border-b border-border bg-amber-50 dark:bg-amber-900/20"
                            : "border-b border-border last:border-0"
                        }
                      >
                        <td className="px-4 py-3 pl-8">
                          <div className="flex items-center gap-2">
                            <span>{row.lessonTitle}</span>
                            {isBiggestDrop && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                Biggest drop
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCount(row.completed)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatRate(row.completed, students)}
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className="h-2 w-full overflow-hidden rounded-full bg-muted"
                            aria-hidden="true"
                          >
                            <div
                              className={
                                isBiggestDrop
                                  ? "h-full rounded-full bg-amber-500"
                                  : "h-full rounded-full bg-primary"
                              }
                              style={{ width: `${share * 100}%` }}
                            />
                          </div>
                        </td>
                        <td
                          className={
                            isBiggestDrop
                              ? "px-4 py-3 text-right font-semibold tabular-nums text-amber-800 dark:text-amber-300"
                              : "px-4 py-3 text-right tabular-nums"
                          }
                        >
                          {formatDrop(row.drop, students)}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading course analytics.";

  if (isRouteErrorResponse(error)) {
    title =
      error.status === 401
        ? "Sign in required"
        : error.status === 403
          ? "Access denied"
          : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/instructor">
          <Button>Back to My Courses</Button>
        </Link>
      </div>
    </div>
  );
}

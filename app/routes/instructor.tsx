import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/instructor";
import { getCoursesByInstructor } from "~/services/courseService";
import { getInstructorAnalytics } from "~/services/analyticsService";
import { getUnansweredQuestions } from "~/services/commentService";
import { getCurrentUserId } from "~/lib/session";
import { formatCurrency } from "~/lib/utils";
import { getUserById } from "~/services/userService";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  CircleCheck,
  GraduationCap,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { CourseStatus, UserRole } from "~/db/schema";

// ─── Instructor Landing Page ───
// An analytics overview: headline tiles, then one table row per published or
// archived course. Metrics come from analyticsService as raw numbers and are
// formatted here.
//
// Drafts sit outside analytics, but they are listed below the table so the
// instructor can still reach their editor from here.

const numberFormat = new Intl.NumberFormat("en-US");

export function meta() {
  return [
    { title: "My Courses — Cadence" },
    { name: "description", content: "How your courses are doing" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your courses.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", {
      status: 403,
    });
  }

  const analytics = getInstructorAnalytics(currentUserId);
  const unansweredQuestions = getUnansweredQuestions(currentUserId).length;
  const drafts = getCoursesByInstructor(currentUserId)
    .filter((course) => course.status === CourseStatus.Draft)
    .map((course) => ({ id: course.id, title: course.title }));

  return { ...analytics, unansweredQuestions, drafts };
}

function statusBadge(status: string) {
  switch (status) {
    case CourseStatus.Published:
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Published
        </span>
      );
    case CourseStatus.Archived:
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
          Archived
        </span>
      );
    default:
      return null;
  }
}

const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

function formatCompletionRate(completedStudents: number, students: number) {
  return students === 0
    ? "—"
    : percentFormat.format(completedStudents / students);
}

function formatRating(rating: { average: number | null; count: number }) {
  return rating.average === null
    ? "—"
    : `${rating.average.toFixed(1)} (${numberFormat.format(rating.count)})`;
}

/** last30Days − previous30Days, for a tile's "vs previous 30 days" line. */
function changeOf(recent: { last30Days: number; previous30Days: number }) {
  return recent.last30Days - recent.previous30Days;
}

/** A signed change against the previous 30 days, formatted by `format`. */
type TileChange = { delta: number; format: (amount: number) => string };

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

function StatTile({
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
    <Card className={to ? "h-full transition-colors hover:bg-muted/50" : "h-full"}>
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
          {change && <ChangeLine {...change} />}
        </div>
        <span className="text-muted-foreground">{icon}</span>
      </CardContent>
    </Card>
  );

  return to ? <Link to={to}>{tile}</Link> : tile;
}

const headerCell =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground";
const numericHeaderCell = `${headerCell} text-right`;

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-40" />
          <Skeleton className="mt-2 h-5 w-72" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export default function InstructorDashboard({
  loaderData,
}: Route.ComponentProps) {
  const { courses, totals, recent, unansweredQuestions, drafts } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">My Courses</span>
      </nav>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Courses</h1>
          <p className="mt-1 text-muted-foreground">
            How your published and archived courses are doing
          </p>
        </div>
        <Link to="/instructor/new">
          <Button>
            <Plus className="mr-2 size-4" />
            New Course
          </Button>
        </Link>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Gross sales"
          value={formatCurrency(totals.grossSalesCents)}
          icon={<DollarSign className="size-5" />}
          change={{
            delta: changeOf(recent.grossSalesCents),
            format: formatCurrency,
          }}
        />
        <StatTile
          label="Total students"
          value={numberFormat.format(totals.students)}
          icon={<Users className="size-5" />}
          change={{
            delta: changeOf(recent.newStudents),
            format: (count) => numberFormat.format(count),
          }}
        />
        <StatTile
          label="Avg completion"
          value={formatCompletionRate(
            totals.completedStudents,
            totals.students
          )}
          icon={<CircleCheck className="size-5" />}
        />
        <StatTile
          label="Unanswered questions"
          value={numberFormat.format(unansweredQuestions)}
          icon={<MessageCircleQuestion className="size-5" />}
          to="/instructor/questions"
        />
      </div>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <GraduationCap className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No published courses yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a course and publish it to start seeing analytics.
          </p>
          <Link to="/instructor/new" className="mt-4">
            <Button>
              <Plus className="mr-2 size-4" />
              Create Course
            </Button>
          </Link>
        </div>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={headerCell}>Course</th>
                  <th className={numericHeaderCell}>Students</th>
                  <th className={numericHeaderCell}>Gross sales</th>
                  <th className={numericHeaderCell}>Completion</th>
                  <th className={numericHeaderCell}>Rating</th>
                  <th className={headerCell}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr
                    key={course.courseId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/courses/${course.slug}`}
                          className="font-medium hover:text-primary"
                        >
                          {course.title}
                        </Link>
                        {statusBadge(course.status)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {numberFormat.format(course.students)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(course.grossSalesCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCompletionRate(
                        course.completedStudents,
                        course.students
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatRating(course.rating)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Link to={`/instructor/${course.courseId}`}>
                          <Button variant="outline" size="sm">
                            <Pencil className="mr-1.5 size-3.5" />
                            Edit
                          </Button>
                        </Link>
                        <Link to={`/instructor/${course.courseId}/analytics`}>
                          <Button variant="outline" size="sm">
                            <BarChart3 className="mr-1.5 size-3.5" />
                            Analytics
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {drafts.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Drafts
          </h2>
          <ul className="flex flex-wrap gap-2">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link to={`/instructor/${draft.id}`}>
                  <Button variant="outline" size="sm">
                    <Pencil className="mr-1.5 size-3.5" />
                    {draft.title}
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your courses.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message = typeof error.data === "string" ? error.data : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

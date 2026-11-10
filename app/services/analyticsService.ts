import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { courses, CourseStatus, enrollments, purchases } from "~/db/schema";

// ─── Analytics Service ───
// The one place instructor analytics are calculated. Every metric is computed
// with a grouped query across a set of courses, never a query per course.
//
// Returns raw counts; percentages, "—" for empty values and formatting are the
// route's job.
//
// Scope: an instructor's published and archived courses. Drafts are excluded.
// A "student" is an enrollment, so redeemed team seats count.
//
// Uses positional parameters (project convention).

export type CourseAnalytics = {
  courseId: number;
  title: string;
  slug: string;
  status: CourseStatus;
  students: number;
  grossSalesCents: number;
};

export type AnalyticsTotals = {
  students: number;
  grossSalesCents: number;
};

export type InstructorAnalytics = {
  courses: CourseAnalytics[];
  totals: AnalyticsTotals;
};

const IN_SCOPE_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

function getInScopeCourses(instructorId: number) {
  return db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      status: courses.status,
    })
    .from(courses)
    .where(
      and(
        eq(courses.instructorId, instructorId),
        inArray(courses.status, IN_SCOPE_STATUSES)
      )
    )
    .orderBy(asc(courses.title), asc(courses.id))
    .all();
}

/** Enrollment count per course. Courses with no enrollments are absent. */
function countStudentsByCourse(courseIds: number[]): Map<number, number> {
  const rows = db
    .select({
      courseId: enrollments.courseId,
      count: sql<number>`count(*)`,
    })
    .from(enrollments)
    .where(inArray(enrollments.courseId, courseIds))
    .groupBy(enrollments.courseId)
    .all();

  return new Map(rows.map((row) => [row.courseId, row.count]));
}

/**
 * Amount paid per course, in cents: after the country discount, with a team
 * purchase counted once at its full amount. Courses with no purchases are
 * absent.
 */
function sumGrossSalesByCourse(courseIds: number[]): Map<number, number> {
  const rows = db
    .select({
      courseId: purchases.courseId,
      total: sql<number>`sum(${purchases.amountPaid})`,
    })
    .from(purchases)
    .where(inArray(purchases.courseId, courseIds))
    .groupBy(purchases.courseId)
    .all();

  return new Map(rows.map((row) => [row.courseId, row.total]));
}

/**
 * Per-course metrics for every in-scope course an instructor owns, ordered by
 * title, plus totals across them.
 */
export function getInstructorAnalytics(
  instructorId: number
): InstructorAnalytics {
  const scope = getInScopeCourses(instructorId);
  const courseIds = scope.map((course) => course.id);

  const studentsByCourse = countStudentsByCourse(courseIds);
  const grossSalesByCourse = sumGrossSalesByCourse(courseIds);

  const courseAnalytics = scope.map(
    (course): CourseAnalytics => ({
      courseId: course.id,
      title: course.title,
      slug: course.slug,
      status: course.status,
      students: studentsByCourse.get(course.id) ?? 0,
      grossSalesCents: grossSalesByCourse.get(course.id) ?? 0,
    })
  );

  return {
    courses: courseAnalytics,
    totals: {
      students: sum(courseAnalytics, (course) => course.students),
      grossSalesCents: sum(courseAnalytics, (course) => course.grossSalesCents),
    },
  };
}

function sum<T>(items: T[], value: (item: T) => number) {
  return items.reduce((total, item) => total + value(item), 0);
}

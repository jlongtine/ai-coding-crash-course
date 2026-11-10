import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  CourseStatus,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
} from "~/db/schema";
import {
  getCourseRatingSummaries,
  type CourseRatingSummary,
} from "~/services/courseRatingService";

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
  completedStudents: number;
  rating: CourseRatingSummary;
};

export type AnalyticsTotals = {
  students: number;
  grossSalesCents: number;
  completedStudents: number;
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
 * Enrolled students per course who have completed every lesson currently in
 * the course. Courses with no completions, including courses with no lessons,
 * are absent. Worked out from lesson progress because the app never writes
 * `enrollments.completedAt`.
 */
function countCompletedStudentsByCourse(
  courseIds: number[]
): Map<number, number> {
  const lessonCounts = db
    .select({
      courseId: modules.courseId,
      lessonCount: sql<number>`count(${lessons.id})`.as("lesson_count"),
    })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .groupBy(modules.courseId)
    .as("lesson_counts");

  const completions = db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .innerJoin(lessonCounts, eq(lessonCounts.courseId, enrollments.courseId))
    .innerJoin(modules, eq(modules.courseId, enrollments.courseId))
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .innerJoin(
      lessonProgress,
      and(
        eq(lessonProgress.lessonId, lessons.id),
        eq(lessonProgress.userId, enrollments.userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .where(inArray(enrollments.courseId, courseIds))
    .groupBy(enrollments.courseId, enrollments.userId)
    .having(
      sql`count(distinct ${lessons.id}) = max(${lessonCounts.lessonCount})`
    )
    .as("completions");

  const rows = db
    .select({
      courseId: completions.courseId,
      count: sql<number>`count(*)`,
    })
    .from(completions)
    .groupBy(completions.courseId)
    .all();

  return new Map(rows.map((row) => [row.courseId, row.count]));
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
  const completedStudentsByCourse = countCompletedStudentsByCourse(courseIds);
  const ratingsByCourse = getCourseRatingSummaries(courseIds);

  const courseAnalytics = scope.map((course): CourseAnalytics => ({
    courseId: course.id,
    title: course.title,
    slug: course.slug,
    status: course.status,
    students: studentsByCourse.get(course.id) ?? 0,
    grossSalesCents: grossSalesByCourse.get(course.id) ?? 0,
    completedStudents: completedStudentsByCourse.get(course.id) ?? 0,
    rating: ratingsByCourse.get(course.id) ?? { average: null, count: 0 },
  }));

  return {
    courses: courseAnalytics,
    totals: {
      students: sum(courseAnalytics, (course) => course.students),
      grossSalesCents: sum(courseAnalytics, (course) => course.grossSalesCents),
      completedStudents: sum(
        courseAnalytics,
        (course) => course.completedStudents
      ),
    },
  };
}

function sum<T>(items: T[], value: (item: T) => number) {
  return items.reduce((total, item) => total + value(item), 0);
}

/**
 * The same figures as a row of `getInstructorAnalytics`, for one course of
 * any status. Undefined when the course doesn't exist.
 */
export function getCourseAnalytics(
  courseId: number
): CourseAnalytics | undefined {
  const course = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      status: courses.status,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) return undefined;

  const ids = [courseId];
  return {
    courseId: course.id,
    title: course.title,
    slug: course.slug,
    status: course.status,
    students: countStudentsByCourse(ids).get(courseId) ?? 0,
    grossSalesCents: sumGrossSalesByCourse(ids).get(courseId) ?? 0,
    completedStudents: countCompletedStudentsByCourse(ids).get(courseId) ?? 0,
    rating: getCourseRatingSummaries(ids).get(courseId) ?? {
      average: null,
      count: 0,
    },
  };
}

export type LessonDropOffRow = {
  lessonId: number;
  lessonTitle: string;
  moduleId: number;
  moduleTitle: string;
  completed: number;
};

export type LessonDropOff = {
  students: number;
  lessons: LessonDropOffRow[];
};

/**
 * Every lesson in a course, in module-then-lesson position order, with how
 * many enrolled students have completed it, plus the course's student count.
 */
export function getLessonDropOff(courseId: number): LessonDropOff {
  const lessonRows = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleId: modules.id,
      moduleTitle: modules.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(modules.courseId, courseId))
    .orderBy(
      asc(modules.position),
      asc(modules.id),
      asc(lessons.position),
      asc(lessons.id)
    )
    .all();

  const completedByLesson = countCompletionsByLesson(courseId);

  return {
    students: countStudentsByCourse([courseId]).get(courseId) ?? 0,
    lessons: lessonRows.map((row) => ({
      ...row,
      completed: completedByLesson.get(row.lessonId) ?? 0,
    })),
  };
}

/**
 * Enrolled students per lesson of a course with a completed progress row.
 * Lessons nobody has completed are absent.
 */
function countCompletionsByLesson(courseId: number): Map<number, number> {
  const rows = db
    .select({
      lessonId: lessons.id,
      count: sql<number>`count(distinct ${enrollments.userId})`,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(enrollments, eq(enrollments.courseId, modules.courseId))
    .innerJoin(
      lessonProgress,
      and(
        eq(lessonProgress.lessonId, lessons.id),
        eq(lessonProgress.userId, enrollments.userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .where(eq(modules.courseId, courseId))
    .groupBy(lessons.id)
    .all();

  return new Map(rows.map((row) => [row.lessonId, row.count]));
}

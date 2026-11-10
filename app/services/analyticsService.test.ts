import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getInstructorAnalytics } from "./analyticsService";
import { createTeamPurchase } from "./purchaseService";
import { redeemCoupon } from "./couponService";

let studentCount = 0;

function createStudent() {
  studentCount += 1;
  return testDb
    .insert(schema.users)
    .values({
      name: `Student ${studentCount}`,
      email: `student${studentCount}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function createCourse(
  title: string,
  status: schema.CourseStatus,
  instructorId = base.instructor.id
) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      description: "A course",
      salesCopy: "Sales copy.",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function enrollStudents(courseId: number, count: number) {
  for (let i = 0; i < count; i++) {
    testDb
      .insert(schema.enrollments)
      .values({ userId: createStudent().id, courseId })
      .run();
  }
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorAnalytics", () => {
    it("counts students per course and in total", () => {
      const archived = createCourse("Old Course", schema.CourseStatus.Archived);
      enrollStudents(base.course.id, 3);
      enrollStudents(archived.id, 2);

      const analytics = getInstructorAnalytics(base.instructor.id);

      expect(analytics.courses).toEqual([
        expect.objectContaining({ courseId: archived.id, students: 2 }),
        expect.objectContaining({ courseId: base.course.id, students: 3 }),
      ]);
      expect(analytics.totals.students).toBe(5);
    });

    it("counts redeemed team seats as students, but not unredeemed ones", () => {
      const buyer = createStudent();
      const { coupons } = createTeamPurchase(
        buyer.id,
        base.course.id,
        50000,
        "US",
        3
      );
      redeemCoupon(coupons[0].code, createStudent().id, "US");
      redeemCoupon(coupons[1].code, createStudent().id, "US");

      const analytics = getInstructorAnalytics(base.instructor.id);

      expect(analytics.courses).toEqual([
        expect.objectContaining({ courseId: base.course.id, students: 2 }),
      ]);
      expect(analytics.totals.students).toBe(2);
    });

    it("excludes draft courses", () => {
      const draft = createCourse("Draft Course", schema.CourseStatus.Draft);
      enrollStudents(draft.id, 4);
      enrollStudents(base.course.id, 1);

      const analytics = getInstructorAnalytics(base.instructor.id);

      expect(analytics.courses.map((c) => c.courseId)).toEqual([
        base.course.id,
      ]);
      expect(analytics.totals.students).toBe(1);
    });

    it("excludes other instructors' courses", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other-instructor@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const theirs = createCourse(
        "Their Course",
        schema.CourseStatus.Published,
        other.id
      );
      enrollStudents(theirs.id, 4);
      enrollStudents(base.course.id, 1);

      const analytics = getInstructorAnalytics(base.instructor.id);

      expect(analytics.courses.map((c) => c.courseId)).toEqual([
        base.course.id,
      ]);
      expect(analytics.totals.students).toBe(1);
    });

    it("includes a course with no students at zero", () => {
      const analytics = getInstructorAnalytics(base.instructor.id);

      expect(analytics.courses).toEqual([
        expect.objectContaining({
          courseId: base.course.id,
          title: "Test Course",
          students: 0,
        }),
      ]);
      expect(analytics.totals.students).toBe(0);
    });

    it("returns no courses and zero totals for an instructor with only drafts", () => {
      testDb
        .update(schema.courses)
        .set({ status: schema.CourseStatus.Draft })
        .run();
      enrollStudents(base.course.id, 2);

      const analytics = getInstructorAnalytics(base.instructor.id);

      expect(analytics).toEqual({
        courses: [],
        totals: { students: 0, completedStudents: 0 },
      });
    });
  });
});

describe("completion and ratings", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  /** Creates modules of lessons in a course; returns lesson ids per module. */
  function createLessons(courseId: number, lessonsPerModule: number[]) {
    return lessonsPerModule.map((lessonCount, moduleIndex) => {
      const mod = testDb
        .insert(schema.modules)
        .values({
          courseId,
          title: `Module ${moduleIndex + 1}`,
          position: moduleIndex,
        })
        .returning()
        .get();
      return Array.from(
        { length: lessonCount },
        (_, lessonIndex) =>
          testDb
            .insert(schema.lessons)
            .values({
              moduleId: mod.id,
              title: `Lesson ${moduleIndex + 1}.${lessonIndex + 1}`,
              position: lessonIndex,
            })
            .returning()
            .get().id
      );
    });
  }

  function enroll(courseId: number) {
    const student = createStudent();
    testDb
      .insert(schema.enrollments)
      .values({ userId: student.id, courseId })
      .run();
    return student;
  }

  function setProgress(
    userId: number,
    lessonIds: number[],
    status = schema.LessonProgressStatus.Completed
  ) {
    for (const lessonId of lessonIds) {
      testDb
        .insert(schema.lessonProgress)
        .values({ userId, lessonId, status })
        .run();
    }
  }

  function rate(courseId: number, rating: number) {
    testDb
      .insert(schema.courseRatings)
      .values({ userId: createStudent().id, courseId, rating })
      .run();
  }

  function courseRow(courseId: number) {
    return getInstructorAnalytics(base.instructor.id).courses.find(
      (course) => course.courseId === courseId
    );
  }

  it("counts a student who completed every lesson across multiple modules", () => {
    const [moduleOne, moduleTwo] = createLessons(base.course.id, [2, 3]);
    const finisher = enroll(base.course.id);
    setProgress(finisher.id, [...moduleOne, ...moduleTwo]);
    enroll(base.course.id);

    expect(courseRow(base.course.id)).toMatchObject({
      students: 2,
      completedStudents: 1,
    });
  });
  it("does not count a student missing one lesson", () => {
    const [moduleOne, moduleTwo] = createLessons(base.course.id, [2, 2]);
    const student = enroll(base.course.id);
    setProgress(student.id, [...moduleOne, moduleTwo[0]]);

    expect(courseRow(base.course.id)).toMatchObject({
      students: 1,
      completedStudents: 0,
    });
  });

  it("does not count lessons that are only in progress", () => {
    const [lessonIds] = createLessons(base.course.id, [2]);
    const student = enroll(base.course.id);
    setProgress(student.id, [lessonIds[0]]);
    setProgress(
      student.id,
      [lessonIds[1]],
      schema.LessonProgressStatus.InProgress
    );

    expect(courseRow(base.course.id)?.completedStudents).toBe(0);
  });

  it("does not count completed lessons from a student who is not enrolled", () => {
    const [lessonIds] = createLessons(base.course.id, [2]);
    setProgress(createStudent().id, lessonIds);

    expect(courseRow(base.course.id)).toMatchObject({
      students: 0,
      completedStudents: 0,
    });
  });

  it("does not count completions of a lesson in another course", () => {
    const other = createCourse("Other Course", schema.CourseStatus.Published);
    const [ours] = createLessons(base.course.id, [2]);
    const [theirs] = createLessons(other.id, [1]);
    const student = enroll(base.course.id);
    setProgress(student.id, [ours[0], theirs[0]]);

    expect(courseRow(base.course.id)?.completedStudents).toBe(0);
  });

  it("gives a course with no lessons no completions", () => {
    enroll(base.course.id);

    expect(courseRow(base.course.id)).toMatchObject({
      students: 1,
      completedStudents: 0,
    });
  });

  it("gives a course with zero students zero completions", () => {
    createLessons(base.course.id, [3]);

    expect(courseRow(base.course.id)).toMatchObject({
      students: 0,
      completedStudents: 0,
    });
  });

  it("excludes completions in drafts and other instructors' courses", () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "other-instructor@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const draft = createCourse("Draft Course", schema.CourseStatus.Draft);
    const theirs = createCourse(
      "Their Course",
      schema.CourseStatus.Published,
      other.id
    );
    for (const course of [draft, theirs]) {
      const [lessonIds] = createLessons(course.id, [1]);
      setProgress(enroll(course.id).id, lessonIds);
    }

    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses.map((c) => c.courseId)).toEqual([base.course.id]);
    expect(analytics.totals).toEqual({ students: 0, completedStudents: 0 });
  });

  it("totals completed students across courses", () => {
    const archived = createCourse("Old Course", schema.CourseStatus.Archived);
    const [published] = createLessons(base.course.id, [2]);
    const [old] = createLessons(archived.id, [1]);
    setProgress(enroll(base.course.id).id, published);
    setProgress(enroll(base.course.id).id, published);
    enroll(base.course.id);
    setProgress(enroll(archived.id).id, old);
    enroll(archived.id);

    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses).toEqual([
      expect.objectContaining({ courseId: archived.id, completedStudents: 1 }),
      expect.objectContaining({
        courseId: base.course.id,
        completedStudents: 2,
      }),
    ]);
    expect(analytics.totals).toEqual({ students: 5, completedStudents: 3 });
  });

  it("attaches each course's rating summary, empty when unrated", () => {
    const unrated = createCourse(
      "Unrated Course",
      schema.CourseStatus.Published
    );
    rate(base.course.id, 5);
    rate(base.course.id, 4);
    rate(base.course.id, 4);

    expect(courseRow(base.course.id)?.rating).toEqual({
      average: 4.3,
      count: 3,
    });
    expect(courseRow(unrated.id)?.rating).toEqual({ average: null, count: 0 });
  });
});

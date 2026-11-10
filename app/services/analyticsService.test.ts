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
import { createPurchase, createTeamPurchase } from "./purchaseService";
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
        totals: { students: 0, grossSalesCents: 0, completedStudents: 0 },
        recent: {
          grossSalesCents: { last30Days: 0, previous30Days: 0 },
          newStudents: { last30Days: 0, previous30Days: 0 },
        },
      });
    });
  });
});

describe("gross sales", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("sums a full-price purchase at the amount paid", () => {
    createPurchase(createStudent().id, base.course.id, 4999, "US");

    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses).toEqual([
      expect.objectContaining({
        courseId: base.course.id,
        grossSalesCents: 4999,
      }),
    ]);
  });

  it("counts a country-discounted purchase at the amount paid", () => {
    createPurchase(createStudent().id, base.course.id, 4999, "US");
    createPurchase(createStudent().id, base.course.id, 1500, "IN");

    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses).toEqual([
      expect.objectContaining({
        courseId: base.course.id,
        grossSalesCents: 6499,
      }),
    ]);
  });

  it("counts a team purchase once at its full amount, though the buyer isn't enrolled", () => {
    const { coupons } = createTeamPurchase(
      createStudent().id,
      base.course.id,
      50000,
      "US",
      5
    );
    redeemCoupon(coupons[0].code, createStudent().id, "US");
    redeemCoupon(coupons[1].code, createStudent().id, "US");

    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses).toEqual([
      expect.objectContaining({
        courseId: base.course.id,
        grossSalesCents: 50000,
      }),
    ]);
    expect(analytics.totals.grossSalesCents).toBe(50000);
  });

  it("excludes draft courses and other instructors' courses", () => {
    const draft = createCourse("Draft Course", schema.CourseStatus.Draft);
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
    createPurchase(createStudent().id, draft.id, 2000, "US");
    createPurchase(createStudent().id, theirs.id, 3000, "US");
    createPurchase(createStudent().id, base.course.id, 1000, "US");

    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses).toEqual([
      expect.objectContaining({
        courseId: base.course.id,
        grossSalesCents: 1000,
      }),
    ]);
    expect(analytics.totals.grossSalesCents).toBe(1000);
  });

  it("returns zero for a course with no purchases", () => {
    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses).toEqual([
      expect.objectContaining({ courseId: base.course.id, grossSalesCents: 0 }),
    ]);
    expect(analytics.totals.grossSalesCents).toBe(0);
  });

  it("totals gross sales across published and archived courses", () => {
    const archived = createCourse("Old Course", schema.CourseStatus.Archived);
    createPurchase(createStudent().id, base.course.id, 4999, "US");
    createPurchase(createStudent().id, archived.id, 2500, "BR");

    const analytics = getInstructorAnalytics(base.instructor.id);

    expect(analytics.courses).toEqual([
      expect.objectContaining({ courseId: archived.id, grossSalesCents: 2500 }),
      expect.objectContaining({
        courseId: base.course.id,
        grossSalesCents: 4999,
      }),
    ]);
    expect(analytics.totals.grossSalesCents).toBe(7499);
  });
});

describe("30-day changes", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  function daysAgo(days: number, extraMs = 0) {
    return new Date(now.getTime() - days * DAY + extraMs).toISOString();
  }

  function purchase(courseId: number, amountPaid: number, createdAt: string) {
    testDb
      .insert(schema.purchases)
      .values({
        userId: createStudent().id,
        courseId,
        amountPaid,
        country: "US",
        createdAt,
      })
      .run();
  }

  function enrollAt(courseId: number, enrolledAt: string) {
    testDb
      .insert(schema.enrollments)
      .values({ userId: createStudent().id, courseId, enrolledAt })
      .run();
  }

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("splits gross sales into the last 30 days and the 30 days before", () => {
    purchase(base.course.id, 100, daysAgo(1));
    purchase(base.course.id, 200, daysAgo(29));
    purchase(base.course.id, 400, daysAgo(31));
    purchase(base.course.id, 800, daysAgo(59));

    const { recent } = getInstructorAnalytics(base.instructor.id, now);

    expect(recent.grossSalesCents).toEqual({
      last30Days: 300,
      previous30Days: 1200,
    });
  });

  it("splits new students into the last 30 days and the 30 days before", () => {
    enrollAt(base.course.id, daysAgo(2));
    enrollAt(base.course.id, daysAgo(10));
    enrollAt(base.course.id, daysAgo(20));
    enrollAt(base.course.id, daysAgo(45));

    const { recent } = getInstructorAnalytics(base.instructor.id, now);

    expect(recent.newStudents).toEqual({ last30Days: 3, previous30Days: 1 });
  });

  it("puts a row at exactly 30 days ago in the last 30 days, and one at exactly 60 days ago in the previous 30", () => {
    purchase(base.course.id, 100, daysAgo(30));
    purchase(base.course.id, 200, daysAgo(30, -1));
    purchase(base.course.id, 400, daysAgo(60));
    enrollAt(base.course.id, daysAgo(30));
    enrollAt(base.course.id, daysAgo(30, -1));
    enrollAt(base.course.id, daysAgo(60));

    const { recent } = getInstructorAnalytics(base.instructor.id, now);

    expect(recent.grossSalesCents).toEqual({
      last30Days: 100,
      previous30Days: 600,
    });
    expect(recent.newStudents).toEqual({ last30Days: 1, previous30Days: 2 });
  });

  it("excludes rows from before both windows and from now onwards", () => {
    purchase(base.course.id, 100, daysAgo(60, -1));
    purchase(base.course.id, 200, daysAgo(0));
    purchase(base.course.id, 400, daysAgo(-1));
    enrollAt(base.course.id, daysAgo(60, -1));
    enrollAt(base.course.id, daysAgo(0));
    enrollAt(base.course.id, daysAgo(-1));

    const analytics = getInstructorAnalytics(base.instructor.id, now);

    expect(analytics.recent).toEqual({
      grossSalesCents: { last30Days: 0, previous30Days: 0 },
      newStudents: { last30Days: 0, previous30Days: 0 },
    });
    expect(analytics.totals).toMatchObject({
      students: 3,
      grossSalesCents: 700,
    });
  });

  it("totals the windows across published and archived courses, excluding drafts and other instructors' courses", () => {
    const archived = createCourse("Old Course", schema.CourseStatus.Archived);
    const draft = createCourse("Draft Course", schema.CourseStatus.Draft);
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
    for (const course of [base.course, archived, draft, theirs]) {
      purchase(course.id, 1000, daysAgo(5));
      purchase(course.id, 300, daysAgo(40));
      enrollAt(course.id, daysAgo(5));
      enrollAt(course.id, daysAgo(40));
      enrollAt(course.id, daysAgo(41));
    }

    const { recent } = getInstructorAnalytics(base.instructor.id, now);

    expect(recent).toEqual({
      grossSalesCents: { last30Days: 2000, previous30Days: 600 },
      newStudents: { last30Days: 2, previous30Days: 4 },
    });
  });

  it("defaults to the current time", () => {
    purchase(base.course.id, 500, new Date(Date.now() - DAY).toISOString());
    enrollAt(base.course.id, new Date(Date.now() - DAY).toISOString());

    const { recent } = getInstructorAnalytics(base.instructor.id);

    expect(recent).toEqual({
      grossSalesCents: { last30Days: 500, previous30Days: 0 },
      newStudents: { last30Days: 1, previous30Days: 0 },
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
    expect(analytics.totals).toEqual({
      students: 0,
      grossSalesCents: 0,
      completedStudents: 0,
    });
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
    expect(analytics.totals).toEqual({
      students: 5,
      grossSalesCents: 0,
      completedStudents: 3,
    });
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

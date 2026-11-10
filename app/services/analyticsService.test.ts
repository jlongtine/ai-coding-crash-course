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
import {
  getCourseAnalytics,
  getInstructorAnalytics,
  getLessonDropOff,
} from "./analyticsService";
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

describe("course analytics and drop-off", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  function createModule(courseId: number, title: string, position: number) {
    return testDb
      .insert(schema.modules)
      .values({ courseId, title, position })
      .returning()
      .get();
  }

  function createLesson(moduleId: number, title: string, position: number) {
    return testDb
      .insert(schema.lessons)
      .values({ moduleId, title, position })
      .returning()
      .get();
  }

  function enroll(courseId: number) {
    const student = createStudent();
    testDb
      .insert(schema.enrollments)
      .values({ userId: student.id, courseId })
      .run();
    return student;
  }

  function complete(
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

  it("orders lessons by module position, then lesson position", () => {
    const second = createModule(base.course.id, "Second", 2);
    const first = createModule(base.course.id, "First", 1);
    const b2 = createLesson(second.id, "B2", 2);
    const a2 = createLesson(first.id, "A2", 2);
    const b1 = createLesson(second.id, "B1", 1);
    const a1 = createLesson(first.id, "A1", 1);

    const dropOff = getLessonDropOff(base.course.id);

    expect(dropOff.lessons).toEqual([
      {
        lessonId: a1.id,
        lessonTitle: "A1",
        moduleId: first.id,
        moduleTitle: "First",
        completed: 0,
      },
      {
        lessonId: a2.id,
        lessonTitle: "A2",
        moduleId: first.id,
        moduleTitle: "First",
        completed: 0,
      },
      {
        lessonId: b1.id,
        lessonTitle: "B1",
        moduleId: second.id,
        moduleTitle: "Second",
        completed: 0,
      },
      {
        lessonId: b2.id,
        lessonTitle: "B2",
        moduleId: second.id,
        moduleTitle: "Second",
        completed: 0,
      },
    ]);
  });

  it("counts enrolled students who completed each lesson", () => {
    const mod = createModule(base.course.id, "Basics", 1);
    const one = createLesson(mod.id, "One", 1);
    const two = createLesson(mod.id, "Two", 2);
    const three = createLesson(mod.id, "Three", 3);
    const a = enroll(base.course.id);
    const b = enroll(base.course.id);
    const c = enroll(base.course.id);
    complete(a.id, [one.id, two.id]);
    complete(b.id, [one.id, two.id]);
    complete(c.id, [one.id]);
    complete(c.id, [two.id, three.id], schema.LessonProgressStatus.InProgress);

    const dropOff = getLessonDropOff(base.course.id);

    expect(dropOff.students).toBe(3);
    expect(dropOff.lessons.map((l) => [l.lessonTitle, l.completed])).toEqual([
      ["One", 3],
      ["Two", 2],
      ["Three", 0],
    ]);
  });

  it("ignores progress from students who aren't enrolled", () => {
    const mod = createModule(base.course.id, "Basics", 1);
    const lesson = createLesson(mod.id, "One", 1);
    complete(enroll(base.course.id).id, [lesson.id]);
    complete(createStudent().id, [lesson.id]);
    const other = createCourse("Other Course", schema.CourseStatus.Published);
    complete(enroll(other.id).id, [lesson.id]);

    const dropOff = getLessonDropOff(base.course.id);

    expect(dropOff.students).toBe(1);
    expect(dropOff.lessons[0].completed).toBe(1);
  });

  it("reports zero students and zero completions for a course nobody is enrolled in", () => {
    const mod = createModule(base.course.id, "Basics", 1);
    createLesson(mod.id, "One", 1);
    createLesson(mod.id, "Two", 2);

    const dropOff = getLessonDropOff(base.course.id);

    expect(dropOff.students).toBe(0);
    expect(dropOff.lessons.map((l) => l.completed)).toEqual([0, 0]);
  });

  it("does not include another course's lessons", () => {
    const other = createCourse("Other Course", schema.CourseStatus.Published);
    createLesson(createModule(other.id, "Theirs", 1).id, "Their lesson", 1);
    createLesson(createModule(base.course.id, "Ours", 1).id, "Our lesson", 1);

    expect(
      getLessonDropOff(base.course.id).lessons.map((l) => l.lessonTitle)
    ).toEqual(["Our lesson"]);
  });

  it("summarises one course the same way as the instructor's course table", () => {
    const archived = createCourse("Old Course", schema.CourseStatus.Archived);
    const mod = createModule(base.course.id, "Basics", 1);
    const lesson = createLesson(mod.id, "One", 1);
    const finisher = enroll(base.course.id);
    complete(finisher.id, [lesson.id]);
    enroll(base.course.id);
    enroll(archived.id);
    createPurchase(finisher.id, base.course.id, 4999, "US");
    createPurchase(createStudent().id, archived.id, 1500, "IN");
    testDb
      .insert(schema.courseRatings)
      .values({ userId: finisher.id, courseId: base.course.id, rating: 4 })
      .run();

    const summary = getCourseAnalytics(base.course.id);

    expect(summary).toEqual({
      courseId: base.course.id,
      title: "Test Course",
      slug: "test-course",
      status: schema.CourseStatus.Published,
      students: 2,
      grossSalesCents: 4999,
      completedStudents: 1,
      rating: { average: 4, count: 1 },
    });
    expect(summary).toEqual(
      getInstructorAnalytics(base.instructor.id).courses.find(
        (course) => course.courseId === base.course.id
      )
    );
  });

  it("returns no summary for a course that doesn't exist", () => {
    expect(getCourseAnalytics(9999)).toBeUndefined();
  });
});

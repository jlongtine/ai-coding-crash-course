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
        totals: { students: 0, grossSalesCents: 0 },
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

---
name: testing-services
description: Testing services against an in-memory database — the `~/db` mock and its import order. Use when writing or editing a test for any module that imports `~/db`, or when a test touches the real `data.db`.
---

# Testing Services

Services import the shared `db` singleton, so a test swaps in a fresh in-memory database by mocking `~/db`.

## The test database

`app/test/setup.ts` exports two helpers:

- `createTestDb()` — a fresh in-memory SQLite database with the real migrations from `drizzle/` applied, so test and production schemas stay in sync.
- `seedBaseData(testDb)` — inserts a user, instructor, category, and course, and returns their IDs for tests to build on.

## The mock

Mock `~/db` with a **getter**, so the binding stays live as `beforeEach` replaces `testDb`, and import the module under test **after** the mock:

```ts
let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getCourseById } from "~/services/courseService";

beforeEach(() => {
  testDb = createTestDb();
});
```

The import order is load-bearing: a service imported above the mock captures the real database, silently.

## Vitest setup

Vitest runs with `globals: true` and `vite-tsconfig-paths`, so `describe`/`it`/`expect` need no import and `~/*` resolves in tests.

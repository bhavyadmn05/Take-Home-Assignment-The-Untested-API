# Bug Report — Task Manager API

Three bugs were found while writing tests against `taskService.js` and the
routes that use it. One is fixed (see "Part B" requirement). The other two
are documented and pinned with `test.failing()` so they stay visible without
breaking the suite.

---

## Bug 1 (FIXED): Pagination skips the first page entirely

**Bug — What is wrong?**
`GET /tasks?page=1&limit=10` does not return the first 10 tasks. It returns
tasks 11–20 (or fewer, if there aren't that many). There is no query value
that returns the true first page — `page=0` also resolves to page 1 upstream
in the route (`parseInt(page) || 1`, and `0` is falsy), so the first `limit`
tasks were permanently unreachable through this endpoint.

**Location**
`src/services/taskService.js`, function `getPaginated(page, limit)`.

**Why it happens (root cause)**
The offset was computed as `page * limit`, treating `page` as 0-indexed.
But every caller (the route's default of `page = 1`, and the API table's
example `?page=1&limit=10`) treats `page` as 1-indexed. For a 1-indexed
page number, the correct offset is `(page - 1) * limit`; using `page * limit`
shifts every page forward by one full `limit`-sized block, permanently
skipping the first block.

**Reproduction**
`tests/taskService.test.js` → `getPaginated` → `'happy path: page 1 returns
the first `limit` tasks'` (originally written and run as a failing test
named `'BUG: page 1 should return the first `limit` tasks, not skip them'`
before the fix; converted to a normal passing assertion after fixing).
`tests/tasks.routes.test.js` → `pagination` → `'happy path: page 1 returns
the first `limit` tasks'` (integration-level version of the same proof).

Before the fix, with 15 tasks seeded, `getPaginated(1, 10)` returned
`tasks[10..14]` instead of `tasks[0..9]`, and `getPaginated(1, 100)`
returned `[]` instead of all 15 tasks.

**Fix**

```diff
- const offset = page * limit;
+ const offset = (page - 1) * limit;
```

**Reasoning — why this addresses the root cause**
This directly corrects the indexing mismatch: for `page=1`, offset is now
`0` (the true first page); for `page=2`, offset is `limit` (the second
block); and so on. It matches the 1-indexed convention already implied by
the route's default and the API documentation, with no changes needed
anywhere else — the rest of `getPaginated`'s logic (`tasks.slice(offset,
offset + limit)`) was already correct once given the correct offset.

---

## Bug 2 (NOT FIXED — documented): Status filter matches on substring, not equality

**Bug — What is wrong?**
`GET /tasks?status=X` should return tasks whose status exactly equals `X`.
Instead, it returns tasks whose status _contains_ `X` as a substring. For
example, `?status=on` (not a real status) matches tasks with status `done`
(`d-o-n-e` contains `"on"`), and `?status=od` matches `todo`.

**Location**
`src/services/taskService.js`, function `getByStatus(status)`:

```js
const getByStatus = (status) => tasks.filter((t) => t.status.includes(status));
```

**Why it happens (root cause)**
`String.prototype.includes()` is a substring test, not an equality test.
The three real status values (`todo`, `in_progress`, `done`) happen not to
be substrings of one another, so filtering by any _real, full_ status value
still works correctly — which is why this bug doesn't show up in ordinary
happy-path testing. It only surfaces when the query value is a partial
fragment of a real status, which isn't itself a valid status.

**Reproduction**
`tests/taskService.test.js` → `getByStatus` → `test.failing('BUG: substring
of a status value incorrectly matches tasks ...')` and `test.failing('BUG: a
fragment of "todo" incorrectly matches the todo task')`.
`tests/tasks.routes.test.js` → `status filtering` → `test.failing('BUG: a
substring fragment of a status value incorrectly returns matches')`.

Each of these asserts that filtering by an invalid, partial status string
(`'on'`, `'od'`) should return `[]`, and demonstrates that it currently
returns real tasks instead.

**What a fix would look like**

```diff
- const getByStatus = (status) => tasks.filter((t) => t.status.includes(status));
+ const getByStatus = (status) => tasks.filter((t) => t.status === status);
```

This is a one-line, low-risk change. It wasn't applied in this pass because
the assignment scopes the required fix to a single bug (Part B), and this
one doesn't affect the endpoint's behavior for any real, valid status value
— only for malformed/partial query input.

---

## Bug 3 (NOT FIXED — documented): Completing a task silently resets its priority

**Bug — What is wrong?**
`PATCH /tasks/:id/complete` unconditionally sets the task's `priority` to
`'medium'`, discarding whatever priority it had before. A `high`-priority
task becomes `medium`-priority just by being marked done.

**Location**
`src/services/taskService.js`, function `completeTask(id)`:

```js
const updated = {
  ...task,
  priority: "medium",
  status: "done",
  completedAt: new Date().toISOString(),
};
```

**Why it happens (root cause)**
Nothing in the task shape or the assignment spec calls for completion to
affect `priority`. This reads like a copy-paste leftover (possibly from
code that meant to set a default for a different field) rather than
intentional business logic — `priority: 'medium'` is hardcoded directly
alongside the two fields that legitimately _should_ change on completion
(`status`, `completedAt`).

**Reproduction**
`tests/taskService.test.js` → `completeTask` → `test.failing('BUG:
completing a task should not change its original priority')`.
`tests/tasks.routes.test.js` → `PATCH /tasks/:id/complete` →
`test.failing('BUG: completing a task should preserve its original
priority')`.

Both create a task with `priority: 'high'`, complete it, and assert the
priority is still `'high'` — it comes back as `'medium'` under the current
code.

**What a fix would look like**

```diff
  const updated = {
    ...task,
-   priority: 'medium',
    status: 'done',
    completedAt: new Date().toISOString(),
  };
```

Simply removing the `priority` override would preserve whatever priority
the task already had. Not applied in this pass for the same reason as Bug 2
— only one fix was required, and this doesn't block the endpoint's primary
purpose (marking a task done).

---

## Additional minor observation (not a chosen bug, noted for completeness)

**The generic error-handling middleware always returns 500, regardless of
the underlying error's actual status.** `app.js`'s error handler is:

```js
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});
```

A malformed JSON request body causes `express.json()` to raise a
`SyntaxError` that Express itself tags with `status: 400`, but this handler
ignores `err.status` and always answers 500. Verified with a test
(`tests/tasks.routes.test.js` → `'edge case: malformed JSON body currently
results in a generic 500 ...'`), which documents the current (arguably
non-ideal) behavior rather than assuming the "more correct" 400. Left
unchanged — it's outside the three bugs above and outside `taskService.js`/
`validators.js`, and touching `app.js`'s error handling wasn't asked for.

---

## Which bug was fixed, and why that one

**Bug 1 (pagination)** was chosen as the required fix because:

- It breaks the endpoint's basic, documented usage (`?page=1&limit=10`),
  not just an edge case with malformed input.
- It's unambiguous: there's no reasonable reading of "page 1" that means
  "skip the first page."
- The fix is a single-line, low-risk change with no ripple effects into
  other code paths.

Bugs 2 and 3 are real and worth fixing, but only surface on inputs/behavior
that are either invalid (an unrecognized status fragment) or a debatable
side effect (priority-on-complete) rather than a break in the endpoint's
core contract — good candidates for a follow-up pass.

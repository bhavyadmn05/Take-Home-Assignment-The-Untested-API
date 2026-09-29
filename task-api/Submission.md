# Submission Notes

## `PATCH /tasks/:id/assign` — design write-up

### Design approach

The implementation follows the existing codebase's patterns exactly rather
than introducing anything new:

- **Route** (`src/routes/tasks.js`): added right after `PATCH
/:id/complete`, following the _same_ validate-then-404 order already used
  by `PUT /:id` — run the body validator first, return `400` on failure,
  then look up the task and return `404` if it doesn't exist, then respond
  with the updated task and a `200`. This mirrors `PUT`'s ordering, which
  was a deliberate choice (see "Edge cases considered" below).
- **Service** (`src/services/taskService.js`): added `assignTask(id,
assignee)`, structurally identical to the existing `completeTask(id)` —
  same `findById` → build updated object via spread → `findIndex` → write
  back → return pattern. No new architecture, no new data-access style.
- **Validator** (`src/utils/validators.js`): added `validateAssignTask`,
  matching the exact shape/style of the existing title check in
  `validateCreateTask` (falsy check + `typeof` check + `trim()` check),
  just applied to `assignee` instead of `title`.
- **Task shape**: added `assignee: null` as a new default field in
  `create()`, so every task — old or new — has a consistent shape and
  `assignee` shows up (as `null`) in every `GET` response even before it's
  ever assigned. This wasn't in the original task shape documented in
  `ASSIGNMENT.md`, but the feature explicitly requires "stores it on the
  task object," so the shape needed to grow by one field.

### Validation decisions

`assignee` must be present, a string, and non-empty after trimming —
otherwise the request is rejected with `400` and a message naming the
field, exactly like every other validator in the codebase. This was a
direct copy of the existing `title` validation rule, since the assignment
explicitly asks "what should happen if `assignee` is an empty string?" and
treating it the same way an empty/missing `title` is already treated
(reject with 400) is the most consistent answer available from the existing
code, not a new judgment call invented from scratch.

I did **not** add stricter validation (e.g., a max length, an allow-list of
known users, alphanumeric-only). Nothing in the assignment or the codebase
suggests such constraints exist, and inventing them would be unrequested
scope creep.

### Error handling

Same shape as every other endpoint: `{ error: "<message>" }` with `400` for
bad input and `404` for a missing task — no new error format introduced.

### Edge cases considered

- **Missing task id** → `404 { error: 'Task not found' }`, same message and
  status as `PUT`/`DELETE`/`complete`.
- **Missing/empty/whitespace-only `assignee`** → `400`, same pattern as
  `title`.
- **Non-string `assignee`** (number, object) → `400` (caught by the
  `typeof` check).
- **Both a bad id and a bad body at once** → the implementation validates
  the body _before_ checking existence (matching `PUT`'s order), so an
  invalid `assignee` against a nonexistent id returns `400`, not `404`.
  This is a real behavioral choice, not an oversight — it's covered by a
  test (`'does not create/modify a task when validation fails ...'`).
- **Task already assigned (the explicit open question in the assignment)**
  → re-assigning **overwrites** the previous assignee. Assign was
  implemented as a plain `PATCH` that always applies the given value,
  which is the simplest and most common REST convention for this kind of
  field update, and it keeps the endpoint idempotent (assigning the same
  person twice, or a different person after, both just work). Covered by a
  test (`'design decision: re-assigning an already-assigned task overwrites
the previous assignee'`).
- **Unrelated fields sneaking into the request body** (e.g. `{ assignee:
'Bob', status: 'done' }`) → ignored. The route only ever reads
  `req.body.assignee`, unlike `PUT`, which merges the entire body onto the
  task. This was a deliberate, minimal deviation from `PUT`'s pattern: `PUT`
  is meant to update arbitrary task fields, while `/assign` has exactly one
  job, so it only touches that one field. Covered by a test.
- **Assigning does not change `status` or any other field** — verified by
  test, since nothing in the spec implies an automatic status transition
  (e.g. `todo` → `in_progress`) on assignment, and adding one would be an
  invented, undocumented side effect.

### Tradeoffs / assumptions

- **Assumption:** re-assignment overwrites rather than being rejected. An
  alternative (reject re-assignment with a 409, or require an explicit
  "unassign" step first) is plausible but adds complexity the assignment
  doesn't ask for, and a plain overwrite is the more common default for a
  single-field `PATCH`. Flagging this explicitly in case the intended
  answer was the stricter one.
- **Assumption:** the response on a duplicate/idempotent assignment is
  still `200` with the task, not any kind of "no-op" signal — consistent
  with how `PATCH /:id/complete` already treats being called twice on an
  already-complete task (silently succeeds, returns `200`).
- **Tradeoff:** I added `assignee: null` to _every_ task via `create()`
  rather than leaving it `undefined` until first assigned. This makes the
  task shape predictable (every task has the same keys) at the cost of a
  one-line change to `create()`, which is technically outside the
  `/assign` route/service/validator files themselves. I judged this
  necessary (not "unrelated scope creep") because the feature explicitly
  requires storing an assignee "on the task object," which implies the
  field belongs in the task shape, not just bolted on after the fact.

---

## Note: what I'd test next, what surprised me, questions before shipping

**What I'd test next if I had more time:**

- Concurrency: the in-memory store isn't safe against concurrent
  read-modify-write races (e.g., two simultaneous `PUT`s could clobber each
  other); worth a test/discussion before this ever touches a real
  multi-request environment.
- The `app.js` error-handling middleware's blanket 500 response (documented
  in `BUGS.md`) — worth deciding whether malformed-input errors should
  surface their real status codes instead of a generic 500.
- Load/behavior with a large number of tasks (the whole store is `O(n)`
  scanned on most operations) — fine for an in-memory demo API, but worth
  flagging before scaling assumptions are made.

**What surprised me in the codebase:**

- The `README.md` at the repo root describes a different status enum
  (`pending | in-progress | completed`) than what the code and
  `ASSIGNMENT.md` actually use (`todo | in_progress | done`) — a stale-docs
  mismatch, not a code bug, but confusing on first read.
- `PUT /tasks/:id` is documented (informally, via `README.md`) as a "full
  update," but the implementation does a partial merge (`{...existing,
...fields}`) and its validator doesn't require any fields at all, so
  `PUT` with an empty body `{}` silently no-ops instead of behaving like a
  full replace. Not fixed (out of scope), but documented via a test
  (`'edge case: an empty body {} is accepted and leaves the task unchanged
...'`).
- The pagination and status-filter bugs (see `BUGS.md`) were surprising in
  that they don't show up under normal, valid-input usage at all — they
  only reveal themselves with unusual/malformed query input, which is
  exactly the kind of thing that's easy to miss without deliberately
  testing edge cases rather than just the happy path.

**Questions I'd ask before shipping to production:**

- Is `assignee` meant to be a free-text name, or should it eventually
  reference a real user/account (an id, not a display string)? The current
  implementation treats it as an opaque string per the spec's `{ "assignee":
"string" }` shape, but that seems like a placeholder for a future
  user-reference field.
- Should re-assigning an already-assigned task require any confirmation,
  audit trail, or notification, or is silent overwrite (as implemented)
  the intended behavior long-term?
- Is the in-memory store intentional for production, or is a real
  persistence layer coming? (The assignment says not to worry about this,
  but it's the first thing I'd flag before this ships for real.)

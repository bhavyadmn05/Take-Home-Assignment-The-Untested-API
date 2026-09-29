const taskService = require('../src/services/taskService');

describe('taskService', () => {
  beforeEach(() => {
    taskService._reset();
  });

  describe('create', () => {
    it('creates a task with the given title and default fields', () => {
      const task = taskService.create({ title: 'Write tests' });

      expect(task.title).toBe('Write tests');
      expect(task.description).toBe('');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe('medium');
      expect(task.dueDate).toBeNull();
      expect(task.completedAt).toBeNull();
      expect(typeof task.id).toBe('string');
      expect(task.id.length).toBeGreaterThan(0);
      expect(typeof task.createdAt).toBe('string');
      expect(new Date(task.createdAt).toString()).not.toBe('Invalid Date');
    });

    it('honors explicitly provided fields instead of defaults', () => {
      const task = taskService.create({
        title: 'Ship feature',
        description: 'Details here',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2030-01-01T00:00:00.000Z',
      });

      expect(task.description).toBe('Details here');
      expect(task.status).toBe('in_progress');
      expect(task.priority).toBe('high');
      expect(task.dueDate).toBe('2030-01-01T00:00:00.000Z');
    });

    it('adds the created task to the store so getAll sees it', () => {
      taskService.create({ title: 'Task A' });
      taskService.create({ title: 'Task B' });

      expect(taskService.getAll()).toHaveLength(2);
    });

    it('generates unique ids for each created task', () => {
      const a = taskService.create({ title: 'A' });
      const b = taskService.create({ title: 'B' });

      expect(a.id).not.toBe(b.id);
    });
  });

  describe('findById', () => {
    it('returns the task when it exists', () => {
      const created = taskService.create({ title: 'Findable' });

      const found = taskService.findById(created.id);

      expect(found).toEqual(created);
    });

    it('returns undefined when the id does not exist', () => {
      expect(taskService.findById('does-not-exist')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns an empty array when there are no tasks', () => {
      expect(taskService.getAll()).toEqual([]);
    });

    it('returns a copy of the underlying array (not the live reference)', () => {
      taskService.create({ title: 'A' });
      const all = taskService.getAll();
      all.push({ id: 'injected' });

      // Mutating the returned array must not affect the internal store.
      expect(taskService.getAll()).toHaveLength(1);
    });
  });

  describe('getByStatus', () => {
    beforeEach(() => {
      taskService.create({ title: 'Todo task', status: 'todo' });
      taskService.create({ title: 'In progress task', status: 'in_progress' });
      taskService.create({ title: 'Done task', status: 'done' });
    });

    it('happy path: returns only tasks with an exact matching status', () => {
      const result = taskService.getByStatus('done');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('done');
    });

    it('happy path: filtering by "todo" does not return in_progress or done tasks', () => {
      const result = taskService.getByStatus('todo');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('todo');
    });

    // --- BUG DEMONSTRATION ---
    // getByStatus currently does `t.status.includes(status)`, i.e. a substring
    // check, instead of an exact equality check. None of the three real status
    // values happen to be substrings of one another, so the happy-path tests
    // above pass either way. But an arbitrary substring of a status value
    // (which is not itself a valid status) should match NOTHING, since it is
    // not a real status. Under the current buggy implementation, it matches
    // every task whose status contains that substring.
    // NOT FIXED THIS PASS — documented in BUGS.md. Using test.failing() so the
    // suite stays green while still actively proving the bug exists: if this
    // is ever fixed, test.failing will itself start failing, forcing the test
    // to be converted back to a normal `it`/`test`.
    test.failing('BUG: substring of a status value incorrectly matches tasks (expected: no matches for an invalid status)', () => {
      // "on" is a substring of "done" but is not a valid status value at all.
      const result = taskService.getByStatus('on');

      // Correct behavior would be an empty array, since "on" isn't a real status.
      expect(result).toEqual([]);
    });

    test.failing('BUG: a fragment of "todo" incorrectly matches the todo task', () => {
      // "od" is a substring of "todo" but not a valid status on its own.
      const result = taskService.getByStatus('od');

      expect(result).toEqual([]);
    });
  });

  describe('getPaginated', () => {
    beforeEach(() => {
      for (let i = 1; i <= 15; i += 1) {
        taskService.create({ title: `Task ${i}` });
      }
    });

    // Fixed bug: getPaginated previously computed `offset = page * limit`,
    // which for page=1 gave offset=10 and skipped the first 10 tasks
    // entirely. It now uses `offset = (page - 1) * limit`, so page 1
    // correctly returns the first `limit` items (offset 0). See BUGS.md.
    it('happy path: page 1 returns the first `limit` tasks', () => {
      const all = taskService.getAll();
      const page1 = taskService.getPaginated(1, 10);

      expect(page1).toEqual(all.slice(0, 10));
    });

    it('happy path: page 2 returns the next slice of tasks', () => {
      const all = taskService.getAll();
      const page2 = taskService.getPaginated(2, 10);

      // With a correct offset of (page-1)*limit, page 2 with limit 10
      // should return items 10-14 (the remaining 5 tasks).
      expect(page2).toEqual(all.slice(10, 20));
    });

    it('edge case: a page beyond the available data returns an empty array', () => {
      const result = taskService.getPaginated(5, 10);

      expect(result).toEqual([]);
    });

    it('edge case: limit larger than the dataset returns everything on page 1', () => {
      const all = taskService.getAll();
      const result = taskService.getPaginated(1, 100);

      expect(result).toEqual(all.slice(0, 100));
    });
  });

  describe('getStats', () => {
    it('counts tasks by status', () => {
      taskService.create({ title: 'A', status: 'todo' });
      taskService.create({ title: 'B', status: 'todo' });
      taskService.create({ title: 'C', status: 'in_progress' });
      taskService.create({ title: 'D', status: 'done' });

      const stats = taskService.getStats();

      expect(stats.todo).toBe(2);
      expect(stats.in_progress).toBe(1);
      expect(stats.done).toBe(1);
    });

    it('counts overdue tasks (past dueDate, not done)', () => {
      const past = new Date(Date.now() - 86400000).toISOString(); // yesterday
      const future = new Date(Date.now() + 86400000).toISOString(); // tomorrow

      taskService.create({ title: 'Overdue', status: 'todo', dueDate: past });
      taskService.create({ title: 'Not due yet', status: 'todo', dueDate: future });
      taskService.create({ title: 'No due date', status: 'todo' });

      const stats = taskService.getStats();

      expect(stats.overdue).toBe(1);
    });

    it('does not count a done task as overdue even if its dueDate is in the past', () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      taskService.create({ title: 'Done but was due yesterday', status: 'done', dueDate: past });

      const stats = taskService.getStats();

      expect(stats.overdue).toBe(0);
    });

    it('returns all-zero counts when there are no tasks', () => {
      const stats = taskService.getStats();

      expect(stats).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
    });

    it('edge case: ignores a task with an unrecognized status when counting (defensive branch)', () => {
      // The HTTP layer's validators prevent this from happening via the API,
      // but taskService itself does not validate `status` on create(), so
      // this exercises the defensive `counts[t.status] !== undefined` guard.
      taskService.create({ title: 'Weird', status: 'archived' });
      taskService.create({ title: 'Normal', status: 'todo' });

      const stats = taskService.getStats();

      expect(stats.todo).toBe(1);
      expect(stats.archived).toBeUndefined();
    });
  });

  describe('update', () => {
    it('merges the given fields into the existing task', () => {
      const created = taskService.create({ title: 'Original', priority: 'low' });

      const updated = taskService.update(created.id, { title: 'Updated', priority: 'high' });

      expect(updated.title).toBe('Updated');
      expect(updated.priority).toBe('high');
      expect(updated.id).toBe(created.id);
    });

    it('preserves fields not included in the update', () => {
      const created = taskService.create({ title: 'Original', description: 'Keep me' });

      const updated = taskService.update(created.id, { title: 'New title' });

      expect(updated.description).toBe('Keep me');
    });

    it('returns null when the id does not exist', () => {
      expect(taskService.update('nope', { title: 'X' })).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes an existing task and returns true', () => {
      const created = taskService.create({ title: 'Doomed' });

      const result = taskService.remove(created.id);

      expect(result).toBe(true);
      expect(taskService.findById(created.id)).toBeUndefined();
    });

    it('returns false when the id does not exist', () => {
      expect(taskService.remove('nope')).toBe(false);
    });
  });

  describe('completeTask', () => {
    it('sets status to done and completedAt to a timestamp', () => {
      const created = taskService.create({ title: 'Finish me' });

      const completed = taskService.completeTask(created.id);

      expect(completed.status).toBe('done');
      expect(typeof completed.completedAt).toBe('string');
      expect(new Date(completed.completedAt).toString()).not.toBe('Invalid Date');
    });

    it('returns null when the id does not exist', () => {
      expect(taskService.completeTask('nope')).toBeNull();
    });

    // --- BUG DEMONSTRATION ---
    // completeTask unconditionally sets `priority: 'medium'`, overwriting
    // whatever priority the task originally had. Nothing in the task shape
    // or the assignment spec suggests completing a task should change its
    // priority. This looks like an unintended side effect.
    // NOT FIXED THIS PASS — documented in BUGS.md.
    test.failing('BUG: completing a task should not change its original priority', () => {
      const created = taskService.create({ title: 'High priority task', priority: 'high' });

      const completed = taskService.completeTask(created.id);

      // Correct expectation: priority is untouched by completion.
      expect(completed.priority).toBe('high');
    });
  });

  describe('assignTask', () => {
    it('sets the assignee on the task', () => {
      const created = taskService.create({ title: 'Needs an owner' });

      const assigned = taskService.assignTask(created.id, 'Ada Lovelace');

      expect(assigned.assignee).toBe('Ada Lovelace');
      expect(assigned.id).toBe(created.id);
    });

    it('persists the change in the store', () => {
      const created = taskService.create({ title: 'Needs an owner' });

      taskService.assignTask(created.id, 'Grace Hopper');

      expect(taskService.findById(created.id).assignee).toBe('Grace Hopper');
    });

    it('returns null when the id does not exist', () => {
      expect(taskService.assignTask('nope', 'Someone')).toBeNull();
    });

    it('does not change unrelated fields on the task', () => {
      const created = taskService.create({ title: 'Needs an owner', priority: 'high', status: 'in_progress' });

      const assigned = taskService.assignTask(created.id, 'Someone');

      expect(assigned.priority).toBe('high');
      expect(assigned.status).toBe('in_progress');
      expect(assigned.title).toBe('Needs an owner');
    });

    it('overwrites a previous assignee on re-assignment', () => {
      const created = taskService.create({ title: 'Needs an owner' });
      taskService.assignTask(created.id, 'First Person');

      const reassigned = taskService.assignTask(created.id, 'Second Person');

      expect(reassigned.assignee).toBe('Second Person');
    });
  });

  describe('_reset', () => {
    it('clears the in-memory store', () => {
      taskService.create({ title: 'Temp' });
      expect(taskService.getAll()).toHaveLength(1);

      taskService._reset();

      expect(taskService.getAll()).toEqual([]);
    });
  });
});

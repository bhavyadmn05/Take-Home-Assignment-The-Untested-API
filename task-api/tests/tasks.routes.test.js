const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

describe('Task routes', () => {
  beforeEach(() => {
    taskService._reset();
  });

  // NOTE: express.json() itself flags a malformed body as a 400-level
  // SyntaxError, but app.js's generic error-handling middleware does not
  // inspect err.status and always responds 500. This test documents the
  // ACTUAL current behavior (500), not the arguably-more-correct 400. This
  // is a minor additional observation, out of scope for this pass's bug
  // fixes -- see the final report.
  it('edge case: malformed JSON body currently results in a generic 500 (see report: error middleware ignores body-parser status)', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json');

    expect(res.status).toBe(500);

    consoleErrorSpy.mockRestore();
  });

  describe('GET /tasks', () => {
    it('happy path: returns an empty array when there are no tasks', async () => {
      const res = await request(app).get('/tasks');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('happy path: returns all created tasks', async () => {
      await request(app).post('/tasks').send({ title: 'Task A' });
      await request(app).post('/tasks').send({ title: 'Task B' });

      const res = await request(app).get('/tasks');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    describe('status filtering', () => {
      beforeEach(async () => {
        await request(app).post('/tasks').send({ title: 'Todo task', status: 'todo' });
        await request(app).post('/tasks').send({ title: 'In progress task', status: 'in_progress' });
        await request(app).post('/tasks').send({ title: 'Done task', status: 'done' });
      });

      it('happy path: filters to only tasks matching the given status', async () => {
        const res = await request(app).get('/tasks?status=done');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].status).toBe('done');
      });

      it('happy path: a different status filter returns a different task', async () => {
        const res = await request(app).get('/tasks?status=todo');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].status).toBe('todo');
      });

      it('edge case: an unknown status value returns no tasks', async () => {
        const res = await request(app).get('/tasks?status=archived');

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      // NOT FIXED THIS PASS — documented in BUGS.md. See taskService.test.js
      // for the unit-level proof. A substring of a real status value should
      // NOT match anything, since it isn't a real status itself.
      test.failing('BUG: a substring fragment of a status value incorrectly returns matches', async () => {
        const res = await request(app).get('/tasks?status=on'); // substring of "done"

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });
    });

    describe('pagination', () => {
      beforeEach(async () => {
        for (let i = 1; i <= 15; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await request(app).post('/tasks').send({ title: `Task ${i}` });
        }
      });

      // Fixed bug: page 1 now correctly returns the first `limit` tasks
      // instead of skipping them. See BUGS.md.
      it('happy path: page 1 returns the first `limit` tasks', async () => {
        const all = await request(app).get('/tasks');
        const res = await request(app).get('/tasks?page=1&limit=10');

        expect(res.status).toBe(200);
        expect(res.body).toEqual(all.body.slice(0, 10));
      });

      it('happy path: page 2 returns the remaining tasks', async () => {
        const all = await request(app).get('/tasks');
        const res = await request(app).get('/tasks?page=2&limit=10');

        expect(res.status).toBe(200);
        expect(res.body).toEqual(all.body.slice(10, 20));
      });

      it('edge case: non-numeric page/limit values fall back to defaults instead of erroring', async () => {
        const res = await request(app).get('/tasks?page=abc&limit=xyz');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });
    });
  });

  describe('POST /tasks', () => {
    it('happy path: creates a task and returns 201 with the created task', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'New task', priority: 'high' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New task');
      expect(res.body.priority).toBe('high');
      expect(res.body.status).toBe('todo');
      expect(typeof res.body.id).toBe('string');
    });

    it('edge case: missing title returns 400', async () => {
      const res = await request(app).post('/tasks').send({ description: 'no title' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it('edge case: empty-string title returns 400', async () => {
      const res = await request(app).post('/tasks').send({ title: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it('edge case: invalid status value returns 400', async () => {
      const res = await request(app).post('/tasks').send({ title: 'X', status: 'bogus' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/status/i);
    });

    it('edge case: invalid priority value returns 400', async () => {
      const res = await request(app).post('/tasks').send({ title: 'X', priority: 'urgent' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/priority/i);
    });

    it('edge case: invalid dueDate string returns 400', async () => {
      const res = await request(app).post('/tasks').send({ title: 'X', dueDate: 'not-a-date' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/dueDate/i);
    });

    it('does not persist a task when validation fails', async () => {
      await request(app).post('/tasks').send({ title: '' });

      const res = await request(app).get('/tasks');
      expect(res.body).toEqual([]);
    });
  });

  describe('PUT /tasks/:id', () => {
    it('happy path: updates an existing task', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Original' });

      const res = await request(app)
        .put(`/tasks/${created.body.id}`)
        .send({ title: 'Updated title', priority: 'high' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated title');
      expect(res.body.priority).toBe('high');
    });

    it('edge case: returns 404 for a non-existent id', async () => {
      const res = await request(app).put('/tasks/does-not-exist').send({ title: 'X' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('edge case: invalid status value returns 400 and does not update the task', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Original' });

      const res = await request(app)
        .put(`/tasks/${created.body.id}`)
        .send({ status: 'bogus' });

      expect(res.status).toBe(400);
    });

    it('edge case: whitespace-only title returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Original' });

      const res = await request(app)
        .put(`/tasks/${created.body.id}`)
        .send({ title: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it('edge case: invalid priority value returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Original' });

      const res = await request(app)
        .put(`/tasks/${created.body.id}`)
        .send({ priority: 'urgent' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/priority/i);
    });

    it('edge case: invalid dueDate string returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Original' });

      const res = await request(app)
        .put(`/tasks/${created.body.id}`)
        .send({ dueDate: 'not-a-date' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/dueDate/i);
    });

    it('edge case: an empty body {} is accepted and leaves the task unchanged (documents partial-merge PUT semantics)', async () => {
      const created = await request(app)
        .post('/tasks')
        .send({ title: 'Untouched', priority: 'high' });

      const res = await request(app).put(`/tasks/${created.body.id}`).send({});

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Untouched');
      expect(res.body.priority).toBe('high');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('happy path: deletes an existing task and returns 204', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Doomed' });

      const res = await request(app).delete(`/tasks/${created.body.id}`);

      expect(res.status).toBe(204);

      const getAll = await request(app).get('/tasks');
      expect(getAll.body).toEqual([]);
    });

    it('edge case: returns 404 for a non-existent id', async () => {
      const res = await request(app).delete('/tasks/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('edge case: deleting the same task twice returns 404 the second time', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Once' });

      await request(app).delete(`/tasks/${created.body.id}`);
      const second = await request(app).delete(`/tasks/${created.body.id}`);

      expect(second.status).toBe(404);
    });
  });

  describe('PATCH /tasks/:id/complete', () => {
    it('happy path: marks a task as done and sets completedAt', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Finish me' });

      const res = await request(app).patch(`/tasks/${created.body.id}/complete`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
      expect(res.body.completedAt).not.toBeNull();
    });

    it('edge case: returns 404 for a non-existent id', async () => {
      const res = await request(app).patch('/tasks/does-not-exist/complete');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('edge case: completing an already-completed task is idempotent (still done)', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Finish me' });

      await request(app).patch(`/tasks/${created.body.id}/complete`);
      const second = await request(app).patch(`/tasks/${created.body.id}/complete`);

      expect(second.status).toBe(200);
      expect(second.body.status).toBe('done');
    });

    // NOT FIXED THIS PASS — documented in BUGS.md. See taskService.test.js
    // for the unit-level proof.
    test.failing('BUG: completing a task should preserve its original priority', async () => {
      const created = await request(app)
        .post('/tasks')
        .send({ title: 'High priority', priority: 'high' });

      const res = await request(app).patch(`/tasks/${created.body.id}/complete`);

      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('high');
    });
  });

  describe('PATCH /tasks/:id/assign', () => {
    it('happy path: assigns a task and returns the updated task with the assignee set', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: 'Ada Lovelace' });

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Ada Lovelace');
      expect(res.body.id).toBe(created.body.id);
    });

    it('persists the assignment: a subsequent GET reflects the assignee', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });
      await request(app).patch(`/tasks/${created.body.id}/assign`).send({ assignee: 'Grace Hopper' });

      const res = await request(app).get('/tasks');

      const task = res.body.find((t) => t.id === created.body.id);
      expect(task.assignee).toBe('Grace Hopper');
    });

    it('a newly created task has assignee: null before being assigned', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Fresh task' });

      expect(created.body.assignee).toBeNull();
    });

    it('edge case: returns 404 for a non-existent task id', async () => {
      const res = await request(app)
        .patch('/tasks/does-not-exist/assign')
        .send({ assignee: 'Someone' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('edge case: missing assignee field returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });

      const res = await request(app).patch(`/tasks/${created.body.id}/assign`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee/i);
    });

    it('edge case: empty-string assignee returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee/i);
    });

    it('edge case: whitespace-only assignee returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee/i);
    });

    it('edge case: non-string assignee (number) returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: 12345 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee/i);
    });

    it('edge case: non-string assignee (object) returns 400', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: { name: 'Ada' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee/i);
    });

    it('does not create/modify a task when validation fails (404 case takes precedence check: validation still runs for a bad id)', async () => {
      // Validation runs even for a non-existent id (matches PUT's existing
      // validate-before-404 ordering), so an invalid body against an unknown
      // id should still surface the 400, not a 404.
      const res = await request(app)
        .patch('/tasks/does-not-exist/assign')
        .send({ assignee: '' });

      expect(res.status).toBe(400);
    });

    it('design decision: re-assigning an already-assigned task overwrites the previous assignee', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Needs an owner' });
      await request(app).patch(`/tasks/${created.body.id}/assign`).send({ assignee: 'First Person' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: 'Second Person' });

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Second Person');
    });

    it('assigning does not change the task status', async () => {
      const created = await request(app)
        .post('/tasks')
        .send({ title: 'Needs an owner', status: 'todo' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: 'Someone' });

      expect(res.body.status).toBe('todo');
    });

    it('assigning does not affect other fields on the task', async () => {
      const created = await request(app)
        .post('/tasks')
        .send({ title: 'Needs an owner', priority: 'high', description: 'Important' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: 'Someone' });

      expect(res.body.priority).toBe('high');
      expect(res.body.description).toBe('Important');
      expect(res.body.title).toBe('Needs an owner');
    });

    it('design decision: extra/unexpected fields in the request body are ignored, not merged onto the task', async () => {
      const created = await request(app)
        .post('/tasks')
        .send({ title: 'Needs an owner', status: 'todo' });

      const res = await request(app)
        .patch(`/tasks/${created.body.id}/assign`)
        .send({ assignee: 'Someone', status: 'done', priority: 'high' });

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Someone');
      // Unlike PUT (which merges the whole body), assign only ever reads
      // `assignee` off the body, so sneaking other fields in has no effect.
      expect(res.body.status).toBe('todo');
      expect(res.body.priority).not.toBe('high');
    });
  });

  describe('GET /tasks/stats', () => {
    it('happy path: returns counts by status and overdue count', async () => {
      await request(app).post('/tasks').send({ title: 'A', status: 'todo' });
      await request(app).post('/tasks').send({ title: 'B', status: 'in_progress' });
      await request(app).post('/tasks').send({ title: 'C', status: 'done' });

      const res = await request(app).get('/tasks/stats');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ todo: 1, in_progress: 1, done: 1, overdue: 0 });
    });

    it('edge case: counts an overdue task correctly', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      await request(app).post('/tasks').send({ title: 'Late', status: 'todo', dueDate: past });

      const res = await request(app).get('/tasks/stats');

      expect(res.status).toBe(200);
      expect(res.body.overdue).toBe(1);
    });

    it('edge case: returns all zeros when there are no tasks', async () => {
      const res = await request(app).get('/tasks/stats');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
    });
  });
});

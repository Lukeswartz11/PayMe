const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(`${__dirname}/server.js`, 'utf8');

function setup() {
  const initial = { users: [{ id: 'me' }, { id: 'other' }], budgetExpenses: [
    { id: 'legacy', ownerId: 'me', desc: 'Existing expense' },
    { id: 'private', ownerId: 'other' },
  ], personalReceipts: [{ id: 'legacy-photo', ownerId: 'me', store: 'Existing expense' },
    { id: 'private-photo', ownerId: 'other', expenseId: 'private' }], settlements: [{ id: 'untouched' }] };
  let saved = structuredClone(initial), writes = 0, failWrite = false;
  const handlers = {};
  const context = {
    app: { post: (path, auth, fn) => { handlers[`POST ${path}`] = fn; }, delete: (path, auth, fn) => { handlers[`DELETE ${path}`] = fn; } },
    requireAuth() {}, crypto, console: { error() {} },
    readData: async () => structuredClone(saved),
    writeData: async (data) => { if (failWrite) throw new Error('Simulated write failure'); saved = structuredClone(data); writes++; },
  };
  vm.createContext(context);
  const start = source.indexOf("app.post('/api/personal-receipts'");
  const end = source.indexOf("app.post('/api/expenses'", start);
  vm.runInContext(source.slice(start, end), context);
  return {
    initial, data: () => saved, writes: () => writes, fail: () => { failWrite = true; },
    async call(route, { body = {}, id, userId = 'me' } = {}) {
      const result = { status: 200 };
      await handlers[route]({ body, params: { id }, userId }, {
        status(status) { result.status = status; return this; },
        json(body) { result.body = body; }, end() {},
      });
      return result;
    },
  };
}
const body = { id: 'new', category: 'fuel', desc: 'Car receipt', amount: 20, date: '2026-09-16', receiptImage: 'data:image/jpeg;base64,/9j/' };

test('expense and linked receipt save in one write; retries do not duplicate either', async () => {
  const s = setup();
  const result = await s.call('POST /api/budget-expenses', { body });
  assert.equal(result.status, 201);
  assert.equal(result.body.receipt.expenseId, body.id);
  assert.equal(s.writes(), 1);
  const beforeRetry = structuredClone(s.data());
  const retry = await s.call('POST /api/budget-expenses', { body });
  assert.equal(retry.status, 200);
  assert.deepEqual(s.data(), beforeRetry);
  assert.equal(s.writes(), 1);
  assert.equal((await s.call('POST /api/budget-expenses', { body: { ...body, amount: 30 } })).status, 409);
});

for (const target of ['expense', 'receipt']) test(`deleting linked ${target} deletes both, preserves legacy and other users`, async () => {
  const s = setup();
  const result = await s.call('POST /api/budget-expenses', { body });
  const route = target === 'expense' ? 'DELETE /api/budget-expenses/:id' : 'DELETE /api/personal-receipts/:id';
  const id = target === 'expense' ? body.id : result.body.receipt.id;
  assert.equal((await s.call(route, { id, userId: 'other' })).status, 404);
  assert.equal((await s.call(route, { id })).status, 204);
  assert.deepEqual(s.data(), s.initial);
});

test('legacy receipt deletion does not guess an expense association', async () => {
  const s = setup();
  await s.call('DELETE /api/personal-receipts/:id', { id: 'legacy-photo' });
  assert.deepEqual(s.data().budgetExpenses, s.initial.budgetExpenses);
});

test('invalid images and failed writes persist neither expense nor receipt', async () => {
  const s = setup();
  assert.equal((await s.call('POST /api/budget-expenses', { body: { ...body, receiptImage: 'bad' } })).status, 400);
  assert.deepEqual(s.data(), s.initial);
  s.fail();
  assert.equal((await s.call('POST /api/budget-expenses', { body })).status, 500);
  assert.deepEqual(s.data(), s.initial);
});

test('an expense without an image still saves', async () => {
  const s = setup();
  const { receiptImage, ...plain } = body;
  const result = await s.call('POST /api/budget-expenses', { body: plain });
  assert.equal(result.status, 201);
  assert.equal(result.body.receipt, null);
  assert.deepEqual(s.data().personalReceipts, s.initial.personalReceipts);
});


test('failed camera decoding keeps the form and photo; retry saves both without duplicates', async () => {
  const appSource = fs.readFileSync(`${__dirname}/../app.js`, 'utf8');
  const start = appSource.indexOf('let budgetSaveInProgress = false;');
  const end = appSource.indexOf('\nasync function deleteBudgetExpense(', start);
  let submit, fail = true, calls = 0;
  const button = { disabled: false };
  const photo = { name: 'camera.jpg' };
  const context = {
    budgetForm: { addEventListener: (_, fn) => { submit = fn; }, querySelector: () => button },
    budgetCategory: { value: 'fuel' }, budgetDescription: { value: 'Receipt' }, budgetAmount: { value: '20' }, budgetDate: { value: '2026-09-16' },
    budgetReceiptImage: { files: [photo], value: 'camera.jpg' }, budgetReceiptStatus: {},
    BUDGET_CATEGORIES: ['fuel'], uid: () => 'new-id', state: { budgetExpenses: [], personalReceipts: [] },
    receiptImageData: async (file) => { assert.equal(file, photo); if (fail) throw new Error('Cannot decode camera photo'); return body.receiptImage; },
    createBudgetExpense: async (expense) => { calls++; assert.equal(expense.receiptImage, body.receiptImage); return { id: expense.id, receipt: { id: 'photo', expenseId: expense.id } }; },
    saveLocalState() {}, autofillBudgetDescription() {}, currentEasternDate: () => '2026-09-16', renderBudget() {},
  };
  vm.createContext(context); vm.runInContext(appSource.slice(start, end), context);
  await submit({ preventDefault() {} });
  assert.equal(calls, 0);
  assert.equal(context.budgetDescription.value, 'Receipt');
  assert.equal(context.budgetReceiptImage.value, 'camera.jpg');
  assert.equal(button.disabled, false);
  assert.equal(context.budgetReceiptStatus.textContent, 'Cannot decode camera photo');
  fail = false;
  await submit({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(context.state.budgetExpenses.length, 1);
  assert.equal(context.state.personalReceipts[0].expenseId, context.state.budgetExpenses[0].id);
  assert.equal(context.budgetReceiptImage.value, '');
  assert.equal(button.disabled, false);
});

// =============================================================
// THE LEDGER — state & persistence
// =============================================================
let state = { people: [], expenses: [], settlements: [] };
const STORAGE_KEY = 'payme-local-state';
const API_BASE = 'https://payme-9w80.onrender.com';
const SYNC_INTERVAL_MS = 4000;
const syncStatusEl = document.getElementById('sync-status');

const DEFAULT_STATE = {
  people: ['Luke', 'Andrew', 'Logan', 'Kai', 'Carson', 'conner'],
  expenses: [],
  settlements: [],
};

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Could not parse local state.', error);
    return null;
  }
}

function saveLocalState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Could not save local state.', error);
  }
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function loadState() {
  const localState = loadLocalState();
  try {
    const response = await fetch(apiUrl('/api/state'));
    if (!response.ok) throw new Error('Failed to load state');
    const data = await response.json();
    const loaded = {
      people: Array.isArray(data.people) ? data.people : DEFAULT_STATE.people,
      expenses: Array.isArray(data.expenses) ? data.expenses : DEFAULT_STATE.expenses,
      settlements: Array.isArray(data.settlements) ? data.settlements : DEFAULT_STATE.settlements,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    return loaded;
  } catch (e) {
    console.warn('Could not load shared ledger state, using local fallback.', e);
    return localState || { ...DEFAULT_STATE };
  }
}

let syncTimer = null;
let lastSyncSignature = '';

function normalizeState(data) {
  return {
    people: Array.isArray(data?.people) ? data.people : DEFAULT_STATE.people,
    expenses: Array.isArray(data?.expenses) ? data.expenses : DEFAULT_STATE.expenses,
    settlements: Array.isArray(data?.settlements) ? data.settlements : DEFAULT_STATE.settlements,
  };
}

function getStateSignature(nextState) {
  return JSON.stringify({
    people: nextState.people,
    expenses: nextState.expenses,
    settlements: nextState.settlements,
  });
}

async function syncStateFromServer() {
  try {
    const response = await fetch(apiUrl('/api/state'));
    if (!response.ok) throw new Error('Could not refresh state');
    const data = await response.json();
    const nextState = normalizeState(data);
    const nextSignature = getStateSignature(nextState);

    if (nextSignature !== lastSyncSignature) {
      state = nextState;
      lastSyncSignature = nextSignature;
      saveLocalState();
      renderAll();
    }

    updateSyncStatus('Live sync active');
  } catch (error) {
    console.warn('Background sync failed, keeping the current view.', error);
    updateSyncStatus('Sync offline — using local view', true);
  }
}

function updateSyncStatus(message, isError = false) {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = message;
  syncStatusEl.style.color = isError ? '#8C0000' : 'var(--stamp-red-ink)';
}

function startLiveSync() {
  if (syncTimer) clearInterval(syncTimer);

  updateSyncStatus('Syncing with shared ledger…');

  syncTimer = setInterval(() => {
    syncStateFromServer();
  }, SYNC_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncStateFromServer();
    }
  });

  window.addEventListener('focus', () => {
    syncStateFromServer();
  });
}

async function initState() {
  const loaded = await loadState();
  state = loaded;
  lastSyncSignature = getStateSignature(state);
  renderAll();
  startLiveSync();
}

async function createExpense(expense) {
  try {
    const response = await fetch(apiUrl('/api/expenses'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expense),
    });
    if (!response.ok) throw new Error('Could not create expense');
    return await response.json();
  } catch (error) {
    console.warn('Expense backend unavailable, falling back to local state.', error);
    return expense;
  }
}

async function createSettlement(settlement) {
  try {
    const response = await fetch(apiUrl('/api/settlements'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settlement),
    });
    if (!response.ok) throw new Error('Could not create payment');
    return await response.json();
  } catch (error) {
    console.warn('Payment backend unavailable, falling back to local state.', error);
    return settlement;
  }
}

async function createPerson(name) {
  try {
    const response = await fetch(apiUrl('/api/people'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error('Could not create person');
    return await response.json();
  } catch (error) {
    console.warn('Person backend unavailable, falling back to local state.', error);
    return { name };
  }
}

async function deleteExpenseById(id) {
  try {
    const response = await fetch(apiUrl(`/api/expenses/${id}`), { method: 'DELETE' });
    if (!response.ok) throw new Error('Could not delete expense');
  } catch (error) {
    console.warn('Expense delete backend unavailable, removing locally.', error);
    saveLocalState();
  }
}

async function deleteSettlementById(id) {
  try {
    const response = await fetch(apiUrl(`/api/settlements/${id}`), { method: 'DELETE' });
    if (!response.ok) throw new Error('Could not delete payment');
  } catch (error) {
    console.warn('Payment delete backend unavailable, removing locally.', error);
    saveLocalState();
  }
}

async function deletePersonByName(name) {
  const response = await fetch(apiUrl(`/api/people/${encodeURIComponent(name)}`), { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not delete person');
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const money = (n) => {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
};

// =============================================================
// DOM references
// =============================================================
const roommateForm = document.getElementById('roommate-form');
const roommateInput = document.getElementById('roommate-input');
const roommateList = document.getElementById('roommate-list');

const expenseForm = document.getElementById('expense-form');
const categoryInput = document.getElementById('exp-category');
const amountInput = document.getElementById('exp-amount');
const payerSelect = document.getElementById('exp-payer');
const dateInput = document.getElementById('exp-date');
const monthInput = document.getElementById('exp-month');
const splitCheckboxes = document.getElementById('split-checkboxes');

const expenseListEl = document.getElementById('expense-list');
const expenseEmpty = document.getElementById('expense-empty');

const balancesGrid = document.getElementById('balances-grid');
const settleList = document.getElementById('settle-list');
const settleEmpty = document.getElementById('settle-empty');

const paymentForm = document.getElementById('payment-form');
const paymentFrom = document.getElementById('payment-from');
const paymentTo = document.getElementById('payment-to');
const paymentAmount = document.getElementById('payment-amount');
const paymentDate = document.getElementById('payment-date');

const logPaymentList = document.getElementById('log-payment-list');
const logPaymentEmpty = document.getElementById('log-payment-empty');
const logExpenseList = document.getElementById('log-expense-list');
const logExpenseEmpty = document.getElementById('log-expense-empty');

const tabButtons = [...document.querySelectorAll('[role="tab"]')];
const tabPanels = [...document.querySelectorAll('[role="tabpanel"]')];

function currentEasternDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return `${year}-${month}-${day}`;
}

function currentEasternMonth() {
  return currentEasternDate().slice(5, 7);
}

dateInput.value = currentEasternDate();
monthInput.value = currentEasternMonth();
paymentDate.value = currentEasternDate();

function activateTab(tabName) {
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  tabPanels.forEach((panel) => {
    panel.hidden = panel.id !== `panel-${tabName}`;
  });

  if (tabName === 'payments') {
    paymentDate.value = currentEasternDate();
  }
}

tabButtons.forEach((button, index) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabButtons.length - 1;
    tabButtons[nextIndex].focus();
    activateTab(tabButtons[nextIndex].dataset.tab);
  });
});

// =============================================================
// ROOMMATES
// =============================================================
roommateForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = roommateInput.value.trim();
  if (!name) return;
  if (state.people.some((p) => p.toLowerCase() === name.toLowerCase())) {
    roommateInput.value = '';
    return;
  }

  try {
    await createPerson(name);
    state.people.push(name);
    saveLocalState();
    roommateInput.value = '';
    renderAll();
  } catch (error) {
    console.error(error);
    alert('Could not save roommate. Please try again.');
  }
});

async function removeRoommate(name) {
  const involved = state.expenses.some(
    (x) => x.paidBy === name || x.splitAmong.includes(name)
  );
  if (involved) {
    const ok = confirm(
      `${name} is part of existing expenses. Remove them from the household anyway? Their past expenses will stay in the tally.`
    );
    if (!ok) return;
  }

  try {
    await deletePersonByName(name);
    state.people = state.people.filter((p) => p !== name);
    saveLocalState();
    renderAll();
  } catch (error) {
    console.error(error);
    alert('Could not remove roommate. Please try again.');
  }
}

function renderRoommates() {
  roommateList.innerHTML = '';
  state.people.forEach((name) => {
    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = `<span>${escapeHtml(name)}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Remove ${name}`);
    btn.textContent = '✕';
    btn.addEventListener('click', () => removeRoommate(name));
    li.appendChild(btn);
    roommateList.appendChild(li);
  });
}

// =============================================================
// EXPENSE FORM (payer select + split checkboxes stay in sync)
// =============================================================
function renderFormOptions() {
  const prevPayer = payerSelect.value;
  payerSelect.innerHTML = '';
  if (state.people.length === 0) {
    payerSelect.innerHTML = '<option value="">Add roommates first</option>';
    payerSelect.disabled = true;
  } else {
    const canLog = state.people.includes('Luke');
    const payers = canLog ? ['Luke'] : state.people;
    payers.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      payerSelect.appendChild(opt);
    });
    if (canLog) {
      payerSelect.value = 'Luke';
      payerSelect.disabled = true;
    } else if (state.people.includes(prevPayer)) {
      payerSelect.value = prevPayer;
      payerSelect.disabled = false;
    } else {
      payerSelect.disabled = false;
    }
  }

  const checkedBefore = new Set(
    [...splitCheckboxes.querySelectorAll('input:checked')].map((i) => i.value)
  );
  splitCheckboxes.innerHTML = '';
  state.people.forEach((name) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = name;
    cb.checked = checkedBefore.size ? checkedBefore.has(name) : true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(name));
    splitCheckboxes.appendChild(label);
  });

  const disabled = state.people.length === 0;
  expenseForm.querySelectorAll('input, select, button').forEach((el) => {
    el.disabled = disabled;
  });
}

expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = categoryInput.value;
  const amount = parseFloat(amountInput.value);
  const paidBy = payerSelect.value;
  const month = monthInput.value;
  const splitAmong = [...splitCheckboxes.querySelectorAll('input:checked')].map(
    (i) => i.value
  );

  if (!category || !amount || amount <= 0 || !paidBy || !month) return;
  if (splitAmong.length === 0) {
    alert('Pick at least one person to split this with.');
    return;
  }

  const year = currentEasternDate().slice(0, 4);
  const expense = {
    id: uid(),
    desc: categoryLabel(category),
    category,
    amount,
    paidBy,
    splitAmong,
    date: currentEasternDate(),
    month: `${year}-${month}`,
  };

  try {
    await createExpense(expense);
    state.expenses.unshift(expense);
    saveLocalState();
    amountInput.value = '';
    expenseForm.reportValidity && amountInput.focus();
    renderAll();
  } catch (error) {
    console.error(error);
    alert('Could not save expense. Please try again.');
  }
});

async function deleteExpense(id) {
  try {
    await deleteExpenseById(id);
    state.expenses = state.expenses.filter((x) => x.id !== id);
    saveLocalState();
    renderAll();
  } catch (error) {
    console.error(error);
    alert('Could not delete expense. Please try again.');
  }
}

// =============================================================
// PAYMENTS
// =============================================================
function populateSelect(select, names, previous, emptyLabel) {
  select.innerHTML = '';
  if (names.length === 0) {
    select.innerHTML = `<option value="">${emptyLabel}</option>`;
    return;
  }
  names.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  if (names.includes(previous)) select.value = previous;
}

function paymentLimit() {
  const balance = computeBalances();
  return Math.min(-(balance[paymentFrom.value] || 0), balance[paymentTo.value] || 0);
}

function updatePaymentLimit() {
  const limit = paymentLimit();
  const canPay = Number.isFinite(limit) && limit > 0.005;
  paymentAmount.max = canPay ? limit.toFixed(2) : '';
  paymentAmount.placeholder = canPay ? `Up to ${money(limit)}` : '0.00';
  paymentAmount.disabled = !canPay;
  paymentForm.querySelector('button[type="submit"]').disabled = !canPay;
}

function renderPaymentOptions() {
  const balance = computeBalances();
  const debtors = state.people.filter((name) => (balance[name] || 0) < -0.005);
  const creditors = state.people.filter((name) => (balance[name] || 0) > 0.005);
  const previousFrom = paymentFrom.value;
  const previousTo = paymentTo.value;

  populateSelect(paymentFrom, debtors, previousFrom, 'No one owes money');
  populateSelect(paymentTo, creditors, previousTo, 'No one is owed money');
  paymentFrom.disabled = debtors.length === 0;
  paymentTo.disabled = creditors.length === 0;
  updatePaymentLimit();
}

paymentFrom.addEventListener('change', updatePaymentLimit);
paymentTo.addEventListener('change', updatePaymentLimit);

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const amount = parseFloat(paymentAmount.value);
  const limit = paymentLimit();
  if (!paymentFrom.value || !paymentTo.value || !amount || amount <= 0) return;
  if (amount > limit + 0.005) {
    alert(`This payment cannot exceed the outstanding ${money(limit)} between these roommates.`);
    return;
  }

  const settlement = {
    id: uid(),
    from: paymentFrom.value,
    to: paymentTo.value,
    amount,
    date: paymentDate.value || new Date().toISOString().slice(0, 10),
  };

  try {
    await createSettlement(settlement);
    state.settlements.unshift(settlement);
    saveLocalState();
    paymentAmount.value = '';
    renderAll();
  } catch (error) {
    console.error(error);
    alert('Could not save payment. Please try again.');
  }
});

async function deletePayment(id) {
  try {
    await deleteSettlementById(id);
    state.settlements = state.settlements.filter((payment) => payment.id !== id);
    saveLocalState();
    renderAll();
  } catch (error) {
    console.error(error);
    alert('Could not delete payment. Please try again.');
  }
}

function renderActivityLog() {
  const payments = [...state.settlements].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  logPaymentList.innerHTML = '';
  logPaymentEmpty.style.display = payments.length ? 'none' : 'block';
  payments.forEach((payment) => {
    const item = document.createElement('li');
    item.className = 'log-row log-payment-row';
    item.innerHTML = `<div class="log-entry-details"><span class="log-date">${formatDate(payment.date)}</span><span>Payment</span><span> ${escapeHtml(payment.from)} to ${escapeHtml(payment.to)}</span></div><span class="log-amount">${money(payment.amount)}</span>`;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'log-delete-button';
    deleteButton.textContent = 'Delete';
    deleteButton.setAttribute('aria-label', `Delete payment from ${formatDate(payment.date)}`);
    deleteButton.addEventListener('click', () => deletePayment(payment.id));
    item.appendChild(deleteButton);
    addHoldToRevealDelete(item);
    logPaymentList.appendChild(item);
  });

  const allExpenses = [...state.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const utilityExpenses = allExpenses.filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense)));
  const otherExpenses = allExpenses.filter((expense) => expenseCategory(expense) === 'other');

  logExpenseList.innerHTML = '';
  logExpenseEmpty.style.display = utilityExpenses.length ? 'none' : 'block';
  utilityExpenses.forEach((expense) => {
    const splitLabel =
      expense.splitAmong.length === state.people.length
        ? 'everyone'
        : expense.splitAmong.length === 2
        ? expense.splitAmong.join(' & ')
        : expense.splitAmong.join(', ');

    const item = document.createElement('li');
    item.className = 'log-row log-expense-row';
    item.innerHTML = `<div class="log-entry-details"><span class="log-date">${formatDate(expense.date)}</span><div class="log-entry-row"><span class="log-entry-main">${escapeHtml(expense.paidBy)}</span><span class="log-entry-split">→ ${escapeHtml(splitLabel)}</span></div><span>${categoryLabel(expenseCategory(expense))}</span></div><span class="log-amount">${money(expense.amount)}</span>`;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'log-delete-button';
    deleteButton.textContent = 'Delete';
    deleteButton.setAttribute('aria-label', `Delete ${expenseCategory(expense)} expense from ${formatDate(expense.date)}`);
    deleteButton.addEventListener('click', () => deleteExpense(expense.id));
    item.appendChild(deleteButton);
    addHoldToRevealDelete(item);
    logExpenseList.appendChild(item);
  });

}

function addHoldToRevealDelete(row) {
  let holdTimer;
  const cancelHold = () => clearTimeout(holdTimer);
  row.addEventListener('pointerdown', () => {
    cancelHold();
    holdTimer = setTimeout(() => row.classList.add('delete-ready'), 650);
  });
  row.addEventListener('pointerup', cancelHold);
  row.addEventListener('pointerleave', cancelHold);
  row.addEventListener('pointercancel', cancelHold);
}

// =============================================================
// RENDER EXPENSE LIST
// =============================================================
function renderExpenses() {
  expenseListEl.innerHTML = '';
  const utilityExpenses = state.expenses.filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense)));
  expenseEmpty.style.display = utilityExpenses.length ? 'none' : 'block';
  return renderReceiptMonths(utilityExpenses);
}

function renderReceiptMonths(expenses) {
  const categories = ['gas', 'electric', 'internet'];
  const byMonth = new Map();
  expenses.forEach((expense) => {
    const month = expense.month || expense.date?.slice(0, 7) || 'unknown';
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(expense);
  });

  [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .forEach(([month, expenses]) => {
      const monthItem = document.createElement('li');
      monthItem.className = 'receipt-month';
      const monthTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
      monthItem.innerHTML = `<div class="receipt-month-heading"><h3>${formatBillingMonth(month)}</h3><span>${money(monthTotal)}</span></div>`;

      const categoryGrid = document.createElement('div');
      categoryGrid.className = 'receipt-category-grid';
      categories.forEach((category) => {
        const categoryExpenses = expenses.filter((expense) => expenseCategory(expense) === category);
        const total = categoryExpenses.reduce((sum, expense) => sum + expense.amount, 0);
        const categoryCard = document.createElement('section');
        categoryCard.className = `receipt-category receipt-category-${category}`;
        categoryCard.innerHTML = `<div class="receipt-category-heading"><span>${categoryLabel(category)}</span><strong>${money(total)}</strong></div>`;
        categoryGrid.appendChild(categoryCard);
      });

      monthItem.appendChild(categoryGrid);
      expenseListEl.appendChild(monthItem);
    });
}

function expenseCategory(expense) {
  if (['gas', 'electric', 'internet', 'other'].includes(expense.category)) return expense.category;
  const text = expense.desc.toLowerCase();
  if (text.includes('gas')) return 'gas';
  if (text.includes('electric')) return 'electric';
  if (text.includes('internet') || text.includes('wifi')) return 'internet';
  return 'other';
}

function categoryLabel(category) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function formatBillingMonth(month) {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime())
    ? 'Older expenses'
    : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function addHoldToDelete(row, expenseId) {
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'expense-delete-button';
  deleteButton.textContent = 'Delete expense';
  deleteButton.addEventListener('click', () => deleteExpense(expenseId));
  row.appendChild(deleteButton);

  let holdTimer;
  const cancelHold = () => clearTimeout(holdTimer);
  row.addEventListener('pointerdown', () => {
    cancelHold();
    holdTimer = setTimeout(() => row.classList.add('delete-ready'), 650);
  });
  row.addEventListener('pointerup', cancelHold);
  row.addEventListener('pointerleave', cancelHold);
  row.addEventListener('pointercancel', cancelHold);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// =============================================================
// BALANCES
// =============================================================
function computeBalances() {
  const balance = {};
  state.people.forEach((p) => (balance[p] = 0));

  state.expenses.forEach((x) => {
    if (!(x.paidBy in balance)) balance[x.paidBy] = 0;
    balance[x.paidBy] += x.amount;
    const share = x.amount / x.splitAmong.length;
    x.splitAmong.forEach((p) => {
      if (!(p in balance)) balance[p] = 0;
      balance[p] -= share;
    });
  });

  state.settlements.forEach((s) => {
    if (!(s.from in balance)) balance[s.from] = 0;
    if (!(s.to in balance)) balance[s.to] = 0;
    balance[s.from] += s.amount; // paying off debt improves their balance
    balance[s.to] -= s.amount;
  });

  return balance;
}

function renderBalances(balance) {
  balancesGrid.innerHTML = '';
  state.people.forEach((name) => {
    const amt = balance[name] || 0;
    const card = document.createElement('div');
    card.className = 'balance-card';
    let cls = 'even';
    let caption = 'all settled up';
    if (amt > 0.005) {
      cls = 'owed';
      caption = 'is owed';
    } else if (amt < -0.005) {
      cls = 'owes';
      caption = 'owes the house';
    }
    card.innerHTML = `
      <p class="balance-name">${escapeHtml(name)}</p>
      <p class="balance-amount ${cls}">${money(Math.abs(amt) < 0.005 ? 0 : amt)}</p>
      <p class="balance-caption">${caption}</p>
    `;
    balancesGrid.appendChild(card);
  });
}

// =============================================================
// SETTLE UP — greedy minimal-transaction simplification
// =============================================================
function computeSettlements(balance) {
  const creditors = [];
  const debtors = [];
  Object.entries(balance).forEach(([name, amt]) => {
    if (amt > 0.005) creditors.push({ name, amt });
    else if (amt < -0.005) debtors.push({ name, amt: -amt });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const txns = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    txns.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt < 0.005) i++;
    if (creditors[j].amt < 0.005) j++;
  }
  return txns;
}

function renderSettlements(txns) {
  settleList.innerHTML = '';
  settleEmpty.style.display = txns.length ? 'none' : 'block';
  txns.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'settle-row';
    li.innerHTML = `
      <span>${escapeHtml(t.from)}</span>
      <span class="arrow">&rarr;</span>
      <span>${escapeHtml(t.to)}</span>
      <span class="amount">${money(t.amount)}</span>
    `;
    settleList.appendChild(li);
  });
}

// =============================================================
// UTIL
// =============================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =============================================================
// MAIN RENDER
// =============================================================
function renderAll() {
  renderFormOptions();
  renderExpenses();
  const balance = computeBalances();
  renderBalances(balance);
  renderPaymentOptions();
  renderSettlements(computeSettlements(balance));
  renderActivityLog();
}

initState();

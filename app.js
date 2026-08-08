// =============================================================
// THE LEDGER — state & persistence
// =============================================================
let state = { people: [], expenses: [], settlements: [] };
const STORAGE_KEY = 'payme-local-state';
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://payme-9w80.onrender.com';
const SYNC_INTERVAL_MS = 4000;
const LOG_PREVIEW_COUNT = 2;
const SESSION_KEY = 'payme-session-token';
const syncStatusEl = document.getElementById('sync-status');
const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const authForm = document.getElementById('auth-form');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authRemember = document.getElementById('auth-remember');
const authPasswordField = document.getElementById('auth-password-field');
const authError = document.getElementById('auth-error');
const authSubmit = document.getElementById('auth-submit');
const authModeToggle = document.getElementById('auth-mode-toggle');
const authCopy = document.getElementById('auth-copy');
const logoutButton = document.getElementById('logout-button');
const developerMenuButton = document.getElementById('developer-menu-button');
const developerSettingsRow = document.getElementById('developer-settings-row');
const developerMenu = document.getElementById('developer-menu');
const developerMenuClose = document.getElementById('developer-menu-close');
const developerAccountList = document.getElementById('developer-account-list');
const developerMenuError = document.getElementById('developer-menu-error');
const notificationButton = document.getElementById('notification-button');
const venmoInfoButton = document.getElementById('venmo-info-button');
const huntingtonBankButton = document.getElementById('huntington-bank-button');
const keybankBankButton = document.getElementById('keybank-bank-button');
const usbankBankButton = document.getElementById('usbank-bank-button');
const payNowMenu = document.getElementById('pay-now-menu');
const payNowClose = document.getElementById('pay-now-close');
const payNowSummary = document.getElementById('pay-now-summary');
const payNowNote = document.getElementById('pay-now-note');
const payWithVenmo = document.getElementById('pay-with-venmo');
const payWithZelle = document.getElementById('pay-with-zelle');
const settingsButton = document.getElementById('settings-button');
const settingsMenu = document.getElementById('settings-menu');
const settingsMenuClose = document.getElementById('settings-menu-close');
const accountNameForm = document.getElementById('account-name-form');
const accountNameInput = document.getElementById('account-name-input');
const accountNameError = document.getElementById('account-name-error');
let authMode = 'sign-in';
let currentUser = null;
const APP_VERSION = '20260807-usbank-r19';

const DEFAULT_STATE = {
  people: [],
  expenses: [],
  settlements: [],
};

function loadLocalState() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Could not parse local state.', error);
    return null;
  }
}

function saveLocalState() {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (error) {
    console.warn('Could not save local state.', error);
  }
}

function getStorageKey() {
  return `${STORAGE_KEY}-${APP_VERSION}`;
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function getSessionToken() {
  return localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
}

function saveSessionToken(token, remember) {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, token);
}

function clearSessionToken() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(apiUrl(path), { ...options, headers });
}

async function loadState() {
  const localState = loadLocalState();
  try {
    const response = await apiFetch('/api/state');
    if (!response.ok) throw new Error('Failed to load state');
    const data = await response.json();
    const loaded = {
      people: Array.isArray(data.people) ? data.people : DEFAULT_STATE.people,
      expenses: Array.isArray(data.expenses) ? data.expenses : DEFAULT_STATE.expenses,
      settlements: Array.isArray(data.settlements) ? data.settlements : DEFAULT_STATE.settlements,
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(loaded));
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
    const response = await apiFetch('/api/state');
    if (response.status === 401) return showAuthScreen();
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
    const response = await apiFetch('/api/expenses', {
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
    const response = await apiFetch('/api/settlements', {
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
    const response = await apiFetch('/api/people', {
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
    const response = await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Could not delete expense');
  } catch (error) {
    console.warn('Expense delete backend unavailable, removing locally.', error);
    saveLocalState();
  }
}

async function deleteSettlementById(id) {
  try {
    const response = await apiFetch(`/api/settlements/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Could not delete payment');
  } catch (error) {
    console.warn('Payment delete backend unavailable, removing locally.', error);
    saveLocalState();
  }
}

async function deletePersonByName(name) {
  const response = await apiFetch(`/api/people/${encodeURIComponent(name)}`, { method: 'DELETE' });
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
const categoryField = document.getElementById('exp-category-field');
const expenseFormTitle = document.getElementById('expense-form-title');
const descriptionField = document.getElementById('exp-description-field');
const descriptionInput = document.getElementById('exp-description');
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
const paymentDescription = document.getElementById('payment-description');
const paymentDate = document.getElementById('payment-date');

const logPaymentList = document.getElementById('log-payment-list');
const logPaymentEmpty = document.getElementById('log-payment-empty');
const logPaymentMore = document.getElementById('log-payment-more');
const logPaymentSection = document.getElementById('log-payments-section');
const logExpenseList = document.getElementById('log-expense-list');
const logExpenseEmpty = document.getElementById('log-expense-empty');
const logExpenseMore = document.getElementById('log-expense-more');
const logExpenseSection = document.getElementById('log-expenses-section');
const logOtherList = document.getElementById('log-other-list');
const logOtherEmpty = document.getElementById('log-other-empty');
const logOtherMore = document.getElementById('log-other-more');

let isPaymentLogExpanded = false;
let isExpenseLogExpanded = false;
let isOtherLogExpanded = false;

logPaymentMore?.addEventListener('click', () => {
  isPaymentLogExpanded = !isPaymentLogExpanded;
  renderActivityLog();
});

logExpenseMore?.addEventListener('click', () => {
  isExpenseLogExpanded = !isExpenseLogExpanded;
  renderActivityLog();
});

logOtherMore?.addEventListener('click', () => {
  isOtherLogExpanded = !isOtherLogExpanded;
  renderActivityLog();
});

const tabButtons = [...document.querySelectorAll('.tab-list [role="tab"]')];
const tabPanels = [...document.querySelectorAll('.tab-panel')];
const receiptTabButtons = [...document.querySelectorAll('[data-receipt-tab]')];
const receiptTabPanels = [...document.querySelectorAll('.receipt-subpanel')];
const balancePanelContent = document.getElementById('balance-panel-content');
const expensePanel = document.getElementById('panel-expense');
const utilityExpensePanel = document.getElementById('expense-panel-utilities');
const otherExpensePanel = document.getElementById('expense-panel-other');

balancePanelContent.append(document.getElementById('panel-settle'), document.getElementById('panel-balances'));
utilityExpensePanel.append(expensePanel);

function setupSubTabs(attribute, panelPrefix, onActivate) {
  const buttons = [...document.querySelectorAll(`[data-${attribute}-tab]`)];
  const panels = buttons.map((button) => document.getElementById(button.getAttribute('aria-controls')));
  const activate = (name) => {
    buttons.forEach((button) => {
      const active = button.dataset[`${attribute}Tab`] === name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.id !== `${panelPrefix}${name}`; });
    onActivate?.(name);
  };
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activate(button.dataset[`${attribute}Tab`]));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      buttons[nextIndex].focus();
      activate(buttons[nextIndex].dataset[`${attribute}Tab`]);
    });
  });
  const selected = buttons.find((button) => button.getAttribute('aria-selected') === 'true') || buttons[0];
  if (selected) activate(selected.dataset[`${attribute}Tab`]);
}

setupSubTabs('balance', 'panel-');
setupSubTabs('expense', 'expense-panel-', (name) => {
  const isOther = name === 'other';
  (isOther ? otherExpensePanel : utilityExpensePanel).append(expensePanel);
  expenseFormTitle.textContent = isOther ? 'Mark another expense' : 'Log a utility';
  categoryField.hidden = isOther;
  categoryInput.innerHTML = isOther
    ? '<option value="other">Other</option>'
    : '<option value="gas">Gas</option><option value="electric">Electric</option><option value="internet">Internet</option>';
  categoryInput.value = isOther ? 'other' : 'gas';
  updateDescriptionField();
});

function activateReceiptTab(tabName) {
  receiptTabButtons.forEach((button) => {
    const active = button.dataset.receiptTab === tabName;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  receiptTabPanels.forEach((panel) => {
    panel.hidden = panel.id !== `receipt-panel-${tabName}`;
  });
}

receiptTabButtons.forEach((button, index) => {
  button.addEventListener('click', () => activateReceiptTab(button.dataset.receiptTab));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + receiptTabButtons.length) % receiptTabButtons.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % receiptTabButtons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = receiptTabButtons.length - 1;
    receiptTabButtons[nextIndex].focus();
    activateReceiptTab(receiptTabButtons[nextIndex].dataset.receiptTab);
  });
});
activateReceiptTab('totals');

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

  if (tabName === 'pay') paymentDate.value = currentEasternDate();

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
  const isDeveloper = currentUser?.isDeveloper;
  payerSelect.innerHTML = '';
  if (state.people.length === 0) {
    payerSelect.innerHTML = '<option value="">Add roommates first</option>';
    payerSelect.disabled = true;
  } else {
    const payers = isDeveloper ? state.people : state.people.filter((name) => name === currentUser?.name);
    payers.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      payerSelect.appendChild(opt);
    });
    if (!isDeveloper) {
      payerSelect.value = currentUser?.name || '';
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
  payerSelect.disabled = disabled || !isDeveloper;
  updateDescriptionField();
}

function updateDescriptionField() {
  const isOther = categoryInput.value === 'other';
  descriptionInput.setCustomValidity('');
  descriptionField.hidden = !isOther;
  descriptionInput.disabled = !isOther || state.people.length === 0;
  descriptionInput.required = isOther;
  if (!isOther) descriptionInput.value = '';
}

categoryInput.addEventListener('change', updateDescriptionField);
descriptionInput.addEventListener('input', () => descriptionInput.setCustomValidity(''));

expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = categoryInput.value;
  const description = descriptionInput.value.trim();
  const amount = parseFloat(amountInput.value);
  const paidBy = payerSelect.value;
  const month = monthInput.value;
  const splitAmong = [...splitCheckboxes.querySelectorAll('input:checked')].map(
    (i) => i.value
  );

  if (!category || !amount || amount <= 0 || !paidBy || !month) return;
  if (category === 'other' && (!description || /\s/.test(description))) {
    descriptionInput.setCustomValidity('Enter a one-word description without spaces.');
    descriptionInput.reportValidity();
    return;
  }
  descriptionInput.setCustomValidity('');
  if (splitAmong.length === 0) {
    alert('Pick at least one person to split this with.');
    return;
  }

  const year = currentEasternDate().slice(0, 4);
  const expense = {
    id: uid(),
    desc: category === 'other' ? description : categoryLabel(category),
    category,
    amount,
    paidBy,
    splitAmong,
    date: currentEasternDate(),
    month: `${year}-${month}`,
  };

  try {
    const savedExpense = await createExpense(expense);
    state.expenses.unshift(savedExpense);
    saveLocalState();
    amountInput.value = '';
    descriptionInput.value = '';
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
  const debtors = state.people.filter((name) => (balance[name] || 0) < -0.005 && (currentUser?.isDeveloper || name === currentUser?.name));
  const creditors = state.people.filter((name) => (balance[name] || 0) > 0.005);
  const previousFrom = paymentFrom.value;
  const previousTo = paymentTo.value;

  populateSelect(paymentFrom, debtors, previousFrom, 'No one owes money');
  populateSelect(paymentTo, creditors, previousTo, 'No one is owed money');
  paymentFrom.disabled = debtors.length === 0 || !currentUser?.isDeveloper;
  paymentTo.disabled = creditors.length === 0;
  updatePaymentLimit();
}

paymentFrom.addEventListener('change', () => {
  updatePaymentLimit();
});
paymentTo.addEventListener('change', () => {
  updatePaymentLimit();
});

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const amount = parseFloat(paymentAmount.value);
  const description = paymentDescription.value.trim();
  const limit = paymentLimit();
  if (!paymentFrom.value || !paymentTo.value || !amount || amount <= 0) return;
  if (!description || /\s/.test(description)) {
    paymentDescription.setCustomValidity('Enter a one-word description without spaces.');
    paymentDescription.reportValidity();
    return;
  }
  paymentDescription.setCustomValidity('');
  if (amount > limit + 0.005) {
    alert(`This payment cannot exceed the outstanding ${money(limit)} between these roommates.`);
    return;
  }

  const settlement = {
    id: uid(),
    from: paymentFrom.value,
    to: paymentTo.value,
    amount,
    desc: description,
    date: paymentDate.value || new Date().toISOString().slice(0, 10),
  };

  try {
    const savedSettlement = await createSettlement(settlement);
    state.settlements.unshift(savedSettlement);
    saveLocalState();
    paymentAmount.value = '';
    paymentDescription.value = '';
    renderAll();
    showPayNow(savedSettlement);
  } catch (error) {
    console.error(error);
    alert('Could not save payment. Please try again.');
  }
});

paymentDescription.addEventListener('input', () => paymentDescription.setCustomValidity(''));

async function showPayNow(payment) {
  payNowSummary.textContent = `${money(payment.amount)} to ${payment.to}`;
  payNowNote.textContent = 'Loading payment options…';
  payWithVenmo.disabled = true;
  payWithZelle.disabled = true;
  payNowMenu.hidden = false;
  try {
    const [response, senderResponse] = await Promise.all([
      apiFetch(`/api/payment-info/${encodeURIComponent(payment.to)}`),
      apiFetch(`/api/payment-info/${encodeURIComponent(payment.from)}`),
    ]);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Payment links need the latest backend. Deploy the newest commit to Render, then try again.');
    }
    const info = await response.json();
    if (!response.ok) throw new Error(info.error || 'Could not load payment information.');
    let senderInfo = {};
    if ((senderResponse.headers.get('content-type') || '').includes('application/json')) {
      senderInfo = await senderResponse.json();
    }
    const senderBank = senderInfo.bank || (payment.from === currentUser?.name ? currentUser.bank : '');
    payWithVenmo.disabled = !info.venmo;
    payWithZelle.disabled = false;
    payWithVenmo.onclick = () => {
      const params = new URLSearchParams({ txn: 'pay', recipients: info.venmo, amount: Number(payment.amount).toFixed(2), note: payment.desc || 'Pay Up' });
      window.open(`https://venmo.com/?${params}`, '_blank', 'noopener');
    };
    payWithZelle.onclick = async () => {
      const recipient = info.zelle || payment.to;
      const details = `${recipient} — ${money(payment.amount)}`;
      const isIphone = /iPhone|iPod/.test(navigator.userAgent);
      const shortcutName = senderBank === 'huntington'
        ? 'Open Huntington'
        : senderBank === 'keybank'
          ? 'Open KeyBank'
          : senderBank === 'usbank' ? 'Open USBank' : '';
      const bankUrl = shortcutName && isIphone
        ? `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}`
        : senderBank === 'huntington'
          ? 'https://www.huntington.com/mobile-login'
          : senderBank === 'keybank'
            ? 'https://www.key.com/personal/online-banking/zelle.html'
            : senderBank === 'usbank'
              ? 'https://www.usbank.com/online-mobile-banking/zelle-person-to-person-payments/zelle-support.html'
            : 'https://enroll.zellepay.com/mobile';
      const bankName = senderBank === 'huntington' ? 'Huntington' : senderBank === 'keybank' ? 'KeyBank' : senderBank === 'usbank' ? 'U.S. Bank' : '';
      const bankInstruction = bankName
        ? `${bankName} opened. Select Zelle to finish the payment.`
        : 'Select your bank on the page that opened, then continue to its app to finish the payment.';
      if (!(shortcutName && isIphone)) window.open(bankUrl, '_blank', 'noopener');
      try {
        await navigator.clipboard.writeText(details);
        payNowNote.textContent = `Copied ${details}. ${bankInstruction}`;
      } catch (error) {
        payNowNote.textContent = `Use ${recipient} and send ${money(payment.amount)}. ${bankInstruction}`;
      }
      if (shortcutName && isIphone) window.location.href = bankUrl;
    };
    payNowNote.textContent = 'Choose a payment app to finish sending the money. Recording it here did not transfer funds.';
  } catch (error) {
    payNowNote.textContent = error.message || 'Payment options are unavailable.';
  }
}

payNowClose.addEventListener('click', () => { payNowMenu.hidden = true; });
payNowMenu.addEventListener('click', (event) => { if (event.target === payNowMenu) payNowMenu.hidden = true; });

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
  const paymentPreview = isPaymentLogExpanded ? payments : payments.slice(0, LOG_PREVIEW_COUNT);
  paymentPreview.forEach((payment) => {
    const item = document.createElement('li');
    item.className = 'log-row log-payment-row';
    item.innerHTML = `<div class="log-entry-details"><span class="log-date">${formatDate(payment.date)}</span><span>${escapeHtml(payment.desc || 'Payment')}</span><span> ${escapeHtml(payment.from)} to ${escapeHtml(payment.to)}</span></div><span class="log-amount">${money(payment.amount)}</span>`;
    if (currentUser?.isDeveloper || payment.createdBy === currentUser?.id) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'log-delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete payment from ${formatDate(payment.date)}`);
      deleteButton.addEventListener('click', () => deletePayment(payment.id));
      item.appendChild(deleteButton);
      addHoldToRevealDelete(item);
    }
    logPaymentList.appendChild(item);
  });
  if (payments.length > LOG_PREVIEW_COUNT) {
    logPaymentMore.hidden = false;
    logPaymentMore.textContent = isPaymentLogExpanded
      ? 'Show less'
      : `View ${payments.length - LOG_PREVIEW_COUNT} more payments`;
  } else {
    logPaymentMore.hidden = true;
  }
  logPaymentSection?.classList.toggle('expanded', isPaymentLogExpanded);

  const allExpenses = [...state.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const utilityExpenses = allExpenses.filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense)));

  logExpenseList.innerHTML = '';
  logExpenseEmpty.style.display = utilityExpenses.length ? 'none' : 'block';
  const expensePreview = isExpenseLogExpanded ? utilityExpenses : utilityExpenses.slice(0, LOG_PREVIEW_COUNT);
  expensePreview.forEach((expense) => {
    const splitLabel =
      expense.splitAmong.length === state.people.length
        ? 'everyone'
        : expense.splitAmong.length === 2
        ? expense.splitAmong.join(' & ')
        : expense.splitAmong.join(', ');

    const item = document.createElement('li');
    item.className = 'log-row log-expense-row';
    item.innerHTML = `<div class="log-entry-details"><span class="log-date">${formatDate(expense.date)}</span><div class="log-entry-row"><span class="log-entry-main">${escapeHtml(expense.paidBy)}</span><span class="log-entry-split">→ ${escapeHtml(splitLabel)}</span></div><span>${categoryLabel(expenseCategory(expense))}</span></div><span class="log-amount">${money(expense.amount)}</span>`;
    if (currentUser?.isDeveloper || expense.createdBy === currentUser?.id) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'log-delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete ${expenseCategory(expense)} expense from ${formatDate(expense.date)}`);
      deleteButton.addEventListener('click', () => deleteExpense(expense.id));
      item.appendChild(deleteButton);
      addHoldToRevealDelete(item);
    }
    logExpenseList.appendChild(item);
  });
  if (utilityExpenses.length > LOG_PREVIEW_COUNT) {
    logExpenseMore.hidden = false;
    logExpenseMore.textContent = isExpenseLogExpanded
      ? 'Show less'
      : `View ${utilityExpenses.length - LOG_PREVIEW_COUNT} more expenses`;
  } else {
    logExpenseMore.hidden = true;
  }
  logExpenseSection?.classList.toggle('expanded', isExpenseLogExpanded);

  renderExpenseLog(
    allExpenses.filter((expense) => expenseCategory(expense) === 'other'),
    logOtherList,
    logOtherEmpty,
    logOtherMore,
    isOtherLogExpanded
  );

}

function renderExpenseLog(expenses, list, empty, moreButton, expanded) {
  list.innerHTML = '';
  empty.style.display = expenses.length ? 'none' : 'block';
  const preview = expanded ? expenses : expenses.slice(0, LOG_PREVIEW_COUNT);
  preview.forEach((expense) => {
    const splitAmong = Array.isArray(expense.splitAmong) ? expense.splitAmong : [];
    const splitLabel = splitAmong.length === state.people.length
      ? 'everyone'
      : splitAmong.length === 2 ? splitAmong.join(' & ') : splitAmong.join(', ');
    const item = document.createElement('li');
    item.className = 'log-row log-expense-row';
    const expenseLabel = expenseCategory(expense) === 'other' && expense.desc
      ? expense.desc
      : categoryLabel(expenseCategory(expense));
    item.innerHTML = `<div class="log-entry-details"><span class="log-date">${formatDate(expense.date)}</span><div class="log-entry-row"><span class="log-entry-main">${escapeHtml(expense.paidBy)}</span><span class="log-entry-split">→ ${escapeHtml(splitLabel)}</span></div><span>${escapeHtml(expenseLabel)}</span></div><span class="log-amount">${money(expense.amount)}</span>`;
    if (currentUser?.isDeveloper || expense.createdBy === currentUser?.id) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'log-delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete other expense from ${formatDate(expense.date)}`);
      deleteButton.addEventListener('click', () => deleteExpense(expense.id));
      item.appendChild(deleteButton);
      addHoldToRevealDelete(item);
    }
    list.appendChild(item);
  });
  moreButton.hidden = expenses.length <= LOG_PREVIEW_COUNT;
  if (!moreButton.hidden) moreButton.textContent = expanded ? 'Show less' : `View ${expenses.length - LOG_PREVIEW_COUNT} more expenses`;
}

function addHoldToRevealDelete(row) {
  addTapToToggleDelete(row);
}

function addTapToToggleDelete(row) {
  row.tabIndex = 0;
  row.setAttribute('aria-expanded', 'false');
  const toggle = () => {
    const revealed = row.classList.toggle('delete-ready');
    row.setAttribute('aria-expanded', String(revealed));
  };
  row.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    toggle();
  });
  row.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key) || event.target.closest('button')) return;
    event.preventDefault();
    toggle();
  });
}

// =============================================================
// RENDER EXPENSE LIST
// =============================================================
function isActiveExpense(expense) {
  return state.people.includes(expense.paidBy) && Array.isArray(expense.splitAmong) && expense.splitAmong.length > 0;
}

function isActiveSettlement(settlement) {
  return state.people.includes(settlement.from) && state.people.includes(settlement.to);
}

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

  addTapToToggleDelete(row);
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
  const balanceCents = {};
  state.people.forEach((person) => (balanceCents[person] = 0));

  state.expenses.filter(isActiveExpense).forEach((x) => {
    const totalCents = Math.round(Number(x.amount) * 100);
    const baseShare = Math.floor(totalCents / x.splitAmong.length);
    const remainder = totalCents - baseShare * x.splitAmong.length;
    x.splitAmong.forEach((person, index) => {
      if (person === x.paidBy || !state.people.includes(person)) return;
      const shareCents = baseShare + (index < remainder ? 1 : 0);
      balanceCents[x.paidBy] += shareCents;
      balanceCents[person] -= shareCents;
    });
  });

  state.settlements.filter(isActiveSettlement).forEach((s) => {
    const amountCents = Math.round(Number(s.amount) * 100);
    balanceCents[s.from] += amountCents;
    balanceCents[s.to] -= amountCents;
  });

  return Object.fromEntries(
    Object.entries(balanceCents).map(([person, cents]) => [person, cents / 100])
  );
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(startValue, endValue) {
  const start = parseDateValue(startValue);
  const end = parseDateValue(endValue);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function computeMostRecentExpenseDate() {
  const expenseDates = state.expenses
    .filter(isActiveExpense)
    .map((expense) => expense.date)
    .filter(Boolean)
    .map((date) => parseDateValue(date))
    .filter(Boolean);

  if (!expenseDates.length) return null;
  const latest = expenseDates.reduce((latestDate, nextDate) => (nextDate > latestDate ? nextDate : latestDate));
  return latest.toISOString().slice(0, 10);
}

function computeCreditScores() {
  const scores = {};
  state.people.forEach((name) => {
    scores[name] = 850;
  });

  const latestExpenseDate = computeMostRecentExpenseDate();
  if (!latestExpenseDate) return scores;

  const paymentsToLuke = [...state.settlements]
    .filter((settlement) => isActiveSettlement(settlement) && settlement.to === 'Luke')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  paymentsToLuke.forEach((settlement) => {
    const payer = settlement.from;
    const daysLate = daysBetween(latestExpenseDate, settlement.date);
    const baseScore = Math.max(0, 850 - 50 * daysLate);
    scores[payer] = (scores[payer] + baseScore) / 2;
  });

  return scores;
}

function renderBalances(balance, scores) {
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
    const score = Math.round(scores[name] || 850);
    card.innerHTML = `
      <div class="balance-header">
        <p class="balance-name">${escapeHtml(name)}</p>
        <span class="credit-score">${score}</span>
      </div>
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
// ACCOUNT ACCESS
// =============================================================
function urlBase64ToUint8Array(value) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function updateNotificationButton() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  notificationButton.hidden = !currentUser || !supported;
  if (!supported || !currentUser) return;
  const enabled = Notification.permission === 'granted';
  notificationButton.disabled = Notification.permission === 'denied';
  notificationButton.classList.toggle('is-enabled', enabled);
  notificationButton.textContent = enabled ? 'Alerts on' : 'Enable alerts';
  notificationButton.setAttribute('aria-label', enabled ? 'Phone alerts are enabled' : 'Enable phone alerts');
}

async function enablePhoneAlerts() {
  try {
    if (Notification.permission === 'denied') throw new Error('Phone notifications are blocked in this browser. Enable them in your phone or browser settings.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Phone notification permission was not granted.');
    const registration = await navigator.serviceWorker.register('/push-sw.js');
    const keyResponse = await apiFetch('/api/push/public-key');
    const keyPayload = await keyResponse.json();
    if (!keyResponse.ok) throw new Error(keyPayload.error || 'Phone notifications are not configured yet.');
    const subscription = await registration.pushManager.getSubscription()
      || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyPayload.publicKey) });
    const response = await apiFetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not enable phone alerts.');
    updateNotificationButton();
  } catch (error) {
    alert(error.message || 'Could not enable phone alerts.');
  }
}

notificationButton.addEventListener('click', enablePhoneAlerts);

function updatePaymentInfoButtons() {
  venmoInfoButton.textContent = currentUser?.venmo ? 'Update Venmo information' : 'Add Venmo information';
  huntingtonBankButton.textContent = currentUser?.bank === 'huntington' ? 'Huntington selected' : 'Huntington';
  keybankBankButton.textContent = currentUser?.bank === 'keybank' ? 'KeyBank selected' : 'KeyBank';
  usbankBankButton.textContent = currentUser?.bank === 'usbank' ? 'U.S. Bank selected' : 'U.S. Bank';
}

async function savePaymentInfo(type) {
  const label = 'Venmo username';
  const existing = currentUser?.[type] || '';
  const value = prompt(label, existing);
  if (value === null) return;
  if (!value.trim()) return alert(`Enter your ${label.toLowerCase()}.`);
  try {
    const response = await apiFetch('/api/auth/payment-info', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, value: value.trim() }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Payment information needs the latest backend. Deploy the newest commit to Render, then try again.');
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not save payment information.');
    currentUser = { ...currentUser, ...payload };
    updatePaymentInfoButtons();
  } catch (error) {
    alert(error.message || 'Could not save payment information.');
  }
}

venmoInfoButton.addEventListener('click', () => savePaymentInfo('venmo'));
async function saveBank(bank) {
  try {
    const response = await apiFetch('/api/auth/payment-info', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bank', value: bank }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('Deploy the latest backend to Render, then try again.');
    const payload = await response.json();
    if (!response.ok) {
      if (payload.error === 'Unsupported banking app.') {
        throw new Error('Render is running an older backend. Deploy the latest commit to enable this bank.');
      }
      throw new Error(payload.error || 'Could not save banking app.');
    }
    currentUser = { ...currentUser, ...payload };
    updatePaymentInfoButtons();
  } catch (error) {
    alert(error.message || 'Could not save banking app.');
  }
}

huntingtonBankButton.addEventListener('click', () => saveBank('huntington'));
keybankBankButton.addEventListener('click', () => saveBank('keybank'));
usbankBankButton.addEventListener('click', () => saveBank('usbank'));

function openSettingsMenu() {
  accountNameInput.value = currentUser?.name || '';
  accountNameError.hidden = true;
  settingsMenu.hidden = false;
  document.body.classList.add('settings-open');
}

function closeSettingsMenu() {
  settingsMenu.hidden = true;
  document.body.classList.remove('settings-open');
  settingsButton.focus({ preventScroll: true });
}

settingsButton.addEventListener('click', openSettingsMenu);
settingsMenuClose.addEventListener('click', closeSettingsMenu);
settingsMenu.addEventListener('click', (event) => { if (event.target === settingsMenu) closeSettingsMenu(); });

accountNameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = accountNameInput.value.trim();
  accountNameError.hidden = true;
  try {
    const response = await apiFetch('/api/auth/account', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not update account name.');
    setDeveloperAccess(payload.user);
    accountNameInput.value = payload.user.name;
    await initState();
  } catch (error) {
    accountNameError.textContent = error.message || 'Could not update account name.';
    accountNameError.hidden = false;
  }
});

function setDeveloperAccess(user) {
  currentUser = user || null;
  developerSettingsRow.hidden = !currentUser?.isDeveloper;
  if (!currentUser?.isDeveloper) developerMenu.hidden = true;
  if (!currentUser) {
    settingsMenu.hidden = true;
    document.body.classList.remove('settings-open');
  }
  updateNotificationButton();
  updatePaymentInfoButtons();
}

function showDeveloperError(message = '') {
  developerMenuError.textContent = message;
  developerMenuError.hidden = !message;
}

function renderDeveloperAccounts(accounts) {
  developerAccountList.innerHTML = '';
  accounts.forEach((account) => {
    const card = document.createElement('article');
    card.className = 'developer-account';
    const title = document.createElement('p');
    title.className = 'developer-account-title';
    title.textContent = account.isDeveloper ? `${account.name} — Developer account` : account.name;
    card.appendChild(title);
    if (account.isDeveloper) {
      const note = document.createElement('p');
      note.className = 'developer-menu-note';
      note.textContent = 'Protected from edits and deletion.';
      card.appendChild(note);
      developerAccountList.appendChild(card);
      return;
    }
    const form = document.createElement('form');
    form.className = 'developer-account-form';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'First name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.value = account.name; nameInput.maxLength = 31; nameInput.required = true;
    nameLabel.appendChild(nameInput);
    const passwordLabel = document.createElement('label');
    passwordLabel.textContent = 'New password';
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password'; passwordInput.placeholder = 'Leave blank to keep'; passwordInput.minLength = 8;
    passwordLabel.appendChild(passwordInput);
    const saveButton = document.createElement('button');
    saveButton.type = 'submit'; saveButton.textContent = 'Save';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button'; deleteButton.className = 'developer-delete'; deleteButton.textContent = 'Delete';
    form.append(nameLabel, passwordLabel, saveButton, deleteButton);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showDeveloperError();
      saveButton.disabled = true;
      try {
        const response = await apiFetch(`/api/developer/accounts/${encodeURIComponent(account.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nameInput.value.trim(), password: passwordInput.value }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not update account.');
        await openDeveloperMenu();
        await syncStateFromServer();
      } catch (error) { showDeveloperError(error.message); } finally { saveButton.disabled = false; }
    });
    deleteButton.addEventListener('click', async () => {
      if (!confirm(`Delete ${account.name}'s account? They will be removed from Balances and Settle up, but their history will remain.`)) return;
      showDeveloperError();
      deleteButton.disabled = true;
      try {
        const response = await apiFetch(`/api/developer/accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error || 'Could not delete account.');
        }
        await openDeveloperMenu();
        await syncStateFromServer();
      } catch (error) { showDeveloperError(error.message); } finally { deleteButton.disabled = false; }
    });
    card.appendChild(form);
    developerAccountList.appendChild(card);
  });
}

async function openDeveloperMenu() {
  if (!currentUser?.isDeveloper) return;
  showDeveloperError();
  developerMenu.hidden = false;
  developerAccountList.textContent = 'Loading accounts…';
  try {
    const response = await apiFetch('/api/developer/accounts');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load accounts.');
    renderDeveloperAccounts(payload.accounts || []);
  } catch (error) {
    developerAccountList.innerHTML = '';
    showDeveloperError(error.message);
  }
}

developerMenuButton.addEventListener('click', openDeveloperMenu);
developerMenuClose.addEventListener('click', () => { developerMenu.hidden = true; });
developerMenu.addEventListener('click', (event) => { if (event.target === developerMenu) developerMenu.hidden = true; });

function setAuthMode(nextMode) {
  authMode = nextMode;
  const isSignUp = nextMode === 'sign-up';
  authCopy.textContent = isSignUp
    ? 'Create an account to access the shared ledger.'
    : 'Sign in to view and update the house ledger.';
  authSubmit.textContent = isSignUp ? 'Create account' : 'Sign in';
  authModeToggle.textContent = isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up';
  authPassword.autocomplete = isSignUp ? 'new-password' : 'current-password';
  authError.hidden = true;
}

function showAuthScreen() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  clearSessionToken();
  setDeveloperAccess(null);
  localStorage.removeItem(getStorageKey());
  document.body.classList.remove('is-authenticated');
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.style.display = 'grid';
  authPassword.value = '';
  authUsername.focus();
}

function showApp(user) {
  setDeveloperAccess(user);
  document.body.classList.add('is-authenticated');
  authScreen.hidden = true;
  authScreen.style.display = 'none';
  appShell.hidden = false;
}

authModeToggle.addEventListener('click', () => setAuthMode(authMode === 'sign-up' ? 'sign-in' : 'sign-up'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;
  try {
    const endpoint = authMode === 'sign-up' ? '/api/auth/signup' : '/api/auth/signin';
    const response = await apiFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: authUsername.value.trim(), password: authPassword.value }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('The deployed backend is missing the new login routes. Deploy backend/server.js to Render, then try again.');
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not sign in.');
    if (!payload.sessionToken) throw new Error('The server did not create a session. Please try again.');
    saveSessionToken(payload.sessionToken, authRemember.checked);
    showApp(payload.user);
    await initState();
  } catch (error) {
    authError.textContent = error.message || 'Could not sign in. Please try again.';
    authError.hidden = false;
  } finally {
    authSubmit.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    showAuthScreen();
  }
});

async function initApp() {
  const sessionAtStart = getSessionToken();
  try {
    const response = await apiFetch('/api/auth/me');
    if (!response.ok) {
      if (getSessionToken() === sessionAtStart) showAuthScreen();
      return;
    }
    const payload = await response.json();
    showApp(payload.user);
    await initState();
  } catch (error) {
    if (getSessionToken() === sessionAtStart) showAuthScreen();
  }
}

// =============================================================
// MAIN RENDER
// =============================================================
function renderAll() {
  renderFormOptions();
  renderExpenses();
  const balance = computeBalances();
  const creditScores = computeCreditScores();
  renderBalances(balance, creditScores);
  renderPaymentOptions();
  renderSettlements(computeSettlements(balance));
  renderActivityLog();
}

setAuthMode(authMode);
initApp();

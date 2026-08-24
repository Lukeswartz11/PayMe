// =============================================================
// THE LEDGER — state & persistence
// =============================================================
let state = { people: [], expenses: [], settlements: [], budgetExpenses: [], personalReceipts: [] };
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
const themeToggle = document.getElementById('theme-toggle');
let authMode = 'sign-in';
let currentUser = null;
const APP_VERSION = '20260810-budget-form-r43';
const THEME_KEY = 'payme-color-theme';

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  if (themeToggle) {
    themeToggle.checked = isDark;
    themeToggle.setAttribute('aria-checked', String(isDark));
  }
}

applyTheme(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light');
themeToggle.addEventListener('change', () => {
  const theme = themeToggle.checked ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
});

const DEFAULT_STATE = {
  people: [],
  expenses: [],
  settlements: [],
  budgetExpenses: [],
  personalReceipts: [],
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
  return `${STORAGE_KEY}-${APP_VERSION}-${currentUser?.id || 'signed-out'}`;
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
      budgetExpenses: Array.isArray(data.budgetExpenses) ? data.budgetExpenses : DEFAULT_STATE.budgetExpenses,
      personalReceipts: Array.isArray(data.personalReceipts) ? data.personalReceipts : DEFAULT_STATE.personalReceipts,
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(loaded));
    return loaded;
  } catch (e) {
    console.warn('Could not load shared ledger state, using local fallback.', e);
    return normalizeState(localState || DEFAULT_STATE);
  }
}

let syncTimer = null;
let lastSyncSignature = '';

function normalizeState(data) {
  return {
    people: Array.isArray(data?.people) ? data.people : DEFAULT_STATE.people,
    expenses: Array.isArray(data?.expenses) ? data.expenses : DEFAULT_STATE.expenses,
    settlements: Array.isArray(data?.settlements) ? data.settlements : DEFAULT_STATE.settlements,
    budgetExpenses: Array.isArray(data?.budgetExpenses) ? data.budgetExpenses : DEFAULT_STATE.budgetExpenses,
    personalReceipts: Array.isArray(data?.personalReceipts) ? data.personalReceipts : DEFAULT_STATE.personalReceipts,
  };
}

function getStateSignature(nextState) {
  return JSON.stringify({
    people: nextState.people,
    expenses: nextState.expenses,
    settlements: nextState.settlements,
    budgetExpenses: nextState.budgetExpenses,
    personalReceipts: nextState.personalReceipts,
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

async function createBudgetExpense(expense) {
  const response = await apiFetch('/api/budget-expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expense),
  });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(payload.error || 'Could not create personal expense.');
  return payload;
}

async function deleteBudgetExpenseById(id) {
  const response = await apiFetch(`/api/budget-expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not delete personal expense.');
}

async function saveBudgetGraphCategories(categories) {
  const response = await apiFetch('/api/auth/budget-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Could not save graph settings.');
  return payload.budgetGraphCategories;
}

async function createPersonalReceipt(receipt) {
  const response = await apiFetch('/api/personal-receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Could not save receipt photo.');
  return payload;
}

async function deletePersonalReceiptById(id) {
  const response = await apiFetch(`/api/personal-receipts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not delete receipt photo.');
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
const monthField = document.getElementById('exp-month-field');
const splitCheckboxes = document.getElementById('split-checkboxes');

const utilityTotalChart = document.getElementById('utility-total-chart');
const expenseEmpty = document.getElementById('expense-empty');
const utilityBreakdown = document.getElementById('utility-breakdown');

const balancesGrid = document.getElementById('balances-grid');
const settleList = document.getElementById('settle-list');
const settleEmpty = document.getElementById('settle-empty');

const paymentForm = document.getElementById('payment-form');
const paymentFrom = document.getElementById('payment-from');
const paymentTo = document.getElementById('payment-to');
const paymentAmount = document.getElementById('payment-amount');
const paymentDescription = document.getElementById('payment-description');
const paymentDate = document.getElementById('payment-date');

const budgetForm = document.getElementById('budget-form');
const budgetCategory = document.getElementById('budget-category');
const budgetDescription = document.getElementById('budget-description');
const budgetAmount = document.getElementById('budget-amount');
const budgetDate = document.getElementById('budget-date');
const budgetSummaryList = document.getElementById('budget-summary-list');
const budgetSummaryEmpty = document.getElementById('budget-summary-empty');
const budgetTotalChart = document.getElementById('budget-total-chart');
const budgetTotalEmpty = document.getElementById('budget-total-empty');
const budgetBreakdown = document.getElementById('budget-breakdown');
const budgetReceiptImage = document.getElementById('budget-receipt-image');
const budgetReceiptStatus = document.getElementById('budget-receipt-status');
const personalReceiptList = document.getElementById('personal-receipt-list');
const personalReceiptEmpty = document.getElementById('personal-receipt-empty');
const budgetGraphSettings = document.getElementById('budget-graph-settings');
const budgetGraphSelection = document.getElementById('budget-graph-selection');
const personalReceiptViewer = document.getElementById('personal-receipt-viewer');
const personalReceiptViewerTitle = document.getElementById('personal-receipt-viewer-title');
const personalReceiptViewerImage = document.getElementById('personal-receipt-viewer-image');
const personalReceiptViewerClose = document.getElementById('personal-receipt-viewer-close');

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
setupSubTabs('budget', 'budget-panel-');
setupSubTabs('expense', 'expense-panel-', (name) => {
  const isOther = name === 'other';
  (isOther ? otherExpensePanel : utilityExpensePanel).append(expensePanel);
  expenseFormTitle.textContent = isOther ? 'Mark another expense' : 'Log a utility';
  categoryField.hidden = isOther;
  categoryInput.innerHTML = isOther
    ? '<option value="other">Other</option>'
    : '<option value="gas">Gas</option><option value="electric">Electric</option><option value="internet">Internet</option>';
  categoryInput.value = isOther ? 'other' : 'gas';
  monthField.hidden = isOther;
  monthInput.disabled = isOther;
  monthInput.required = !isOther;
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
budgetDate.value = currentEasternDate();

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
  if (tabName === 'budget' && !budgetDate.value) budgetDate.value = currentEasternDate();

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
  monthField.hidden = isOther;
  monthInput.disabled = isOther || state.people.length === 0;
  monthInput.required = !isOther;
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

  if (!category || !amount || amount <= 0 || !paidBy || (category !== 'other' && !month)) return;
  if (category === 'other' && (!description || description.length >= 24)) {
    descriptionInput.setCustomValidity('Enter a description shorter than 24 characters.');
    descriptionInput.reportValidity();
    return;
  }
  descriptionInput.setCustomValidity('');
  if (splitAmong.length === 0) {
    alert('Pick at least one person to split this with.');
    return;
  }

  const today = currentEasternDate();
  const year = today.slice(0, 4);
  const expense = {
    id: uid(),
    desc: category === 'other' ? description : categoryLabel(category),
    category,
    amount,
    paidBy,
    splitAmong,
    date: today,
    month: category === 'other' ? today.slice(0, 7) : `${year}-${month}`,
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
// PERSONAL BUDGET
// =============================================================
const BUDGET_CATEGORIES = ['groceries', 'eat-out', 'rent', 'fun', 'other'];
const GRAPH_CATEGORIES = [...BUDGET_CATEGORIES, 'gas', 'electric', 'internet'];

function selectedBudgetGraphCategories() {
  const saved = currentUser?.budgetGraphCategories;
  const selected = Array.isArray(saved) ? saved.filter((category) => GRAPH_CATEGORIES.includes(category)) : [];
  return selected.length ? selected : GRAPH_CATEGORIES;
}

function graphCategoryLabel(category) {
  return BUDGET_CATEGORIES.includes(category) ? budgetCategoryLabel(category) : categoryLabel(category);
}

function renderBudgetGraphSettings() {
  const selected = selectedBudgetGraphCategories();
  budgetGraphSelection.textContent = selected.length === GRAPH_CATEGORIES.length ? 'All categories' : `${selected.length} selected`;
  budgetGraphSettings.innerHTML = '';
  GRAPH_CATEGORIES.forEach((category) => {
    const label = document.createElement('label');
    label.className = 'budget-graph-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.includes(category);
    input.addEventListener('change', async () => {
      const next = [...budgetGraphSettings.querySelectorAll('input:checked')].map((item) => item.value);
      if (!next.length) {
        input.checked = true;
        alert('Choose at least one category for your Total graph.');
        return;
      }
      try {
        const saved = await saveBudgetGraphCategories(next);
        currentUser = { ...currentUser, budgetGraphCategories: saved };
        renderBudget();
      } catch (error) {
        input.checked = !input.checked;
        alert(error.message || 'Could not save graph settings.');
      }
    });
    input.value = category;
    label.append(input, document.createTextNode(graphCategoryLabel(category)));
    budgetGraphSettings.appendChild(label);
  });
}

function receiptImageData(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      let longestSide = Math.max(image.naturalWidth, image.naturalHeight);
      let size = Math.min(1800, longestSide);
      const canvas = document.createElement('canvas');
      const draw = (quality) => {
        const scale = size / longestSide;
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
      };
      let result = draw(0.84);
      while (result.length > 2_400_000 && size > 1000) {
        size = Math.round(size * 0.82);
        result = draw(0.76);
      }
      if (result.length > 2_400_000) return reject(new Error('That photo is too large. Please retake it closer to the receipt.'));
      resolve(result);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that receipt image.')); };
    image.src = url;
  });
}

function renderPersonalReceipts() {
  const receipts = [...state.personalReceipts].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  personalReceiptList.innerHTML = '';
  personalReceiptEmpty.style.display = receipts.length ? 'none' : 'block';
  receipts.forEach((receipt) => {
    const card = document.createElement('article');
    card.className = 'personal-receipt-card';
    const meta = document.createElement('div');
    meta.className = 'personal-receipt-meta';
    const details = document.createElement('div');
    details.innerHTML = `<strong>${escapeHtml(receipt.store)}</strong><span>${escapeHtml(formatDate(String(receipt.createdAt || '').slice(0, 10)))}</span>`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'personal-receipt-delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      try {
        await deletePersonalReceiptById(receipt.id);
        state.personalReceipts = state.personalReceipts.filter((item) => item.id !== receipt.id);
        saveLocalState();
        renderPersonalReceipts();
      } catch (error) { alert(error.message || 'Could not delete receipt photo.'); }
    });
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'personal-receipt-view';
    view.textContent = 'View photo';
    view.addEventListener('click', () => {
      personalReceiptViewerTitle.textContent = receipt.store;
      personalReceiptViewerImage.src = receipt.image;
      personalReceiptViewerImage.alt = `Receipt from ${receipt.store}`;
      personalReceiptViewer.showModal();
    });
    const actions = document.createElement('div');
    actions.className = 'personal-receipt-actions';
    actions.append(view, remove);
    meta.append(details, actions);
    card.append(meta);
    personalReceiptList.appendChild(card);
  });
}

personalReceiptViewerClose.addEventListener('click', () => personalReceiptViewer.close());
personalReceiptViewer.addEventListener('click', (event) => { if (event.target === personalReceiptViewer) personalReceiptViewer.close(); });
let selectedBudgetMonth = null;
const openLogMonths = {
  budget: new Set(),
  payments: new Set(),
  utilities: new Set(),
  other: new Set(),
};

function logMonthKey(entry) {
  return String(entry.date || entry.month || 'unknown').slice(0, 7) || 'unknown';
}

function utilityLogMonthKey(entry) {
  return String(entry.month || entry.date || 'unknown').slice(0, 7) || 'unknown';
}

function logMonthKeys(entries, keyFunction = logMonthKey) {
  return [...new Set(entries.map(keyFunction))];
}

function visibleLogEntries(entries, expanded, keyFunction = logMonthKey) {
  return entries;
}

function wrapLogRowsByMonth(list, sectionKey) {
  const rows = [...list.children];
  const groups = new Map();
  rows.forEach((row) => {
    const month = row.dataset.month || 'unknown';
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(row);
  });
  list.innerHTML = '';
  groups.forEach((monthRows, month) => {
    const total = monthRows.reduce((sum, row) => sum + Number(row.dataset.amountCents || 0), 0);
    const group = document.createElement('li');
    group.className = 'monthly-log-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'monthly-log-toggle';
    const isOpen = openLogMonths[sectionKey].has(month);
    button.setAttribute('aria-expanded', String(isOpen));
    button.innerHTML = `<span class="monthly-log-title">${formatBillingMonth(month)}</span><span class="monthly-log-summary">${monthRows.length} ${monthRows.length === 1 ? 'entry' : 'entries'} · ${money(total / 100)}</span><span class="monthly-log-chevron" aria-hidden="true">⌄</span>`;
    const contents = document.createElement('ol');
    contents.className = 'monthly-log-entries';
    contents.hidden = !isOpen;
    monthRows.forEach((row) => contents.appendChild(row));
    button.addEventListener('click', () => {
      const opening = contents.hidden;
      contents.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      group.classList.toggle('is-open', opening);
      if (opening) openLogMonths[sectionKey].add(month);
      else openLogMonths[sectionKey].delete(month);
      list.classList.toggle('has-open-month', openLogMonths[sectionKey].size > 0);
    });
    group.classList.toggle('is-open', isOpen);
    group.append(button, contents);
    list.appendChild(group);
  });
  list.classList.toggle('has-open-month', openLogMonths[sectionKey].size > 0);
}

function budgetCategoryLabel(category) {
  return category === 'eat-out' ? 'Resturants' : categoryLabel(category);
}

function autofillBudgetDescription() {
  const previousAutofill = budgetDescription.dataset.autofill || '';
  const nextAutofill = budgetCategory.value === 'groceries'
    ? 'Groceries'
    : budgetCategory.value === 'rent' ? 'Rent' : '';
  if (nextAutofill) budgetDescription.value = nextAutofill;
  else if (budgetDescription.value === previousAutofill) budgetDescription.value = '';
  budgetDescription.dataset.autofill = nextAutofill;
}

budgetCategory.addEventListener('change', autofillBudgetDescription);
autofillBudgetDescription();

function budgetChartMaximum(maximumCents) {
  const maximumDollars = maximumCents / 100;
  const roughTick = maximumDollars / 4;
  const tickMultiple = roughTick < 50 ? 5 : roughTick < 250 ? 10 : roughTick < 1000 ? 50 : 100;
  const tickDollars = Math.max(tickMultiple, Math.ceil(roughTick / tickMultiple) * tickMultiple);
  return tickDollars * 4 * 100;
}

function renderBudgetBreakdown(month, totals) {
  const monthTotal = selectedBudgetGraphCategories().reduce((sum, category) => sum + totals[category], 0);
  budgetBreakdown.hidden = false;
  budgetBreakdown.innerHTML = `<div class="budget-breakdown-heading"><div><span class="budget-breakdown-eyebrow">Spending breakdown</span><h3>${formatBillingMonth(month)}</h3></div><strong>${money(monthTotal / 100)}</strong></div>`;
  const categoryList = document.createElement('div');
  categoryList.className = 'budget-breakdown-list';
  selectedBudgetGraphCategories().forEach((category) => {
    const categoryTotal = totals[category] || 0;
    const percentage = monthTotal ? categoryTotal / monthTotal * 100 : 0;
    const row = document.createElement('div');
    row.className = `budget-breakdown-row budget-breakdown-${category}`;
    const label = graphCategoryLabel(category);
    row.innerHTML = `<div class="budget-breakdown-label"><span>${escapeHtml(label)}</span><span>${money(categoryTotal / 100)} <small>${Math.round(percentage)}%</small></span></div><div class="budget-breakdown-track"><span style="width:${percentage}%"></span></div>`;
    categoryList.appendChild(row);
  });
  budgetBreakdown.appendChild(categoryList);
}

budgetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const expense = {
    id: uid(),
    category: budgetCategory.value,
    desc: budgetDescription.value.trim(),
    amount: Number(budgetAmount.value),
    date: budgetDate.value,
  };
  if (!BUDGET_CATEGORIES.includes(expense.category) || !expense.desc || !Number.isFinite(expense.amount) || expense.amount <= 0 || !expense.date) return;
  try {
    const savedExpense = await createBudgetExpense(expense);
    state.budgetExpenses.unshift(savedExpense);
    const receiptFile = budgetReceiptImage.files?.[0];
    if (receiptFile) {
      budgetReceiptStatus.textContent = 'Compressing receipt photo…';
      try {
        const image = await receiptImageData(receiptFile);
        budgetReceiptStatus.textContent = 'Saving receipt…';
        const savedReceipt = await createPersonalReceipt({ store: expense.desc, image });
        state.personalReceipts.unshift(savedReceipt);
        budgetReceiptStatus.textContent = 'Receipt attached.';
      } catch (receiptError) {
        budgetReceiptStatus.textContent = receiptError.message || 'Your expense was saved, but the receipt photo was not.';
      }
    } else {
      budgetReceiptStatus.textContent = '';
    }
    saveLocalState();
    budgetDescription.value = '';
    autofillBudgetDescription();
    budgetAmount.value = '';
    budgetDate.value = currentEasternDate();
    budgetReceiptImage.value = '';
    renderBudget();
  } catch (error) {
    alert(error.message || 'Could not save personal expense.');
  }
});

async function deleteBudgetExpense(id) {
  try {
    await deleteBudgetExpenseById(id);
    state.budgetExpenses = state.budgetExpenses.filter((expense) => expense.id !== id);
    saveLocalState();
    renderBudget();
  } catch (error) {
    alert(error.message || 'Could not delete personal expense.');
  }
}

function renderBudget() {
  renderBudgetGraphSettings();
  renderPersonalReceipts();
  const expenses = [...state.budgetExpenses].sort((a, b) => `${b.date || ''}${b.createdAt || ''}`.localeCompare(`${a.date || ''}${a.createdAt || ''}`));
  budgetSummaryList.innerHTML = '';
  budgetSummaryEmpty.style.display = expenses.length ? 'none' : 'block';
  expenses.forEach((expense) => {
    const item = document.createElement('li');
    item.className = 'log-row sleek-log-row budget-log-card';
    item.dataset.month = logMonthKey(expense);
    item.dataset.amountCents = String(Math.round(Number(expense.amount) * 100));
    item.innerHTML = `<div class="sleek-log-content"><div class="sleek-log-meta"><span class="sleek-log-date">${formatDate(expense.date)}</span><span class="sleek-log-badge budget-log-badge-${expense.category}">${escapeHtml(budgetCategoryLabel(expense.category))}</span></div><strong class="sleek-log-description">${escapeHtml(expense.desc)}</strong></div><span class="sleek-log-amount">${money(expense.amount)}</span>`;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'log-delete-button';
    deleteButton.textContent = 'Delete';
    deleteButton.setAttribute('aria-label', `Delete ${expense.desc} from ${formatDate(expense.date)}`);
    deleteButton.addEventListener('click', () => deleteBudgetExpense(expense.id));
    item.appendChild(deleteButton);
    addHoldToRevealDelete(item);
    budgetSummaryList.appendChild(item);
  });
  wrapLogRowsByMonth(budgetSummaryList, 'budget');

  const months = new Map();
  const emptyMonthTotals = () => Object.fromEntries(GRAPH_CATEGORIES.map((category) => [category, 0]));
  expenses.forEach((expense) => {
    const month = String(expense.date || '').slice(0, 7) || 'unknown';
    if (!months.has(month)) months.set(month, emptyMonthTotals());
    months.get(month)[expense.category] += Math.round(Number(expense.amount) * 100);
  });
  state.expenses
    .filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense)))
    .forEach((expense) => {
      const splitAmong = Array.isArray(expense.splitAmong) ? expense.splitAmong : [];
      const accountIndex = splitAmong.indexOf(currentUser?.name);
      if (accountIndex < 0 || !splitAmong.length) return;
      const totalCents = Math.round(Number(expense.amount) * 100);
      const baseShareCents = Math.floor(totalCents / splitAmong.length);
      const remainder = totalCents - baseShareCents * splitAmong.length;
      const accountShareCents = baseShareCents + (accountIndex < remainder ? 1 : 0);
      const month = expense.month || String(expense.date || '').slice(0, 7) || 'unknown';
      if (!months.has(month)) months.set(month, emptyMonthTotals());
      months.get(month)[expenseCategory(expense)] += accountShareCents;
    });
  budgetTotalChart.innerHTML = '';
  budgetTotalEmpty.style.display = months.size ? 'none' : 'block';
  if (!months.size) {
    selectedBudgetMonth = null;
    budgetBreakdown.hidden = true;
    budgetBreakdown.innerHTML = '';
    return;
  }

  const monthEntries = [...months.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!months.has(selectedBudgetMonth)) selectedBudgetMonth = null;
  const maximumCents = Math.max(...monthEntries.map(([, totals]) => selectedBudgetGraphCategories().reduce((sum, category) => sum + totals[category], 0)), 1);
  const chartMaximumCents = budgetChartMaximum(maximumCents);
  const yAxis = document.createElement('div');
  yAxis.className = 'budget-y-axis';
  yAxis.setAttribute('aria-hidden', 'true');
  yAxis.innerHTML = `<span class="budget-axis-title">$</span>${[4, 3, 2, 1, 0].map((step) => `<span>${money(chartMaximumCents * step / 4 / 100)}</span>`).join('')}`;
  const plot = document.createElement('div');
  plot.className = 'budget-chart-plot';
  plot.classList.toggle('has-selection', Boolean(selectedBudgetMonth));
  const gridLines = document.createElement('div');
  gridLines.className = 'budget-grid-lines';
  gridLines.setAttribute('aria-hidden', 'true');
  gridLines.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
  plot.appendChild(gridLines);
  budgetTotalChart.append(yAxis, plot);
  monthEntries.forEach(([month, totals]) => {
    const monthTotal = selectedBudgetGraphCategories().reduce((sum, category) => sum + totals[category], 0);
    const item = document.createElement('div');
    item.className = 'budget-bar-item';
    item.setAttribute('role', 'listitem');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'budget-bar-button';
    button.classList.toggle('selected', month === selectedBudgetMonth);
    button.setAttribute('aria-pressed', String(month === selectedBudgetMonth));
    button.setAttribute('aria-label', `${formatBillingMonth(month)}: ${money(monthTotal / 100)}`);
    const height = monthTotal > 0 ? Math.max(3, Math.round(monthTotal / chartMaximumCents * 100)) : 0;
    button.innerHTML = `<span class="budget-bar-amount">${money(monthTotal / 100)}</span><span class="budget-bar-track"><span class="budget-bar-fill" style="height:${height}%"></span></span><span class="budget-bar-label">${escapeHtml(formatBillingMonth(month))}</span>`;
    button.addEventListener('click', () => {
      selectedBudgetMonth = selectedBudgetMonth === month ? null : month;
      plot.classList.toggle('has-selection', Boolean(selectedBudgetMonth));
      budgetTotalChart.querySelectorAll('.budget-bar-button').forEach((candidate) => {
        const selected = Boolean(selectedBudgetMonth) && candidate === button;
        candidate.classList.toggle('selected', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      });
      if (selectedBudgetMonth) {
        renderBudgetBreakdown(month, totals);
      } else {
        budgetBreakdown.hidden = true;
        budgetBreakdown.innerHTML = '';
      }
    });
    item.appendChild(button);
    plot.appendChild(item);
  });
  if (selectedBudgetMonth) renderBudgetBreakdown(selectedBudgetMonth, months.get(selectedBudgetMonth));
  else {
    budgetBreakdown.hidden = true;
    budgetBreakdown.innerHTML = '';
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
  const previousFrom = paymentFrom.value;
  const previousTo = paymentTo.value;
  const accountOwner = currentUser?.name || '';
  const paymentSenders = currentUser?.isDeveloper
    ? [accountOwner, ...debtors.filter((name) => name !== accountOwner)].filter(Boolean)
    : accountOwner ? [accountOwner] : [];

  populateSelect(paymentFrom, paymentSenders, previousFrom || accountOwner, 'Account unavailable');
  const creditors = (balance[paymentFrom.value] || 0) < -0.005
    ? state.people.filter((name) => (balance[name] || 0) > 0.005)
    : [];
  populateSelect(paymentTo, creditors, previousTo, 'Keep your charity');
  paymentFrom.disabled = !currentUser?.isDeveloper || paymentSenders.length < 2;
  paymentTo.disabled = creditors.length === 0;
  updatePaymentLimit();
}

paymentFrom.addEventListener('change', () => {
  renderPaymentOptions();
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
  if (!description || description.length >= 24) {
    paymentDescription.setCustomValidity('Enter a description shorter than 24 characters.');
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
      const webUrl = `https://venmo.com/?${params}`;
      const isPhone = /iPhone|iPod|Android/i.test(navigator.userAgent);
      if (!isPhone) {
        window.open(webUrl, '_blank', 'noopener');
        return;
      }

      const fallbackTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') window.location.href = webUrl;
      }, 1400);
      window.addEventListener('pagehide', () => clearTimeout(fallbackTimer), { once: true });
      window.location.href = `venmo://paycharge?${params}`;
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
  const paymentPreview = visibleLogEntries(payments, isPaymentLogExpanded);
  paymentPreview.forEach((payment) => {
    const item = document.createElement('li');
    item.className = 'log-row sleek-log-row payment-log-card';
    item.dataset.month = logMonthKey(payment);
    item.dataset.amountCents = String(Math.round(Number(payment.amount) * 100));
    item.innerHTML = `<div class="sleek-log-content"><div class="sleek-log-meta"><span class="sleek-log-date">${formatDate(payment.date)}</span><span class="sleek-log-badge payment-log-badge">Payment</span></div><strong class="sleek-log-description">${escapeHtml(payment.desc || 'Payment')}</strong><span class="sleek-log-route"><b>${escapeHtml(payment.from)}</b><span aria-hidden="true">→</span><b>${escapeHtml(payment.to)}</b></span></div><span class="sleek-log-amount">${money(payment.amount)}</span>`;
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
  wrapLogRowsByMonth(logPaymentList, 'payments');
  const paymentMonthCount = logMonthKeys(payments).length;
  if (paymentMonthCount > LOG_PREVIEW_COUNT) {
    logPaymentMore.hidden = false;
    logPaymentMore.textContent = isPaymentLogExpanded
      ? 'Show less'
      : `View ${paymentMonthCount - LOG_PREVIEW_COUNT} more months`;
  } else {
    logPaymentMore.hidden = true;
  }
  logPaymentSection?.classList.toggle('expanded', isPaymentLogExpanded);
  logPaymentList.classList.toggle('expanded', isPaymentLogExpanded);
  logPaymentMore.hidden = true;

  const allExpenses = [...state.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const utilityExpenses = allExpenses
    .filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense)))
    .sort((a, b) => utilityLogMonthKey(b).localeCompare(utilityLogMonthKey(a)) || (b.date || '').localeCompare(a.date || ''));

  logExpenseList.innerHTML = '';
  logExpenseEmpty.style.display = utilityExpenses.length ? 'none' : 'block';
  const expensePreview = visibleLogEntries(utilityExpenses, isExpenseLogExpanded, utilityLogMonthKey);
  expensePreview.forEach((expense) => {
    const splitLabel =
      expense.splitAmong.length === state.people.length
        ? 'everyone'
        : expense.splitAmong.length === 2
        ? expense.splitAmong.join(' & ')
        : expense.splitAmong.join(', ');

    const item = document.createElement('li');
    item.className = 'log-row utility-log-row';
    item.dataset.month = utilityLogMonthKey(expense);
    item.dataset.amountCents = String(Math.round(Number(expense.amount) * 100));
    item.innerHTML = `<div class="log-entry-details"><span class="log-date">${formatDate(expense.date)}</span><div class="log-entry-row"><span class="log-entry-main">${escapeHtml(expense.paidBy)}</span><span class="log-entry-split">→ ${escapeHtml(splitLabel)}</span></div><span>${categoryLabel(expenseCategory(expense))}</span></div><span class="log-amount">${money(expense.amount)}</span>`;
    const category = expenseCategory(expense);
    item.innerHTML = `<div class="utility-log-content"><div class="utility-log-meta"><span class="utility-log-date">${formatDate(expense.date)}</span><span class="utility-log-category utility-log-category-${category}">${categoryLabel(category)}</span></div><div class="utility-log-route"><strong>${escapeHtml(expense.paidBy)}</strong><span>paid for ${escapeHtml(splitLabel)}</span></div></div><span class="utility-log-amount">${money(expense.amount)}</span>`;
    if (currentUser?.isDeveloper || expense.createdBy === currentUser?.id) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'log-delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete ${category} expense from ${formatDate(expense.date)}`);
      deleteButton.addEventListener('click', () => deleteExpense(expense.id));
      item.appendChild(deleteButton);
      addHoldToRevealDelete(item);
    }
    logExpenseList.appendChild(item);
  });
  wrapLogRowsByMonth(logExpenseList, 'utilities');
  const utilityMonthCount = logMonthKeys(utilityExpenses, utilityLogMonthKey).length;
  if (utilityMonthCount > LOG_PREVIEW_COUNT) {
    logExpenseMore.hidden = false;
    logExpenseMore.textContent = isExpenseLogExpanded
      ? 'Show less'
      : `View ${utilityMonthCount - LOG_PREVIEW_COUNT} more months`;
  } else {
    logExpenseMore.hidden = true;
  }
  logExpenseSection?.classList.toggle('expanded', isExpenseLogExpanded);
  logExpenseList.classList.toggle('expanded', isExpenseLogExpanded);
  logExpenseMore.hidden = true;

  renderExpenseLog(
    allExpenses.filter((expense) => expenseCategory(expense) === 'other'),
    logOtherList,
    logOtherEmpty,
    logOtherMore,
    isOtherLogExpanded,
    'other'
  );
  logOtherList.classList.toggle('expanded', isOtherLogExpanded);

}

function renderExpenseLog(expenses, list, empty, moreButton, expanded, sectionKey) {
  list.innerHTML = '';
  empty.style.display = expenses.length ? 'none' : 'block';
  const preview = visibleLogEntries(expenses, expanded);
  preview.forEach((expense) => {
    const splitAmong = Array.isArray(expense.splitAmong) ? expense.splitAmong : [];
    const splitLabel = splitAmong.length === state.people.length
      ? 'everyone'
      : splitAmong.length === 2 ? splitAmong.join(' & ') : splitAmong.join(', ');
    const item = document.createElement('li');
    item.className = 'log-row sleek-log-row other-log-card';
    item.dataset.month = logMonthKey(expense);
    item.dataset.amountCents = String(Math.round(Number(expense.amount) * 100));
    const expenseLabel = expenseCategory(expense) === 'other' && expense.desc
      ? expense.desc
      : categoryLabel(expenseCategory(expense));
    item.innerHTML = `<div class="log-entry-details"><span class="log-date">${formatDate(expense.date)}</span><div class="log-entry-row"><span class="log-entry-main">${escapeHtml(expense.paidBy)}</span><span class="log-entry-split">→ ${escapeHtml(splitLabel)}</span></div><span>${escapeHtml(expenseLabel)}</span></div><span class="log-amount">${money(expense.amount)}</span>`;
    item.innerHTML = `<div class="sleek-log-content"><div class="sleek-log-meta"><span class="sleek-log-date">${formatDate(expense.date)}</span><span class="sleek-log-badge other-log-badge">Other</span></div><strong class="sleek-log-description">${escapeHtml(expenseLabel)}</strong><span class="sleek-log-route"><b>${escapeHtml(expense.paidBy)}</b><span>paid for ${escapeHtml(splitLabel)}</span></span></div><span class="sleek-log-amount">${money(expense.amount)}</span>`;
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
  wrapLogRowsByMonth(list, sectionKey);
  const monthCount = logMonthKeys(expenses).length;
  moreButton.hidden = monthCount <= LOG_PREVIEW_COUNT;
  if (!moreButton.hidden) moreButton.textContent = expanded ? 'Show less' : `View ${monthCount - LOG_PREVIEW_COUNT} more months`;
  moreButton.hidden = true;
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
  const utilityExpenses = state.expenses.filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense)));
  expenseEmpty.style.display = utilityExpenses.length ? 'none' : 'block';
  renderUtilityTotalsGraph(utilityExpenses);
}

let selectedUtilityMonth = null;

function renderUtilityBreakdown(month, totals) {
  const monthTotal = Object.values(totals).reduce((sum, cents) => sum + cents, 0);
  utilityBreakdown.hidden = false;
  utilityBreakdown.innerHTML = `<div class="budget-breakdown-heading"><div><span class="budget-breakdown-eyebrow">Full utility breakdown</span><h3>${formatBillingMonth(month)}</h3></div><strong>${money(monthTotal / 100)}</strong></div>`;
  const list = document.createElement('div');
  list.className = 'budget-breakdown-list';
  ['gas', 'electric', 'internet'].forEach((category) => {
    const categoryTotal = totals[category] || 0;
    const percentage = monthTotal ? categoryTotal / monthTotal * 100 : 0;
    const row = document.createElement('div');
    row.className = `budget-breakdown-row utility-breakdown-${category}`;
    row.innerHTML = `<div class="budget-breakdown-label"><span>${categoryLabel(category)}</span><span>${money(categoryTotal / 100)} <small>${Math.round(percentage)}%</small></span></div><div class="budget-breakdown-track"><span style="width:${percentage}%"></span></div>`;
    list.appendChild(row);
  });
  utilityBreakdown.appendChild(list);
}

function renderUtilityTotalsGraph(expenses) {
  const categories = ['gas', 'electric', 'internet'];
  const byMonth = new Map();
  expenses.forEach((expense) => {
    const month = expense.month || expense.date?.slice(0, 7) || 'unknown';
    if (!byMonth.has(month)) byMonth.set(month, { gas: 0, electric: 0, internet: 0 });
    byMonth.get(month)[expenseCategory(expense)] += Math.round(Number(expense.amount) * 100);
  });
  utilityTotalChart.innerHTML = '';
  if (!byMonth.size) {
    selectedUtilityMonth = null;
    utilityBreakdown.hidden = true;
    utilityBreakdown.innerHTML = '';
    return;
  }
  const entries = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!byMonth.has(selectedUtilityMonth)) selectedUtilityMonth = null;
  const maximumCents = Math.max(...entries.map(([, totals]) => categories.reduce((sum, category) => sum + totals[category], 0)), 1);
  const chartMaximumCents = budgetChartMaximum(maximumCents);
  const yAxis = document.createElement('div');
  yAxis.className = 'budget-y-axis';
  yAxis.setAttribute('aria-hidden', 'true');
  yAxis.innerHTML = `<span class="budget-axis-title">$</span>${[4, 3, 2, 1, 0].map((step) => `<span>${money(chartMaximumCents * step / 4 / 100)}</span>`).join('')}`;
  const plot = document.createElement('div');
  plot.className = 'budget-chart-plot';
  plot.classList.toggle('has-selection', Boolean(selectedUtilityMonth));
  const gridLines = document.createElement('div');
  gridLines.className = 'budget-grid-lines';
  gridLines.setAttribute('aria-hidden', 'true');
  gridLines.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
  plot.appendChild(gridLines);
  utilityTotalChart.append(yAxis, plot);
  entries.forEach(([month, totals]) => {
    const monthTotal = categories.reduce((sum, category) => sum + totals[category], 0);
    const item = document.createElement('div');
    item.className = 'budget-bar-item';
    item.setAttribute('role', 'listitem');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'budget-bar-button';
    button.classList.toggle('selected', month === selectedUtilityMonth);
    button.setAttribute('aria-pressed', String(month === selectedUtilityMonth));
    button.setAttribute('aria-label', `${formatBillingMonth(month)} household utilities: ${money(monthTotal / 100)}`);
    const height = Math.max(3, Math.round(monthTotal / chartMaximumCents * 100));
    button.innerHTML = `<span class="budget-bar-amount">${money(monthTotal / 100)}</span><span class="budget-bar-track"><span class="budget-bar-fill" style="height:${height}%"></span></span><span class="budget-bar-label">${escapeHtml(formatBillingMonth(month))}</span>`;
    button.addEventListener('click', () => {
      selectedUtilityMonth = selectedUtilityMonth === month ? null : month;
      plot.classList.toggle('has-selection', Boolean(selectedUtilityMonth));
      utilityTotalChart.querySelectorAll('.budget-bar-button').forEach((candidate) => {
        const selected = Boolean(selectedUtilityMonth) && candidate === button;
        candidate.classList.toggle('selected', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      });
      if (selectedUtilityMonth) renderUtilityBreakdown(month, totals);
      else {
        utilityBreakdown.hidden = true;
        utilityBreakdown.innerHTML = '';
      }
    });
    item.appendChild(button);
    plot.appendChild(item);
  });
  if (selectedUtilityMonth) renderUtilityBreakdown(selectedUtilityMonth, byMonth.get(selectedUtilityMonth));
  else {
    utilityBreakdown.hidden = true;
    utilityBreakdown.innerHTML = '';
  }
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
  localStorage.removeItem(getStorageKey());
  setDeveloperAccess(null);
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
      body: JSON.stringify({ name: authUsername.value.trim(), password: authPassword.value, remember: authRemember.checked }),
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
  renderBudget();
}

setAuthMode(authMode);
initApp();

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
const authInviteField = document.getElementById('auth-invite-field');
const authInviteCode = document.getElementById('auth-invite-code');
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
const developerInviteForm = document.getElementById('developer-invite-form');
const developerInviteCode = document.getElementById('developer-invite-code');
const developerInviteCopy = document.getElementById('developer-invite-copy');
const developerInviteNote = document.getElementById('developer-invite-note');
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
const billsTransferMenu = document.getElementById('bills-transfer-menu');
const billsTransferClose = document.getElementById('bills-transfer-close');
const billsTransferSummary = document.getElementById('bills-transfer-summary');
const billsTransferOpenBank = document.getElementById('bills-transfer-open-bank');
const billsTransferNotNow = document.getElementById('bills-transfer-not-now');
const settingsButton = document.getElementById('settings-button');
const settingsMenu = document.getElementById('settings-menu');
const settingsMenuClose = document.getElementById('settings-menu-close');
const exportExcelButton = document.getElementById('export-excel-button');
const accountNameForm = document.getElementById('account-name-form');
const accountNameInput = document.getElementById('account-name-input');
const accountNameError = document.getElementById('account-name-error');
const accountPasswordForm = document.getElementById('account-password-form');
const accountCurrentPassword = document.getElementById('account-current-password');
const accountNewPassword = document.getElementById('account-new-password');
const accountPasswordError = document.getElementById('account-password-error');
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
    localStorage.removeItem(getStorageKey());
    return null;
  } catch (error) {
    console.warn('Could not parse local state.', error);
    return null;
  }
}

function saveLocalState() {
  try {
    localStorage.removeItem(getStorageKey());
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

function billsAccountTransferCents(amount, splitAmong, accountName) {
  const totalCents = Math.round(Number(amount) * 100);
  const accountIndex = splitAmong.indexOf(accountName);
  if (accountIndex < 0) return totalCents;
  const baseShareCents = Math.floor(totalCents / splitAmong.length);
  const remainder = totalCents - baseShareCents * splitAmong.length;
  const accountShareCents = baseShareCents + (accountIndex < remainder ? 1 : 0);
  return totalCents - accountShareCents;
}

function openBankForBillsTransfer(transferCents) {
  const bank = currentUser?.bank || '';
  const transferAmount = money(transferCents / 100);
  const shortcutName = bank === 'huntington'
    ? 'Open Huntington'
    : bank === 'keybank'
      ? 'Open KeyBank'
      : bank === 'usbank' ? 'Open USBank' : '';
  const bankUrl = bank === 'huntington'
    ? 'https://www.huntington.com/mobile-login'
    : bank === 'keybank'
      ? 'https://www.key.com/personal/online-banking/zelle.html'
      : bank === 'usbank'
        ? 'https://www.usbank.com/online-mobile-banking/zelle-person-to-person-payments/zelle-support.html'
        : '';

  navigator.clipboard?.writeText(transferAmount).catch(() => {});
  if (shortcutName && /iPhone|iPod/.test(navigator.userAgent)) {
    window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${encodeURIComponent(transferAmount)}`;
  } else if (bankUrl) {
    window.open(bankUrl, '_blank', 'noopener');
  }
}

function showBillsAccountTransfer(transferCents) {
  const transferAmount = money(transferCents / 100);
  const bankName = currentUser?.bank === 'huntington' ? 'Huntington'
    : currentUser?.bank === 'keybank' ? 'KeyBank'
      : currentUser?.bank === 'usbank' ? 'U.S. Bank' : '';
  billsTransferSummary.textContent = `Transfer ${transferAmount} to your bills account. This is the portion of the bill that everyone else owes.`;
  billsTransferOpenBank.textContent = bankName ? `Open ${bankName}` : 'Choose a bank in Settings';
  billsTransferOpenBank.disabled = !bankName;
  billsTransferOpenBank.onclick = () => {
    openBankForBillsTransfer(transferCents);
    billsTransferMenu.hidden = true;
  };
  billsTransferMenu.hidden = false;
}

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
    if (category !== 'other' && currentUser?.isDeveloper && paidBy === currentUser.name) {
      const transferCents = billsAccountTransferCents(amount, splitAmong, currentUser.name);
      showBillsAccountTransfer(transferCents);
    }
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
let budgetGraphSaveInProgress = false;
let pendingBudgetGraphCategories = null;

function selectedBudgetGraphCategories() {
  const saved = currentUser?.budgetGraphCategories;
  const selected = Array.isArray(saved) ? saved.filter((category) => GRAPH_CATEGORIES.includes(category)) : [];
  return selected.length ? selected : GRAPH_CATEGORIES;
}

function graphCategoryLabel(category) {
  return BUDGET_CATEGORIES.includes(category) ? budgetCategoryLabel(category) : categoryLabel(category);
}

async function queueBudgetGraphCategorySave(categories) {
  pendingBudgetGraphCategories = categories;
  if (budgetGraphSaveInProgress) return;

  budgetGraphSaveInProgress = true;
  try {
    while (pendingBudgetGraphCategories) {
      const next = pendingBudgetGraphCategories;
      pendingBudgetGraphCategories = null;
      const saved = await saveBudgetGraphCategories(next);
      currentUser = { ...currentUser, budgetGraphCategories: saved };
    }
  } catch (error) {
    pendingBudgetGraphCategories = null;
    alert(error.message || 'Could not save graph settings.');
  } finally {
    budgetGraphSaveInProgress = false;
    renderBudget();
  }
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
      queueBudgetGraphCategorySave(next);
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
    .filter((expense) => ['gas', 'electric', 'internet', 'other'].includes(expenseCategory(expense)))
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
function closeBillsTransferMenu() { billsTransferMenu.hidden = true; }
billsTransferClose.addEventListener('click', closeBillsTransferMenu);
billsTransferNotNow.addEventListener('click', closeBillsTransferMenu);
billsTransferMenu.addEventListener('click', (event) => { if (event.target === billsTransferMenu) closeBillsTransferMenu(); });
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
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
    card.dataset.balanceStatus = cls;
    card.innerHTML = `
      <div class="balance-header">
        <div class="balance-person"><span class="balance-avatar" aria-hidden="true">${escapeHtml(initials)}</span><p class="balance-name">${escapeHtml(name)}</p></div>
        <span class="credit-score">${score}</span>
      </div>
      <p class="balance-amount ${cls}">${money(Math.abs(amt) < 0.005 ? 0 : amt)}</p>
      <p class="balance-caption">${caption}</p>
    `;
    balancesGrid.appendChild(card);
  });
}

function renderBalanceHero(balance) {
  const settlements = computeSettlements(balance);
  const totalOutstanding = Object.values(balance)
    .filter((amount) => amount > 0.005)
    .reduce((sum, amount) => sum + amount, 0);
  const peopleWithBalances = Object.values(balance).filter((amount) => Math.abs(amount) > 0.005).length;
  const activeExpenseCount = state.expenses.filter(isActiveExpense).length;
  const householdSpend = state.expenses.filter(isActiveExpense).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const stats = `<div class="balance-hero-stats"><span><strong>${state.people.length}</strong> ${state.people.length === 1 ? 'roommate' : 'roommates'}</span><span><strong>${activeExpenseCount}</strong> shared entries</span><span><strong>${money(householdSpend)}</strong> logged</span></div>`;
  balanceHero.classList.toggle('is-settled', !settlements.length);

  if (!settlements.length) {
    balanceHero.innerHTML = `<div class="balance-hero-copy"><p class="balance-hero-kicker">House status <span class="balance-hero-live-dot" aria-hidden="true"></span></p><p class="balance-hero-amount">All square</p><p class="balance-hero-detail">No open balances.</p>${stats}</div><div class="balance-hero-mark" aria-hidden="true">✓</div>`;
    return;
  }

  const next = settlements[0];
  balanceHero.innerHTML = `
    <div class="balance-hero-copy">
      <p class="balance-hero-kicker">Open household balance</p>
      <p class="balance-hero-amount">${money(totalOutstanding)}</p>
      <p class="balance-hero-detail">${peopleWithBalances} ${peopleWithBalances === 1 ? 'person has' : 'people have'} an open balance · next: ${escapeHtml(next.from)} pays ${escapeHtml(next.to)}</p>${stats}
    </div>
    <div class="balance-hero-action"><span class="balance-hero-count">${settlements.length} ${settlements.length === 1 ? 'payment' : 'payments'} to clear</span><button id="balance-hero-view" type="button" class="balance-hero-button">View balances <span aria-hidden="true">→</span></button></div>
  `;
  document.getElementById('balance-hero-view')?.addEventListener('click', () => document.getElementById('balance-tab-balances')?.click());
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
    const canPay = currentUser?.isDeveloper || currentUser?.name === t.from;
    li.innerHTML = `
      <div class="settle-route"><span>${escapeHtml(t.from)}</span><span class="arrow" aria-hidden="true">&rarr;</span><span>${escapeHtml(t.to)}</span></div>
      <div class="settle-actions"><span class="amount">${money(t.amount)}</span>${canPay ? '<button type="button" class="settle-pay-button">Pay now <span aria-hidden="true">→</span></button>' : ''}</div>
    `;
    li.querySelector('.settle-pay-button')?.addEventListener('click', () => startSettlementPayment(t));
    settleList.appendChild(li);
  });
}

function startSettlementPayment(settlement) {
  activateTab('pay');
  renderPaymentOptions();
  paymentFrom.value = settlement.from;
  renderPaymentOptions();
  paymentTo.value = settlement.to;
  paymentAmount.value = settlement.amount.toFixed(2);
  paymentDescription.value = 'Settle up';
  updatePaymentLimit();
  document.getElementById('panel-pay')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => paymentDescription.focus(), 350);
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

// A small, dependency-free XLSX writer. XLSX files are ZIP archives containing
// XML, and the ZIP format permits uncompressed entries, which keeps exports
// available even when the installed app is offline.
function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function excelColumnName(index) {
  let name = '';
  for (let number = index + 1; number; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}

function sheetXml(rows, currencyColumns = []) {
  const currency = new Set(currencyColumns);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) => Math.min(45, Math.max(12, ...rows.map((row) => String(row[column] ?? '').length + 2))));
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, column) => {
    const reference = `${excelColumnName(column)}${rowIndex + 1}`;
    if (rowIndex && currency.has(column) && Number.isFinite(Number(value))) return `<c r="${reference}" s="2"><v>${Number(value)}</v></c>`;
    if (rowIndex && typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
    return `<c r="${reference}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const lastCell = `${excelColumnName(columnCount - 1)}${Math.max(rows.length, 1)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${lastCell}"/>` : ''}</worksheet>`;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function createZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const directory = [];
  let offset = 0;
  const number = (value, size) => Array.from({ length: size }, (_, index) => value >>> (index * 8) & 255);
  entries.forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = Uint8Array.from([...number(0x04034b50, 4), 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...number(checksum, 4), ...number(data.length, 4), ...number(data.length, 4), ...number(nameBytes.length, 2), 0, 0, ...nameBytes]);
    chunks.push(local, data);
    directory.push(Uint8Array.from([...number(0x02014b50, 4), 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, ...number(checksum, 4), ...number(data.length, 4), ...number(data.length, 4), ...number(nameBytes.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...number(offset, 4), ...nameBytes]));
    offset += local.length + data.length;
  });
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  const end = Uint8Array.from([...number(0x06054b50, 4), 0, 0, 0, 0, ...number(entries.length, 2), ...number(entries.length, 2), ...number(directorySize, 4), ...number(offset, 4), 0, 0]);
  return new Blob([...chunks, ...directory, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function exportWorkbookSheets() {
  const exportedAt = new Date().toISOString();
  const transactionRows = [['Type', 'Date', 'Month', 'Category', 'Description', 'Amount', 'Paid / From', 'To', 'Split Among', 'Created At', 'Record ID']];
  state.expenses.forEach((expense) => transactionRows.push(['Household expense', expense.date || '', expense.month || String(expense.date || '').slice(0, 7), categoryLabel(expenseCategory(expense)), expense.desc || categoryLabel(expenseCategory(expense)), Number(expense.amount) || 0, expense.paidBy || '', '', (expense.splitAmong || []).join(', '), expense.createdAt || '', expense.id || '']));
  state.settlements.forEach((payment) => transactionRows.push(['Payment', payment.date || '', String(payment.date || '').slice(0, 7), 'Payment', payment.desc || '', Number(payment.amount) || 0, payment.from || '', payment.to || '', '', payment.createdAt || '', payment.id || '']));
  state.budgetExpenses.forEach((expense) => transactionRows.push(['Personal expense', expense.date || '', String(expense.date || '').slice(0, 7), graphCategoryLabel(expense.category), expense.desc || '', Number(expense.amount) || 0, currentUser?.name || '', '', '', expense.createdAt || '', expense.id || '']));
  transactionRows.splice(1, transactionRows.length - 1, ...transactionRows.slice(1).sort((a, b) => String(b[1]).localeCompare(String(a[1]))));

  const receiptRows = [['Receipt Type', 'Date', 'Month', 'Category', 'Description / Store', 'Amount', 'Paid By', 'Split Among', 'Has Photo', 'Record ID']];
  state.expenses.forEach((expense) => receiptRows.push(['Household log', expense.date || '', expense.month || String(expense.date || '').slice(0, 7), categoryLabel(expenseCategory(expense)), expense.desc || categoryLabel(expenseCategory(expense)), Number(expense.amount) || 0, expense.paidBy || '', (expense.splitAmong || []).join(', '), 'No', expense.id || '']));
  state.budgetExpenses.forEach((expense) => receiptRows.push(['Personal log', expense.date || '', String(expense.date || '').slice(0, 7), graphCategoryLabel(expense.category), expense.desc || '', Number(expense.amount) || 0, currentUser?.name || '', '', state.personalReceipts.some((receipt) => receipt.store === expense.desc) ? 'Yes' : 'No', expense.id || '']));
  state.personalReceipts.forEach((receipt) => receiptRows.push(['Receipt photo', String(receipt.createdAt || '').slice(0, 10), String(receipt.createdAt || '').slice(0, 7), '', receipt.store || '', '', currentUser?.name || '', '', 'Yes', receipt.id || '']));

  const householdMonths = new Map();
  state.expenses.filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense))).forEach((expense) => {
    const month = expense.month || String(expense.date || '').slice(0, 7) || 'Unknown';
    if (!householdMonths.has(month)) householdMonths.set(month, { gas: 0, electric: 0, internet: 0 });
    householdMonths.get(month)[expenseCategory(expense)] += Number(expense.amount) || 0;
  });
  const personalMonths = new Map();
  const ensurePersonalMonth = (month) => { if (!personalMonths.has(month)) personalMonths.set(month, Object.fromEntries(GRAPH_CATEGORIES.map((category) => [category, 0]))); return personalMonths.get(month); };
  state.budgetExpenses.forEach((expense) => { ensurePersonalMonth(String(expense.date || '').slice(0, 7) || 'Unknown')[expense.category] += Number(expense.amount) || 0; });
  state.expenses.filter((expense) => ['gas', 'electric', 'internet', 'other'].includes(expenseCategory(expense))).forEach((expense) => {
    const people = Array.isArray(expense.splitAmong) ? expense.splitAmong : [];
    const index = people.indexOf(currentUser?.name);
    if (index < 0 || !people.length) return;
    const cents = Math.round((Number(expense.amount) || 0) * 100);
    const share = Math.floor(cents / people.length) + (index < cents % people.length ? 1 : 0);
    ensurePersonalMonth(expense.month || String(expense.date || '').slice(0, 7) || 'Unknown')[expenseCategory(expense)] += share / 100;
  });
  const graphRows = [['Graph', 'Month', 'Category', 'Amount', 'Included In Current Personal Total']];
  [...householdMonths.entries()].sort().forEach(([month, totals]) => ['gas', 'electric', 'internet'].forEach((category) => graphRows.push(['Household utility totals', month, categoryLabel(category), totals[category], 'Yes'])));
  [...personalMonths.entries()].sort().forEach(([month, totals]) => GRAPH_CATEGORIES.forEach((category) => graphRows.push(['Personal spending', month, graphCategoryLabel(category), totals[category], selectedBudgetGraphCategories().includes(category) ? 'Yes' : 'No'])));

  const balances = computeBalances();
  const balanceRows = [['Person', 'Current Balance', 'Meaning'], ...state.people.map((person) => [person, balances[person] || 0, (balances[person] || 0) > 0 ? 'Is owed money' : (balances[person] || 0) < 0 ? 'Owes money' : 'Settled'])];
  const infoRows = [['Field', 'Value'], ['Exported at', exportedAt], ['Exported by', currentUser?.name || ''], ['Household members', state.people.join(', ')], ['Household expenses', state.expenses.length], ['Payments', state.settlements.length], ['Personal expenses', state.budgetExpenses.length], ['Receipt photos (metadata only)', state.personalReceipts.length], ['Personal graph categories', selectedBudgetGraphCategories().map(graphCategoryLabel).join(', ')], ['Privacy note', 'Receipt images, passwords, session tokens, Venmo details, and banking settings are not included.']];
  return [
    ['All Transactions', transactionRows, [5]],
    ['Receipts Log', receiptRows, [5]],
    ['Graph Data', graphRows, [3]],
    ['Balances', balanceRows, [1]],
    ['Export Info', infoRows, []],
  ];
}

function styleExcelSheet(worksheet, frozenRows = 1) {
  worksheet.views = [{ state: 'frozen', ySplit: frozenRows, activeCell: `A${frozenRows + 1}` }];
  worksheet.properties.defaultRowHeight = 20;
  worksheet.eachRow((row) => { row.alignment = { vertical: 'middle' }; });
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } };
  worksheet.headerFooter.oddFooter = '&LPayMe&C&P of &N&R&D';
  worksheet.properties.pageSetUpPr = { fitToPage: true };
}

function addExcelTitle(worksheet, title, subtitle, lastColumn, tabColor = 'FFBA0C2F') {
  worksheet.mergeCells(`A1:${lastColumn}1`);
  worksheet.mergeCells(`A2:${lastColumn}2`);
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { bold: true, size: 22, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBA0C2F' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  worksheet.getRow(1).height = 34;
  const subtitleCell = worksheet.getCell('A2');
  subtitleCell.value = subtitle;
  subtitleCell.font = { italic: true, size: 10, color: { argb: 'FF5D6268' } };
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2F3' } };
  subtitleCell.alignment = { vertical: 'middle', indent: 1 };
  worksheet.getRow(2).height = 24;
  worksheet.getRow(3).height = 8;
  worksheet.properties.tabColor = { argb: tabColor };
}

function graphTablesFromRows(graphRows) {
  const graphs = new Map();
  graphRows.slice(1).forEach(([graph, month, category, amount]) => {
    if (!graphs.has(graph)) graphs.set(graph, { categories: [], months: new Map() });
    const current = graphs.get(graph);
    if (!current.categories.includes(category)) current.categories.push(category);
    if (!current.months.has(month)) current.months.set(month, {});
    current.months.get(month)[category] = Number(amount) || 0;
  });
  return [...graphs.entries()].map(([name, data]) => ({
    name,
    rows: [['Month', ...data.categories], ...[...data.months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, totals]) => [month, ...data.categories.map((category) => totals[category] || 0)])],
  }));
}

function graphImage(title, rows) {
  const width = 960;
  const height = 420;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#242424';
  context.font = '700 24px Arial';
  context.fillText(title, 36, 38);
  const categories = rows[0].slice(1);
  const data = rows.slice(1);
  const colors = ['#ba0c2f', '#666666', '#f4a261', '#2a9d8f', '#457b9d', '#8f5aa8', '#d4a017', '#4f772d'];
  const totals = data.map((row) => row.slice(1).reduce((sum, value) => sum + Number(value || 0), 0));
  const maximum = Math.max(...totals, 1);
  const plot = { left: 70, top: 78, right: 930, bottom: 340 };
  context.strokeStyle = '#d6d2ca';
  context.fillStyle = '#666666';
  context.font = '12px Arial';
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = plot.bottom - (plot.bottom - plot.top) * tick / 4;
    context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.right, y); context.stroke();
    context.fillText(`$${(maximum * tick / 4).toFixed(0)}`, 18, y + 4);
  }
  const slot = (plot.right - plot.left) / Math.max(data.length, 1);
  data.forEach((row, index) => {
    const barWidth = Math.min(70, slot * 0.58);
    let bottom = plot.bottom;
    row.slice(1).forEach((value, categoryIndex) => {
      const barHeight = (Number(value || 0) / maximum) * (plot.bottom - plot.top);
      context.fillStyle = colors[categoryIndex % colors.length];
      context.fillRect(plot.left + index * slot + (slot - barWidth) / 2, bottom - barHeight, barWidth, barHeight);
      bottom -= barHeight;
    });
    context.fillStyle = '#242424'; context.textAlign = 'center'; context.font = '700 12px Arial';
    context.fillText(`$${totals[index].toFixed(2)}`, plot.left + index * slot + slot / 2, Math.max(plot.top + 12, bottom - 7));
    context.save();
    context.translate(plot.left + index * slot + slot / 2, plot.bottom + 14);
    context.rotate(-Math.PI / 5);
    context.fillStyle = '#444444'; context.textAlign = 'right'; context.font = '12px Arial'; context.fillText(row[0], 0, 0);
    context.restore();
  });
  let legendX = 36;
  categories.forEach((category, index) => {
    context.fillStyle = colors[index % colors.length]; context.fillRect(legendX, 390, 13, 13);
    context.fillStyle = '#333333'; context.font = '12px Arial'; context.fillText(category, legendX + 18, 401);
    legendX += context.measureText(category).width + 48;
  });
  return canvas.toDataURL('image/png');
}

async function receiptImageForExcel(dataUrl) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
  const isSupported = /^data:image\/(png|jpeg);base64,/i.test(dataUrl);
  if (isSupported) return { base64: dataUrl, extension: dataUrl.startsWith('data:image/png') ? 'png' : 'jpeg', width: image.naturalWidth, height: image.naturalHeight };
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return { base64: canvas.toDataURL('image/png'), extension: 'png', width: image.naturalWidth, height: image.naturalHeight };
}

function excelMonthLabel(month) {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(month || 'Unknown') : date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function personalShareAmount(expense) {
  const people = Array.isArray(expense.splitAmong) ? expense.splitAmong : [];
  const index = people.indexOf(currentUser?.name);
  if (index < 0 || !people.length) return null;
  const cents = Math.round((Number(expense.amount) || 0) * 100);
  return (Math.floor(cents / people.length) + (index < cents % people.length ? 1 : 0)) / 100;
}

async function exportToExcel() {
  const sourceSheets = exportWorkbookSheets();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PayMe';
  workbook.created = new Date();

  const logRows = [['Type', 'Date', 'Month', 'Category', 'Description', 'My Amount', 'Paid To / Paid By']];
  state.budgetExpenses.forEach((expense) => logRows.push(['Personal expense', expense.date || '', excelMonthLabel(String(expense.date || '').slice(0, 7)), graphCategoryLabel(expense.category), expense.desc || '', Number(expense.amount) || 0, '']));
  state.expenses.forEach((expense) => {
    const share = personalShareAmount(expense);
    if (share === null) return;
    logRows.push(['Shared expense share', expense.date || '', excelMonthLabel(expense.month || String(expense.date || '').slice(0, 7)), graphCategoryLabel(expenseCategory(expense)), expense.desc || graphCategoryLabel(expenseCategory(expense)), share, expense.paidBy || '']);
  });
  state.settlements.filter((payment) => payment.from === currentUser?.name).forEach((payment) => logRows.push(['Payment sent', payment.date || '', excelMonthLabel(String(payment.date || '').slice(0, 7)), 'Payment', payment.desc || '', Number(payment.amount) || 0, payment.to || '']));
  logRows.splice(1, logRows.length - 1, ...logRows.slice(1).sort((a, b) => String(b[1]).localeCompare(String(a[1]))));
  const logSheet = workbook.addWorksheet('Transaction Log');
  addExcelTitle(logSheet, 'MY TRANSACTION LOG', `${currentUser?.name || 'My'} personal spending · exported ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 'G');
  logSheet.addTable({ name: 'PayMeTransactionLog', ref: 'A4', headerRow: true, style: { theme: 'TableStyleMedium2', showRowStripes: true }, columns: logRows[0].map((name) => ({ name })), rows: logRows.slice(1) });
  [22, 13, 20, 18, 30, 14, 22].forEach((width, index) => { logSheet.getColumn(index + 1).width = width; });
  logSheet.getColumn(6).numFmt = '$#,##0.00;[Red]-$#,##0.00';
  styleExcelSheet(logSheet, 4);

  const graphSource = sourceSheets.find(([name]) => name === 'Graph Data')[1];
  const visibleGraphSource = [graphSource[0], ...graphSource.slice(1).filter((row) => row[0] !== 'Personal spending' || row[4] === 'Yes')];
  const graphTables = graphTablesFromRows(visibleGraphSource).map((graph) => ({ ...graph, rows: [graph.rows[0], ...graph.rows.slice(1).map((row) => [excelMonthLabel(row[0]), ...row.slice(1)])] }));
  const personalGraph = graphTables.find((graph) => graph.name === 'Personal spending');
  const graphSheet = workbook.addWorksheet('Graphs');
  addExcelTitle(graphSheet, 'MY SPENDING GRAPHS', 'Monthly totals use the same selected categories as the Personal Budget graph in PayMe.', 'J', 'FF4D5968');
  graphSheet.getColumn(1).width = 16;
  for (let column = 2; column <= 10; column += 1) graphSheet.getColumn(column).width = 14;
  if (personalGraph) {
    graphSheet.addTable({ name: 'PayMePersonalGraph', ref: 'A4', headerRow: true, style: { theme: 'TableStyleMedium2', showRowStripes: true }, columns: personalGraph.rows[0].map((name) => ({ name })), rows: personalGraph.rows.slice(1) });
    for (let column = 2; column <= personalGraph.rows[0].length; column += 1) graphSheet.getColumn(column).numFmt = '$#,##0.00';
    const chartTop = 5 + personalGraph.rows.length;
    const imageId = workbook.addImage({ base64: graphImage('My monthly spending', personalGraph.rows), extension: 'png' });
    graphSheet.addImage(imageId, { tl: { col: 0, row: chartTop - 1 }, ext: { width: 960, height: 420 } });
  } else graphSheet.getCell('A4').value = 'No personal spending has been recorded yet.';
  styleExcelSheet(graphSheet, 4);

  const utilityRows = [['Date', 'Month', 'Utility', 'Description', 'Bill Amount', 'Paid By', 'Split Among']];
  state.expenses.filter((expense) => ['gas', 'electric', 'internet'].includes(expenseCategory(expense))).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).forEach((expense) => utilityRows.push([expense.date || '', excelMonthLabel(expense.month || String(expense.date || '').slice(0, 7)), categoryLabel(expenseCategory(expense)), expense.desc || categoryLabel(expenseCategory(expense)), Number(expense.amount) || 0, expense.paidBy || '', (expense.splitAmong || []).join(', ')]));
  const utilitySheet = workbook.addWorksheet('Utilities');
  addExcelTitle(utilitySheet, 'HOUSEHOLD UTILITIES', 'Gas, electric, and internet bills with monthly totals.', 'G', 'FF4D5968');
  utilitySheet.addTable({ name: 'PayMeUtilities', ref: 'A4', headerRow: true, style: { theme: 'TableStyleMedium4', showRowStripes: true }, columns: utilityRows[0].map((name) => ({ name })), rows: utilityRows.slice(1) });
  [13, 20, 15, 24, 14, 18, 34].forEach((width, index) => { utilitySheet.getColumn(index + 1).width = width; });
  utilitySheet.getColumn(5).numFmt = '$#,##0.00;[Red]-$#,##0.00';
  styleExcelSheet(utilitySheet, 4);
  const utilityGraph = graphTables.find((graph) => graph.name === 'Household utility totals');
  if (utilityGraph) {
    const utilityChartTop = utilityRows.length + 6;
    utilitySheet.getCell(utilityChartTop, 1).value = 'Monthly utility totals';
    utilitySheet.getCell(utilityChartTop, 1).font = { bold: true, size: 18, color: { argb: 'FFBA0C2F' } };
    const imageId = workbook.addImage({ base64: graphImage('Monthly utility totals', utilityGraph.rows), extension: 'png' });
    utilitySheet.addImage(imageId, { tl: { col: 0, row: utilityChartTop + 1 }, ext: { width: 960, height: 420 } });
  }

  const receiptSheet = workbook.addWorksheet('Receipt Images');
  receiptSheet.columns = Array.from({ length: 15 }, () => ({ width: 11 }));
  addExcelTitle(receiptSheet, 'SAVED RECEIPTS', 'Original receipt images from your personal expense log.', 'O', 'FFD69E2E');
  if (!state.personalReceipts.length) receiptSheet.getCell('A4').value = 'No receipt images have been saved yet.';
  for (let index = 0; index < state.personalReceipts.length; index += 1) {
    const receipt = state.personalReceipts[index];
    const column = index % 2 ? 9 : 1;
    const row = 4 + Math.floor(index / 2) * 34;
    receiptSheet.getCell(row, column).value = receipt.store || 'Receipt';
    receiptSheet.mergeCells(row, column, row, column + 5);
    receiptSheet.getCell(row, column).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    receiptSheet.getCell(row, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4D5968' } };
    receiptSheet.getCell(row, column).alignment = { vertical: 'middle', indent: 1 };
    receiptSheet.getRow(row).height = 26;
    receiptSheet.mergeCells(row + 1, column, row + 1, column + 5);
    receiptSheet.getCell(row + 1, column).value = String(receipt.createdAt || '').slice(0, 10);
    receiptSheet.getCell(row + 1, column).font = { italic: true, color: { argb: 'FF5D6268' } };
    receiptSheet.getCell(row + 1, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2F3' } };
    receiptSheet.getCell(row + 1, column).alignment = { vertical: 'middle', indent: 1 };
    try {
      const image = await receiptImageForExcel(receipt.image);
      const maximumWidth = 470;
      const maximumHeight = 570;
      const scale = Math.min(maximumWidth / image.width, maximumHeight / image.height, 1);
      const imageId = workbook.addImage({ base64: image.base64, extension: image.extension });
      receiptSheet.addImage(imageId, { tl: { col: column - 1, row: row + 1 }, ext: { width: image.width * scale, height: image.height * scale } });
    } catch (error) {
      receiptSheet.getCell(row + 3, column).value = 'This receipt image could not be included.';
    }
  }
  styleExcelSheet(receiptSheet, 3);

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `PayMe-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let excelLibraryPromise = null;
function ensureExcelLibrary() {
  if (window.ExcelJS) return Promise.resolve();
  if (excelLibraryPromise) return excelLibraryPromise;
  excelLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${API_BASE}/exceljs.min.js`;
    script.onload = () => window.ExcelJS ? resolve() : reject(new Error('Excel library did not initialize.'));
    script.onerror = () => reject(new Error('Could not load the Excel export library.'));
    document.head.appendChild(script);
  });
  return excelLibraryPromise;
}

exportExcelButton.addEventListener('click', async () => {
  exportExcelButton.disabled = true;
  exportExcelButton.textContent = 'Preparing…';
  try {
    await ensureExcelLibrary();
    await exportToExcel();
  } catch (error) {
    console.error('Excel export failed.', error);
    alert(error.message || 'Could not create the Excel export. Please try again.');
  } finally {
    exportExcelButton.disabled = false;
    exportExcelButton.textContent = 'Export to Excel';
  }
});

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

accountPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accountPasswordError.hidden = true;
  try {
    const response = await apiFetch('/api/auth/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: accountCurrentPassword.value, newPassword: accountNewPassword.value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not update password.');
    saveSessionToken(payload.sessionToken, false);
    accountPasswordForm.reset();
  } catch (error) {
    accountPasswordError.textContent = error.message || 'Could not update password.';
    accountPasswordError.hidden = false;
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

async function loadDeveloperInviteCode() {
  const response = await apiFetch('/api/developer/invite-code');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Could not load the household invite code.');
  developerInviteCode.value = payload.inviteCode || '';
  developerInviteCode.disabled = payload.managedByEnvironment;
  developerInviteForm.querySelector('button[type="submit"]').disabled = payload.managedByEnvironment;
  developerInviteCopy.disabled = !payload.inviteCode;
  developerInviteNote.textContent = payload.managedByEnvironment
    ? 'This code is currently managed by the server environment settings.'
    : payload.inviteCode ? 'The code is active. You can copy it or replace it here.' : 'No invite code exists yet. Create one to allow new roommate accounts.';
}

developerInviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showDeveloperError();
  try {
    const response = await apiFetch('/api/developer/invite-code', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode: developerInviteCode.value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not save the household invite code.');
    await loadDeveloperInviteCode();
    developerInviteNote.textContent = 'Invite code saved and ready to share.';
  } catch (error) { showDeveloperError(error.message || 'Could not save the household invite code.'); }
});

developerInviteCopy.addEventListener('click', async () => {
  if (!developerInviteCode.value) return;
  try {
    await navigator.clipboard.writeText(developerInviteCode.value);
    developerInviteNote.textContent = 'Invite code copied.';
  } catch (error) {
    developerInviteCode.select();
    document.execCommand('copy');
    developerInviteNote.textContent = 'Invite code copied.';
  }
});

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
    const [response] = await Promise.all([
      apiFetch('/api/developer/accounts'),
      loadDeveloperInviteCode(),
    ]);
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
  authPassword.minLength = isSignUp ? 12 : 8;
  authInviteField.hidden = !isSignUp;
  authInviteCode.required = isSignUp;
  if (!isSignUp) authInviteCode.value = '';
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
      body: JSON.stringify({ name: authUsername.value.trim(), password: authPassword.value, inviteCode: authInviteCode.value, remember: authRemember.checked }),
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

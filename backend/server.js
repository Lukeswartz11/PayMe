import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import webpush from 'web-push';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const dataPath = path.resolve(__dirname, 'data.json');
const publicRoot = path.resolve(__dirname, '..');
const firebaseDbUrl = process.env.FIREBASE_DATABASE_URL?.replace(/\/$/, '');
const firebaseServiceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const reminderCronSecret = process.env.REMINDER_CRON_SECRET || '';
const developerAccountName = process.env.DEVELOPER_ACCOUNT_NAME || 'Luke';
const developerAccountPassword = process.env.DEVELOPER_ACCOUNT_PASSWORD || '';
const backupCronSecret = process.env.BACKUP_CRON_SECRET || '';
const householdInviteCode = process.env.HOUSEHOLD_INVITE_CODE || '';
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://lukeswartz11.github.io,https://payme-9w80.onrender.com,http://localhost:3000,http://localhost:5500').split(',').map((origin) => origin.trim()).filter(Boolean));
const publicAssetPaths = new Set(['/', '/index.html', '/app.js', '/style.css', '/manifest.webmanifest', '/push-sw.js', '/Brutus_Front.png', '/brutus_back.jpg']);
const legacyStarterPeople = ['Luke', 'Andrew', 'Logan', 'Kai', 'Carson', 'conner'];
const maxAccounts = 6;
let firebaseAccessToken = null;
let firebaseAccessTokenExpiresAt = 0;
const authAttempts = new Map();

function getFirebaseServiceAccount() {
  if (!firebaseDbUrl) return null;
  if (!firebaseServiceAccountRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required when FIREBASE_DATABASE_URL is set.');
  try {
    const serviceAccount = JSON.parse(firebaseServiceAccountRaw);
    if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('Missing client_email or private_key.');
    return serviceAccount;
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ${error.message}`);
  }
}

const firebaseServiceAccount = getFirebaseServiceAccount();

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function getFirebaseAccessToken() {
  if (!firebaseServiceAccount) return null;
  if (firebaseAccessToken && Date.now() < firebaseAccessTokenExpiresAt) return firebaseAccessToken;

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: firebaseServiceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: firebaseServiceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsignedToken = `${header}.${claim}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsignedToken).end().sign(firebaseServiceAccount.private_key, 'base64url');
  const response = await fetch(firebaseServiceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || 'Could not authenticate with Firebase.');
  firebaseAccessToken = payload.access_token;
  firebaseAccessTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000;
  return firebaseAccessToken;
}

async function firebaseFetch(pathname, options = {}) {
  const token = await getFirebaseAccessToken();
  return fetch(`${firebaseDbUrl}${pathname}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
}

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails('mailto:admin@payluke.app', vapidPublicKey, vapidPrivateKey);
}

const defaultData = {
  people: [],
  expenses: [],
  settlements: [],
  budgetExpenses: [],
  personalReceipts: [],
  users: [],
};

app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()',
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store, private, max-age=0');
  next();
});
app.use(cors({ origin(origin, callback) { callback(null, !origin || allowedOrigins.has(origin)); }, credentials: false, allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (!publicAssetPaths.has(req.path)) return res.status(404).end();
  next();
});
app.use(express.static(publicRoot, { dotfiles: 'deny', index: 'index.html', maxAge: '1h', etag: true }));

function authRateLimit(req, res, next) {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const entry = authAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  entry.count += 1;
  authAttempts.set(key, entry);
  if (authAttempts.size > 10000) authAttempts.clear();
  if (entry.count > 10) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  next();
}

async function readData() {
  if (firebaseDbUrl) {
    const response = await firebaseFetch('/state.json', { headers: { 'X-Firebase-ETag': 'true' } });
    if (!response.ok) throw new Error(`Firebase read failed: ${response.status}`);
    const value = await response.text();
    const data = !value || value === 'null' ? normalizeData(defaultData) : normalizeData(JSON.parse(value));
    Object.defineProperty(data, '__firebaseEtag', { value: response.headers.get('etag'), writable: true, enumerable: false });
    return data;
  }

  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to read data.json:', error);
    if (error.code === 'ENOENT' || error.name === 'SyntaxError') {
      await writeData(defaultData);
      return defaultData;
    }
    throw error;
  }
}

function normalizeData(data) {
  return {
    ...defaultData,
    ...data,
    people: Array.isArray(data?.people) ? data.people : defaultData.people,
    expenses: Array.isArray(data?.expenses) ? data.expenses : [],
    settlements: Array.isArray(data?.settlements) ? data.settlements : [],
    budgetExpenses: Array.isArray(data?.budgetExpenses) ? data.budgetExpenses : [],
    personalReceipts: Array.isArray(data?.personalReceipts) ? data.personalReceipts : [],
    users: Array.isArray(data?.users) ? data.users : [],
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function validPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const hash = crypto.scryptSync(password, user.salt, 64);
  return crypto.timingSafeEqual(hash, Buffer.from(user.passwordHash, 'hex'));
}

function getUserLoginName(user) {
  return String(user.name || user.username || '').trim().toLowerCase();
}

function strongPassword(password) {
  return password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

function secretMatches(value, expected) {
  const actual = Buffer.from(String(value));
  const target = Buffer.from(expected);
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}

function publicUser(user) {
  return { id: user.id, name: user.name || '', isDeveloper: Boolean(user.isDeveloper), zelle: user.zelle || '', venmo: user.venmo || '', bank: user.bank || '', budgetGraphCategories: Array.isArray(user.budgetGraphCategories) ? user.budgetGraphCategories : null };
}

function validName(name) {
  return /^[a-zA-Z][a-zA-Z '-]{0,30}$/.test(name);
}

function pushIsConfigured() {
  return Boolean(vapidPublicKey && vapidPrivateKey);
}

async function sendPushToUser(user, payload) {
  if (!pushIsConfigured() || !Array.isArray(user.pushSubscriptions)) return false;
  let delivered = false;
  const activeSubscriptions = [];
  for (const subscription of user.pushSubscriptions) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      activeSubscriptions.push(subscription);
      delivered = true;
    } catch (error) {
      if (error.statusCode !== 404 && error.statusCode !== 410) activeSubscriptions.push(subscription);
      console.warn('Push delivery failed:', error.statusCode || error.message);
    }
  }
  user.pushSubscriptions = activeSubscriptions;
  return delivered;
}

function expenseReminderRecipients(data, expense) {
  const splitAmong = Array.isArray(expense.splitAmong) ? expense.splitAmong : [];
  const totalCents = Math.round(Number(expense.amount) * 100);
  const baseShareCents = splitAmong.length ? Math.floor(totalCents / splitAmong.length) : 0;
  const remainder = splitAmong.length ? totalCents - baseShareCents * splitAmong.length : 0;
  return splitAmong
    .map((name, index) => ({ name, amountCents: baseShareCents + (index < remainder ? 1 : 0) }))
    .filter(({ name }) => name !== expense.paidBy)
    .map(({ name, amountCents }) => ({ user: data.users.find((user) => user.name === name), amountCents }))
    .filter(({ user }) => user)
    .map(({ user, amountCents }) => ({ userId: user.id, name: user.name, amount: amountCents / 100, dueAt: Date.now() + 24 * 60 * 60 * 1000, reminderSentAt: null }));
}

function reminderBalancesForPair(data, debtor, creditor) {
  const debts = [];
  for (const expense of data.expenses) {
    if (expense.paidBy !== creditor || !Array.isArray(expense.splitAmong)) continue;
    const debtorIndex = expense.splitAmong.indexOf(debtor);
    if (debtorIndex < 0 || debtor === creditor || !expense.splitAmong.length) continue;
    const totalCents = Math.round(Number(expense.amount) * 100);
    const baseShareCents = Math.floor(totalCents / expense.splitAmong.length);
    const remainder = totalCents - baseShareCents * expense.splitAmong.length;
    debts.push({
      expenseId: expense.id,
      createdAt: new Date(expense.createdAt || 0).getTime(),
      remainingCents: baseShareCents + (debtorIndex < remainder ? 1 : 0)
    });
  }
  debts.sort((a, b) => a.createdAt - b.createdAt);

  const payments = data.settlements
    .filter((payment) => payment.from === debtor && payment.to === creditor)
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  for (const payment of payments) {
    const paidAt = new Date(payment.createdAt || 0).getTime();
    let paymentCents = Math.round(Number(payment.amount) * 100);
    for (const debt of debts) {
      if (paymentCents <= 0) break;
      if (debt.createdAt > paidAt || debt.remainingCents <= 0) continue;
      const appliedCents = Math.min(paymentCents, debt.remainingCents);
      debt.remainingCents -= appliedCents;
      paymentCents -= appliedCents;
    }
  }
  return new Map(debts.map((debt) => [debt.expenseId, debt.remainingCents / 100]));
}

function householdBalanceCents(data) {
  const balances = Object.fromEntries(data.people.map((name) => [name, 0]));
  for (const expense of data.expenses) {
    if (!(expense.paidBy in balances) || !Array.isArray(expense.splitAmong) || !expense.splitAmong.length) continue;
    const totalCents = Math.round(Number(expense.amount) * 100);
    const baseShareCents = Math.floor(totalCents / expense.splitAmong.length);
    const remainder = totalCents - baseShareCents * expense.splitAmong.length;
    expense.splitAmong.forEach((name, index) => {
      if (name === expense.paidBy || !(name in balances)) return;
      const shareCents = baseShareCents + (index < remainder ? 1 : 0);
      balances[expense.paidBy] += shareCents;
      balances[name] -= shareCents;
    });
  }
  for (const payment of data.settlements) {
    if (!(payment.from in balances) || !(payment.to in balances)) continue;
    const amountCents = Math.round(Number(payment.amount) * 100);
    balances[payment.from] += amountCents;
    balances[payment.to] -= amountCents;
  }
  return balances;
}

function prepareHousehold(data) {
  if (developerAccountPassword && !strongPassword(developerAccountPassword)) throw new Error('DEVELOPER_ACCOUNT_PASSWORD must use 12+ characters with uppercase, lowercase, and a number.');
  if (householdInviteCode && householdInviteCode.length < 12) throw new Error('HOUSEHOLD_INVITE_CODE must be at least 12 characters.');
  let changed = false;
  const isUntouchedLegacyHousehold = data.people.length === legacyStarterPeople.length && legacyStarterPeople.every((person, index) => data.people[index] === person) && data.expenses.length === 0 && data.settlements.length === 0;
  if (isUntouchedLegacyHousehold) {
    data.people = [];
    changed = true;
  }
  const developerUser = data.users.find((user) => getUserLoginName(user) === developerAccountName.toLowerCase());
  if (!developerUser && developerAccountPassword) {
    const { salt, hash } = hashPassword(developerAccountPassword);
    data.users.push({ id: crypto.randomUUID(), name: developerAccountName, isDeveloper: true, salt, passwordHash: hash, createdAt: new Date().toISOString() });
    changed = true;
  } else if (developerUser && !developerUser.isDeveloper && developerAccountPassword) {
    developerUser.isDeveloper = true;
    changed = true;
  }
  if (developerUser && !developerAccountPassword) {
    if (developerUser.isDeveloper || developerUser.salt || developerUser.passwordHash || (developerUser.authSessions || []).length) {
      developerUser.isDeveloper = false;
      developerUser.salt = '';
      developerUser.passwordHash = '';
      developerUser.authSessions = [];
      changed = true;
    }
  }
  if (developerUser && developerAccountPassword && !validPassword(developerAccountPassword, developerUser)) {
    const { salt, hash } = hashPassword(developerAccountPassword);
    developerUser.salt = salt;
    developerUser.passwordHash = hash;
    developerUser.authSessions = [];
    changed = true;
  }
  if ((developerUser || developerAccountPassword) && !data.people.some((person) => person.toLowerCase() === developerAccountName.toLowerCase())) {
    data.people.push(developerAccountName);
    changed = true;
  }
  return changed;
}

async function readPreparedData() {
  const data = await readData();
  if (prepareHousehold(data)) await writeData(data);
  return data;
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(user, response, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const activeSessions = Array.isArray(user.authSessions)
    ? user.authSessions.filter((session) => Number.isFinite(session.expiresAt) && session.expiresAt > now)
    : [];
  user.authSessions = [...activeSessions.slice(-9), {
    tokenHash: sessionTokenHash(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + (remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000),
  }];
  return token;
}

async function requireAuth(request, response, next) {
  try {
    const authorization = request.get('authorization') || '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    if (!token) return response.status(401).json({ error: 'Sign in required.' });
    const tokenHash = sessionTokenHash(token);
    const data = await readPreparedData();
    const now = Date.now();
    const user = data.users.find((candidate) => Array.isArray(candidate.authSessions) && candidate.authSessions.some((session) => session.tokenHash === tokenHash && Number.isFinite(session.expiresAt) && session.expiresAt > now));
    if (!user) return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    request.userId = user.id;
    request.sessionTokenHash = tokenHash;
    next();
  } catch (error) {
    console.error('Session authorization error:', error);
    response.status(500).json({ error: 'Could not verify your session.' });
  }
}

async function requireDeveloper(request, response, next) {
  try {
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === request.userId);
    if (!user?.isDeveloper) return response.status(403).json({ error: 'Developer access required.' });
    request.developer = user;
    next();
  } catch (error) {
    console.error('Developer authorization error:', error);
    response.status(500).json({ error: 'Could not verify developer access.' });
  }
}

async function writeData(data) {
  if (firebaseDbUrl) {
    const response = await firebaseFetch('/state.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': data.__firebaseEtag || '*' },
      body: JSON.stringify(data),
    });
    if (response.status === 412) throw new Error('Data changed on another device. Refresh and try again.');
    if (!response.ok) throw new Error(`Firebase write failed: ${response.status}`);
    return;
  }

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
}

app.post('/api/auth/signup', authRateLimit, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (!validName(name)) return res.status(400).json({ error: 'Enter a valid first name.' });
    if (!householdInviteCode) return res.status(503).json({ error: 'Registration is closed until the household invite code is configured.' });
    if (!secretMatches(req.body?.inviteCode || '', householdInviteCode)) return res.status(403).json({ error: 'That household invite code is not correct.' });
    if (!strongPassword(password)) return res.status(400).json({ error: 'Use 12+ characters with uppercase, lowercase, and a number.' });
    const data = await readPreparedData();
    if (data.users.length >= maxAccounts) return res.status(403).json({ error: 'This household already has the maximum of 6 accounts.' });
    if (data.users.some((user) => getUserLoginName(user) === name.toLowerCase())) return res.status(409).json({ error: 'An account already uses that first name.' });
    const { salt, hash } = hashPassword(password);
    const user = { id: crypto.randomUUID(), name, salt, passwordHash: hash, createdAt: new Date().toISOString() };
    data.users.push(user);
    if (!data.people.some((person) => person.toLowerCase() === name.toLowerCase())) data.people.push(name);
    const sessionToken = createSession(user, res, Boolean(req.body?.remember));
    await writeData(data);
    res.status(201).json({ user: publicUser(user), sessionToken });
  } catch (error) {
    console.error('POST /api/auth/signup error:', error);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/signin', authRateLimit, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const data = await readPreparedData();
    const user = data.users.find((candidate) => getUserLoginName(candidate) === name.toLowerCase());
    if (!user || !validPassword(password, user)) return res.status(401).json({ error: 'Incorrect first name or password.' });
    const sessionToken = createSession(user, res, Boolean(req.body?.remember));
    await writeData(data);
    res.json({ user: publicUser(user), sessionToken });
  } catch (error) {
    console.error('POST /api/auth/signin error:', error);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const data = await readPreparedData();
  const user = data.users.find((candidate) => candidate.id === req.userId);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: publicUser(user) });
});

app.put('/api/auth/payment-info', requireAuth, async (req, res) => {
  try {
    const type = String(req.body?.type || '');
    const value = String(req.body?.value || '').trim();
    if (!['zelle', 'venmo', 'bank'].includes(type)) return res.status(400).json({ error: 'Invalid payment method.' });
    if (!value || value.length > 100) return res.status(400).json({ error: 'Enter valid payment information.' });
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (type === 'bank' && !['huntington', 'keybank', 'usbank'].includes(value)) return res.status(400).json({ error: 'Unsupported banking app.' });
    user[type] = type === 'venmo' ? value.replace(/^@/, '') : value;
    await writeData(data);
    res.json({ zelle: user.zelle || '', venmo: user.venmo || '', bank: user.bank || '' });
  } catch (error) {
    console.error('PUT /api/auth/payment-info error:', error);
    res.status(500).json({ error: 'Could not save payment information.' });
  }
});

app.get('/api/payment-info/:name', requireAuth, async (req, res) => {
  try {
    const data = await readPreparedData();
    const name = decodeURIComponent(req.params.name).toLowerCase();
    const user = data.users.find((candidate) => String(candidate.name || '').toLowerCase() === name);
    if (!user) return res.status(404).json({ error: 'Recipient account not found.' });
    res.json({ name: user.name, zelle: user.zelle || '', venmo: user.venmo || '', bank: user.bank || '' });
  } catch (error) {
    res.status(500).json({ error: 'Could not load payment information.' });
  }
});

app.put('/api/auth/account', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!validName(name)) return res.status(400).json({ error: 'Enter a valid first name.' });
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (user.isDeveloper) return res.status(403).json({ error: 'The developer account name cannot be changed here.' });
    if (data.users.some((candidate) => candidate.id !== user.id && getUserLoginName(candidate) === name.toLowerCase())) return res.status(409).json({ error: 'An account already uses that first name.' });
    const oldName = user.name;
    user.name = name;
    if (oldName !== name) {
      data.people = data.people.map((person) => person === oldName ? name : person);
      data.expenses.forEach((expense) => {
        if (expense.paidBy === oldName) expense.paidBy = name;
        if (Array.isArray(expense.splitAmong)) expense.splitAmong = expense.splitAmong.map((person) => person === oldName ? name : person);
      });
      data.settlements.forEach((settlement) => {
        if (settlement.from === oldName) settlement.from = name;
        if (settlement.to === oldName) settlement.to = name;
      });
    }
    await writeData(data);
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('PUT /api/auth/account error:', error);
    res.status(500).json({ error: 'Could not update account.' });
  }
});

app.get('/api/developer/accounts', requireAuth, requireDeveloper, async (req, res) => {
  const data = await readPreparedData();
  res.json({ accounts: data.users.map((user) => ({ id: user.id, name: user.name, isDeveloper: Boolean(user.isDeveloper), createdAt: user.createdAt })) });
});

app.put('/api/developer/accounts/:id', requireAuth, requireDeveloper, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (!validName(name)) return res.status(400).json({ error: 'Enter a valid first name.' });
    if (password && !strongPassword(password)) return res.status(400).json({ error: 'Use 12+ characters with uppercase, lowercase, and a number.' });
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (user.isDeveloper) return res.status(403).json({ error: 'The developer account cannot be changed here.' });
    if (data.users.some((candidate) => candidate.id !== user.id && getUserLoginName(candidate) === name.toLowerCase())) return res.status(409).json({ error: 'An account already uses that first name.' });
    const oldName = user.name;
    user.name = name;
    if (password) {
      const { salt, hash } = hashPassword(password);
      user.salt = salt;
      user.passwordHash = hash;
    }
    if (oldName !== name) {
      data.people = data.people.map((person) => person === oldName ? name : person);
      data.expenses.forEach((expense) => {
        if (expense.paidBy === oldName) expense.paidBy = name;
        if (Array.isArray(expense.splitAmong)) expense.splitAmong = expense.splitAmong.map((person) => person === oldName ? name : person);
      });
      data.settlements.forEach((settlement) => {
        if (settlement.from === oldName) settlement.from = name;
        if (settlement.to === oldName) settlement.to = name;
      });
    }
    await writeData(data);
    res.json({ account: { id: user.id, name: user.name, isDeveloper: false } });
  } catch (error) {
    console.error('PUT /api/developer/accounts error:', error);
    res.status(500).json({ error: 'Could not update account.' });
  }
});

app.delete('/api/developer/accounts/:id', requireAuth, requireDeveloper, async (req, res) => {
  try {
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (user.isDeveloper) return res.status(403).json({ error: 'The developer account cannot be deleted.' });
    data.users = data.users.filter((candidate) => candidate.id !== user.id);
    data.budgetExpenses = data.budgetExpenses.filter((expense) => expense.ownerId !== user.id);
    data.people = data.people.filter((person) => person !== user.name);
    data.expenses.forEach((expense) => {
      if (expense.paidBy === user.name) expense.reminders = [];
    });
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    console.error('DELETE /api/developer/accounts error:', error);
    res.status(500).json({ error: 'Could not delete account.' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    if (user) {
      user.authSessions = (user.authSessions || []).filter((session) => session.tokenHash !== req.sessionTokenHash);
      await writeData(data);
    }
    res.clearCookie('payme_session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.status(204).end();
  } catch (error) {
    console.error('POST /api/auth/logout error:', error);
    res.status(500).json({ error: 'Could not sign out.' });
  }
});

app.put('/api/auth/password', requireAuth, authRateLimit, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (user.isDeveloper) return res.status(403).json({ error: 'Update the developer password through Render environment variables.' });
    if (!validPassword(currentPassword, user)) return res.status(401).json({ error: 'Your current password is not correct.' });
    if (!strongPassword(newPassword)) return res.status(400).json({ error: 'Use 12+ characters with uppercase, lowercase, and a number.' });
    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.passwordHash = hash;
    user.authSessions = [];
    const sessionToken = createSession(user, res, false);
    await writeData(data);
    res.json({ sessionToken });
  } catch (error) {
    console.error('PUT /api/auth/password error:', error);
    res.status(500).json({ error: 'Could not update password.' });
  }
});

app.get('/api/push/public-key', requireAuth, (req, res) => {
  if (!pushIsConfigured()) return res.status(503).json({ error: 'Phone notifications have not been configured yet.' });
  res.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    if (!pushIsConfigured()) return res.status(503).json({ error: 'Phone notifications have not been configured yet.' });
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return res.status(400).json({ error: 'Invalid phone notification subscription.' });
    const data = await readPreparedData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    const subscriptions = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions : [];
    user.pushSubscriptions = [...subscriptions.filter((candidate) => candidate.endpoint !== subscription.endpoint), subscription];
    await writeData(data);
    res.status(201).json({ subscribed: true });
  } catch (error) {
    console.error('POST /api/push/subscribe error:', error);
    res.status(500).json({ error: 'Could not enable phone notifications.' });
  }
});

async function sendDueReminders() {
  const data = await readPreparedData();
  let changed = false;
  const pairBalances = new Map();
  const balances = householdBalanceCents(data);
  for (const expense of data.expenses) {
    for (const reminder of expense.reminders || []) {
      const pairKey = `${reminder.name}\u0000${expense.paidBy}`;
      if (!pairBalances.has(pairKey)) pairBalances.set(pairKey, reminderBalancesForPair(data, reminder.name, expense.paidBy));
      const requestRemaining = Math.max(0, pairBalances.get(pairKey).get(expense.id) ?? Number(reminder.amount));
      const accountDebt = Math.max(0, -(balances[reminder.name] || 0) / 100);
      const creditorBalance = Math.max(0, (balances[expense.paidBy] || 0) / 100);
      const remaining = Math.min(requestRemaining, accountDebt, creditorBalance);
      if (reminder.reminderSentAt || reminder.dueAt > Date.now() || remaining < 0.005) continue;
      const user = data.users.find((candidate) => candidate.id === reminder.userId);
      if (!user) continue;
      const subscriptionCount = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions.length : 0;
      const delivered = await sendPushToUser(user, { title: 'Payment reminder', body: `You still owe ${expense.paidBy} $${remaining.toFixed(2)}. Please pay them or log your payment in Pay Up.`, url: '/', tag: `payment-reminder-${expense.id}` });
      if ((user.pushSubscriptions?.length || 0) !== subscriptionCount) changed = true;
      if (delivered) {
        reminder.reminderSentAt = new Date().toISOString();
        changed = true;
      }
    }
  }
  if (changed) await writeData(data);
}

app.post('/api/push/reminders/run', async (req, res) => {
  if (!reminderCronSecret || req.get('x-reminder-secret') !== reminderCronSecret) return res.status(401).json({ error: 'Unauthorized reminder job.' });
  try {
    await sendDueReminders();
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/push/reminders/run error:', error);
    res.status(500).json({ error: 'Could not send payment reminders.' });
  }
});

app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    res.json({ people: data.people, expenses: data.expenses, settlements: data.settlements, budgetExpenses: data.budgetExpenses.filter((expense) => expense.ownerId === req.userId), personalReceipts: data.personalReceipts.filter((receipt) => receipt.ownerId === req.userId) });
  } catch (error) {
    console.error('GET /api/state error:', error);
    res.status(500).json({ error: 'Could not read state.' });
  }
});

app.post('/api/backups/run', async (req, res) => {
  if (!backupCronSecret || req.get('x-backup-secret') !== backupCronSecret) return res.status(401).json({ error: 'Unauthorized backup job.' });
  if (!firebaseDbUrl) return res.status(503).json({ error: 'Firebase storage is required for backups.' });
  try {
    const data = await readData();
    const backupId = new Date().toISOString().replace(/[:.]/g, '-');
    const response = await firebaseFetch(`/backups/${backupId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Firebase backup failed: ${response.status}`);
    const backupsResponse = await firebaseFetch('/backups.json');
    const backups = backupsResponse.ok ? await backupsResponse.json() : {};
    const expiredBackupIds = Object.keys(backups || {}).sort().slice(0, -30);
    await Promise.all(expiredBackupIds.map((id) => firebaseFetch(`/backups/${id}.json`, { method: 'DELETE' })));
    res.status(201).json({ ok: true, backupId });
  } catch (error) {
    console.error('POST /api/backups/run error:', error);
    res.status(500).json({ error: 'Could not create backup.' });
  }
});

app.put('/api/auth/budget-settings', requireAuth, async (req, res) => {
  try {
    const categories = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const allowed = ['groceries', 'eat-out', 'rent', 'fun', 'other', 'gas', 'electric', 'internet'];
    const selected = [...new Set(categories.filter((category) => allowed.includes(category)))];
    if (!selected.length) return res.status(400).json({ error: 'Choose at least one graph category.' });

    // Firebase protects the entire state with an ETag. A simultaneous ledger
    // update can briefly invalidate it, so retry this idempotent preference save
    // with freshly read data after a short backoff instead of dropping the user's
    // selection while the competing write completes.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const data = await readData();
      const user = data.users.find((candidate) => candidate.id === req.userId);
      if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
      user.budgetGraphCategories = selected;
      try {
        await writeData(data);
        return res.json({ budgetGraphCategories: selected });
      } catch (error) {
        if (error.message === 'Data changed on another device. Refresh and try again.' && attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    console.error('PUT /api/auth/budget-settings error:', error);
    const conflict = error.message === 'Data changed on another device. Refresh and try again.';
    res.status(conflict ? 409 : 500).json({ error: conflict ? error.message : 'Could not save graph settings.' });
  }
});

app.post('/api/personal-receipts', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    const store = String(req.body?.store || '').trim();
    const image = String(req.body?.image || '');
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!store || store.length > 60) return res.status(400).json({ error: 'Enter a store name up to 60 characters.' });
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > 2_500_000) return res.status(400).json({ error: 'Upload a readable JPEG, PNG, or WebP receipt under 1.8 MB.' });
    const receipt = { id: crypto.randomUUID(), ownerId: user.id, store, image, createdAt: new Date().toISOString() };
    data.personalReceipts.unshift(receipt);
    await writeData(data);
    res.status(201).json(receipt);
  } catch (error) {
    console.error('POST /api/personal-receipts error:', error);
    res.status(500).json({ error: 'Could not save receipt photo.' });
  }
});

app.delete('/api/personal-receipts/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const receipt = data.personalReceipts.find((candidate) => candidate.id === req.params.id && candidate.ownerId === req.userId);
    if (!receipt) return res.status(404).json({ error: 'Receipt photo not found.' });
    data.personalReceipts = data.personalReceipts.filter((candidate) => candidate !== receipt);
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    console.error('DELETE /api/personal-receipts error:', error);
    res.status(500).json({ error: 'Could not delete receipt photo.' });
  }
});

app.post('/api/budget-expenses', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    const category = String(req.body?.category || '');
    const desc = String(req.body?.desc || '').trim();
    const amount = Number(req.body?.amount);
    const date = String(req.body?.date || '');
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!req.body?.id || !['groceries', 'eat-out', 'rent', 'fun', 'other'].includes(category)) return res.status(400).json({ error: 'Choose a valid budget category.' });
    if (!desc || desc.length > 60) return res.status(400).json({ error: 'Enter a description up to 60 characters.' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid expense amount.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Choose a valid expense date.' });
    const expense = { id: String(req.body.id), ownerId: user.id, category, desc, amount: Math.round(amount * 100) / 100, date, createdAt: new Date().toISOString() };
    data.budgetExpenses.unshift(expense);
    await writeData(data);
    res.status(201).json(expense);
  } catch (error) {
    console.error('POST /api/budget-expenses error:', error);
    res.status(500).json({ error: 'Could not save personal expense.' });
  }
});

app.delete('/api/budget-expenses/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const expense = data.budgetExpenses.find((candidate) => candidate.id === req.params.id && candidate.ownerId === req.userId);
    if (!expense) return res.status(404).json({ error: 'Personal expense not found.' });
    data.budgetExpenses = data.budgetExpenses.filter((candidate) => candidate !== expense);
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    console.error('DELETE /api/budget-expenses error:', error);
    res.status(500).json({ error: 'Could not delete personal expense.' });
  }
});

app.post('/api/expenses', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    const expense = { ...req.body };
    if (!expense || !/^[a-z0-9]{6,64}$/i.test(String(expense.id || ''))) {
      return res.status(400).json({ error: 'Invalid expense.' });
    }
    expense.desc = String(expense.desc || '').trim();
    if (!['gas', 'electric', 'internet', 'other'].includes(expense.category) || !Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0 || Number(expense.amount) > 100000 || !Array.isArray(expense.splitAmong) || !expense.splitAmong.length || !/^\d{4}-\d{2}-\d{2}$/.test(String(expense.date || ''))) {
      return res.status(400).json({ error: 'Enter a complete valid expense.' });
    }
    if (expense.category === 'other' && (!expense.desc || expense.desc.length >= 24)) {
      return res.status(400).json({ error: 'Enter an expense description shorter than 24 characters.' });
    }
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!user.isDeveloper) expense.paidBy = user.name;
    if (!data.people.includes(expense.paidBy) || expense.splitAmong.some((name) => !data.people.includes(name))) return res.status(400).json({ error: 'Choose valid household members.' });
    expense.amount = Math.round(Number(expense.amount) * 100) / 100;
    expense.createdBy = user.id;
    expense.createdAt = new Date().toISOString();
    expense.reminders = expenseReminderRecipients(data, expense);
    data.expenses.unshift(expense);
    await writeData(data);
    const balances = householdBalanceCents(data);
    for (const reminder of expense.reminders) {
      const recipient = data.users.find((candidate) => candidate.id === reminder.userId);
      const amountOwed = Math.min(Number(reminder.amount), Math.max(0, -(balances[reminder.name] || 0) / 100), Math.max(0, (balances[expense.paidBy] || 0) / 100));
      if (recipient && amountOwed >= 0.005) await sendPushToUser(recipient, { title: 'New shared expense', body: `${expense.paidBy} paid $${Number(expense.amount).toFixed(2)}. You owe $${amountOwed.toFixed(2)} to ${expense.paidBy}.`, url: '/', tag: `expense-${expense.id}` });
    }
    res.status(201).json(expense);
  } catch (error) {
    res.status(500).json({ error: 'Could not save expense.' });
  }
});

app.post('/api/settlements', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const user = data.users.find((candidate) => candidate.id === req.userId);
    const payment = { ...req.body };
    if (!payment || !/^[a-z0-9]{6,64}$/i.test(String(payment.id || ''))) {
      return res.status(400).json({ error: 'Invalid payment.' });
    }
    payment.desc = String(payment.desc || '').trim();
    if (!payment.desc || payment.desc.length >= 24 || !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0 || Number(payment.amount) > 100000 || !/^\d{4}-\d{2}-\d{2}$/.test(String(payment.date || ''))) {
      return res.status(400).json({ error: 'Enter a payment description shorter than 24 characters.' });
    }
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!user.isDeveloper) payment.from = user.name;
    if (!data.people.includes(payment.from) || !data.people.includes(payment.to) || payment.from === payment.to) return res.status(400).json({ error: 'Choose valid payment members.' });
    payment.amount = Math.round(Number(payment.amount) * 100) / 100;
    payment.createdBy = user.id;
    payment.createdAt = new Date().toISOString();
    data.settlements.unshift(payment);
    await writeData(data);
    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Could not save payment.' });
  }
});

app.post('/api/people', requireAuth, requireDeveloper, async (req, res) => {
  try {
    const data = await readData();
    const { name } = req.body;
    if (!validName(String(name || '').trim())) return res.status(400).json({ error: 'Invalid name.' });
    if (!data.people.includes(name)) {
      data.people.push(name);
      await writeData(data);
    }
    res.status(201).json({ name });
  } catch (error) {
    res.status(500).json({ error: 'Could not save person.' });
  }
});

app.delete('/api/expenses/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const { id } = req.params;
    const user = data.users.find((candidate) => candidate.id === req.userId);
    const expense = data.expenses.find((candidate) => candidate.id === id);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!expense) return res.status(404).json({ error: 'Expense not found.' });
    if (!user.isDeveloper && expense.createdBy !== user.id) return res.status(403).json({ error: 'You can only delete expenses you created.' });
    data.expenses = data.expenses.filter((expense) => expense.id !== id);
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Could not delete expense.' });
  }
});

app.delete('/api/settlements/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const { id } = req.params;
    const user = data.users.find((candidate) => candidate.id === req.userId);
    const settlement = data.settlements.find((candidate) => candidate.id === id);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!settlement) return res.status(404).json({ error: 'Payment not found.' });
    if (!user.isDeveloper && settlement.createdBy !== user.id) return res.status(403).json({ error: 'You can only delete payments you created.' });
    data.settlements = data.settlements.filter((settlement) => settlement.id !== id);
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Could not delete payment.' });
  }
});

app.delete('/api/people/:name', requireAuth, requireDeveloper, async (req, res) => {
  try {
    const data = await readData();
    const name = decodeURIComponent(req.params.name);
    data.people = data.people.filter((person) => person !== name);
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Could not delete person.' });
  }
});

// Checks every 15 minutes so each reminder is sent shortly after its 24-hour due time.
// The protected endpoint above also supports an external scheduler for hosts that sleep.
setInterval(() => sendDueReminders().catch((error) => console.error('Automatic reminder error:', error)), 15 * 60 * 1000);

app.listen(port, () => {
  console.log(`PayMe backend running at http://localhost:${port}`);
});

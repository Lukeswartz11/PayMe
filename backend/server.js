import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const dataPath = path.resolve(__dirname, 'data.json');
const publicRoot = path.resolve(__dirname, '..');
const firebaseDbUrl = process.env.FIREBASE_DATABASE_URL?.replace(/\/$/, '');
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessions = new Map();
const developerAccount = { name: 'Luke', password: 'Lukeswartz11' };
const legacyStarterPeople = ['Luke', 'Andrew', 'Logan', 'Kai', 'Carson', 'conner'];

const defaultData = {
  people: [],
  expenses: [],
  settlements: [],
  users: [],
};

app.use(cors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use(express.static(publicRoot));

async function readData() {
  if (firebaseDbUrl) {
    try {
      const response = await fetch(`${firebaseDbUrl}/state.json`);
      if (!response.ok) throw new Error(`Firebase read failed: ${response.status}`);
      const value = await response.text();
      if (!value || value === 'null') return defaultData;
      return normalizeData(JSON.parse(value));
    } catch (error) {
      console.error('Failed to read Firebase data:', error);
    }
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
    users: Array.isArray(data?.users) ? data.users : [],
  };
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function validPassword(password, user) {
  const hash = crypto.scryptSync(password, user.salt, 64);
  return crypto.timingSafeEqual(hash, Buffer.from(user.passwordHash, 'hex'));
}

function getUserLoginName(user) {
  return String(user.name || user.username || '').trim().toLowerCase();
}

function validName(name) {
  return /^[a-zA-Z][a-zA-Z '-]{0,30}$/.test(name);
}

function prepareHousehold(data) {
  let changed = false;
  const isUntouchedLegacyHousehold = data.people.length === legacyStarterPeople.length && legacyStarterPeople.every((person, index) => data.people[index] === person) && data.expenses.length === 0 && data.settlements.length === 0;
  if (isUntouchedLegacyHousehold) {
    data.people = [];
    changed = true;
  }
  const developerUser = data.users.find((user) => getUserLoginName(user) === developerAccount.name.toLowerCase());
  if (!developerUser) {
    const { salt, hash } = hashPassword(developerAccount.password);
    data.users.push({ id: crypto.randomUUID(), name: developerAccount.name, isDeveloper: true, salt, passwordHash: hash, createdAt: new Date().toISOString() });
    changed = true;
  } else if (!developerUser.isDeveloper) {
    developerUser.isDeveloper = true;
    changed = true;
  }
  if (!data.people.some((person) => person.toLowerCase() === developerAccount.name.toLowerCase())) {
    data.people.push(developerAccount.name);
    changed = true;
  }
  return changed;
}

async function readPreparedData() {
  const data = await readData();
  if (prepareHousehold(data)) await writeData(data);
  return data;
}

function createSession(user, response) {
  const token = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', sessionSecret).update(token).digest('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  response.cookie('payme_session', `${token}.${signature}`, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
  return `${token}.${signature}`;
}

function requireAuth(request, response, next) {
  const authorization = request.get('authorization') || '';
  const credential = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : parseCookies(request).payme_session || '';
  const [token, signature] = credential.split('.');
  const expected = token && crypto.createHmac('sha256', sessionSecret).update(token).digest('hex');
  if (!token || !signature || !expected || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return response.status(401).json({ error: 'Sign in required.' });
  }
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  request.userId = session.userId;
  next();
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
    const response = await fetch(`${firebaseDbUrl}/state.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Firebase write failed: ${response.status}`);
    return;
  }

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (!validName(name)) return res.status(400).json({ error: 'Enter a valid first name.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const data = await readPreparedData();
    if (data.users.some((user) => getUserLoginName(user) === name.toLowerCase())) return res.status(409).json({ error: 'An account already uses that first name.' });
    const { salt, hash } = hashPassword(password);
    const user = { id: crypto.randomUUID(), name, salt, passwordHash: hash, createdAt: new Date().toISOString() };
    data.users.push(user);
    if (!data.people.some((person) => person.toLowerCase() === name.toLowerCase())) data.people.push(name);
    await writeData(data);
    const sessionToken = createSession(user, res);
    res.status(201).json({ user: { name: user.name, isDeveloper: false }, sessionToken });
  } catch (error) {
    console.error('POST /api/auth/signup error:', error);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const data = await readPreparedData();
    const user = data.users.find((candidate) => getUserLoginName(candidate) === name.toLowerCase());
    if (!user || !validPassword(password, user)) return res.status(401).json({ error: 'Incorrect first name or password.' });
    const sessionToken = createSession(user, res);
    res.json({ user: { name: user.name || '', isDeveloper: Boolean(user.isDeveloper) }, sessionToken });
  } catch (error) {
    console.error('POST /api/auth/signin error:', error);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const data = await readPreparedData();
  const user = data.users.find((candidate) => candidate.id === req.userId);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
  res.json({ user: { name: user.name || '', isDeveloper: Boolean(user.isDeveloper) } });
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
    if (password && password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
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
    for (const [token, session] of sessions) if (session.userId === user.id) sessions.delete(token);
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    console.error('DELETE /api/developer/accounts error:', error);
    res.status(500).json({ error: 'Could not delete account.' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const authorization = req.get('authorization') || '';
  const credential = authorization.startsWith('Bearer ') ? authorization.slice(7) : parseCookies(req).payme_session || '';
  const token = credential.split('.')[0];
  sessions.delete(token);
  res.clearCookie('payme_session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.status(204).end();
});

app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    res.json({ people: data.people, expenses: data.expenses, settlements: data.settlements });
  } catch (error) {
    console.error('GET /api/state error:', error);
    res.status(500).json({ error: 'Could not read state.' });
  }
});

app.post('/api/expenses', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const expense = req.body;
    if (!expense || !expense.id) {
      return res.status(400).json({ error: 'Invalid expense.' });
    }
    data.expenses.unshift(expense);
    await writeData(data);
    res.status(201).json(expense);
  } catch (error) {
    res.status(500).json({ error: 'Could not save expense.' });
  }
});

app.post('/api/settlements', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const payment = req.body;
    if (!payment || !payment.id) {
      return res.status(400).json({ error: 'Invalid payment.' });
    }
    data.settlements.unshift(payment);
    await writeData(data);
    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Could not save payment.' });
  }
});

app.post('/api/people', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Invalid name.' });
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
    data.settlements = data.settlements.filter((settlement) => settlement.id !== id);
    await writeData(data);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Could not delete payment.' });
  }
});

app.delete('/api/people/:name', requireAuth, async (req, res) => {
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

app.listen(port, () => {
  console.log(`PayMe backend running at http://localhost:${port}`);
});

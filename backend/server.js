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
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM;
const publicAppUrl = process.env.PUBLIC_APP_URL;
const sessions = new Map();
const MAX_ACCOUNTS = 6;

const defaultData = {
  people: ['Luke', 'Andrew', 'Logan', 'Kai', 'Carson', 'conner'],
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

function getUserEmail(user) {
  return String(user.email || user.username || '').toLowerCase();
}

function removeUserSessions(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

async function sendPasswordResetEmail(email, token) {
  if (!resendApiKey || !emailFrom || !publicAppUrl) throw new Error('Email service is not configured.');
  const resetUrl = new URL(publicAppUrl);
  resetUrl.searchParams.set('reset', token);
  resetUrl.searchParams.set('email', email);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: emailFrom,
      to: [email],
      subject: 'Reset your Pay Luke password',
      text: `Use this link to reset your Pay Luke password. It expires in one hour:\n${resetUrl}`,
    }),
  });
  if (!response.ok) throw new Error(`Email provider rejected the request (${response.status}).`);
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
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const data = await readData();
    if (data.users.length >= MAX_ACCOUNTS) return res.status(403).json({ error: 'All six house accounts have already been created.' });
    if (data.users.some((user) => getUserEmail(user) === email)) return res.status(409).json({ error: 'An account already uses that email address.' });
    const { salt, hash } = hashPassword(password);
    const user = { id: crypto.randomUUID(), email, salt, passwordHash: hash, createdAt: new Date().toISOString() };
    data.users.push(user);
    await writeData(data);
    const sessionToken = createSession(user, res);
    res.status(201).json({ user: { email: user.email }, sessionToken, accountsRemaining: MAX_ACCOUNTS - data.users.length });
  } catch (error) {
    console.error('POST /api/auth/signup error:', error);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const data = await readData();
    const user = data.users.find((candidate) => getUserEmail(candidate) === email);
    if (!user || !validPassword(password, user)) return res.status(401).json({ error: 'Incorrect email or password.' });
    const sessionToken = createSession(user, res);
    res.json({ user: { email: getUserEmail(user) }, sessionToken });
  } catch (error) {
    console.error('POST /api/auth/signin error:', error);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const data = await readData();
  const user = data.users.find((candidate) => candidate.id === req.userId);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
  res.json({ user: { email: getUserEmail(user) } });
});

app.post('/api/auth/request-password-reset', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const data = await readData();
    const user = data.users.find((candidate) => getUserEmail(candidate) === email);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      user.resetTokenExpiresAt = Date.now() + 60 * 60 * 1000;
      await writeData(data);
      await sendPasswordResetEmail(email, token);
    }
    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (error) {
    console.error('POST /api/auth/request-password-reset error:', error);
    res.status(500).json({ error: 'Could not send reset email. Please try again later.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const data = await readData();
    const user = data.users.find((candidate) => getUserEmail(candidate) === email);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (!user || !user.resetTokenHash || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < Date.now() || !crypto.timingSafeEqual(Buffer.from(user.resetTokenHash), Buffer.from(tokenHash))) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }
    const { salt, hash } = hashPassword(password);
    user.salt = salt;
    user.passwordHash = hash;
    delete user.resetTokenHash;
    delete user.resetTokenExpiresAt;
    removeUserSessions(user.id);
    await writeData(data);
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    console.error('POST /api/auth/reset-password error:', error);
    res.status(500).json({ error: 'Could not reset password.' });
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

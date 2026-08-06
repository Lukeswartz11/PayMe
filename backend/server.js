import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const dataPath = path.resolve(__dirname, 'data.json');
const publicRoot = path.resolve(__dirname, '..');

app.use(express.json());
app.use(express.static(publicRoot));

async function readData() {
  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to read data.json:', error);
    if (error.code === 'ENOENT' || error.name === 'SyntaxError') {
      const defaultData = {
        people: ['Luke', 'Andrew', 'Logan', 'Kai', 'Carson', 'conner'],
        expenses: [],
        settlements: [],
      };
      await writeData(defaultData);
      return defaultData;
    }
    throw error;
  }
}

async function writeData(data) {
  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
}

app.get('/api/state', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch (error) {
    console.error('GET /api/state error:', error);
    res.status(500).json({ error: 'Could not read state.' });
  }
});

app.post('/api/expenses', async (req, res) => {
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

app.post('/api/settlements', async (req, res) => {
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

app.post('/api/people', async (req, res) => {
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

app.delete('/api/expenses/:id', async (req, res) => {
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

app.delete('/api/settlements/:id', async (req, res) => {
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

app.delete('/api/people/:name', async (req, res) => {
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

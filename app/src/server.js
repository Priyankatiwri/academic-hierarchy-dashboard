require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const { initSchema } = require('./db');
const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');
const { runSync } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/auth', authRouter);
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

async function start() {
  await initSchema();

  const cronExpr = process.env.SYNC_CRON || '*/15 * * * *';
  if (cron.validate(cronExpr)) {
    cron.schedule(cronExpr, () => {
      runSync().catch(err => console.error('[sync] failed:', err.message));
    });
    console.log(`Scheduled Drive sync: "${cronExpr}" (add an external pinger on free hosts — see README.md)`);
  } else {
    console.warn(`Invalid SYNC_CRON "${cronExpr}" — auto-sync disabled. Use POST /api/sync to trigger manually.`);
  }

  app.listen(PORT, () => {
    console.log(`Academic dashboard running at http://localhost:${PORT}`);
  });
}

start();

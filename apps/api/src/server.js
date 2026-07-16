import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { meRouter } from './routes/me.js';
import { internalRouter } from './routes/internal.js';
import { startInProcessCron } from './jobs/reconcile-cron.js';
import { providerStatus } from './services/brief-generation.js';

const app = express();
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: config.env,
    roma: config.roma.baseUrl,
    calendar: config.calendarEnabled,
    researchProviders: providerStatus(),
  });
});

app.use('/api/v1/me', meRouter);
app.use('/internal', internalRouter);

// Central error handler — never leak internals; always JSON.
app.use((err, req, res, _next) => {
  console.error('[api error]', req.method, req.path, err.status || 500, err.message);
  res.status(err.status || 500).json({ error: 'internal_error', message: config.env === 'development' ? err.message : undefined });
});

app.listen(config.port, () => {
  console.log(`ae-workspace API on :${config.port} (${config.env})`);
  startInProcessCron();
});

export { app };

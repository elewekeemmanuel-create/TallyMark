import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import { createApiRouter } from '../src/server/routes.ts';

const app = express();
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

export default app;

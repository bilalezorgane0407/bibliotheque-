import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createDatabase, seedDatabaseIfEmpty } from './server/db/database.ts';
import { createApp } from './server/app.ts';

const PORT = 3000;

async function startServer() {
  const db = createDatabase();
  seedDatabaseIfEmpty(db);

  const { app } = createApp(db);
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`BiblioEST server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BiblioEST server:', err);
  process.exit(1);
});

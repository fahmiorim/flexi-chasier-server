import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import geraiRoutes from './routes/gerai.js';
import syncRoutes from './routes/sync.js';
import laporanRoutes from './routes/laporan.js';
import produkRoutes from './routes/produk.js';
import bahanRoutes from './routes/bahan.js';
import usersRoutes from './routes/users.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', nama: 'flexi-chasier-server' });
});

app.use('/api/auth', authRoutes);
app.use('/api/gerai', geraiRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/laporan', laporanRoutes);
app.use('/api/produk', produkRoutes);
app.use('/api/bahan', bahanRoutes);
app.use('/api/users', usersRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`flexi-chasier-server berjalan di http://localhost:${port}`);
});

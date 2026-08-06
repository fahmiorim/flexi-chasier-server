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

// Rate limit memakai alamat IP klien. Di belakang reverse proxy (produksi),
// set TRUST_PROXY=1 (jumlah hop) agar IP asli terbaca; default 0 aman untuk lokal.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 0));

// CORS: bila CORS_ORIGIN diisi, batasi ke daftar asal yang dipisahkan koma
// (contoh: "https://kasir.example.com,https://admin.example.com").
const originCors = process.env.CORS_ORIGIN;
if (originCors) {
  app.use(
    cors({
      origin: originCors
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    }),
  );
} else {
  app.use(cors());
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[CORS] CORS_ORIGIN tidak diatur — semua origin diizinkan. ' +
        'Tetapkan CORS_ORIGIN (daftar asal dipisah koma) untuk produksi.',
    );
  }
}

// Batas tubuh JSON diperbesar: batch sinkronisasi push bisa membawa hingga
// 500 transaksi × 200 item (melebihi 2 MB default Express).
app.use(express.json({ limit: '20mb' }));

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

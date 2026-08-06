# Flexi Kasir Server

Backend untuk aplikasi kasir **Flexi Kasir** (Android + website) — multi-tenant, multi-gerai, dengan sinkronisasi dua arah.

- **Stack:** Node.js (>= 20) + Express 5 + Prisma 7 + PostgreSQL
- **Auth:** JWT (access + refresh), password di-hash dengan bcrypt
- **Model:** 1 akun (tenant) → banyak gerai → banyak user (Pemilik/Kasir)
- **Sinkronisasi:** push idempotent per entitas (last-write-wins via `versi`) + pull dengan kursor
- **Bahasa kode & pesan:** Indonesia

---

## Fitur

- Registrasi akun (otomatis membuat tenant + gerai pertama + user Pemilik)
- Login multi-peran (Pemilik melihat semua gerai, Kasir hanya gerai ter-assign)
- Tambah gerai & buat akun kasir dengan assignment gerai
- Endpoint **sync push** untuk 10 entitas (produk, transaksi, meja, shift kas, mutasi kas, setoran, bahan, pembelian bahan, resep, pengaturan toko)
- Endpoint **sync pull** (`/api/sync/perubahan`) dengan kursor & flag `terpotong`
- Endpoint **produk** per gerai (dipakai katalog Android)
- Endpoint **laporan**: penjualan harian/periode, rekap kas, produk terlaris, stok, mutasi

---

## Prasyarat

| Kebutuhan | Versi |
|---|---|
| Node.js | >= 20 |
| PostgreSQL | 14+ (bebas versi) |
| npm | bawaan Node |

---

## Setup dari nol

### 1. Clone & masuk folder

```bash
git clone <url-repo> flexi-kasir-server
cd flexi-kasir-server
```

### 2. Buat database PostgreSQL

Buat database bernama `flexi_chasier` (atau bebas, sesuaikan di `.env`).

**Via psql:**

```bash
psql -U postgres -c "CREATE DATABASE flexi_chasier;"
```

**Pakai Laragon (Windows):**

1. Buka Laragon → klik **Start All** (Apache & MySQL tidak wajib, PostgreSQL saja cukup — jalankan PostgreSQL dari menu *Tools* atau mulai service-nya).
2. Buka **HeidiSQL** (di Laragon menu *Tools*) → buat database baru `flexi_chasier`.
   - Default kredensial PostgreSQL Laragon: user `postgres`, password `postgres` (sesuaikan jika diubah).

> Pastikan PostgreSQL aktif di `localhost:5432` sebelum lanjut.

### 3. Instal dependensi

```bash
npm install
```

### 4. Buat file `.env`

```bash
cp .env.example .env
```

Isi nilai di `.env` — jangan pernah meng-commit file `.env` (sudah di-`.gitignore`). Contoh isian:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flexi_chasier?schema=public"
JWT_ACCESS_SECRET="ganti-dengan-secret-panjang-acak"
JWT_REFRESH_SECRET="ganti-dengan-secret-panjang-acak-lain"
JWT_ACCESS_EXPIRES="15m"
JWT_REFRESH_EXPIRES="30d"
PORT=4000
```

**Generate secret acak** (bekerja di Windows/Linux/Mac):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Jalankan dua kali — satu untuk `JWT_ACCESS_SECRET`, satu untuk `JWT_REFRESH_SECRET`.

> `JWT_ACCESS_SECRET` dan `JWT_REFRESH_SECRET` **wajib berbeda** dan cukup panjang (min. 32 karakter). Jangan pakai nilai default.

### 5. Terapkan migrasi database

```bash
npx prisma migrate deploy
```

Perintah ini membuat seluruh tabel dari `prisma/migrations`. Verifikasi:

```bash
npx prisma migrate status   # harus: "Database schema is up to date!"
```

### 6. Jalankan server

**Mode pengembangan** (auto-restart saat file berubah):

```bash
npm run dev
```

**Mode produksi:**

```bash
npm run build   # kompilasi TypeScript ke dist/
npm start       # node dist/index.js
```

Jika berhasil akan muncul:

```
flexi-kasir-server berjalan di http://localhost:4000
```

---

## Verifikasi cepat

```bash
# 1. Health check
curl http://localhost:4000/health
# => {"status":"ok","nama":"flexi-kasir-server"}

# 2. Registrasi akun pertama (Pemilik)
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"namaUsaha":"Kopi Nusantara","namaUser":"Budi","email":"budi@example.com","password":"rahasia123"}'

# 3. Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"budi@example.com","password":"rahasia123"}'
```

Login/register mengembalikan `accessToken`, `refreshToken`, `user`, dan daftar `gerai`. Simpan `accessToken` untuk memanggil endpoint terproteksi.

---

## Autentikasi

Semua endpoint kecuali `/health`, `/api/auth/register`, dan `/api/auth/login` memerlukan token:

```
Authorization: Bearer <accessToken>
```

- **Access token** kedaluwarsa (`JWT_ACCESS_EXPIRES`, default `15m`).
- Saat dapat `401`, tukar dengan **refresh token**:

```bash
curl -X POST http://localhost:4000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
# => { accessToken, refreshToken }
```

- **Logout:**

```bash
curl -X POST http://localhost:4000/api/auth/logout \
  -H "Authorization: Bearer <accessToken>"
```

---

## Endpoint

### Auth — `/api/auth`

| Method | Path | Deskripsi | Body |
|---|---|---|---|
| POST | `/register` | Daftar tenant + gerai pertama + user Pemilik | `{ namaUsaha, namaUser, email, password (min 6) }` |
| POST | `/login` | Login | `{ email, password }` |
| POST | `/refresh` | Tukar refresh token | `{ refreshToken }` |
| POST | `/logout` | Logout | — |

### Gerai & user — `/api/gerai` (auth)

| Method | Path | Akses | Deskripsi | Body |
|---|---|---|---|---|
| GET | `/` | Semua role | Daftar gerai yang boleh diakses | — |
| POST | `/` | Owner | Buat gerai baru | `{ nama, alamat? }` |
| POST | `/:id/users` | Owner | Buat user & assign ke gerai | `{ nama, email, password, peran: "Pemilik"\|"Kasir", geraiIds: [...] }` |

### Sinkronisasi push — `POST /api/sync/:entitas` (auth)

Body selalu: `{ geraiId, items: [...] }` → respons `{ diterima, total }`.

| Entitas | Catatan |
|---|---|
| `/produk` | + varian, favorit, stok |
| `/transaksi` | + item transaksi (nested `items`) |
| `/meja` | nomor meja |
| `/shift-kas` | buka/tutup shift |
| `/mutasi-kas` | pemasukan/pengeluaran |
| `/setoran` | setoran shift |
| `/bahan` | bahan baku |
| `/pembelian-bahan` | pembelian bahan |
| `/resep` | + bahan resep (nested `bahan`) |
| `/pengaturan-toko` | nama usaha, alamat, tagline, logo |

Aturan: setiap item wajib punya `id` dan `versi` (epoch mili, monotonik). Server menyimpan dengan **last-write-wins** — item ber-`versi` lebih tua diabaikan. Item dengan `dihapus: true` melakukan soft-delete.

### Sinkronisasi pull — `GET /api/sync/perubahan` (auth)

```
GET /api/sync/perubahan?geraiId=<id>&sejakEpochMili=<kursor>&batas=<500>
```

Respons berisi `waktuServerEpochMili`, `terpotong` (true = masih ada data lagi), dan daftar item per entitas (`products`, `transactions`, `transactionItems`, `tables`, `cashShifts`, `cashMutations`, `setoran`, `bahan`, `pembelianBahan`, `resep`, `resepBahan`, `storeSettings`).

Pola klien: ulangi request dengan `sejakEpochMili = waktuServerEpochMili` selama `terpotong = true`.

### Produk — `/api/produk` (auth)

| Method | Path | Deskripsi |
|---|---|---|
| GET | `/` | Daftar produk; query: `geraiId` (opsional), `kata_kunci` (opsional) |
| GET | `/:id` | Detail produk |

Kasir hanya melihat produk gerai ter-assign; owner semua gerai tenantnya.

### Laporan — `/api/laporan` (auth)

| Method | Path | Parameter |
|---|---|---|
| GET | `/penjualan-harian` | `geraiId` (wajib), `dari`/`sampai` (epoch mili, opsional) |
| GET | `/penjualan-periode` | `geraiId` (wajib), `dari`/`sampai` (epoch mili, opsional) |
| GET | `/rekap-kas` | `geraiId` (wajib), `dari`/`sampai` (epoch mili, opsional) |
| GET | `/produk-terlaris` | `geraiId` (wajib), `dari`/`sampai` (epoch mili, opsional), `limit` (default 10, maks 50) |
| GET | `/stok` | `geraiId` (wajib), `limit` (default 1000), `q` (opsional), `batasMenipis` (default 5) |
| GET | `/mutasi` | `geraiId` (wajib), `dari`/`sampai` (epoch mili, opsional), `limit` (default 1000) |

---

## Skrip npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Jalankan dev server (tsx watch, auto-restart) |
| `npm run build` | Kompilasi TypeScript ke `dist/` |
| `npm start` | Jalankan hasil build (`node dist/index.js`) |
| `npm run db:migrate` | `prisma migrate dev` — buat migrasi baru dari perubahan schema |
| `npm run db:deploy` | `prisma migrate deploy` — terapkan migrasi (produksi) |
| `npm run db:generate` | Regenerasi Prisma Client setelah edit schema |
| `npm run db:studio` | Buka Prisma Studio (GUI data) |

---

## Struktur folder

```
src/
├── index.ts              # Entry point: Express app, mount routes
├── middleware/auth.ts    # requireAuth, requireOwner (JWT + role)
├── lib/
│   ├── prisma.ts         # PrismaClient + adapter PostgreSQL
│   ├── token.ts          # sign/verify JWT
│   └── akses-gerai.ts    # Pembatasan akses kasir per gerai
├── routes/
│   ├── auth.ts           # register/login/refresh/logout
│   ├── gerai.ts          # gerai & user management
│   ├── sync.ts           # push 10 entitas + pull /perubahan
│   ├── produk.ts         # katalog produk per gerai
│   └── laporan.ts        # 6 endpoint laporan
└── types/express.d.ts    # Tipe user di request
prisma/
├── schema.prisma         # 17 tabel (tenant, user, gerai, data transaksi, dll.)
└── migrations/           # Migrasi database
```

---

## Troubleshooting

| Gejala | Solusi |
|---|---|
| `EADDRINUSE: address already in use :::4000` | Port dipakai aplikasi lain. Ganti `PORT` di `.env` atau matikan proses lama. |
| `PrismaClientInitializationError ... connection refused` | PostgreSQL belum jalan atau `DATABASE_URL` salah. Pastikan DB aktif & kredensial benar. |
| `database "flexi_chasier" does not exist` | Buat database dulu (lihat langkah 2). |
| `P1000 ... database schema not up to date` | Jalankan `npx prisma migrate deploy`. |
| Login gagal `401` | Cek email/password. Jika server di-restart dengan secret baru, semua token lama tidak valid — login ulang. |
| Endpoint terproteksi `401` | Token kedaluwarsa → tukar refresh token, atau token bukan milik gerai/tenant yang diminta. |
| Respons error `500` | Lihat log server (error tercetak di konsol). |

---

## Keamanan

- **Isolasi tenant:** setiap query data wajib difilter `tenant_id` dari token JWT — tidak pernah dari body/payload klien.
- **Akses role:** `requireOwner` membatasi endpoint manajemen; kasir dibatasi pada gerai ter-assign (`lib/akses-gerai.ts`).
- **Password** di-hash bcrypt (10 rounds).
- **Secret JWT** panjang & berbeda untuk access/refresh; simpan hanya di `.env` (tidak di-commit).
- **CORS** terbuka untuk pengembangan — batasi origin sebelum produksi.

---

## Integrasi dengan Android

Aplikasi `flexi-kasir` (Android) memanggil backend ini untuk:

- Login/register & pemilihan gerai (`/api/auth/*`)
- Katalog produk per gerai (`/api/produk`)
- Sinkronisasi outbox → push + pull (`/api/sync/*`)

Untuk diuji dari HP di jaringan yang sama, gunakan IP komputer (mis. `http://192.168.1.10:4000`) sebagai `alamatDasarApi` di Android (`CashierNetworkConfig`), bukan `localhost`. Untuk produksi, deploy ke server publik + HTTPS, lalu ubah `alamatDasarApi` ke domain server.

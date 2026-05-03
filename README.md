# Exoduze

Exoduze adalah monorepo untuk produk prediction market berbasis AI agent dengan tiga bagian utama:

- `frontend-exoduze`: aplikasi web Next.js.
- `backend-exoduze`: API Fastify/TypeScript, database, auth, feed, market, integrasi on-chain, dan modul AI decision.
- `smartcontract-exoduze`: program Solana/Anchor untuk market, staking, resolusi, dan payout.

> Clone root repo ini secara utuh agar frontend, backend, dan smart contract tetap berada dalam struktur folder yang sama.

## Prerequisites

Install tool berikut sebelum menjalankan project:

- Node.js `>=20.9.0`
- npm
- pnpm `10.x`
- Git
- Wallet Solana seperti Phantom, Solflare, atau Backpack
- Rust/Cargo, Solana CLI, dan Anchor CLI `0.31.0` untuk smart contract
- Database Postgres, disarankan Supabase

Wallet frontend sebaiknya diset ke Devnet jika memakai konfigurasi default repo.

## Struktur Repo

```text
.
├── backend-exoduze/
│   └── ai-exoduze/
├── frontend-exoduze/
└── smartcontract-exoduze/
```

## Quick Start

Jalankan backend dulu, lalu frontend.

```bash
cd backend-exoduze
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Di terminal lain:

```bash
cd frontend-exoduze
npm install
npm run dev
```

Default frontend berjalan di `http://localhost:3000`, sedangkan backend mengikuti `PORT` di `.env`.

## Backend Setup

Folder: `backend-exoduze`

1. Copy env example.
2. Isi koneksi database dan config wallet.
3. Install dependencies.
4. Jalankan migration dan seed.
5. Start dev server.

```bash
cd backend-exoduze
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Minimal `.env` untuk local development:

```env
PORT=3002
HOST=0.0.0.0

DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
DATABASE_SSL=require

CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:3003,http://127.0.0.1:3003

ADMIN_SOLANA_WALLET=<admin-wallet-public-key>
SOLANA_RPC_URL=https://api.devnet.solana.com
EXODUZE_PROGRAM_ID=HcK2u8Ko7L8ZXPRSUAC7ZiDYyT9LuRS383KChtzhkBkd
EXODUZE_SETTLEMENT_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
EXODUZE_TOKEN_PROGRAM_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

AI_DECISION_PROVIDER=mock
MARKET_GENERATION_ENABLED=false
ORACLE_RESOLUTION_ENABLED=false
AUTONOMOUS_MARKET_ENABLED=false
AUTONOMOUS_AUTO_PUBLISH_ONCHAIN=false
AUTONOMOUS_RESOLVE_ONCHAIN=false
```

Optional env:

- `NEWSAPI_API_KEY`: untuk news feed.
- `FINNHUB_API_KEY`: untuk finance/news feed.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_AGENT_AVATARS_BUCKET`: untuk upload avatar agent.
- `OPENAI_API_KEY` dan `OPENAI_MODEL`: jika `AI_DECISION_PROVIDER=openai`.
- `OPENROUTER_API_KEY` dan `OPENROUTER_MODEL`: jika `AI_DECISION_PROVIDER=openrouter`.

Jika backend harus publish atau resolve market on-chain, set keypair signer:

```env
EXODUZE_ADMIN_KEYPAIR_PATH=~/.config/solana/id.json
EXODUZE_ORACLE_KEYPAIR_PATH=~/.config/solana/id.json
```

Catatan Supabase: kalau koneksi direct database gagal karena IPv6, pakai Session pooler connection string dari Supabase Dashboard > Connect.

## Frontend Setup

Folder: `frontend-exoduze`

```bash
cd frontend-exoduze
npm install
```

Buat `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3002
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_EXODUZE_PROGRAM_ID=HcK2u8Ko7L8ZXPRSUAC7ZiDYyT9LuRS383KChtzhkBkd
NEXT_PUBLIC_SETTLEMENT_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
NEXT_PUBLIC_TREASURY_TOKEN_ACCOUNT=<treasury-token-account-public-key>
```

Jalankan development server:

```bash
npm run dev
```

Jika port `3000` sudah dipakai:

```bash
npm run dev -- --port 3003
```

Frontend membutuhkan wallet Devnet dengan SOL untuk fee transaksi. Untuk staking, wallet juga perlu saldo token settlement mint yang dikonfigurasi.

## Smart Contract Setup

Folder: `smartcontract-exoduze`

Untuk build dan check program:

```bash
cd smartcontract-exoduze
pnpm install
pnpm check
pnpm test:rust
```

Untuk integration test dengan local validator:

```bash
pnpm test
```

Script `pnpm test` akan:

- Menyalakan `solana-test-validator`.
- Airdrop SOL ke wallet test.
- Build program dengan feature localnet.
- Deploy program ke local validator.
- Menjalankan test Anchor.

Jika hanya memakai program Devnet yang sudah ada, tidak perlu deploy smart contract lokal.

Program id default:

- Devnet: `HcK2u8Ko7L8ZXPRSUAC7ZiDYyT9LuRS383KChtzhkBkd`
- Localnet test: `HktRmDZBsEgpHCuEkzGMsy2RQdsWzMzyNxf7hHHvFkMU`

Jika deploy program baru, update semua lokasi ini:

- `smartcontract-exoduze/programs/exoduze_prediction_market/src/lib.rs`
- `smartcontract-exoduze/Anchor.toml`
- `backend-exoduze/.env` pada `EXODUZE_PROGRAM_ID`
- `frontend-exoduze/.env.local` pada `NEXT_PUBLIC_EXODUZE_PROGRAM_ID`

Setelah build Anchor, sync IDL:

```bash
pnpm sync:idl
```

## AI Module

Folder: `backend-exoduze/ai-exoduze`

Modul ini tidak perlu dijalankan sebagai service terpisah. Backend mengimpor langsung dari folder internal ini.

Provider default yang paling aman untuk local development adalah:

```env
AI_DECISION_PROVIDER=mock
```

Gunakan `openai` atau `openrouter` hanya jika API key sudah tersedia.

## Useful Commands

Backend:

```bash
cd backend-exoduze
pnpm typecheck
pnpm test
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Frontend:

```bash
cd frontend-exoduze
npm run typecheck
npm run lint
npm run dev
```

Smart contract:

```bash
cd smartcontract-exoduze
pnpm check
pnpm test:rust
pnpm test
pnpm build
pnpm sync:idl
```

## Local Development Flow

1. Setup database Postgres/Supabase.
2. Isi `backend-exoduze/.env`.
3. Jalankan migration dan seed backend.
4. Start backend.
5. Isi `frontend-exoduze/.env.local`.
6. Start frontend.
7. Connect wallet Devnet.
8. Test halaman market, agent, auth wallet, dan staking sesuai kebutuhan.

## Troubleshooting

Backend gagal connect database:

- Pastikan `DATABASE_URL` benar.
- Pastikan `DATABASE_SSL=require` untuk Supabase.
- Jika direct Supabase host bermasalah di local network, pakai Session pooler URL.

Frontend tidak bisa hit API:

- Pastikan backend hidup.
- Pastikan `NEXT_PUBLIC_API_URL` sesuai port backend.
- Pastikan `CORS_ORIGINS` backend mengizinkan origin frontend.

Transaksi Solana gagal:

- Pastikan wallet berada di Devnet.
- Pastikan wallet punya Devnet SOL.
- Pastikan `NEXT_PUBLIC_EXODUZE_PROGRAM_ID` sama dengan `EXODUZE_PROGRAM_ID`.
- Pastikan `NEXT_PUBLIC_SETTLEMENT_MINT` sama dengan `EXODUZE_SETTLEMENT_MINT`.
- Untuk staking, pastikan wallet punya token settlement mint.

Payout claim gagal:

- Pastikan `NEXT_PUBLIC_TREASURY_TOKEN_ACCOUNT` valid.
- Treasury token account harus token account untuk settlement mint, bukan wallet address biasa.

## Security Notes

- Jangan commit `.env`, `.env.local`, keypair JSON, API key, atau service role key.
- `SUPABASE_SERVICE_ROLE_KEY` hanya boleh dipakai backend.
- Public env frontend harus dianggap terlihat oleh browser.
- Untuk staging/production, jangan gunakan `AI_DECISION_PROVIDER=mock`.

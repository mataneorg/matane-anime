# Plan: Fase 2 (Library dan progress) Matane Anime

> **Status: draf untuk ditinjau** (ditulis 7 Okt 2026 setelah Fase 1 selesai). Belum ada kode. Bagian "Keputusan yang saya ambil sendiri" di akhir perlu dibaca dulu: itu hal-hal yang PRD tidak menentukan.

## Context

Fase 1 selesai: extension berjalan di sandbox, browse, detail, dan pemutar dengan fallback server bekerja end to end, tetapi **app belum mengingat apa pun**. Anime yang dibuka hanya baris cache di tabel `anime`, episode tidak punya progres, pemutar selalu mulai dari detik 0, dan menu History, Library, Global search masih berupa empty state.

Fase 2 (PRD §13) membuat app **mengingat**: library dengan kategori, progres tonton (resume, ambang ditonton, "lanjut nonton"), history, global search, dan migrasi source (P1). Hasil akhirnya adalah alur sehari-hari yang utuh: temukan → tambah ke library → tonton sebagian → tutup app → buka lagi → lanjut persis di tempat berhenti.

Acuan: PRD §6.5 (LIB), §6.6 (PRG), BRW-2, BRW-5, BRW-8, §9 (skema), §10.1 (performa: library 1.000 anime / 50.000 episode, `library.list` ≲ 100 ms), §10.6; mockup `docs/ui/screens/01-library`, `01b-library-empty`, `02-detail`, `05-global-search`, `09-history`, `10-settings-player`, `10d-settings-library`; ADR 0004, 0010–0014; rencana Fase 2 Matane (`manga-reader/docs/plans/fase-2-library-progress.md`) sebagai pola.

Yang **sudah ada dan dipakai ulang**: seluruh skema (`anime.in_library/added_at`, `categories`, `anime_categories`, `episodes.watched/position_ms/duration_ms`, `history`, `watch_sessions`, FTS5 `anime_fts` dengan trigger), `AnimeRepository`, `EpisodesRepository.sync`, `ChangeEmitter` dan event `db.changed`, `invalidateForTags`, `PlaybackService`, `ExtensionService.browse`, komponen `AnimeCard`, `Cover`, `EpisodeList`, `Dialog`, `Select`, `Badge`, `ErrorState`, `EmptyState`, dan `e2e/support/app.ts`.

Di luar cakupan Fase 2: download dan status "terunduh" (Fase 3), update checker, badge "New", halaman Updates (Fase 3), command palette, incognito (UI-nya Fase 5; **hook-nya dibuat sekarang**, lihat 2a), tracker (pasca-v1), ranking `CODECS` (PLY-12, menunggu probe dari renderer).

Dikerjakan dalam **5 milestone**; berhenti dan commit di tiap checkpoint (seperti Fase 1).

---

## Milestone 2a: Lapisan data di main (tanpa UI)

**Logika murni** (`apps/desktop/src/main/watch/`, dengan unit test):
- `threshold.ts`: ambang ditonton (PRG-3). Default **85%**, bisa 50–100; 100% berarti hanya saat video selesai; sekali ditandai ditonton **tidak dibatalkan** bila posisi mundur.
- `resume.ts`: aturan resume (PRG-4). Posisi tersimpan > 10 detik dan di bawah ambang → mulai dari posisi − 3 detik; episode yang sudah ditonton atau posisi ≤ 10 detik → dari awal.
- `unwatched.ts`: hitungan **per nomor episode**, bukan per baris (PRG-5): varian bernomor sama dihitung satu; episode tanpa nomor satu per satu.
- `continue.ts`: "Lanjut nonton" (PRG-6): (1) episode terakhir yang dibuka belum selesai → lanjutkan; (2) sudah selesai → episode belum ditonton berikutnya menurut nomor (varian yang sama dengan yang ditonton, pakai `neighbors` dari Fase 1); (3) belum pernah menonton → episode pertama.

**`WatchService`** (`main/watch/service.ts`): **satu-satunya pintu** penulisan progres, history, dan sesi tontonan (PRG-9). Renderer hanya mengirim heartbeat dan tidak tahu aturannya.
- `progress({ episodeId, positionMs, durationMs, reason })` dengan `reason` ∈ `heartbeat | pause | seek | close | ended`. Menulis `position_ms`/`duration_ms`; di atas ambang → menandai **semua varian dengan nomor yang sama** ditonton (`watched`, `watched_at`); meng-upsert `history` (satu baris per anime) setelah ≥ 5 detik pemutaran sungguhan, bukan sekadar membuka; mencatat `watch_sessions` (`started_at`, `ended_at`, `active_ms` bertambah per heartbeat dengan batas 15 detik per langkah agar lompatan tidak menggelembung).
- `markWatched({ episodeIds, watched })`, `markPreviousWatched(episodeId)` ("tandai semua sebelumnya"), `resetProgress(episodeId)` (PRG-7).
- Hook **incognito** (PRG-11, P1): satu fungsi `isIncognito()` (sekarang selalu `false`) yang dicek di semua jalur tulis otomatis; aksi eksplisit pengguna tetap berlaku. UI-nya Fase 5.
- Setiap tulis memancarkan `db.changed` bertag (`episodes:<animeId>`, `anime:<id>`, `history`, `library`), digabung per tick.

**`LibraryService`** (`main/library/`):
- `add(animeId, categoryIds)`, `remove(animeId)`, `setCategories(animeId, ids)`; `added_at` diisi saat ditambahkan (dasar UPD-4 di Fase 3).
- Kategori (LIB-1): `create`, `rename`, `delete`, `reorder`, `list` dengan jumlah anime. **Tanpa kategori bawaan** (sejalan dengan EXT-7); "All" adalah tampilan, bukan kategori.
- `library.list({ category?, search?, sort, filters })` dalam **satu query SQL** yang mengagregasi per anime: jumlah episode belum ditonton (nomor berbeda), total nomor berbeda, nomor episode terakhir ditonton, progres episode terakhir, waktu terakhir ditonton (join `history`), dan target "lanjut nonton". Pencarian lewat `anime_fts` (judul dan judul alternatif) digabung dengan `in_library = 1`. Sort: judul, terakhir ditonton, episode terbaru (`latest_episode_at`), tanggal ditambahkan, jumlah belum ditonton. Filter: belum ditonton, sedang ditonton, status, source ("terunduh" menunggu Fase 3).
- **Migrasi SQL 0002** (`drizzle-kit generate`): indeks `episodes(anime_id, watched)`, `anime(in_library, added_at)`, `history(watched_at)`, dan indeks pendukung query agregat. Dicek dengan `EXPLAIN QUERY PLAN` di test.

**Cover permanen** (LIB-7, `main/library/covers.ts`): saat anime masuk library, cover diunduh lewat fetcher extension ke `userData/covers/<animeId>.<ext>` (`anime.cover_path`), tidak kena LRU; diperbarui saat `anime.refresh` melihat `thumbnail_url` berubah; dihapus saat anime keluar dari library dan tidak ada di history. `anime://cover/library/<animeId>` melayani dari disk (jatuh ke URL source bila file belum ada). Cover browse tetap cache memori dari Fase 1.

**Kontrak** (`packages/shared`): channel `library.{list,add,remove,setCategories}`, `categories.{list,create,rename,delete,reorder}`, `episodes.{markWatched,markPrevious,resetProgress}`, `watch.{progress,continueTarget}`, `history.{list,delete,clear}`; `playback.start` mengembalikan `resumeMs`; setting `playerWatchedThreshold` (50–100, default 85). Test kontrak menjaga `channels.ts` ≡ `contract.ts`.

**Checkpoint 2a:** unit test (aturan murni, `WatchService`, query library di SQLite in-memory dengan migrasi sungguhan, EXPLAIN memakai indeks) hijau; lewat DevTools: tambah ke library, kirim `watch.progress`, `library.list` mengembalikan angka yang benar.

---

## Milestone 2b: UI Library, detail, dan progres di pemutar

Acuan mockup: `01-library`, `01b-library-empty`, `02-detail`, `03-player`, `10-settings-player`, `10d-settings-library`.

- **Library** `/library` (LIB-1…6, LIB-9): judul + badge jumlah, filter teks (FTS), sort, panel filter, **tab per kategori** (All + kategori, dengan jumlah, tombol tambah), grid **tervirtualisasi** (TanStack Virtual, baris dihitung dari lebar), kartu dengan badge belum ditonton, bar progres tipis, "Ep N / total · LANG", tombol **"Continue Ep N"** saat hover (LIB-6), mode **multi-select** (LIB-5: pindah kategori, tandai ditonton, hapus; "download" nonaktif sampai Fase 3). Empty state per tab; `01b` tetap untuk library kosong.
- **Detail** (BRW-4/5, PRG-7): tombol primer "Continue Ep N" (hasil `watch.continueTarget`) atau "Start watching"; tombol library: "Add to library" membuka dialog kategori, lalu menjadi menu **"In library · …"** (ubah kategori, hapus); baris episode dengan bar progres mini, tanda ditonton, dan menu (tandai ditonton/belum, tandai semua sebelumnya, reset progres); header daftar "24 total · 11 unwatched" (nomor berbeda); filter "Unwatched" aktif ("Downloaded" nonaktif).
- **Pemutar**: `playback.start` memberi `resumeMs` → seek otomatis setelah metadata siap (tanpa dialog, PRG-4); **heartbeat tiap 5 detik** dan juga saat jeda, selesai seek, ganti episode, dan menutup pemutar → `watch.progress`; episode selesai mengirim `ended`. Posisi dan buffer tetap di Zustand, tidak di Query.
- **Settings → Player**: ambang ditonton (slider 50–100, langkah 5, 100 = hanya saat selesai) di samping setting Fase 1. **Settings → Library**: manajer kategori (tambah, ganti nama, hapus dengan konfirmasi, urutkan lewat seret **dan** tombol naik/turun yang bisa dipakai keyboard); bagian "New episode checks" dan "Download automatically" tampil nonaktif (Fase 3).
- String baru EN dan ID; bandingkan screenshot Mocha dan Latte dengan mockup.

**Checkpoint 2b:** alur manual lewat app: tambah ke library dengan kategori → tonton 30 detik → keluar → Library menampilkan progres → "Continue" melanjutkan di posisi − 3 detik; tes UI Playwright hijau.

---

## Milestone 2c: History dan Global search

- **History** `/history` (PRG-8, mockup `09`): satu entri per anime, dikelompokkan per tanggal (Today, Yesterday, nama hari, tanggal) dengan `Intl`; baris menampilkan cover, judul, "Ep N · nama · source", bar progres, "12:43 of 24:10", dan aksi **Continue** atau **Play Ep N+1** bila episode terakhir sudah selesai; tombol hapus per entri dan **Clear all history** dengan konfirmasi dan catatan bahwa library, progres, dan sesi tontonan tidak ikut terhapus (PRG-10: `watch_sessions` terpisah).
- **Global search** `/browse/global-search` (BRW-2, mockup `05`): satu kotak cari, ke **semua source yang terlihat** (NSFW dan bahasa mengikuti setting) **paralel maksimal 5**, hasil **bertahap** per source dalam kartu: mencari (skeleton), N hasil (10 cover pertama + "View all" ke browse source dengan query itu), kosong, galat dengan "Coba lagi", dan **"perlu verifikasi"** untuk `CloudflareError` dengan tombol "Solve check" (membuka verifikasi lalu mengulang). Ringkasan "3 of 5 sources done". Query baru membatalkan yang lama lewat `requests.cancel`. Orkestrasi di renderer (pool konkurensi kecil yang bisa diuji) di atas `sources.browse` (kind `search`, halaman 1); tidak perlu channel baru.
- Kotak cari di title bar membuka halaman ini dengan fokus di input (palet Ctrl+K penuh = Fase 5).

**Checkpoint 2c:** History mencerminkan tontonan dari 2b; global search ke dua source extension contoh (EN dan ID) plus satu source yang sengaja gagal dan satu yang kena challenge tiruan; tes UI hijau.

---

## Milestone 2d: Migrasi source (P1), housekeeping, dan performa

- **Migrasi source** (BRW-8): dari detail, "Migrate to another source" → memilih anime di source lain (hasil pencarian judul, dasar yang sama dengan global search) → `library.migrate({ fromAnimeId, toAnimeId })` dalam satu transaksi: episode dicocokkan **per nomor** (varian yang sama dulu, lalu yang pertama) dengan fungsi murni `matchEpisodes`; `watched`, `watched_at`, `position_ms`, `duration_ms` dipindahkan; kategori, `in_library`, `added_at`, dan baris `history` ikut; anime lama dihapus. Hasilnya meringkas "N episode cocok, M tidak", dan UI menunjukkan episode yang tidak cocok sebelum konfirmasi.
- **Housekeeping**: setiap membuka listing menulis baris `anime`, jadi tabel tumbuh terus. Saat start, baris yang **bukan library, tanpa history, dan tidak disentuh 14 hari** dihapus (episode ikut lewat cascade; FTS lewat trigger). Dicatat di ADR.
- **Performa** (PRD §10.1): skrip `apps/desktop/scripts/seed-library.mts` mengisi 1.000 anime / 50.000 episode; test Vitest mengukur `library.list` (target ≲ 100 ms, batas keras di test dilonggarkan agar tidak flaky di CI) dan query "lanjut nonton"; tes Playwright pada library ber-seed memastikan hanya baris yang terlihat yang ada di DOM dan startup sampai library tampil < 2 detik. Hasilnya masuk ADR.

**Checkpoint 2d:** migrasi antar dua source extension contoh memindahkan progres; purge tidak menyentuh library atau history; angka performa tercatat.

---

## Milestone 2e: Penutup

- **E2E (Playwright `_electron`)**, alur penuh **termasuk restart app** (helper `launchApp` diberi `userData` yang bisa dipakai ulang): cari di global search → buka → tambah ke library + kategori → tonton sebagian → **tutup dan buka lagi app** → library menampilkan progres dan badge → "Continue" melanjutkan di posisi − 3 detik → lewati ambang → episode tertandai ditonton dan "Continue" memilih episode berikutnya → History mencatatnya → migrasi ke source lain membawa progres → hapus dari library. Berjalan di job e2e CI Linux.
- **ADR** (Inggris): 0015 WatchService dan aturan progres (satu pintu, ambang, resume, history setelah 5 detik, sesi tontonan), 0016 query library, indeks, dan purge baris browse, 0017 cover permanen, 0018 orkestrasi global search di renderer, 0019 migrasi source.
- **Dokumen**: PRD (Fase 2 selesai, catatan penyimpangan), README, `docs/plans/fase-2-...` diberi status dan penyimpangan seperti Fase 1.

---

## File kunci

- `packages/shared/src/{catalog.ts,library.ts,watch.ts,settings.ts}`, `packages/shared/src/ipc/{channels,contract}.ts`
- `apps/desktop/src/main/watch/**`, `src/main/library/**`, `src/main/db/repositories/{anime,episodes,history,categories}.ts`, `drizzle/0002_*.sql`, `src/main/ipc/handlers.ts`, `src/main/playback/service.ts` (`resumeMs`), `src/main/playback/covers.ts`
- `apps/desktop/src/renderer/src/routes/_app/{library,history}.tsx`, `routes/_app/browse/global-search.tsx`, `routes/_app/anime/$animeId.tsx`, `features/{library,history,search,anime,player}/**`, `features/settings/{PlayerSettings,LibrarySettings}.tsx`, `lib/catalog.ts`
- `apps/desktop/scripts/seed-library.mts`, `apps/desktop/e2e/{library,history,search,restart}.spec.ts`, `e2e/support/app.ts`
- `docs/adr/00{15..19}-*.md`

## Verifikasi

1. `pnpm lint`, `format:check`, `typecheck`, `test` hijau (aturan murni, `WatchService`, query library dengan EXPLAIN, migrasi episode, kontrak IPC).
2. `pnpm e2e` hijau lokal dan di CI, termasuk skenario restart.
3. Screenshot Library, detail, History, Global search, Settings (Mocha dan Latte) dibandingkan dengan mockup.
4. Benchmark seed 1.000 / 50.000: `library.list` dan "lanjut nonton" tercatat; scroll library lancar dengan DOM terbatas.
5. Cek manual: tutup paksa app saat memutar; progres paling banyak kehilangan 5 detik (heartbeat) dan sesi tontonan tidak ganda.

## Gerbang keluar Fase 2

Fase 3 dimulai bila: (a) milestone 2a–2e selesai dan hijau; (b) alur restart di e2e hijau; (c) angka performa library memenuhi §10.1 atau penyimpangannya tercatat di ADR; (d) `WatchService` adalah satu-satunya jalur tulis progres (dicek dengan pencarian di kode: tidak ada `update(episodes)` untuk progres di luar service itu). Spike 3 OS (ADR 0008/0009) masih terbuka dan tetap harus hijau sebelum beta.

---

## Keputusan yang saya ambil sendiri (mohon ditinjau)

PRD tidak menentukan hal-hal ini; saya memilih default yang paling aman dan mudah diubah:

1. **Tanpa kategori bawaan.** Mockup memakai "Watching / Plan to watch / Completed" sebagai contoh isi, tetapi EXT-7 dan prinsip "app tidak membawa apa pun" membuat saya tidak membuat kategori sendiri. Pengguna membuatnya di Settings → Library atau saat menambah anime.
2. **Resume otomatis tanpa dialog** (PRG-4 menyebut "lanjut dari posisi itu dikurangi 3 detik"); tidak ada pertanyaan "lanjutkan atau mulai dari awal".
3. **History tercatat setelah ≥ 5 detik pemutaran**, bukan saat episode dibuka, agar klik tak sengaja tidak mengisi history.
4. **Baris anime hasil browse dibersihkan setelah 14 hari** bila bukan library dan tanpa history. Alternatifnya (tabel tumbuh selamanya) lebih sederhana tetapi tidak baik untuk pengguna yang sering menjelajah. Angka 14 hari bisa disesuaikan.
5. **Global search diorkestrasi di renderer**, bukan channel `search.global` di main. Lebih sederhana dan pembatalannya sudah ada; konsekuensinya pencarian berhenti bila halaman ditutup (itu memang yang diharapkan).
6. **Menandai satu episode menandai semua variannya** (Sub dan Dub bernomor sama), sesuai PRG-5; "Continue" tetap memakai varian yang sedang ditonton.
7. **Incognito hanya hook di `WatchService`**, tanpa UI, supaya Fase 5 tidak perlu mengubah semua jalur tulis.
8. **Filter "Downloaded" dan aksi "Download"** ditampilkan nonaktif (bukan disembunyikan), supaya tata letak sesuai mockup dan Fase 3 tinggal menyalakannya.

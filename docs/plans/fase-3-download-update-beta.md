# Plan: Fase 3 (Download dan update → beta) Matane Anime

> **Status: selesai (9 Okt 2026), dalam sembilan commit (3a, 3b, 3e, 3h, lalu 3c, 3d, 3f, 3g, dan penutup 3i).** Penyimpangan dari rencana di bawah, dan apa yang ditemukan di jalan:
> - **Urutan dan jalur.** 3a dikerjakan sekali berurutan (kontrak, migrasi, test-site); 3b/3e/3h lalu 3c/3d/3f/3g dikerjakan paralel di git worktree. Karena 3a belum di-commit saat jalur pertama dimulai, worktree dibuat dari `HEAD` dan patch 3a diterapkan sebagai commit sementara; riwayat akhir direkonstruksi per milestone dan cocok persis dengan isi pohon sebelumnya.
> - **Kontrak.** `downloads.clearFinished` menjadi **`downloads.clearFailed`** (episode yang selesai *adalah* hasil unduhan, jadi tombol "Clear finished" di mockup `08` dilabeli "Clear failed"). Ditambah `updates.status` (progres "Check now"), `downloads.openFolder` (3d) dan `categories.setAutoDownload` + `autoDownload` pada kategori (3f).
> - **Urutan UPD-6.** `migrateUrl` berjalan *sebelum* refresh, bukan setelah pengecekan, karena URL yang basi membuat refresh gagal duluan; urutan relatif migrateUrl → auto-download → notifikasi tetap ([ADR 0023](../adr/0023-update-service.md)).
> - **Baseline "episode baru".** Fetch pertama anime yang sudah di library, dan episode yang dibawa migrasi source, tidak pernah dihitung baru (klem `fetched_at` di `library.migrate`).
> - **UPD-5 menghapus.** Episode yang hilang dari source dihapus kecuali ditonton/dimulai/diunduh/di history; satu e2e lama (Sub/Dub) diperbarui untuk perilaku ini.
> - **Pemisahan P1.** Download ahead, hapus setelah ditonton, tray dan jalan saat login masuk Fase 3 (diputuskan pemilik produk). WatchService mendapat hook pengamat (`onWatched`, `onPlayStarted`, `onPlayClosed`); file yang sedang diputar ditahan sampai pemutarannya ditutup.
> - **Benchmark.** Default 1 episode × 6 segmen dan bucket media 30/detik **tidak berubah**; angkanya di [ADR 0021](../adr/0021-download-engine.md). Memori tidak membesar mengikuti ukuran file.
> - **Packaging.** `electron-builder` 26.15.3 dan `electron-updater` 6.8.9; AppImage dibangun dan lolos smoke test paket di Linux ([ADR 0020](../adr/0020-beta-packaging.md)).
> - **Belum:** repo GitHub dan `release.yml` terverifikasi (owner/repo di `electron-builder.yml` dan `RELEASES_URL` masih placeholder), build NSIS dan dmg, auto-update end-to-end, perilaku macOS tanpa tanda tangan di mac asli, spike pemutaran 3-OS (ADR 0008/0009 masih Linux saja; harus hijau sebelum beta publik), tes Windows/macOS, tray/entri login/toggle System yang belum dicoba manual (hanya tes unit), opsi "bersihkan" untuk download dari anime hasil migrasi source, dan konfirmasi unduhan manual yang hilang setelah restart.


> Rencana ini ditulis dalam bahasa Indonesia (kebiasaan proyek). Setelah disetujui, langkah pertama adalah menyalinnya ke `docs/plans/fase-3-download-update-beta.md` (tidak di-commit, untuk ditinjau), lalu bagian "Penyimpangan" di bagian atas diisi setelah fase selesai, seperti Fase 1 dan 2.

## Context

Fase 2 selesai (8 Okt 2026, commit `a396654`). Aplikasi sudah bisa browse, memutar stream, menyimpan library, progress, history, global search, dan migrasi source. Belum ada: download, tonton offline, update checker, halaman Updates, notifikasi, tray, dan paket beta. Fase 3 menutup celah itu, dengan alur penutup: **download → situs mati → tonton offline → episode baru → Updates → auto-download** (PRD §13 Fase 3, §16).

Acuan: PRD §6.7 (DL-1…14), §6.8 (UPD-1…9), §8.3, §9, §10.1, §12, R3/R4/R5/R12/R13/R14; mockup `07-updates`, `08-downloads`, `10c/10d/10e/10f`, `02-detail`; ADR 0003, 0004, 0006, 0008, 0012, 0014, 0015, 0016, 0019.

**Sudah ada dan dipakai ulang** (hasil eksplorasi):
- Tabel `downloads` (sejak `0000_init`, belum ada repository); `anime.added_at`, `episodes.fetched_at` + indeksnya, `episodes.source_missing`; `EpisodesRepository.sync` (sudah mengembalikan `{added, missing}`).
- `playback/upstream.ts::createSessionUpstream` (streaming `session.fetch` + `media` bucket + `withMarkers`), `network/header-bridge.ts`, `network/policy.ts`, `m3u8.ts` (`resolveUri`, `rewriteManifest`), `ranking.ts::rankStreams`, `probe.ts`.
- `ExtensionService.refresh/streamsFor`, `NetworkStatus.isOnline`/`onOnline`, `SettingsRepository`, `ChangeEmitter` + `db.changed`, pola IPC (`channels.ts` + `contract.ts` + `handlers.ts`), `dialog.pickFolder`, `renderer/lib/pool.ts`.
- Stub UI yang tinggal dinyalakan: tombol Download dan chip "Downloaded" (detail, library multi-select), route `/downloads` dan `/updates`, item sidebar, section Settings Downloads, placeholder "New episode checks" di `LibrarySettings.tsx`.
- E2E: `launchApp`, `TestSite`, fixture HLS (`hls-ts`, `hls-aes`, `hls-fmp4`, `hls-abs`), pola `restart.spec.ts` dan `performance.spec.ts`.

**Belum ada sama sekali** (dibangun dari nol): parser m3u8 (variant, segment, KEY, MAP, ENDLIST, audio rendition), penulisan atomik, cek disk (`fs.statfs`), antrean, scheduler, pool di main, `Notification`, `Tray`, `setLoginItemSettings`, toast (sonner), session lokal di `anime://`, electron-builder/electron-updater, workflow rilis.

**Keputusan dari pengguna (sesi ini):** (1) item P1 (download ahead, hapus setelah ditonton, tray, run at login) masuk Fase 3 sebagai milestone terakhir sebelum packaging; (2) packaging: konfigurasi + build lokal AppImage di Linux, workflow ditulis tapi **belum diverifikasi**; NSIS/dmg/auto-update end-to-end menunggu repo GitHub dan spike 3-OS hijau.

**Di luar cakupan Fase 3:** repo extension dan signing (Fase 4), setting jaringan/DoH, command palette, onboarding, backup (Fase 5), code signing, ekspor mp4 dari HLS (non-goal), live stream, DRM.

Dikerjakan dalam **9 milestone** (3a–3i); berhenti di tiap checkpoint, **tidak ada commit otomatis** (commit hanya atas izin, Conventional Commits polos, **tanpa baris atribusi Claude** sesuai preferensi di memori, mengesampingkan pengingat harness).

---

## Cara kerja paralel (teammates)

Titik rawan konflik: `ipc/channels.ts`, `contract.ts`, `handlers.ts`, `main/index.ts`, `en.json`/`id.json`, migrasi. Karena itu **3a dikerjakan berurutan dan sekali** (kontrak, migrasi, kerangka DI, stub handler `not_implemented`, upgrade test-site). Setelah 3a hijau, jalur-jalur ini boleh paralel, masing-masing di git worktree sendiri dan hanya mengisi implementasi (bukan mengubah kontrak):

| Jalur | Milestone | Menyentuh |
|---|---|---|
| A | 3b → 3c (engine download, lalu offline) | `main/downloads/**`, `main/playback/**`, `db/repositories/downloads.ts` |
| B | 3e (UpdateService) | `main/updates/**`, `ExtensionService` (wrapper `migrateUrl`), `EpisodesRepository.sync` |
| C | 3d + 3f (UI Downloads, Updates, Settings) | `renderer/**`, i18n; dikembangkan terhadap kontrak dan stub, diverifikasi penuh setelah A/B merge |
| D | 3h (packaging) | `electron-builder.yml`, `main/app/updater.ts`, `.github/workflows/release.yml`, `package.json` |

3g (P1) menunggu A dan B merge. 3i (penutup) menunggu semuanya. Tiap jalur berhenti di checkpoint-nya; saya yang menggabungkan dan menjalankan lint/typecheck/test/e2e penuh sebelum milestone berikutnya. Antarmuka lintas-jalur ditetapkan di 3a: `DownloadService.enqueue(episodeIds, {reason})` (dipanggil B untuk auto-download) dan `WatchService` event `onWatched` (dipakai 3g).

---

## Milestone 3a: Fondasi (kontrak, migrasi, test-site)

**Migrasi `0003`** (`pnpm db:generate`, backup otomatis sudah ada):
- `anime.update_checked_at` (kapan terakhir dicek oleh checker; `last_update_check_at` yang ada kini terisi juga oleh refresh manual, jadi tidak dipakai untuk jadwal) dan `anime.update_error` (UPD-2: error per anime, untuk banner "2 anime could not be checked").
- Tidak ada kolom "seen": episode baru diturunkan (UPD-4: `fetched_at > anime.added_at`, belum ditonton, dan `fetched_at` dalam 30 hari). Badge Updates = jumlahnya.
- `downloads` tetap; file hilang ditandai `status='error'`, `error='file_missing'` (tanpa mengubah enum).

**Settings** (`packages/shared/src/settings.ts`, otomatis lewat `settings.get/set/changed`): `downloadFolder`, `downloadQuality`, `downloadParallelEpisodes` (1), `downloadParallelSegments` (6), `downloadSizeLimitGb` (20), `downloadAhead`+`downloadAheadCount` (off, 2), `deleteAfterWatched`+`deleteAfterWatchedDelay`+kategori pengecualian (off), `updateIntervalHours` (12), `updateSkipCompleted` (true), `updateSkipNotStarted` (false), `updateSkipUnwatchedOver` (10; null = mati), `autoDownload` (false), `runAtLogin`, `closeToTray`, `updateChannel` (`beta`). Include/exclude auto-download per kategori disimpan di `categories.settings_json` (slot yang belum terpakai).

**Kontrak** (`packages/shared/src/downloads.ts`, `updates.ts`, re-export di `index.ts`): channel `downloads.{list,enqueue,pause,resume,pauseAll,resumeAll,cancel,remove,retry,reorder,clearFailed,storage,changeFolder}` (`clearFailed`, bukan `clearFinished`: episode yang selesai *adalah* hasil unduhan, jadi tombol "Clear finished" di mockup perlu diperbaiki di 3d), `updates.{list,check,count}`; event `downloads.progress` (frekuensi tinggi, untuk Zustand), `updates.status` (progres cek untuk tombol "Check now"), `app.navigate` (klik notifikasi); tag `db.changed`: `downloads`, `updates` (+ cabang di `renderer/lib/catalog.ts::invalidateForTags`). `contract.test.ts` menjaga channels dan contract tetap sama.

**Kerangka main**: `main/downloads/` dan `main/updates/` (service kosong, di-wire di `index.ts` dan `HandlerDeps`), `DownloadsRepository` ditambahkan ke `createTestDb()`.

**Test-site** (`packages/test-site`, fixture di `e2e/fixtures/media` lewat `scripts/make-fixtures.sh`, hasilnya di-commit):
- `site.stop()` / `site.resume()` pada **port yang sama** (hari ini hanya `close()`, port acak) agar "situs mati lalu hidup lagi" bisa diuji.
- `site.setEpisodeCount(slug, n)` per instance (bukan memutasi `CATALOG` global), dikembalikan oleh `reset()`; `uploadedAt` mengikuti waktu.
- Throttle (`segmentDelayMs`/`bytesPerSec`), HLS panjang (≥24 segmen) dan MP4 besar untuk jeda/batal/benchmark, fault per request (403 pada segmen ke-N, reset di tengah).
- Fixture baru (skrip terpisah `make-download-fixtures.sh` / `pnpm fixtures:download`, agar fixture playback lama tidak ikut dibuat ulang): HLS dengan `EXT-X-MEDIA TYPE=AUDIO` (audio terpisah), byte-range, rotasi `EXT-X-KEY`, playlist live (tanpa ENDLIST).

**Checkpoint 3a (tercapai):** lint, format, typecheck, `pnpm test` hijau (kecuali `extensions/otakudesu`, lihat catatan); migrasi `0003` berlaku di DB lama; test-site punya tes untuk stop/resume dan setEpisodeCount.

## Milestone 3b: Engine download (main, logika murni dulu)

**Logika murni** (`main/downloads/`, dengan unit test memakai fixture):
- `hls.ts`: parser master (variant lewat `BANDWIDTH`/`RESOLUTION`, pilih sesuai kualitas download atau terdekat; grup audio `DEFAULT=YES` dari varian terpilih, keputusan §15.2 diuji dengan fixture beragam), parser media playlist (EXTINF, MAP, KEY `AES-128` + IV, byte-range), **tolak live** (tanpa `EXT-X-ENDLIST`) dengan pesan jelas, estimasi ukuran (`BANDWIDTH × durasi`). Penulisan ulang playlist ke path relatif lokal memakai `resolveUri`/`rewriteManifest` dari `m3u8.ts`.
- `layout.ts`: `<folder>/<Source (LANG)>/<Anime>/<Episode>/`, sanitasi nama lintas OS, path disimpan di DB, tidak dihitung ulang (DL-6).
- `atomic.ts`: `.part` + rename per file, folder `<episode>.tmp/` di-rename setelah semua segmen dan `playlist.m3u8` lengkap, segmen yang sudah ada dipertahankan saat jeda/error/tutup app (DL-5).
- `disk.ts`: `fs.statfs`, cek ruang (peringatan < 2 GB bila ukuran tidak diketahui), batas total 20 GB (DL-9/10).

**Pengunduh** (`fetch.ts`): streaming ke disk lewat pola `createSessionUpstream` (media bucket, `withMarkers`, `session.fetch`), ditambah yang tidak dimiliki jalur playback: timeout, retry 3× backoff hanya untuk error yang bisa dipulihkan (DL-7), pemeriksaan skema di tiap redirect, `Range` + `.part` untuk MP4 (DL-4). Upstream disuntikkan agar bisa dites di vitest tanpa Electron.

**Antrean** (`DownloadService`, `DownloadsRepository`): persisten, 1 episode × 6 segmen (angka disetel di 3i), jeda/lanjut/batal/hapus/urutan, tunggu saat offline (`network.status`), pemulihan saat start (`downloading` → `queued`), refresh stream sekali pada 403/410 lewat `ExtensionService.streamsFor(fresh)` + `rankStreams` (R5), event progres dibatasi ~4/detik.

**Housekeeping:** `purgeBrowseRows` melindungi anime yang punya download; hapus dari library tidak menghapus file; anime hasil migrasi source tetap membawa download di baris lamanya dan muncul di Downloads dengan opsi bersihkan (ADR 0019 menyerahkannya ke fase ini).

**Checkpoint 3b:** unit test parser/atomik/antrean; tes integrasi vitest terhadap `TestSite` (HLS ts/aes/fmp4/abs/audio terpisah, MP4 + resume, kill di tengah lalu lanjut hanya segmen yang kurang, live ditolak, disk penuh).

## Milestone 3c: Tonton offline (DL-14, STR-7)

- Jenis sesi baru `'local'` di `SessionStore` + handler file di `playback/` (Range 206 untuk MP4, baca langsung `playlist.m3u8` dan segmen, tanpa host upstream). Renderer tetap satu jalur kode (`anime://play/<id>/…`, §8.3).
- `PlaybackService.startInner` (komentar STR-7 di `service.ts:94`): bila download `done` dan file ada, putar dari disk sebelum mencoba stream; bila file hilang, tandai `error/file_missing` dan jatuh ke streaming. DTO memakai satu kandidat sintetis (`switchStream` dan event tetap valid). Tidak butuh extension terpasang.

**Checkpoint 3c:** unit test sesi lokal (Range, path traversal ditolak); manual: matikan jaringan, episode terunduh tetap diputar.

## Milestone 3d: UI Downloads dan Settings (acuan mockup `08-downloads`, `10e`, `10f`, `02-detail`)

- `/downloads`: header + hitungan status, kartu penyimpanan (terpakai/batas/sisa disk/folder/ganti folder), baris aktif (segmen, byte, kecepatan, ETA; MP4 byte), antrean dengan drag, jeda, gagal + Retry, bagian Completed. Progres lewat store Zustand yang diisi event `downloads.progress`; daftar lewat Query + tag `downloads`.
- Nyalakan tombol Download (detail, multi-select library), chip "Downloaded", indikator per episode + mini progres (BRW-5), badge sidebar Downloads, indikator aktivitas di title bar (UI-1).
- Settings → Downloads (`10e`) dan bagian Storage di Data (`10f`; backup tetap Fase 5). Ganti folder menggeser file dan menulis ulang path.
- Toast: tambah `sonner` (pin versi sesuai ADR 0007). Semua string lewat `t()` di `en.json` dan `id.json` (aturan `i18next/no-literal-string`).

**Checkpoint 3d:** e2e UI (enqueue → progres → selesai, jeda/lanjut, retry error), screenshot Mocha dan Latte dibandingkan dengan mockup.

## Milestone 3e: UpdateService (UPD-1…6)

- Penjadwal (`main/updates/`): off/6/12/24/48 jam/mingguan, juga saat app dibuka bila interval lewat (tunggu `registry.init()` selesai), tunggu saat offline, state terakhir di `settings` (`updates.lastRunAt`).
- Pool 3 anime sekaligus, bisa dibatalkan, error dicatat per anime (`update_error`); cek: semua, per kategori, per anime (pemeriksaan satu anime mengabaikan aturan lewati).
- Aturan lewati sebagai fungsi murni + tes: completed, belum pernah ditonton, belum ditonton > N (`countEpisodes` dari `packages/shared/src/episodes.ts`).
- **UPD-5** di `EpisodesRepository.sync`: episode yang hilang dari source dihapus kecuali watched, punya progress, punya download, atau ada di history/sessions; **daftar kosong tidak menghapus apa pun** (sudah dijaga). Hanya membaca history/sessions, tidak menulisnya (ADR 0015).
- **UPD-6** berurutan: `migrateUrl` (tambah wrapper di `ExtensionService`; deteksi perubahan versi extension lewat kunci settings per extension) → auto-download (DL-11, include/exclude per kategori, "exclude menang", berhenti di batas ukuran) → notifikasi.
- Notifikasi (UPD-7): `Notification` terkelompok ("5 episode baru dari 3 anime"); otomatis selalu, manual hanya bila jendela di latar; klik membuka `/updates` lewat event `app.navigate`.
- `updates.list` (dikelompokkan per hari), `updates.count` (badge). "Mark watched" (tunggal dan massal) **lewat `WatchService`**, satu-satunya penulis progress.

**Checkpoint 3e:** unit test (aturan, jadwal dengan jam palsu, UPD-4/5, pool, urutan UPD-6); tes integrasi terhadap `TestSite` + `setEpisodeCount`.

## Milestone 3f: UI Updates dan Settings Library (acuan `07-updates`, `10d`)

- `/updates`: chip jumlah, "Last checked", Check now, Mark all as watched, banner anime yang gagal dicek + Retry, grup Today/Yesterday, aksi Play/Download/mark watched per baris, badge sidebar.
- `LibrarySettings`: interval, aturan lewati, auto-download + tri-state per kategori (menggantikan placeholder).

**Checkpoint 3f:** e2e UI; screenshot vs mockup.

## Milestone 3g: P1 (DL-12, DL-13, UPD-9)

- **Download ahead**: saat menonton, N episode berikut (default 2), hanya anime library, mengikuti batas ukuran.
- **Hapus setelah ditonton**: berlangganan event watched dari `WatchService` (tanpa menulis progress), jeda N episode, kategori pengecualian.
- **Tray + tutup ke tray + run at login** (`main/app/tray.ts`, `app.setLoginItemSettings`, bagian System di `10c`): mengubah `window-all-closed` di `index.ts:252` dan `close` di `app/window.ts`; di Linux tray opsional dan app tidak boleh bergantung padanya (R14).
- Bila jadwal mepet, P1 yang digeser ke v1.x (R11), dicatat di bagian Penyimpangan.

**Checkpoint 3g:** unit test pemicu; manual tray di Linux (jika desktop mendukung AppIndicator).

## Milestone 3h: Packaging beta (verifikasi Linux saja)

- ADR 0020 menambah pin `electron-builder` dan `electron-updater` (ADR 0007 belum mem-pin); `apps/desktop/electron-builder.yml`: `appId dev.sukun.matane-anime`, `productName Matane Anime`, target AppImage/NSIS/dmg (arm64+x64), `files` memuat `out/` (termasuk `extension-host.js`), `drizzle/` dan `resources/`, **tanpa** `e2e/` dan `extensions/`; `asarUnpack` untuk `better-sqlite3`; ikon dari PNG 1024 (saat ini 512, perlu aset baru); skrip `pack`/`dist`.
- **Risiko pertama dicek lebih awal:** pnpm tanpa `node-linker=hoisted` dengan electron-builder (perlu `files`/`asarUnpack` eksplisit atau `pnpm deploy`), WASM `quickjs-emscripten` dari dalam asar di `utilityProcess`.
- `main/app/updater.ts` (electron-updater): hanya saat `app.isPackaged`, channel `beta` lewat `allowPrerelease`, macOS tanpa signing hanya memberi tahu (R13), pengecekan hanya ke GitHub Releases (tanpa telemetri, §10.3). Versi aplikasi menjadi `0.1.0-beta.1`. About/Updater di Settings belum punya mockup, jadi dibuat minimal dan dicatat; mockup diperbaiki dulu bila perlu (ADR 0006).
- `.github/workflows/release.yml` (matriks 3-OS mengikuti `spike.yml`, `contents: write`, `GH_TOKEN`, build per OS karena modul native, R12) dan skrip smoke test paket (jalankan AppImage di bawah xvfb: DB terbuka, migrasi, extension host jalan).

**Checkpoint 3h:** AppImage terbuat dan lolos smoke test lokal. **Belum** (dicatat): NSIS, dmg, auto-update end-to-end, spike 3-OS, repo GitHub.

## Milestone 3i: Penutup (E2E, benchmark, ADR, dokumen)

- **E2E** `e2e/downloads.spec.ts` (Playwright `_electron`, pola `restart.spec.ts`): tambah ke library → download HLS (+ varian audio terpisah dan MP4) → `site.stop()` → putar offline (tanpa permintaan ke situs di `site.log`, ulangi setelah restart app) → `site.resume()` + `site.setEpisodeCount(+1)` → cek update → episode muncul di Updates → auto-download (kategori include) → episode terunduh.
- **Benchmark** `e2e/download-bench.spec.ts` (pola anotasi `performance` + `PERF_OUT`): mengukur paralelisme dan bucket media dengan test-site ber-throttle, menyetel ulang default 1×6 dan 30/detik (PRD §15.2), tanpa lonjakan memori (§10.1). Hasil dipasang di ADR.
- **ADR** (Inggris, mulai 0020 setelah 0019): 0020 toolchain packaging; 0021 download engine (layout, atomik, pilihan audio rendition, parameter hasil benchmark); 0022 sesi lokal + STR-7; 0023 UpdateService (episode baru diturunkan, jadwal, UPD-5/6). Update PRD (Fase 3 selesai, §15.2), README, status dan penyimpangan di plan.

## File kunci

- `packages/shared/src/{downloads,updates,settings}.ts`, `ipc/channels.ts`, `ipc/contract.ts`
- `apps/desktop/src/main/{downloads,updates}/**`, `db/repositories/{downloads,episodes}.ts`, `db/schema/library.ts`, `drizzle/0003_*`, `db/housekeeping.ts`
- `main/playback/{service,sessions,scheme,proxy}.ts` + berkas sesi lokal baru; `main/extensions/service.ts` (wrapper `migrateUrl`), `main/watch/service.ts` (event watched), `main/index.ts`, `main/ipc/handlers.ts`, `main/app/{tray,updater,window}.ts`
- `renderer/src/routes/_app/{downloads,updates}.tsx`, `routes/_app/settings/**`, `features/{downloads,updates}/**`, `components/shell/{Sidebar,TitleBar}.tsx`, `lib/catalog.ts`, `i18n/locales/{en,id}.json`
- `packages/test-site/src/{server,catalog}.ts`, `apps/desktop/scripts/make-fixtures.sh`, `apps/desktop/e2e/**`
- `apps/desktop/electron-builder.yml`, `.github/workflows/release.yml`, `docs/adr/0020–0023`, `docs/plans/fase-3-download-update-beta.md`

## Verifikasi

1. Tiap milestone: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` hijau.
2. `pnpm e2e` (butuh display nyata; `xvfb-run` belum terpasang di mesin ini, di CI sudah) hijau, termasuk spec lama (restart, library, player).
3. Layar baru dibandingkan dengan mockup Mocha dan Latte di `docs/ui/screens`.
4. Manual: paksa tutup app di tengah download lalu buka lagi (hanya segmen yang kurang diunduh); cabut jaringan lalu putar episode terunduh; cek notifikasi dan klik ke Updates.
5. AppImage hasil `pnpm --filter desktop dist` dijalankan lokal (smoke test).
6. CI tidak pernah menyentuh situs asli; semua terhadap `packages/test-site`.

## Gerbang keluar Fase 3

Fase 4 dimulai bila: (a) semua P0 DL/UPD lulus dan E2E penutup hijau; (b) angka benchmark tercatat dan default disetel; (c) AppImage lolos smoke test lokal; (d) tersisa dan **dicatat sebagai "Belum"**: repo GitHub + `release.yml` terverifikasi, NSIS dan dmg, auto-update beta end-to-end, spike 3-OS hijau (ADR 0008/0009 masih Linux saja; harus hijau sebelum rilis beta publik), tes Windows/macOS.

---

## Keputusan yang saya ambil sendiri (mohon ditinjau)

PRD tidak menentukan hal-hal ini; saya memilih default yang paling aman dan mudah diubah.

1. **Episode baru diturunkan, tanpa kolom "seen"**: `fetched_at > added_at`, belum ditonton, 30 hari terakhir. Alternatif: kolom `seen_at`. Kelemahan: episode lama yang belum ditonton hilang dari Updates setelah 30 hari.
2. **Waktu cek terakhir di kolom baru** `anime.update_checked_at`, karena `last_update_check_at` ikut terisi oleh refresh manual.
3. **File hilang = `status='error'`, `error='file_missing'`** tanpa mengubah enum DB; dibanding menambah status `broken`.
4. **Audio rendition** = grup `DEFAULT=YES` dari varian terpilih (asumsi PRD), diverifikasi dengan fixture baru.
5. **Include/exclude auto-download per kategori** disimpan di `categories.settings_json`.
6. **Hapus dari library tidak menghapus file download**; anime hasil migrasi source membawa download di baris lamanya.
7. **Toast memakai `sonner`** (PRD UI-5 menyebutnya, belum ada di dependensi).
8. **Pengunduh memakai jalur streaming `session.fetch`** (bukan `ExtensionFetcher.request` yang membuffer dan memakai bucket halaman), dengan retry/timeout sendiri.
9. **Channel update `beta` sebagai default** selama fase beta.
10. **Folder `extensions/otakudesu` ada di repo ini** (sudah ter-commit di `484cec0`), padahal PRD §15.1/R9 dan ADR 0013 menyatakan extension nyata ada di repo terpisah. Packaging mengecualikan `extensions/`; apakah foldernya dipindah, saya serahkan ke kamu.

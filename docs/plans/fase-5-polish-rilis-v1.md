# Plan: Fase 5 (Polish dan rilis v1.0) Matane Anime

> **Status: dibangun (9 Okt 2026) di branch `development`. Pembaruan 10 Okt 2026: suite e2e penuh (146 tes, termasuk `phase5.spec.ts`) hijau di Electron pada akhir pekerjaan UI Matane, bersama lint, format, typecheck dan build; sisanya di daftar "Belum" di bawah belum diuji.** Catatan asli dari 9 Okt: Satu commit per milestone (5a sampai 5h), dikerjakan di kantor tanpa menjalankan Electron: tidak ada e2e, `pnpm build`, `pnpm dist`, `smoke:packaged` atau `verify:packages` yang dijalankan. Yang lolos: lint, format, tiga typecheck desktop (node, web, e2e) dan unit test per milestone. Hasil nyata menunggu uji di rumah ([Daftar uji rumah](#daftar-uji-rumah)).
>
> **Penyimpangan dari rencana:**
> - **Urutan.** 5a, lalu 5c (incognito) dikerjakan langsung; 5b, 5e, dan 5f+5g paralel di worktree; 5d menyusul. Dua worktree dibuat dari `main`, bukan `development`, jadi hasilnya digabung dengan `merge --squash` dan konflik kecil di `handlers.ts`, `index.ts` dan berkas i18n diselesaikan tangan.
> - **Migrasi `network.userAgent`** dikerjakan di 5b (bersama pembaca barunya), bukan 5a.
> - **Zip backup memakai kode sendiri** di atas `node:zlib` (`main/backup/zip.ts`), bukan `fflate`: `fflate` hanya dependensi `extension-repo` dan menambah dependensi mengubah lockfile ([ADR 0030](../adr/0030-backup-restore.md)).
> - **Restore lewat staging dan relaunch**, bukan menukar DB yang terbuka; `backup.import` mengembalikan `reloaded: true` yang berarti "app dimulai ulang".
> - **DoH `auto`** berarti mode otomatis Chromium (DoH dulu, lalu resolver sistem), kebalikan dari kata-kata awal PRD ([ADR 0028](../adr/0028-network-settings.md)).
> - **Updater:** `canInstallUpdates` kini false untuk build portable (`PORTABLE_EXECUTABLE_FILE`), perubahan kecil di luar daftar rencana ([ADR 0031](../adr/0031-extra-packages.md)).
> - **Tema:** audit menemukan satu celah nyata (kontras teks di atas 11 aksen Latte, 2,3 sampai 3,5:1) dan memperbaikinya; selebihnya sudah ada ([ADR 0032](../adr/0032-onboarding-and-whats-new.md)).
> - **ADR 0028–0032** ditulis (jaringan, incognito, backup, paket tambahan, onboarding/What's new/palet).
> - **Tambahan setelah milestone (9 Okt 2026): kecepatan loading.** Cache cover di disk dengan batas ukuran di Settings, antrean rate limit terpisah untuk cover, timeout cover 10 detik, Browse mengingat halaman pertama Popular dan Latest, probe stream paralel, dan prefetch detail anime saat kartu di-hover ([ADR 0033](../adr/0033-cover-cache.md), [0034](../adr/0034-parallel-stream-probe.md), [0035](../adr/0035-prefetch-on-hover.md)). Hanya diuji unit; butirnya ada di daftar uji rumah nomor 3.
> - **e2e:** `launchApp` kini menandai onboarding selesai kecuali spec meminta `onboarding: true`, supaya spec lama tidak berhenti di layar onboarding; `phase5.spec.ts` ditulis dan hanya di-typecheck.
> - **Dokumentasi:** teks `apps/docs` dicocokkan dengan kode setelah merge (DoH otomatis, SOCKS5 dengan login, restore dan pemasangan ulang extension, What's new).
>
> **Pembaruan 10 Okt 2026:** setelah fase ini, UI diselaraskan dengan Matane ([ADR 0036](../adr/0036-ui-follows-matane.md), [rencana](ui-parity-matane.md)), halaman Statistics, backup terjadwal dan halaman About ditambahkan, 15 extension situs digabung dari `feat/extension`, latensinya dioptimalkan, lalu dipindahkan ke repositori sendiri ([ADR 0037](../adr/0037-extension-latency.md)). Placeholder repo `SukunDev/matane-anime` sudah diganti `mataneorg/matane-anime`, dan SDK, runtime dan CLI sudah terbit di npm.
>
> **Situs docs:** `pnpm --filter @matane-anime/docs docs:build` hijau (10 Okt 2026, tanpa tautan mati); `.github/workflows/docs.yml` membangunnya pada PR/push yang menyentuh `apps/docs`, tanpa deploy (host belum dipilih).
>
> **Belum:** `pnpm dist` dan build portable/deb/rpm (hanya AppImage yang pernah diverifikasi); `release.yml` yang belum pernah jalan dan auto-update; `latest.yml`/`latest-linux.yml` dengan target baru; nama variabel `PORTABLE_EXECUTABLE_FILE`; DoH/proxy/`safeStorage`/dialog backup/relaunch di Electron nyata; spike 3-OS (ADR 0008/0009); Flatpak dan AUR (hanya draf); dialog What's new tanpa mockup; kontak untuk laporan perilaku dan keamanan (belum ada alamat); langkah manual rilis v1.0 (versi, tag, merge `development` ke `main`).

## Context

Fase 1–4 selesai: extension, pemutar, library/progress, download/update, repo extension, dan SDK sudah di npm. PRD §13 mendefinisikan Fase 5 sebagai "polish dan rilis v1.0": setting jaringan (DoH, proxy, UA, tes koneksi), command palette, onboarding, What's new, tema AMOLED + aksen, incognito, backup/restore, paket tambahan, dokumentasi lengkap. Fase ini menutup kriteria penerimaan v1.0 (§16) sejauh bisa dikerjakan tanpa mesin lain.

**Batasan kerja (permintaan pemilik produk):**
- Dikerjakan di kantor: **jangan menjalankan e2e Playwright, `pnpm dist`, `smoke:packaged`, `pnpm build`/electron-vite, atau apa pun yang membuka Electron.** Pengujian di rumah oleh pemilik produk.
- Yang boleh: lint/format/typecheck dan unit test vitest pada file/paket yang berubah, memakai `nice -n 19` dan `--maxWorkers=2`.
- Semua kerja di branch baru **`development`** (dari `main`), di-**commit dan push** (`git push -u origin development`) di setiap checkpoint milestone. Tidak ada merge ke `main`, tag, PR, atau publish npm.
- Commit: Conventional Commits polos, **tanpa atribusi apa pun** (aturan pemilik produk, juga ada di memory dan `~/.claude/CLAUDE.md`).
- Boleh memakai teammates (subagent), maksimum 3 sekaligus, masing-masing di git worktree sendiri dan tidak commit; saya yang menggabungkan, memeriksa, lalu commit.

## Temuan riset (yang sudah ada)

- **Tema:** AMOLED dan 14 aksen **sudah ada** (`packages/shared/src/theme.ts`, `settings.ts`, `renderer/src/theme/ThemeProvider.tsx`, `GeneralSettings.tsx`). Sisanya audit kontras/mockup `10c`, bukan fitur baru.
- **Incognito:** hook `WatchService.deps.isIncognito` sudah memotong semua jalur tulis otomatis (`main/watch/service.ts:149`, teruji), tetapi `main/index.ts:180-187` tidak menyuplainya; tidak ada state, IPC, atau UI. Mockup `09b` ada.
- **Jaringan:** UA global hanya baris mentah `network.userAgent` (`network/manager.ts:16`, tanpa UI). Tidak ada proxy/DoH/`safeStorage`. `RepoFetcher` (`network/repo-fetcher.ts`) adalah jalur terpisah di sesi `persist:repos`. Rute `settings/network` jatuh ke EmptyState; mockup `10b` ada.
- **Shell:** ada petunjuk `Ctrl K` di `TitleBar.tsx` tetapi tidak ada palet; satu-satunya `keydown` ada di `PlayerView.tsx:367`. Mockup `11`, `12`–`12d` ada; **What's new tidak punya mockup**. Tidak ada deteksi first-run atau `lastSeenVersion`.
- **Backup:** `DataSettings.tsx` baru berisi Storage; mockup `10f` ada. `db/migrate.ts` sudah membuat salinan `sqlite.backup()` sebelum migrasi dan memigrasi maju DB lama, tetapi tidak menolak DB dari versi lebih baru.
- **Paket/dokumen:** target AppImage/NSIS/dmg saja; `release.yml` belum pernah jalan; placeholder `SukunDev/matane-anime` di `electron-builder.yml:44-48`, `updater.ts:7` (+ `updater.test.ts`), `docs/releasing.md`. Belum ada CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, template issue, VitePress, atau disclaimer di README.

## Keputusan

Dari pemilik produk: (1) paket tambahan = **portable + deb + rpm**; Flatpak dan AUR hanya draf di `docs/packaging/` (tidak bisa diuji tanpa Flathub/AUR). (2) Backup = **data pengguna saja** (library, kategori, progress, history, watch_sessions, setting, repo extension, daftar extension terpasang, cover); tanpa file unduhan dan tanpa kode extension.

Yang saya putuskan sendiri (untuk ditinjau; semuanya mudah diubah):
1. **Incognito hanya di memori main**, mati lagi saat app dimulai ulang (privasi lebih aman; PRD diam soal ini). Tidak masuk backup.
2. **Kata sandi proxy** disimpan terenkripsi `safeStorage` lewat `SettingsRepository.setValue`, tidak pernah dikirim ke renderer (hanya flag `hasPassword`); bila keyring tidak ada, disimpan polos dan halaman memberi peringatan (sesuai mockup `10b`).
3. **Endpoint tes koneksi:** `https://www.gstatic.com/generate_204` (HEAD), memakai nilai form yang belum disimpan ("settings di atas"). Bisa diganti nanti.
4. **Palet perintah tanpa dependensi baru**: `components/ui/dialog` + daftar sendiri, bukan `cmdk`.
5. **What's new** memakai changelog yang dibundel (`apps/desktop/resources/changelog.json` atau modul TS) dan menampilkan hanya bila `lastSeenVersion` ada dan lebih lama; tidak tampil pada instalasi baru. Karena tidak ada mockup, dibuat dengan token yang ada dan **dicatat sebagai penyimpangan dari ADR 0006**.
6. **Restore:** menolak backup dari skema lebih baru dari app; memakai salinan pengaman DB sebelum menimpa; extension dari backup ditandai "perlu dipasang ulang" dan dipasang dari repo yang dipulihkan; `downloadFolder` dikosongkan ke default bila path tidak ada.
7. **Format backup:** satu zip (`fflate`, sudah dipakai `extension-repo`) berisi `manifest.json` (versi app, versi skema, tanggal), `data.db` (hasil `VACUUM INTO`), `covers/`; tabel `downloads`, `image_cache`, dan baris browse-only dibuang dari salinan.
8. **Situs VitePress** di `apps/docs` (otomatis masuk workspace `apps/*`), bukan di `docs/` yang berisi PRD/ADR/plan.
9. **Rilis v1.0 dan publikasi tetap manual**: tidak ada tag, versi tidak dinaikkan, tidak ada push ke `main`.

## Cara kerja paralel

5a dikerjakan sendiri dan berurutan: menambah semua kontrak/setting/string i18n yang dipakai milestone lain (handler awal melempar `unsupported`, seperti Fase 4), supaya jalur tidak berebut `settings.ts`, `channels.ts`, `contract.ts`, `handlers.ts`, `en.json`/`id.json`.

| Gelombang | Jalur | Isi |
|---|---|---|
| 1 | N: jaringan (5b) | main + `NetworkSettings` |
| 1 | B: backup (5e) | service backup/restore + `DataSettings` |
| 1 | D: dokumen dan paket (5f, 5g) | electron-builder/release.yml, docs, VitePress |
| 2 | U: incognito, palet, onboarding, What's new, tema (5c, 5d) | renderer + sedikit main |
| 3 | penutup (5h) | spec e2e (ditulis, tidak dijalankan), ADR, PRD, gerbang keluar |

Setiap jalur: worktree di `.claude/worktrees/<jalur>` dari HEAD `development`, tanpa commit, menjalankan hanya lint/typecheck/unit test pada file yang disentuh dengan `nice -n 19`. Saya menggabungkan lewat patch, menjalankan pemeriksaan gabungan, lalu commit dan push per milestone.

## Milestone

**5a. Fondasi** (sendiri)
- `git switch -c development`; tulis `docs/plans/fase-5-polish-rilis-v1.md` (salinan rencana ini dalam bahasa Indonesia, format seperti `fase-4-ekosistem-extension.md`); `git push -u origin development`.
- Perbaiki placeholder `SukunDev/matane-anime` → `mataneorg/matane-anime`: `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/app/updater.ts` (+ `updater.test.ts`), `docs/releasing.md`.
- `packages/shared/src/settings.ts`: kunci jaringan (`dohMode` off/auto/always, `dohProvider`/`dohCustomUrl`, `proxyMode` system/none/http/socks5, host, port, user, `userAgent`), `onboardingDone`, `lastSeenVersion`; tes di `settings.test.ts`. Migrasi baris lama `network.userAgent` ke kunci baru.
- Kontrak IPC (`ipc/channels.ts`, `contract.ts`, handler `unsupported` di `main/ipc/handlers.ts`): `network.testConnection`, `network.setProxyPassword`, `incognito.get/set` + event, `backup.export/import/peek`, `app.changelog`. Kerangka kunci i18n EN+ID. `contract.test.ts` tetap hijau.
- **Checkpoint 5a:** lint, format, typecheck, unit test shared + desktop terkait hijau → commit + push.

**5b. Jaringan** (acuan mockup `10b`; NET-4/6/8)
- Modul murni `main/network/config.ts` (tanpa import `electron`): pemetaan setting → opsi `configureHostResolver` dan `ProxyConfig`, validasi DoH hanya `https`, validasi UA; tes vitest seperti `policy.test.ts`.
- `applyNetworkSettings` (main): `session.setProxy` pada sesi default, `persist:repos`, dan setiap `persist:ext-*` (termasuk yang dibuat belakangan, via `NetworkManager.fetcherFor`); `app.configureHostResolver`. Dipanggil saat start dan di `settings.set` (`handlers.ts:101`).
- `userAgentOf` (`manager.ts:54`) dan `RepoFetcher` (`index.ts:118-123`) membaca UA dari setting; sandi proxy lewat `safeStorage`, main-only.
- `network.testConnection` (fungsi dengan `get`/`now` yang disuntik, teruji unit).
- `NetworkSettings.tsx` + cabang `network` di `routes/_app/settings/$section.tsx`; string EN+ID.
- **Checkpoint 5b.**

**5c. Incognito** (acuan `09b`; PRG-11)
- State dalam memori di main + `incognito.get/set` + event; suplai `isIncognito` di `main/index.ts:180-187`.
- UI: pill di `TitleBar.tsx`, banner dan tombol "Turn off" di History, indikator di pemutar (tanpa title bar), aksi palet "Toggle incognito".
- Tes: `service.test.ts` sudah menutup hook; tambah tes state/IPC.
- **Checkpoint 5c.**

**5d. Palet, onboarding, What's new, tema**
- Palet `Ctrl+K` (acuan `11`) di `__root.tsx`/`AppShell`, dinonaktifkan di rute pemutar: navigasi (`nav.ts`), pencarian library, "lanjut nonton" dari `history.list`, aksi (cek update, jeda download, incognito), pencarian di source (`/browse/global-search`). Tombol cari di title bar membuka palet. Logika penyaringan/peringkat dibuat murni dan diuji.
- Onboarding 4 langkah (acuan `12`–`12d`) memakai komponen setting yang sudah ada; gerbang di `__root.tsx` bila `onboardingDone` salah; instalasi lama (library tidak kosong) dianggap selesai.
- What's new: `app.changelog`, `lastSeenVersion` vs `app.getVersion()`, dialog sekali tampil, tautan ke `RELEASES_URL`.
- Tema: audit AMOLED/aksen/`on-accent` terhadap `10c` dan `styles.css`; perbaiki bila ada selisih; tambah tes bila logika berubah.
- **Checkpoint 5d.**

**5e. Backup dan restore** (acuan `10f`; P1)
- `main/backup/` dengan fungsi murni yang teruji memakai `db/__tests__/helpers.ts`: buat arsip (keputusan 7), baca/validasi manifest, tolak skema lebih baru, restore (salinan pengaman, tukar DB, jalankan `runMigrations`, pulihkan cover, tandai extension "perlu dipasang ulang", normalisasi `downloadFolder`), lalu emit `db.changed` global.
- IPC dengan dialog buka/simpan; bagian Backup di `DataSettings.tsx` (+ ringkasan isi backup sebelum restore, peringatan menimpa data); string EN+ID.
- **Checkpoint 5e.**

**5f. Paket tambahan**
- `electron-builder.yml`: target `portable` (nama artefak berbeda dari NSIS), `deb`, `rpm` (maintainer, vendor, homepage, depends). `release.yml`: argumen target dan glob unggahan (`*.deb`, `*.rpm`, portable `.exe`). `updater.ts` sudah hanya memberi tahu untuk Linux non-AppImage; periksa tidak ada regresi.
- `docs/packaging/` berisi draf manifest Flatpak + metainfo dan PKGBUILD, ditandai **belum diverifikasi**.
- Yang bisa diverifikasi di kantor hanya sintaks YAML dan tes unit; build paket di rumah.
- **Checkpoint 5f.**

**5g. Dokumentasi**
- README: fitur, instalasi per OS (termasuk cara melewati SmartScreen/Gatekeeper), **disclaimer** (§12).
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/` (bug, fitur; permintaan sumber diarahkan ke repo extension), template PR.
- `apps/docs` (VitePress): panduan pengguna (instal, repo extension, library, download, jaringan, backup) dan panduan penulis dari `docs/extensions.md` + `docs/repositories.md`. Instal dependensi dengan `pnpm install --filter @matane-anime/docs... --ignore-scripts` agar tidak memicu `electron-rebuild`; `vitepress build` hanya sekali di akhir.
- **Checkpoint 5g.**

**5h. Penutup**
- Spec e2e `apps/desktop/e2e/phase5.spec.ts` **ditulis tetapi tidak dijalankan** (jaringan/proxy lokal, incognito tidak mencatat progress, palet, onboarding, backup→restore). Hanya dicek lewat `typecheck` (termasuk `tsconfig.e2e.json`).
- ADR 0028+ (jaringan/DoH/proxy, incognito, backup, paket tambahan), perbarui `docs/PRD.md` (§13 Fase 5, §15.2, §16), `docs/releasing.md`, README, dan tulis bagian status + "Belum" di `docs/plans/fase-5-polish-rilis-v1.md`.
- Tambahkan **daftar uji rumah** di dokumen plan (lihat Verifikasi).
- **Checkpoint 5h:** commit + push; ringkasan untuk pemilik produk.

## File kunci

`packages/shared/src/{settings,theme}.ts`, `packages/shared/src/ipc/{channels,contract}.ts`; `apps/desktop/src/main/index.ts`, `main/ipc/handlers.ts`, `main/network/{manager,repo-fetcher,config}.ts`, `main/watch/service.ts`, `main/db/{migrate.ts,repositories/settings.ts}`, `main/backup/*`, `main/app/updater.ts`; renderer `components/shell/{TitleBar,AppShell}.tsx`, `routes/__root.tsx`, `routes/_app/settings/$section.tsx`, `features/settings/{NetworkSettings,DataSettings,GeneralSettings}.tsx`, `i18n/locales/{en,id}.json`; `apps/desktop/electron-builder.yml`, `.github/workflows/release.yml`; `apps/docs/*`.

Dipakai ulang: `network/policy.ts` (pola modul murni), `RepoHttp`/`RepoFetcher`, `SettingsRepository.getValue/setValue`, `settingsFromStored`, `runMigrations` + `backupDir`, `db/__tests__/helpers.ts`, `fflate` (`extension-repo`), komponen `components/ui/*`, `useIpcEvent`, `notify` (`lib/toast`).

## Verifikasi

**Di kantor (per milestone, hemat CPU, tanpa Electron):**
1. `nice -n 19 pnpm exec eslint <file yang berubah>` dan `pnpm exec prettier --check <file>`.
2. `nice -n 19 pnpm --filter @matane-anime/shared test` dan `pnpm --filter @matane-anime/desktop exec vitest run <path> --maxWorkers=2`.
3. `nice -n 19 pnpm --filter @matane-anime/desktop typecheck` di checkpoint (menjangkau spec e2e tanpa menjalankannya).
4. Tidak dijalankan: `pnpm e2e`, `pnpm build`, `pnpm dist`, `pnpm smoke:packaged`, `pnpm verify:packages`.

**Di rumah (oleh pemilik produk):** `pnpm install`, `xvfb-run -a pnpm e2e` (termasuk `phase5.spec.ts`), `pnpm build`, `pnpm dist` + `pnpm smoke:packaged`; uji manual: DoH/proxy ke sumber yang diblokir dan tombol Test connection, incognito (tidak ada history/progress, hilang setelah restart), palet `Ctrl+K`, onboarding pada profil baru, What's new setelah ganti versi, backup→hapus data→restore, bandingkan UI dengan mockup Mocha dan Latte; bangun portable/deb/rpm; `workflow_dispatch` `release.yml` tanpa publish di GitHub; `cd apps/docs && pnpm build`.

## Gerbang keluar Fase 5

Selesai bila: semua checkpoint 5a–5h ter-push di `development`; lint/format/typecheck/unit hijau; spec e2e Fase 5 ada. **Belum (dicatat di dokumen plan):** hasil e2e dan build paket di rumah, verifikasi `release.yml` dan auto-update, spike 3-OS (ADR 0008/0009), Flatpak/AUR, What's new tanpa mockup, serta langkah manual rilis v1.0 (versi, tag, merge `development` → `main`).

---

## Daftar uji rumah

Urutan yang disarankan, dari yang paling murah:

1. `git switch development && corepack pnpm@12.5.1 install` (Electron dan `better-sqlite3` dibangun ulang), lalu `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.
2. `xvfb-run -a pnpm e2e` (di Linux tanpa layar) atau `pnpm e2e` (dengan layar). Spec baru: `e2e/phase5.spec.ts`. Spec lama kini melewati onboarding lewat `launchApp`.
3. `pnpm dev` dan jalankan tangan:
   - **Onboarding:** profil baru (hapus folder data atau pakai `--user-data-dir`); pratinjau bahasa dan tema langsung; profil lama tidak melihatnya.
   - **Palet:** `Ctrl+K` di mana saja kecuali pemutar; panah, Enter, Tab, Esc; "Lanjut nonton", pencarian library, tiap aksi.
   - **Incognito:** pil di title bar dan di pemutar, banner di Riwayat; tidak ada riwayat/progress saat aktif; mati lagi setelah restart.
   - **Jaringan:** proxy HTTP dengan dan tanpa login, Test connection dengan nilai yang belum disimpan; DoH Always lalu Off; alamat `http://` ditolak; peringatan kata sandi polos tanpa keyring; User-Agent kustom.
   - **Backup:** buat backup, hapus data, restore; library, progres, riwayat dan cover kembali; extension berstatus "perlu dipasang ulang"; ada `backups/db/pre-restore-*.db`; zip rusak dan zip dari versi lebih baru ditolak.
   - **What's new:** ubah `lastSeenVersion` ke versi lebih lama lalu mulai ulang.
   - **Tema:** putar semua aksen di Latte dan perhatikan teks tombol; AMOLED nonaktif di Latte.
   - **Kecepatan loading** ([ADR 0033](../adr/0033-cover-cache.md), [0034](../adr/0034-parallel-stream-probe.md), [0035](../adr/0035-prefetch-on-hover.md)); cek dengan sumber yang lambat atau sebagian mati, bukan hanya yang sehat:
     - **Cache cover:** buka Browse (popular), tutup app, buka lagi: cover harus langsung muncul tanpa menunggu situs. Di Settings → Data and storage ukuran Cover cache naik; turunkan batas ke 256 MB dan ukuran terpakai ikut turun; Clear cache mengosongkannya (cover yang sudah di layar bisa tetap tampil sampai app ditutup). Cover library tetap ada setelah Clear cache.
     - **Cover mati:** matikan jaringan ke satu host gambar (atau pakai sumber yang covernya lambat); kotak cover jadi placeholder dalam sekitar 21 detik, bukan satu menit lebih.
     - **Antrean terpisah:** buka halaman Browse dengan cache cover kosong; daftar hasil, Search, dan detail anime tidak menunggu cover selesai.
     - **Browse langsung terisi:** setelah satu kali membuka Popular dan Latest, tutup app dan buka lagi: daftar terakhir langsung tampil dengan tulisan "Updating the list…", lalu diganti daftar baru. Matikan jaringan dan buka lagi: daftar terakhir tetap tampil; pada sumber yang belum pernah dibuka, muncul keterangan offline seperti biasa. Search tidak diingat.
     - **Stream paralel:** pilih episode dari sumber yang server teratasnya mati atau menggantung; video mulai sekitar 1,5 detik setelah server yang hidup menjawab, bukan setelah beberapa timeout 8 detik. Di pemilih server, server yang dibatalkan berstatus tersedia, bukan gagal; yang benar-benar gagal berstatus gagal. Dengan semua server sehat, server teratas tetap yang diputar. Jika semua mati, pesan "No server answered" muncul seperti sebelumnya.
     - **Prefetch saat hover:** arahkan pointer ke kartu anime yang belum pernah dibuka dan diam sekitar setengah detik; log extension memperlihatkan permintaan detail dan episode (tanpa mengklik). Buka anime itu: daftar episode sudah terisi. Menggeser pointer cepat melintasi grid tidak memicu permintaan; paling banyak dua permintaan sekaligus. Klik saat prefetch masih jalan tidak menggandakan permintaan.
4. `pnpm build`, `pnpm dist` dan `pnpm smoke:packaged`; `pnpm dist` di tiap OS membangun target yang tertulis di `electron-builder.yml` (portable di Windows; deb dan rpm di Linux, dengan paket `rpm` terpasang). Pasang deb dan rpm di mesin bersih.
5. Di GitHub: jalankan `release.yml` lewat `workflow_dispatch` **tanpa** publish; unduh artefak dan periksa `latest.yml` dan `latest-linux.yml`.
6. `pnpm --filter @matane-anime/docs docs:build` dan periksa tautan mati.
7. Setelah semuanya hijau: naikkan versi, merge `development` ke `main`, tag.

## Gerbang keluar Fase 5

Fase ini selesai untuk **dibangun** bila: semua milestone ter-push di `development` dan lint, format, typecheck, unit test dan dokumen sinkron dengan kode (terpenuhi 9 Okt 2026). Fase ini selesai untuk **dirilis** hanya setelah daftar uji rumah di atas hijau dan daftar "Belum" di atas kosong atau dicatat sebagai keputusan.

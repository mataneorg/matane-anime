# Plan: Fase 4 (Ekosistem extension) Matane Anime

> **Status: selesai (9 Okt 2026), dalam sebelas commit (4a, 4b, paket npm, penyambungan, 4d, 4c, perbaikan 18+, e2e repo, `--min-app-version`, UI 4e, dokumen 4f).** Dikerjakan selagi pemilik produk tidur; penyimpangan dari rencana di bawah, dan apa yang ditemukan di jalan:
> - **Urutan.** Kontrak, migrasi, setting dan pembuangan otakudesu dari workspace (4a) dikerjakan sekali; pustaka format repo (4b) dan paket npm (4f, bagian 1) paralel; lalu main process (4c) dengan CLI + test-site (4d) paralel; lalu UI (4e), e2e IPC (4g) dan dokumen paralel.
> - **Pembaca zip sendiri.** `fflate.unzipSync` menerima zip yang mengaku kecil tetapi mengembang 50 MB (memotong diam-diam), jadi `readArchive` membaca central directory sendiri dan menghentikan inflate di ukuran yang diumumkan ([ADR 0024](../adr/0024-extension-repositories.md)).
> - **Anti-rollback untuk semua repo, bukan hanya yang terpercaya.** Serial yang lebih kecil ditolak untuk repo unverified juga; begitu pula tanda tangan rusak. Lebih ketat dari rencana (keputusan 3), dipertahankan.
> - **Bug yang ditemukan e2e dan diperbaiki:** flag 18+ hanya ada di baris `extensions` yang dihapus saat uninstall, jadi source extension 18+ yang sudah dicopot lolos filter. Kolom `sources.nsfw` (migrasi 0005, diisi dari `extensions`).
> - **Tambahan:** `ma-ext repo build --min-app-version` (app sudah menghormati `minAppVersion` tetapi tidak ada cara menulisnya); teks scaffold menyebut Developer mode; `extensions/example/icon.png`.
> - **Paket npm:** kondisi export `matane-source` (sumber di dalam workspace, `dist` untuk konsumen), `prepack` menggantikan `prepare` di CLI, `scripts/verify-packages.mjs`. **Tidak ada yang diterbitkan.**
> - **Mockup:** mode dev, panel log, konfirmasi uninstall/update dan error repo tidak punya mockup; dibuat konsisten dengan token yang ada.
> - **Belum:** pengecekan ketersediaan nama `@matane-anime` di npm dan publikasi paket (langkah manual pemilik produk, daftar periksa di `docs/releasing.md`); repo GitHub dan verifikasi `release.yml` (owner/repo masih placeholder di `electron-builder.yml`, `RELEASES_URL`, dan field `repository` paket); VitePress (Fase 5); pemindahan `extensions/otakudesu` ke repo sendiri; `RepoFetcher` hanya teruji lewat e2e (butuh Electron); pesan error dari main untuk repo dan install hanya berbahasa Inggris (belum diterjemahkan ke Indonesia); `minAppVersion` belum diuji di UI; npm/yarn sebagai konsumen dan Node 22 belum diverifikasi.


> Dibuat saat pemilik produk tidur dan menyerahkan semua keputusan; semua pilihan yang tidak ditentukan PRD ada di "Keputusan yang saya ambil sendiri" di bawah, untuk ditinjau. Bagian "Penyimpangan" diisi setelah fase selesai, seperti Fase 1–3.

## Context

Fase 3 selesai (download, tonton offline, update checker, Updates, P1, paket beta Linux). Aplikasi bisa memuat extension, tetapi hanya dari **folder dev** (ADR 0013). Belum ada cara bagi pengguna untuk menemukan, memasang, dan memperbarui extension, dan belum ada cara bagi penulis extension untuk menerbitkannya. Fase 4 menutup celah itu: **tambah repo → periksa tanda tangan → percayai kunci → pasang → pakai → perbarui → copot**, plus alat penulis (`ma-ext repo …`, SDK siap terbit, panduan).

Acuan: PRD EXT-5…EXT-10, EXT-15, EXT-16, EXT-18, UPD-6, §9 (tabel `extension_repos`, `extensions`), §10.2/§10.3, R6, R9, R10, §15.2 (ketersediaan nama); mockup `06-extensions`, `06b-extension-install-dialog`, `06c-add-repo-dialog`, `10c-settings-general` (bahasa konten, 18+); ADR 0003, 0006, 0010–0013, 0019.

**Sudah ada dan dipakai ulang:** skema DB lengkap (`extension_repos`, `extensions.repo_id`, prefs/storage dengan cascade) tanpa kode; `ExtensionRegistry` (memuat bundle `manifest.json` + `index.js`, hot reload mtime, satu `id` satu asal antar folder dev) dan `findBundle/readBundle`; `ExtensionStore`; `ExtensionService` (`migrateUrl`, `extensionVersions`, `supportsMigrateUrl`); `UpdateService.migrateUrls` (UPD-6); `ma-ext create|build|test|bench` (output `dist/{index.js,manifest.json,icon.png}`); `manifestSchema` + `API_VERSION`; `downloads/atomic.ts` (`writeFileAtomic`, `removePath`); filter NSFW di renderer; panel log di Settings → Advanced; `packages/test-site`; pola e2e `extensions.spec.ts`.

**Belum ada:** semua kode repo/install/uninstall; ed25519 (cukup `node:crypto`); pembaca/penulis zip; fetcher yang bukan milik extension; origin di registry (kini semua `dev`); pemeriksaan integritas dan `apiVersion` saat memuat; filter bahasa konten; penegakan NSFW di main; `ma-ext repo …`; build `dist/` untuk paket npm; panduan lengkap.

**Di luar cakupan Fase 4:** situs VitePress (Fase 5, bersama dokumentasi lengkap), DoH/proxy untuk fetch repo (Fase 5; R8), publikasi ke npm, membuat repo GitHub, dan pengecekan ketersediaan nama `@matane-anime` (PRD §15.2: **langkah manual pemilik produk**, tidak dijalankan otomatis), helper SDK opsional EXT-17 (P1, bila sempat).

Dikerjakan dalam **7 milestone** (4a–4g) dengan jalur paralel; setiap milestone berhenti di checkpoint dan di-commit (Conventional Commits polos, **tanpa baris atribusi Claude**; tidak ada push, tidak ada publish).

---

## Cara kerja paralel

Kontrak, migrasi, dan setting dikerjakan sekali (4a, berurutan) supaya jalur tidak berebut `channels.ts`, `contract.ts`, `handlers.ts`, `index.ts`, i18n. Lalu gelombang:

| Gelombang | Jalur | Isi |
|---|---|---|
| 1 | R: `packages/extension-repo` (4b) | pustaka format repo: kunci, tanda tangan, index, zip, semver |
| 1 | N: paket npm (4f) | build `dist/`, `exports`, README, LICENSE, `pnpm pack` terverifikasi |
| 2 | M: main process (4c) | RepoService, InstallService, registry berasal-ganda, penegakan NSFW/bahasa |
| 2 | C: CLI + test-site (4d) | `ma-ext repo keygen|build|verify`, test-site menyajikan repo |
| 3 | U: UI (4e) | halaman Extensions, dialog, setting bahasa konten, mode dev |
| 3 | D: dokumen (4f) | `docs/extensions.md`, README, ADR |
| 4 | penutup (4g) | E2E alur penuh, ADR, dokumen, gerbang keluar |

Jalur bekerja di git worktree masing-masing dari HEAD bersih (`.claude/worktrees/<jalur>`), tidak commit; saya menggabungkan lewat patch dan menjalankan lint/typecheck/test/e2e penuh sebelum commit per milestone.

---

## Milestone 4a: Fondasi (kontrak, migrasi, setting, buang bentrokan)

- **Migrasi `0004`:** `extensions.origin` (`'dev'|'repo'`, default `'dev'`), `extensions.install_dir`, `extensions.sha256` (hash `index.js` terpasang, untuk deteksi perubahan); `extension_repos.signing_key` (kunci yang diumumkan repo, `public_key` tetap = kunci yang dipercaya pengguna), `extension_repos.serial` (anti-rollback).
- **Setting baru:** `contentLanguages: string[]` (kosong = semua bahasa; `multi` selalu lolos), `devMode: boolean` (Settings → Advanced).
- **Kontrak IPC** (`packages/shared/src/extensions-repo.ts` + `ipc/*`): `repos.{list,preview,add,remove,refresh,setTrust}`, `extensions.{available,prepareInstall,install,update,updateAll,uninstall}`; `ExtensionInfo` mendapat `origin: 'dev'|'repo'`, `repo`, `updateAvailable`, `trust`, `shadowed`, `installDir`-tanpa-path; event memakai tag `db.changed` `repos`/`extensions`. Handler awal melempar `unsupported`; `contract.test.ts` tetap hijau.
- **Buang bentrokan:** workspace `extensions/*` dipersempit ke `extensions/example` karena `extensions/otakudesu` (extension nyata, yang menurut PRD §15.1/R9 dan ADR 0013 harus di repo terpisah) membuat `pnpm test` dan CI gagal (fixture-nya tidak ada). Foldernya **tidak dihapus**; pemindahan ke repo sendiri diserahkan ke pemilik produk.
- **Checkpoint 4a:** lint, format, typecheck, test hijau; migrasi berlaku di DB lama.

## Milestone 4b: Pustaka format repo (`packages/extension-repo`, MIT)

Dipakai CLI (menulis), app (memverifikasi), dan test-site (menyajikan); dibundel, tidak diterbitkan terpisah.
- **Kunci:** `ed25519:<hex 32 byte>`; sidik jari tampilan `7f3a…c91e`; `generateKeyPair()` memakai `node:crypto`, privat sebagai PEM PKCS8.
- **`index.json`** (`format: 1`, `name`, `serial`, `generatedAt`, `extensions[]` dengan `id`, `name`, `version`, `apiVersion`, `minAppVersion?`, `nsfw`, `langs`, `sources`, `archive`, `sha256`, `size`, `icon`, `iconSha256`, `iconSize`) dengan skema zod; batas EXT-5 (index 2 MB, arsip 20 MB, ikon 512 KB) sebagai konstanta.
- **`index.json.sig`:** JSON `{alg:'ed25519', key:'ed25519:…', sig:'<base64>'}`; yang ditandatangani adalah **byte persis `index.json`** (tanpa kanonikalisasi; app menyimpan byte itu di `extension_repos.index_json`).
- **Arsip zip** (`fflate`, versi dipin sesuai ADR 0007): berisi tepat `manifest.json`, `index.js`, `icon.png`; pembaca menolak entri lain, path berbahaya (zip-slip), ukuran tak terkompresi melewati batas (bundle 2 MB, ikon 512 KB), dan bom kompresi (periksa `originalSize` sebelum inflate).
- **Verifikasi paket:** sha256 + ukuran terhadap entri index, manifest di zip cocok dengan entri (id, version, apiVersion), `manifestSchema`, `apiVersion ≤ API_VERSION`; perbandingan semver.
- **Checkpoint 4b:** tes unit lengkap (kunci, tanda tangan sah/rusak/kunci lain, index rusak, zip jahat, hash tak cocok, semver); tidak ada ketergantungan Electron.

## Milestone 4c: Main process (repo, install, registry)

- **`RepoFetcher`** (`network/repo-fetcher.ts`): `net.request` di partition `persist:repos`, http(s) per hop, timeout, batas byte berjalan, `AbortSignal`; tidak memakai fetcher extension (UA, bucket, cookie berbeda).
- **`RepoStore` + `RepoService`:** `preview(url)` (ambil index + sig, verifikasi, kembalikan nama, kunci, status: `signed`, `unsigned`, `invalid`), `add(url, trustKey)`, `remove`, `refresh` (anti-rollback: tolak `serial` lebih kecil; repo terpercaya menolak index yang tidak lagi bertanda tangan kuncinya dan menandai `last_error`), `setTrust`. Segarkan saat app start (non-blokir, bila online), saat halaman Extensions dibuka, dan sebelum cek update terjadwal.
- **`InstallService`:** `prepareInstall` (unduh arsip, verifikasi hash/ukuran/isi/`apiVersion`/`minAppVersion`, kembalikan token dengan TTL 5 menit + data dialog: trust, API, bahasa, ukuran, SHA-256, konflik, peringatan *unverified*); `install(token)` menulis atomik `userData/extensions/<id>.tmp` → `<id>.old` → `<id>` dengan rollback saat gagal, mengisi `extensions` (origin `repo`, `repo_id`, `install_dir`, `sha256`), memuat lewat registry; `update` (langsung, tanpa dialog; hanya ke versi lebih tinggi dari repo yang sama; `updateAll`); `uninstall` (hapus folder, `extensions` row → cascade prefs/storage, bersihkan `persist:ext-<id>` dengan `clearStorageData`/`clearCache`, `network.invalidate`; source dan anime tetap di DB, tampil "source belum terpasang").
- **Registry berasal-ganda:** record memiliki `origin`; extension repo dimuat dari `install_dir` saat start dengan **pemeriksaan sha256 `index.js` dan `apiVersion` saat memuat** (berubah ⇒ status `error` "modified", tidak dijalankan); poll mtime hanya untuk `dev`; **EXT-9:** satu `id` dari satu asal (dev > repo; folder dev menutupi extension repo ber-id sama sebagai `shadowed`, dipulihkan saat folder dilepas; id yang sudah terpasang dari repo lain menolak `prepareInstall` dengan pesan "also offered by …").
- **`migrateUrl` (EXT-16):** dijalankan segera setelah install/update/muat-ulang versi baru (bukan hanya saat cek update), jangkauan diperluas ke anime yang hanya ada di history atau punya download; baseline versi tersimpan di `updates.extensionVersions` dan tidak hilang saat uninstall.
- **NSFW dan bahasa (EXT-15) ditegakkan di main:** `sources.list`/`extensions.available` menyaring `nsfw` dan `contentLanguages`; `sources.browse`/`resolveUrl` menolak source 18+ saat `showNsfw` mati (`forbidden`); daftar *Installed* tetap menampilkan semuanya (agar bisa dicopot).
- **Checkpoint 4c:** tes unit dengan DB nyata dan fake fetcher (tanda tangan, trust, rollback, kunci berganti, token kedaluwarsa, instalasi atomik dengan kegagalan di tengah, integritas saat muat, konflik EXT-9, uninstall membersihkan, migrateUrl setelah update).

## Milestone 4d: CLI dan test-site

- **`ma-ext repo keygen [--out dir]`** (tulis `repo-key.pem` mode 0600 dan `repo-key.pub`), **`repo build <dir…> --out <repoDir> --key <pem> --name <nama> [--base-url url] [--unsigned]`** (membuat `<id>-<versi>.zip`, ikon, `index.json` dengan `serial` naik, `index.json.sig`), **`repo verify <dirOrUrl> [--key ed25519:…]`** (tanda tangan, hash/ukuran semua arsip dan ikon, manifest cocok; exit ≠ 0 bila gagal).
- **Test-site menyajikan repo:** `site.setRepo({...})` untuk `index.json`, `.sig`, arsip, ikon, dengan variasi rusak (tanda tangan kunci lain, hash salah, arsip terlalu besar, index tidak ditandatangani, serial turun, kunci berganti).
- **Checkpoint 4d:** tes CLI (alur keygen → build → verify, dan kegagalan terdeteksi); tes test-site.

## Milestone 4e: UI (acuan mockup `06`, `06b`, `06c`, `10c`)

- **Halaman Extensions:** header (Check repositories, Add repository), banner "N updates available" + Update all, tab Installed / Available / Repositories, filter bahasa dan "Show 18+ sources", baris terpasang (versi, badge Update, meta, trust: *Trusted key*/*Unverified repository*, preferensi, uninstall dengan konfirmasi, badge 18+, catatan konflik/`shadowed`), baris tersedia (Install), tab Repositories (nama, URL, sidik jari, status, sinkron terakhir, refresh, hapus).
- **Dialog:** Add repository (06c: peringatan unverified, sidik jari kunci, "Trust this key", catatan tidak ada repo bawaan), Install (06b: repo, API, bahasa, ukuran, SHA-256, kotak sandbox; peringatan unverified dan kasus tidak kompatibel/hash gagal yang tidak digambar mockup), Uninstall. Estado kosong tanpa repo menjelaskan langkah awal tanpa menyarankan repo (EXT-7).
- **Settings:** Content language (chip dari bahasa source yang ada + `multi`) dan 18+ di General (10c); **Advanced → Developer mode** (`devMode`): "Load from folder" dan panel log yang diperkaya (filter level, bersihkan, salin, error muat sebagai baris log) hanya tampil bila aktif; folder dev yang sudah dimuat tetap tampil.
- Semua string lewat `t()` di `en.json` dan `id.json`; mockup yang belum ada (mode dev, dialog update/uninstall, error index) dibuat konsisten dengan token yang ada dan dicatat.
- **Checkpoint 4e:** e2e UI (tambah repo unverified → peringatan → trust → install → muncul di Browse; update; uninstall; filter 18+/bahasa); screenshot Mocha dan Latte dibandingkan dengan mockup.

## Milestone 4f: Paket npm dan panduan

- **Siap terbit (tidak diterbitkan):** `@matane-anime/extension-{sdk,runtime,cli}` dibuild ke `dist/` (JS + `.d.ts`), `exports`/`types`/`files`/`engines`/`repository`/`keywords`/`publishConfig.access`, `private` dicabut, versi `0.1.0`, README per paket, LICENSE MIT di CLI, CLI memakai `prepack` (bukan `prepare`) untuk membangun, zod sebagai dependensi dengan rentang; skrip `scripts/verify-packages.mjs`: `pnpm pack` ketiga paket → pasang tarball di folder sementara → `ma-ext create` + `build` + `test` berhasil.
- **Panduan:** `docs/extensions.md` ditulis ulang (repo, `index.json`, penandatanganan, `ma-ext repo …`, install/update/uninstall dari sisi pengguna, `migrateUrl` dan versi semver/`apiVersion`, ikon wajib, mode dev, semantik NSFW/bahasa, cara menerbitkan); README disegarkan (status, bagian Extensions). Situs VitePress ditunda ke Fase 5.
- **Checkpoint 4f:** `verify-packages.mjs` hijau; dry-run `npm publish --dry-run` per paket lolos.

## Milestone 4g: Penutup

- **E2E** `e2e/repo.spec.ts` (Playwright `_electron`, test-site menyajikan repo hasil `ma-ext repo build`): tambah repo → peringatan *unverified* → percayai kunci → install `example` → browse dan putar → repo menerbitkan versi 1.1.0 → Update (migrateUrl berjalan, anime tetap terbuka) → hash dirusak ditolak, index bertanda tangan kunci lain ditolak untuk repo terpercaya, serial turun ditolak → file `index.js` terpasang diubah ⇒ ditolak saat start → uninstall membersihkan, anime tetap ada "source belum terpasang" → folder dev menutupi extension repo → NSFW/bahasa tersaring. Seluruh suite e2e lama tetap hijau.
- **ADR** (Inggris, mulai 0024 setelah ADR Fase 3): repo dan penandatanganan (format, trust, anti-rollback), instalasi atomik dan integritas saat muat, registry berasal-ganda dan EXT-9, filter NSFW/bahasa di main, paket npm. ADR 0013 ditandai diperluas.
- **Dokumen:** PRD (Fase 4 selesai, §15.2), README, bagian Penyimpangan di plan ini.

## File kunci

- `packages/extension-repo/**`; `packages/extension-cli/src/{cli,repo}.ts`; `packages/extension-{sdk,runtime,cli}/package.json` dan build; `packages/test-site/src/{server,repo}.ts`
- `packages/shared/src/{extensions-repo,catalog,settings}.ts`, `ipc/{channels,contract}.ts`
- `apps/desktop/src/main/extensions/{registry,service,repos,install,store}.ts`, `network/repo-fetcher.ts`, `db/schema/extensions.ts`, `drizzle/0004_*`, `db/repositories/{extension-store,updates}.ts`, `ipc/handlers.ts`, `index.ts`
- `apps/desktop/src/renderer/src/routes/_app/browse/extensions.tsx`, `features/extensions/**`, `features/settings/{General,Advanced}Settings.tsx`, `i18n/locales/{en,id}.json`
- `apps/desktop/e2e/{repo,extensions}.spec.ts`; `docs/extensions.md`, `docs/adr/0024+`

## Verifikasi

1. Tiap milestone: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` hijau (otakudesu tidak lagi bagian workspace).
2. `pnpm e2e` penuh hijau, termasuk spec lama (library, player, downloads, updates, offline).
3. Layar baru dibandingkan dengan mockup Mocha dan Latte.
4. `scripts/verify-packages.mjs` (paket npm), `pnpm run pack:dir` + smoke test paket tetap lolos (zip dan crypto ikut ter-bundle).
5. CI tidak menyentuh situs atau repo asli; repo uji adalah fixture lokal.

## Gerbang keluar Fase 4

Fase 5 dimulai bila: (a) semua P0 EXT lulus dan e2e penutup hijau; (b) paket npm lolos `verify-packages` dan dry-run; (c) tersisa dan **dicatat "Belum"**: pengecekan ketersediaan nama `@matane-anime`, publikasi npm, repo GitHub dan verifikasi `release.yml`, spike 3-OS, pemindahan `extensions/otakudesu` ke repo sendiri, VitePress.

---

## Keputusan yang saya ambil sendiri (mohon ditinjau)

PRD tidak menentukan hal-hal ini; saya memilih default yang paling aman dan mudah diubah.

1. **Format kunci dan tanda tangan:** `ed25519:<hex>`; `index.json.sig` berupa JSON berisi kunci pengumuman dan tanda tangan base64 atas **byte persis** `index.json` (tanpa kanonikalisasi). Kunci yang dipercaya pengguna disimpan di `extension_repos.public_key`, kunci pengumuman di kolom baru `signing_key`.
2. **Repo tanpa tanda tangan = *unverified*** (boleh ditambahkan, tidak pernah "terpercaya"); repo yang menandatangani dengan kunci belum dipercaya juga *unverified* sampai pengguna menyetujui "Trust this key"; kunci yang berganti pada repo terpercaya **ditolak** (hapus dan tambah ulang repo untuk mempercayai kunci baru).
3. **Anti-rollback** memakai `serial` bilangan bulat di index (naik setiap `repo build`); index dengan serial lebih kecil ditolak untuk repo terpercaya; extension hanya diperbarui ke versi lebih tinggi.
4. **Zip dengan `fflate`** (pustaka kecil tanpa dependensi) dengan pemeriksaan ukuran sebelum inflate; isi arsip dikunci pada tiga file. PRD §8.5 menyebut menghindari pustaka zip berat; `fflate` memenuhi itu dan tidak menarik dependensi.
5. **Lokasi:** extension terpasang di `userData/extensions/<id>/`; instalasi `.tmp` → `.old` → rename dengan rollback.
6. **Integritas saat muat:** sha256 `index.js` disimpan di DB dan dicek tiap memuat; tidak cocok ⇒ status `error`.
7. **EXT-9:** folder dev menutupi extension repo ber-id sama (`shadowed`); id yang sudah dipasang dari repo lain menolak pemasangan dari repo kedua.
8. **Daftar Installed tidak disaring** oleh 18+/bahasa (supaya bisa dicopot); filter berlaku di Available, Browse, dan pencarian global, dan **ditegakkan di main**, bukan hanya renderer.
9. **`contentLanguages`** kosong berarti semua bahasa; `multi` selalu lolos.
10. **Mode dev** adalah setting (`devMode`) yang menggerbangi "Load from folder" dan panel log yang diperkaya; IPC `extensions.loadDevFolder` tidak berubah (e2e lama tetap jalan).
11. **`extensions/otakudesu` dikeluarkan dari workspace** (tidak dihapus) agar CI hijau; memindahkannya ke repo terpisah (PRD §15.1) adalah keputusan pemilik produk.
12. **Tidak ada publish/push/pembuatan repo GitHub dan tidak ada pengecekan nama paket di npm**; hanya persiapan dan dry-run.
13. **Pustaka `packages/extension-repo`** dibundel ke CLI dan app, tidak diterbitkan terpisah (MIT, sama seperti SDK/CLI).
14. **VitePress ditunda ke Fase 5**; Fase 4 menulis ulang `docs/extensions.md` sebagai panduan lengkap.

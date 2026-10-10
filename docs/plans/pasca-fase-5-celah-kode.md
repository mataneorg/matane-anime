# Plan: Celah kode setelah Fase 5 (10 Okt 2026)

> **Status: dikerjakan 10 Okt 2026 di branch `development`, belum di-commit.** Empat jalur paralel oleh agen. Tidak ada e2e, `pnpm build`, `pnpm dist` atau apa pun yang membuka Electron; hasil nyata menunggu uji di mesin pemilik produk.

## Yang dikerjakan dan yang tidak

Dikerjakan (bisa dibuktikan lewat unit test, lint, typecheck, dan `vitepress build`):

| Jalur | Isi | Sumber celah |
|---|---|---|
| **D. Docs** | Jalankan `vitepress build`, perbaiki tautan mati, tambah workflow CI yang membangun situs docs | Fase 5 "Belum" |
| **C. Codec** | PLY-12: stream dengan `CODECS` yang tidak didukung diurutkan paling akhir | PRD §6.3 PLY-12 (ditunda) |
| **B. markSeen** | Tandai entri Updates sebagai "sudah dilihat" tanpa menandai ditonton | UI parity, ditunda |
| **A. i18n main** | Katalog bahasa untuk proses main (notifikasi, tray) menggantikan salinan manual; pesan error repo dan install ikut diterjemahkan; uji `minAppVersion` di sisi main | TODO di `system.ts`, `updates/messages.ts`; Fase 4 "Belum" |

Tidak dikerjakan, dengan alasan:

- **Butuh Electron atau mesin lain:** `pnpm dist`, build portable/deb/rpm, `release.yml`, auto-update, e2e, DoH/proxy/`safeStorage` di Electron nyata, spike 3-OS, uji lintas OS.
- **Langkah pemilik produk:** naikkan versi, merge ke `main`, tag, alamat kontak untuk CoC dan SECURITY, memilih host situs docs (jadi `base` VitePress tidak diubah dan workflow docs hanya membangun, tidak men-deploy).
- **Butuh desain atau mockup dulu:** migrasi massal, tracking AniList/MAL, mockup dialog What's new.
- **Tidak bisa diuji tanpa Flathub/AUR:** Flatpak dan AUR tetap draf.

## Cara kerja

- Satu pohon kerja (`development`), tanpa worktree: node_modules dan modul native tidak perlu dibangun ulang. Tiap jalur punya berkas sendiri; berkas bersama (`en.json`, `id.json`, `contract.ts`, `channels.ts`, `handlers.ts`, `PRD.md`) diedit dengan `Edit` kecil setelah dibaca ulang, tidak pernah ditimpa utuh dan tidak pernah dikembalikan.
- Agen hanya menjalankan test pada berkas miliknya (`vitest run <berkas>`, `nice -n 19`, `--maxWorkers=2`). Lint, format, typecheck penuh dan seluruh unit test dijalankan sekali oleh saya setelah semua jalur selesai.
- Tidak ada commit, push, tag, atau publish. Hasil tetap sebagai perubahan kerja untuk ditinjau.
- ADR baru: 0038 (codec), 0039 (i18n main), 0040 (markSeen).
- Setelah laporan masuk, agen dihentikan.

## Jalur C: peringkat codec (PLY-12)

Masalah: `main` tidak bisa memanggil `MediaSource.isTypeSupported`, jadi stream yang codec-nya tidak diputar Chromium baru ketahuan saat diputar (audio tanpa gambar, ADR 0014).

Rancangan:
1. Renderer mengukur dukungan sekali saat start (tabel tetap: `avc1`, `hvc1`/`hev1`, `vp09`, `av01`, `mp4a.40.2`, `opus`, `flac`, dll. lewat `MediaSource.isTypeSupported`) dan melaporkannya ke main lewat satu channel IPC baru; main menyimpannya di memori.
2. Probe HLS membaca lebih dari 64 byte dari master playlist (batas kecil) untuk mengambil atribut `CODECS` tiap varian. Stream yang semua variannya tidak didukung ditandai.
3. Stream yang ditandai **diturunkan ke akhir antrean, tidak dibuang** (PRD: "peringkat paling akhir"), jadi tetap dicoba bila semuanya gagal. Tanpa laporan dukungan atau tanpa `CODECS`, perilaku lama tidak berubah.
4. Fungsi murni (parser `CODECS`, pencocokan, peringkat) dengan unit test; tes `service` untuk urutan akhir.
5. ADR 0038; PRD PLY-12 diubah dari "ditunda" ke selesai.

## Jalur B: `markSeen` pada Updates

Rujukan perilaku: Matane (`../manga-reader`), hanya sebagai referensi. Entri Updates yang "dilihat" hilang dari daftar dan badge sidebar tanpa menandai episode ditonton atau mengubah progres.

Rancangan: kolom `update_seen_at` pada `episodes` (migrasi drizzle baru); `UpdatesRepository.list/count` menyaringnya; `markSeen`/`markAllSeen` di service, kontrak IPC dan handler; UI di halaman Updates (aksi pada pilihan, "Mark all as seen"); string en dan id; episode yang baru muncul kemudian tetap tampil. Backup/restore sudah menyalin DB utuh, jadi hanya perlu dipastikan migrasi ikut. Test repository, service, dan e2e hanya ditulis, tidak dijalankan. ADR 0040.

## Jalur A: i18n di proses main

1. `main/i18n/`: katalog `en` dan `id` bertipe, fungsi `mainT(language, key, params)`, dan test bahwa kunci `id` sama persis dengan `en`.
2. `updates/messages.ts` dan `app/system.ts` memakainya; dua TODO hilang.
3. Pesan `AppError` dari repo dan install (di `extensions/repos.ts`, `install.ts`, dan yang dipakai `toRepoAppError`) mendapat kunci stabil di `detail`; `describeError` di renderer menerjemahkan lewat `errors.main.*` di `en.json`/`id.json` dan jatuh ke `message` bila kunci tidak dikenal. Pesan Inggris di main tidak diubah (log dan tes lama tetap).
4. Test: `describeError` dengan kunci, `minAppVersion` ditolak di `InstallService.prepareInstall` dan diizinkan bila cukup (tambah hanya yang belum ada).
5. ADR 0039.

## Jalur D: situs docs

`pnpm --filter @matane-anime/docs docs:build`; perbaiki tautan mati dan galat build di `apps/docs`; tambah `.github/workflows/docs.yml` (build saat PR/push yang menyentuh `apps/docs`, versi action dipin, tanpa deploy). Catat hasil di plan Fase 5 pada daftar "Belum".

## Gerbang selesai

`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` hijau; `docs:build` hijau; dokumen (PRD, plan Fase 5, ADR) sinkron dengan kode. Yang tetap belum: semua butir "butuh Electron" di atas.

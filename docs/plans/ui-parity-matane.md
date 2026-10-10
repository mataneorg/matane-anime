# Rencana: samakan layout, UX, dan fitur UI dengan Matane

> **Status: dikerjakan (10 Okt 2026) dan sudah ada di `development`** (commit `2d7570b`, `ea4ea14`, `34bf407`, `1e55422`). Layout dan UX Library, Browse, Downloads dan Extensions mengikuti Matane; Display modes, ukuran cover serta sort dan filter tersimpan, halaman Statistics, backup terjadwal dan halaman About ada. e2e penuh (146 tes), lint, format, typecheck dan build hijau di akhir pekerjaan.
>
> **Belum dikerjakan (sesuai keputusan di bawah):** migrasi massal dan tracking (AniList/MAL). `markSeen` pada Updates yang semula ditunda sudah dikerjakan pada 10 Okt 2026 ([ADR 0040](../adr/0040-updates-mark-seen.md)). Penyimpangan kontras Latte dari Matane dicatat di [ADR 0036](../adr/0036-ui-follows-matane.md).

Lanjutan refactor visual (ADR 0036). Token, komponen dasar, dan gaya halaman sudah mengikuti Matane. Rencana ini menutup selisih layout, pola UX, dan fitur yang ditemukan audit. Matane (`../manga-reader`) hanya referensi pola; kode ditulis ulang di repo ini. Yang tetap berbeda hanya domain manga vs anime.

Keputusan user: kerjakan grup A (layout dan UX), Display modes + ukuran cover + filter/sort tersimpan, Statistics, Backup yang lebih kaya + About/What's New. Migrasi massal dan Tracking ditunda ke fase terpisah.

Kualitas: lint, format:check, typecheck, unit test, build, dan e2e penuh hijau di akhir tiap fase. Tidak ada commit tanpa izin user. Test CI tetap hanya memakai `packages/test-site`.

## Fase 1 — layout dan UX (renderer saja)

**Agent A (shell dan lintas-halaman)**
- `components/ConfirmDialog.tsx` global (AlertDialog, prop `destructive`); pindahkan dari `features/extensions/ConfirmDialog`, dan pakai di dialog konfirmasi inline (Library, History, Downloads, Updates).
- `ErrorState` menerima `error`/`onRetry` (kode error, Verify untuk Cloudflare, mode `compact`); `OfflineState` (`OnlineOnly`) untuk Browse; `Cover` dengan placeholder loading dan fade-in.
- TitleBar: kotak search tepat di tengah, breadcrumb dinamis lewat `stores/crumbs.ts` + `staticData.crumbs` (halaman source, anime dari Browse, Migrate), indikator aktivitas gabungan (cek update / unduhan).
- Sidebar: badge jumlah Library, titik pembaruan extension; nav `/statistics` ditambahkan di Fase 2. Hapus tautan mati `extensions`/`about` di sub-nav Settings (About diisi di Fase 2) dan redirect untuk section tidak valid.
- `lib/scroll.ts` (`useScrollRestoration`, per entri history, memakai `<main>` sebagai scroller) untuk dipakai halaman B.
- Palette: grup "Go to" menyertakan setiap section settings, 5 item Continue, hint Esc di footer.
- Incognito: toggle selalu tampil di TitleBar; banner History selalu tampil (teks ON/OFF berbeda).
- Settings: General (picker tema 6 kartu + aksen), sub-nav `w-56`, onboarding mengikuti pola Matane bila tidak mengubah alur.

**Agent B (halaman konten)**
- Library: tab Default (tanpa kategori) dan tab mengikuti URL (`?tab=`); seleksi Ctrl/Shift range/Esc/Ctrl+A (`selection.ts` + unit test); bar seleksi melayang `absolute bottom-5`; popover Filter dan menu Sort dengan arah (backend sudah punya `descending`); `SearchField` kecil; `ErrorState` untuk query gagal; tombol "Clear filters" pada hasil kosong; scroll restoration.
- Detail anime: hero dengan backdrop cover blur, deskripsi "show more", jumlah episode dan terakhir update, preview cover zoom; seleksi episode + bar melayang (`episodes.markWatched` sudah menerima `episodeIds`), kotak lompat ke episode, SortMenu bergaya Matane.
- Browse: state tab/`q`/filter Source browse di search param route (Back mengembalikan listing); FilterPanel `w-80` (badge hitungan aktif, tombol close, footer Reset/Apply); Global search (bar progres, tombol clear); Sources list (grup Pinned + per bahasa, tombol "Latest"); Extensions (kartu toolbar dengan search, tab Updates).
- Updates: virtualisasi, header grup (Today/Yesterday/This week/tanggal) dengan "Download all", dialog daftar error, seleksi Shift-range, dan `markSeen` (kini ada, tetapi eksplisit lewat tombol, bukan otomatis saat halaman dibuka; lihat ADR 0040).
- History: search di-debounce, persen + bar hijau saat selesai, error state.
- Downloads: tab Queue/Completed/Errors dengan hitungan, header ringkas, footer, antrean dikelompokkan per judul, RetryAll di tab Errors.

Pertahankan kelebihan anime: toast, cache listing Source browse, banner Cloudflare, prefetch hover, `StorageCard`, langkah di empty library. Jaga kontrak e2e (lihat rencana refactor visual); spec boleh disesuaikan hanya jika perilaku sengaja berubah, dengan alasan dicatat.

## Fase 2 — fitur (renderer + main + shared)

Urutan: skema bersama dulu (B, kecil), lalu kerja paralel.

**Agent B — Library dan Browse**
- Tambah `library` dan `browse` (display mode comfortable/compact/cover/list, ukuran cover 100–280, sort + arah, filter) ke `appSettingsSchema` (`packages/shared/src/settings.ts`) dengan default dan migrasi; jaga ADR/versi settings yang ada.
- `CoverViewControls` (mode + slider ber-debounce), mode list, kartu 4 mode di Library dan Source browse; sort/filter bertahan. Perluas `libraryQuerySchema` (multi-status, multi-source, downloaded only) bila diperlukan; persistensi global search (source terpilih, hanya yang ada hasil).
- Tampilan episode tersimpan per anime (sort/filter): kolom baru + IPC kecil.

**Agent A — Statistics, Backup, About**
- Statistics: service di main yang membaca `watch_sessions` dan history (rentang week/month/year/all: waktu tonton, streak, top anime, genre, source), kontrak IPC `stats.*`, halaman `/statistics` (tile ringkasan, grafik batang aktivitas, bar genre, top anime, breakdown source), entri nav + crumb, i18n en/id, aksi "clear statistics" di Data. Unit test untuk service; gunakan skill dataviz untuk grafik.
- Backup: samakan `BackupSection` dengan Matane (auto-backup terjadwal, daftar backup, restore dialog, hasil/ringkasan); lihat `manga-reader/.../BackupSettings.tsx` hanya sebagai pola.
- Settings → About (versi, lisensi, buka ulang What's New, ulangi onboarding); What's New hanya menampilkan versi berjalan dan bisa dibuka lagi.

## Review
Agent reviewer (read-only) memeriksa tiap fase: kontrak e2e, aksesibilitas (fokus, label, kontras Latte), kelas Tailwind tanpa token, i18n (`en.json` dan `id.json` seimbang), migrasi skema/IPC, unit test, dan konsistensi dengan Matane. Temuan diperbaiki oleh agent pemilik file, lalu dicek ulang.

## Verifikasi
`pnpm lint`, `format:check`, `typecheck`, `test`, `build`; `pnpm e2e` penuh di akhir tiap fase (jendela Electron tampil di layar user karena tidak ada Xvfb); cek visual `pnpm dev` per tema (Mocha, Latte, AMOLED) dibandingkan dengan Matane.

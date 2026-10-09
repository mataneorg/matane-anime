# Mockup UI Matane Anime

> **Status (9 Okt 2026): historis.** UI sekarang mengikuti Matane ([ADR 0036](../adr/0036-ui-follows-matane.md), menggantikan ADR 0006). Mockup dan PNG di `docs/ui/screens/` menunjukkan tampilan lama (Figtree, `accent`/`on-accent`, `border-strong`) dan **belum dibuat ulang**; rujukan UI saat ini adalah `design-system.md`, `tokens/`, dan aplikasinya sendiri. Brief di bawah dipertahankan apa adanya sebagai sejarah.
>
> Status lama: Draft 1, 6 Okt 2026. Indeks mockup UI, mengikuti pola `docs/ui/MOCKUP_PLAN.md` di Matane.
> Mockup dibuat di Claude Design dengan tema **Catppuccin**. **Artifact di Claude Design adalah sumber kebenaran UI**; berkas ini hanya indeksnya.

## Tautan

| Apa | Tautan |
|---|---|
| Canvas mockup (30 artboard) | https://claude.ai/artifact/2NaJS1H2G9rh4kiJveWShT |
| Design System (token, README, cover) | https://claude.ai/artifact/As1jBkaMK5MWw8Wg299gsS |

Keduanya privat: hanya pemilik yang bisa membukanya sampai dibagikan lewat menu Share di halamannya.

## Brief desain

- **Tema**: Catppuccin **Mocha** (default, gelap) dan **Latte** (terang), bisa ditukar lewat menu Theme di canvas. Frappé, Macchiato, AMOLED, dan 14 warna aksen menyusul (PRD UI-3, UI-11) dari token yang sama.
- **Aksen**: Mauve. Teks di atas aksen memakai `on-accent` (crust di Mocha, base di Latte).
- **Font**: **Figtree** untuk UI dan **JetBrains Mono** untuk waktu, ukuran file, kecepatan, dan tombol pintasan. Sengaja berbeda dari Matane (Inter).
- **Ikon**: SVG inline bergaya Lucide, stroke 1.75 px.
- **Shell**: title bar 40 px, sidebar 224 px (64 px saat ciut), pemutar layar penuh tanpa sidebar (top bar 56 px, bottom bar 64 px).
- **Pemutar**: memakai token `video-*` yang nilainya sama di kedua tema, jadi pemutar tidak mengikuti Latte.
- **Konten mockup fiktif**: judul anime, nama episode, dan nama source sengaja karangan ("Tsuki no Shiori", "Example Source (EN)"). Cover berupa komposisi bentuk abstrak dari warna palet. Jangan memakai judul, gambar, atau situs nyata.
- **Bahasa UI mockup**: English (i18n EN + ID dikerjakan saat implementasi, PRD UI-4).

## Layar dan rujukan PRD

| # | Artboard | Isi | Rujukan PRD |
|---|---|---|---|
| 01 | Library | Grid cover, badge belum ditonton, tab kategori, sort/filter, "Continue Ep N" | LIB-1…6 |
| 01b | Library, empty | Tanpa source bawaan: tiga langkah memulai, disclaimer | UI-5, EXT-7 |
| 02 | Anime detail | Header bertint cover, "Continue Ep 12", daftar episode dengan progres dan status unduhan | BRW-4, BRW-5 |
| 02b | Detail, source error | Skeleton + error source dengan Retry, progres dan unduhan aman | BRW-6 |
| 03 | Player, controls | Top bar, seek bar dengan buffered, kontrol dasar, server/kualitas, kecepatan | PLY-1, PLY-2, PLY-7 |
| 03b | Player, idle and buffering | Kontrol tersembunyi, pil waktu, indikator buffering, toast fallback server | PLY-6, PLY-7, STR-3 |
| 03c | Player, server and quality | Menu server dan kualitas dengan status | PLY-5, STR-1, STR-5 |
| 03d | Player, stream error | Stream kedaluwarsa, Retry / Switch server, daftar server yang dicoba | PLY-6, STR-3, STR-4 |
| 03e | Player, next episode | Hitung mundur autoplay yang bisa dibatalkan | PLY-4 |
| 03f | Player, episode list | Panel daftar episode di dalam pemutar, episode aktif bertanda | PLY-10 |
| 04 | Browse source | Pemilih source, Popular/Latest, pencarian, panel filter tristate | BRW-1, EXT-14 |
| 05 | Global search | Hasil per source: selesai, mencari, perlu verifikasi, kosong | BRW-2 |
| 06 | Extensions | Terpasang, pembaruan, repositori, status trust, filter 18+ dan bahasa | EXT-5…9, EXT-15 |
| 06b | Install extension | Dialog `prepareInstall`: kepercayaan repo, API, ukuran, SHA-256 | EXT-8 |
| 06c | Add repository | Konfirmasi *unverified* dan "Trust this key" | EXT-6 |
| 07 | Updates | Episode baru per tanggal, aksi putar/unduh/tandai, source gagal dicek | UPD-8, UPD-2 |
| 08 | Downloads | Antrean, progres segmen, batas ukuran, ruang disk, gagal/jeda/antre | DL-1…10 |
| 09 | History | Satu entri per anime, per tanggal, progres | PRG-8 |
| 09b | History, incognito | Pil Incognito di title bar, banner penjelasan, "Turn off" | PRG-11 |
| 10 | Settings, player | Ambang ditonton, autoplay, kualitas, kecepatan, shortcut | PRG-3, PLY-3, PLY-4, UI-7 |
| 10b | Settings, network | DoH, proxy, User-Agent, tes koneksi | NET-6, NET-8 |
| 10c | Settings, general | Tema, warna aksen (14), AMOLED, bahasa app dan konten, mulai bersama komputer, tray, 18+ | UI-3, UI-11, UI-9, UPD-9 |
| 10d | Settings, library | Interval dan aturan lewati update check, auto-download per kategori, kelola kategori | UPD-1, UPD-3, DL-11, LIB-1 |
| 10e | Settings, downloads | Folder, kualitas, paralel, download ahead, hapus setelah ditonton, batas ukuran | DL-1, DL-6, DL-9…13 |
| 10f | Settings, data and storage | Backup dan restore, penggunaan penyimpanan, hapus history dan watch time | Backup (P1), DL-10, PRG-8, PRG-10 |
| 11 | Command palette | Ctrl K: lanjut nonton, library, aksi, cari di source | UI-8 |
| 12 | Onboarding, step 1 | Bahasa dan tema | UI-9 |
| 12b | Onboarding, step 2 | Bahasa konten dan toggle 18+ | UI-9, EXT-15 |
| 12c | Onboarding, step 3 | Folder unduhan, ruang kosong, batas ukuran | UI-9, DL-9, DL-10 |
| 12d | Onboarding, step 4 | Pintasan pemutar, autoplay, ambang ditonton | UI-9, PLY-3, PLY-4 |

Belum ada mockup untuk: Settings "Browse and extensions", "Advanced", dan "About"; migrasi source (BRW-8); dan tautan ke Detail dari hasil Browse yang belum masuk library.

## Catatan yang perlu diketahui saat implementasi

- **Kontras Latte.** Beberapa pasangan warna Catppuccin tidak lolos 4.5:1 di Latte dan dibiarkan eksak, dengan catatan di `usage` tiap token. Karena itu `muted-foreground` memakai `subtext1` di Latte, status (success, warning, info) selalu disertai ikon dan kata, dan kontrol diletakkan di `background`/`sidebar`/`popover`, bukan di `card`.
- **`catppuccin-tokens.css`** di canvas ditulis tangan dari `tokens.json` (Design System belum menghasilkan `tokens.css`). Saat implementasi, token diturunkan dari `@catppuccin/tailwindcss` dan `docs/ui` ini hanya rujukan nilai.
- **Pengecualian hex.** Pratinjau tema di onboarding (langkah 1) memakai hex literal untuk memperlihatkan Mocha dan Latte berdampingan apa pun tema aktifnya. Di app, pratinjau itu dibuat dari token kedua flavor.
- **Verifikasi visual (6 Okt 2026).** Semua 21 artboard dirender sebagai HTML statis di Chrome headless (1440 px) dalam Mocha, dan 7 artboard yang padat atau berdialog juga dalam Latte, lalu diperiksa. Sembilan artboard tambahan (03f, 09b, 10c…10f, 12b…12d) diperiksa dengan cara yang sama di Mocha, dan 03f, 10c, 10d, 10f juga di Latte; tidak ada yang melebihi frame. Perbaikan dari pemeriksaan itu sudah dipublikasikan: `color-scheme` per tema (kontrol bawaan browser ikut gelap/terang), scrim dan overlay cover yang tetap gelap di Latte, kartu aktif/gagal bertint (bukan garis aksen di tepi), dan tinggi Global search yang pas di frame. Pemeriksaan ini **belum** dilakukan di dalam runtime canvas Claude Design (tombol Theme) dan Latte belum diperiksa untuk semua artboard.
- **Ekspor.** Artboard `.dc.html` tidak berdiri sendiri sebagai HTML biasa. Untuk menyimpan salinan di repo, ekspor PNG dari menu Share › Export di canvas ke `docs/ui/screens/`. Render Mocha dan Latte semua artboard sudah ada di sana (`NN-nama.mocha.png`, `NN-nama.latte.png`), dan nilai token di `docs/ui/tokens/`; keduanya menjadi acuan implementasi ([ADR 0006](../adr/0006-ui-mockups-source-of-truth.md)).

# PRD: Matane Anime — aplikasi desktop untuk menonton anime

> Status: **Draft 2**, 6 Okt 2026. Disusun dari sesi brainstorming; keputusan yang sudah diambil ada di §4, yang masih menunggu implementasi atau spike ada di §15.
> Pemilik produk: SukunDev.
> Referensi: **Matane** (manga reader, `manga-reader/`). Matane dipakai sebagai acuan **alur dan pola desain**, bukan sebagai basis kode. Matane Anime ditulis dari nol (lihat pemetaan di §11).

---

## 1. Ringkasan

**Matane Anime** adalah aplikasi desktop open source (Windows, macOS, Linux) untuk menonton anime dari **sumber online lewat sistem extension**. Ini saudara dari Matane: seperti Aniyomi, tetapi untuk komputer.

**Masalah**
- Menonton anime di situs streaming berarti iklan, popup, dan pemutar yang berbeda-beda di tiap situs.
- Tidak ada riwayat dan progress yang menyatu antar situs. Pengguna harus ingat sendiri sudah sampai episode berapa.
- Tidak ada pemberitahuan episode baru, dan download episode untuk ditonton offline sulit atau tidak ada.
- Di Indonesia, banyak situs diblokir ISP (DNS), sehingga pengguna butuh DoH atau proxy.

**Solusi**
- Satu pemutar yang bersih untuk semua sumber. Sumber ditambahkan pengguna lewat repositori extension (sandbox, repo bertanda tangan).
- Library, "lanjut nonton" dari detik terakhir, history, dan update checker.
- Download episode (HLS dan MP4) untuk offline.
- Network layer dengan Cloudflare handling, DoH, proxy, dan User-Agent kustom.

**Sikap hukum:** app **tidak membawa sumber apa pun**, tidak meng-host konten, dan tidak menautkan repo extension mana pun. Pola yang sama dengan Matane (ADR 0022–0023 di Matane).

---

## 2. Tujuan, non-goals, dan prinsip

### 2.1 Tujuan v1

| ID | Tujuan | Ukuran keberhasilan |
|---|---|---|
| G1 | Menonton episode tanpa iklan dan popup | Dari kartu library ke video berputar dengan **1 klik** ("Lanjut nonton"); dari hasil pencarian ke video berputar ≤ **3 klik** |
| G2 | Tidak pernah kehilangan posisi | Posisi dipulihkan setelah menutup pemutar atau restart app (selisih ≤ 5 detik) |
| G3 | Menonton offline | Episode terunduh bisa diputar tanpa jaringan, termasuk setelah restart |
| G4 | Tahu episode baru | Update checker terjadwal + notifikasi desktop yang dikelompokkan |
| G5 | Ekosistem extension yang aman | Extension jalan di sandbox QuickJS; repo ditandatangani ed25519; test sandbox di CI |
| G6 | Ringan dan stabil | Target performa di §10.1 terpenuhi |

### 2.2 Non-goals (v1)

- Meng-host, menyimpan, atau mendistribusikan konten. Tidak ada sumber, repo, atau kunci bawaan.
- **Subtitle** (UI, SRT/VTT/ASS, JASSUB) dan **pilihan track audio**. Alasan: sumber yang menjadi target umumnya sudah hardsub. Field `subtitles` opsional boleh ditambahkan ke kontrak nanti tanpa breaking change.
- Picture-in-picture, tombol skip +85 detik, skip intro/outro otomatis.
- Konten ber-DRM (Widevine). Electron standar tidak membawanya.
- Live stream, torrent, Chromecast/DLNA.
- Transcoding atau remux (ffmpeg), termasuk ekspor mp4 dari hasil download HLS.
- Kompatibilitas dengan extension Aniyomi dan import backup Aniyomi.
- Sumber file lokal.
- Mobile, akun cloud, sinkron antar perangkat.

### 2.3 Prinsip desain

1. **Konten milik sumber.** App hanyalah mesin dan tidak mengenal situs tertentu.
2. **Semua jaringan lewat main process.** Renderer tidak pernah mengakses internet langsung. Satu-satunya jalan keluar adalah protokol `anime://` yang dilayani main.
3. **Main adalah sumber kebenaran data.** Renderer membaca lewat IPC dan tidak menyimpan data sendiri.
4. **Menonton tidak boleh menunggu hal lain.** Tracker, update checker, dan download tidak boleh menghambat pemutaran.
5. **Extension tidak tepercaya.** Sandbox, batas sumber daya, dan tanda tangan repo.
6. **Satu pintu untuk setiap efek samping.** Penulisan progress lewat satu fungsi di main, sehingga incognito dan tracker nanti tinggal dipasang di satu tempat.

---

## 3. Pengguna dan skenario

### 3.1 Persona

| Persona | Kebutuhan utama |
|---|---|
| **Penonton maraton** (utama) | Mengikuti beberapa anime sekaligus, lanjut dari episode terakhir, autoplay episode berikutnya, tidak diganggu iklan |
| **Penonton offline** | Mengunduh beberapa episode sebelum bepergian atau saat koneksi lambat, mengontrol ruang disk |
| **Pengguna di jaringan terblokir** | DoH dan proxy, Cloudflare ditangani otomatis |
| **Penulis extension** | SDK bertipe, CLI untuk membuat/build/menguji, mode dev dengan hot reload dan log |
| **Pengguna Matane** | Tampilan, tema, dan kebiasaan yang sama |

### 3.2 User stories

| ID | Sebagai … saya ingin … agar … | Prioritas |
|---|---|---|
| US-1 | menambahkan repositori extension lewat URL | saya memilih sendiri sumber anime saya | P0 |
| US-2 | mencari anime di satu atau semua sumber | tidak perlu membuka tiap situs | P0 |
| US-3 | melihat detail dan daftar episode | memilih episode untuk ditonton | P0 |
| US-4 | menekan satu tombol dan video langsung berputar | tidak perlu memilih server | P0 |
| US-5 | berpindah server/kualitas bila video bermasalah | tontonan tidak terhenti | P0 |
| US-6 | menyimpan anime ke library dengan kategori | mengelompokkan tontonan saya | P0 |
| US-7 | melanjutkan dari detik terakhir, di episode yang sama atau berikutnya | tidak mencari posisi manual | P0 |
| US-8 | episode berikutnya otomatis diputar, dan bisa dibatalkan | maraton tanpa menyentuh mouse | P0 |
| US-9 | mengunduh episode dan menontonnya tanpa internet | menonton di perjalanan | P0 |
| US-10 | diberi tahu saat ada episode baru | tidak mengecek manual | P0 |
| US-11 | melihat riwayat tontonan | kembali ke yang baru saya tonton | P0 |
| US-12 | mengatur DoH, proxy, dan User-Agent | tetap bisa mengakses sumber yang diblokir | P0 |
| US-13 | memakai Ctrl+K untuk berpindah dan mencari | bergerak cepat di app | P1 |
| US-14 | mode incognito | tontonan tertentu tidak tercatat | P1 |
| US-15 | membuat extension dengan CLI dan mengujinya di sandbox yang sama dengan app | extension saya bekerja saat dipasang | P0 |

---

## 4. Keputusan produk

Hasil brainstorming 6 Okt 2026.

| Aspek | Keputusan |
|---|---|
| Bentuk produk | **Aplikasi terpisah**, ditulis dari nol. Bukan gabungan manga + anime |
| Nama | **Matane Anime** (saudara Matane). `productName` `Matane Anime`; `appId` dan folder data berbeda dari Matane agar bisa terpasang berdampingan |
| Pemutar | **HTML5 `<video>` + hls.js**. Tidak ada JASSUB di v1 |
| Subtitle | **Tidak di v1** (sumber target umumnya hardsub) |
| Sumber | **Extension** di sandbox QuickJS, repo bertanda tangan, app tanpa sumber bawaan |
| Kontrak extension | **Format sendiri**, tidak mengikuti Aniyomi |
| Embed host | **Extension yang meresolve** ke URL video langsung (`.m3u8`/`.mp4`) beserta header yang dibutuhkan |
| Server dan kualitas | **Otomatis dengan fallback**, bisa diganti manual di pemutar; pilihan manual diingat per anime |
| Fitur pemutar v1 | Kontrol dasar (play/pause, seek, volume, fullscreen, kecepatan) + next/previous dan autoplay |
| Ambang "ditonton" | **Bisa diatur, default 85%** |
| Resume | Termasuk di modul progress (v1) |
| Download | **Folder segmen `.ts` + playlist lokal**, tanpa ffmpeg |
| Fitur v1 | Browse/detail/putar; library/progress/history; download + update checker |
| Lisensi | **App: GPL-3.0**; **SDK, runtime, CLI extension: MIT** |
| Struktur repo | Monorepo **pnpm workspaces** |
| Tech stack | Sama dengan Matane (§8.5); versi dikunci di Fase 0 |
| Extension pertama | Ditulis **pemilik produk sendiri di repo terpisah** setelah SDK dan `ma-ext` jadi (Fase 1). Repo app tidak merujuknya. Fase 1–3 diuji otomatis dengan situs tiruan; extension nyata dipakai untuk uji manual |
| Varian episode (Sub/Dub/BD) | **Satu status ditonton per nomor episode**; varian yang diputar adalah yang pertama dari extension. Prioritas varian menunggu kebutuhan nyata |
| Backup/restore | **P1**: target v1.0, selambatnya v1.1. Bila belum ada saat v1.0, dokumentasi memberi tahu |
| Penamaan teknis | Paket `@matane-anime/extension-{sdk,runtime,cli}`, scope internal `@matane-anime/*`, CLI **`ma-ext`**, `appId` **`dev.sukun.matane-anime`**. Ketersediaan scope npm, repo, dan paket Linux dicek sebelum publikasi pertama (Fase 4–5) |

---

## 5. Cakupan

Prioritas: **P0** = wajib di v1.0 · **P1** = diusahakan di v1.0, boleh bergeser ke v1.x · **P2** = pasca-v1.

| Area | P0 | P1 | P2 |
|---|---|---|---|
| Extension | Runtime sandbox, host API, repo bertanda tangan, install/update/uninstall, mode dev, CLI, filter NSFW dan bahasa | Template/helper SDK untuk resolver umum | Template untuk CMS populer |
| Browse | Popular/latest/search + filter, global search, buka dari URL, detail | Migrasi source, warna dari cover | |
| Pemutar | Kontrol dasar, keyboard (bisa diubah), next/prev, autoplay, menu server/kualitas, error state, anti-sleep layar | Panel daftar episode, media keys, ranking berdasar codec | PiP, skip +85 s, subtitle (SRT/VTT/ASS), pilihan audio, pemutar eksternal, thumbnail seek |
| Stream | Pemilihan otomatis, probe, fallback, resolve ulang bila kedaluwarsa | | |
| Library | Kategori, sort/filter, pencarian FTS5, multi-select, badge belum ditonton | Cover kustom | |
| Progress | Posisi per episode, resume, ditonton per nomor episode, "lanjut nonton", history | Incognito | Statistik tontonan |
| Download | Antrean persisten, HLS dan MP4, pause/resume/retry, tonton offline, auto-download episode baru, cek ruang disk, batas ukuran | Download ahead, hapus setelah ditonton | Ekspor mp4 |
| Update | Checker terjadwal, halaman Updates, notifikasi, aturan lewati | Tray, jalan saat login | |
| UI | Title bar kustom, sidebar, tema Catppuccin, i18n EN + ID, halaman setting | Command palette, onboarding, What's new, AMOLED + aksen | Discord RPC |
| Jaringan | Cloudflare handling, rate limit, DoH, proxy, User-Agent, deteksi offline | Tes koneksi | |
| Data | Skema lengkap sejak awal (termasuk tabel tracker dan sesi tontonan) | Backup/restore | Import backup Aniyomi |
| Tracker | Tabel dan "satu pintu" progress disiapkan | | AniList, MyAnimeList, Kitsu (dua arah) |
| Rilis | AppImage, NSIS, dmg + auto-update, channel beta | Portable, deb, rpm, AUR, Flatpak | Code signing |

---

## 6. Persyaratan fungsional

### 6.1 Extension dan sumber (EXT)

| ID | Persyaratan | Pri |
|---|---|---|
| EXT-1 | Extension adalah bundle `manifest.json` + `index.js` (ES2020, satu file) + `icon.png`, berjalan di **QuickJS (WASM)** di dalam satu `utilityProcess`, **satu runtime per extension**. Runtime dimuat lazy dan dibongkar setelah idle | P0 |
| EXT-2 | Batas per runtime: memori **64 MB**, kode sinkron maksimal **2 detik**, timeout per panggilan **30 detik** (`getEpisodes`: 60 detik). Dikonfirmasi dengan benchmark `ma-ext bench` di Fase 1 (7 Okt 2026: kasus terburuk realistis memakai ±3% heap dan ±40% anggaran kode sinkron, batas tetap; lihat [ADR 0010](adr/0010-extension-runtime.md)). Batas memori ditegakkan dua lapis: `setMemoryLimit` saja tidak cukup, jadi tiap runtime punya modul WASM dengan memori maksimum | P0 |
| EXT-3 | Manifest: `id` (tanpa bahasa, tidak pernah berubah), `name`, `version`, `apiVersion`, **`type: "anime"`**, `nsfw`, `rateLimit`, `sources[]` (`key`, `lang`). App menolak manifest dengan `type` selain `anime` agar extension Matane tidak terpasang tersalah | P0 |
| EXT-4 | Source id = `<extensionId>/<key>`. Anime unik berdasarkan `(sourceId, url)`; episode unik berdasarkan `(animeId, url)` | P0 |
| EXT-5 | Repositori = `index.json` + `index.json.sig` (ed25519) + arsip zip + ikon. Arsip diperiksa terhadap `sha256` dan ukuran sebelum ditulis. Batas: index 2 MB, arsip 20 MB, ikon 512 KB | P0 |
| EXT-6 | Kepercayaan ditentukan kunci yang dipilih pengguna ("Trust this key"), bukan isi index. Repo tanpa kunci terpercaya = *unverified*: perlu konfirmasi saat menambah dan peringatan saat memasang. Repo terpercaya tidak menerima index yang tidak lagi bertanda tangan kuncinya | P0 |
| EXT-7 | **App tidak membawa repo, extension, atau kunci bawaan**, dan tidak mengusulkan repo mana pun | P0 |
| EXT-8 | Install dua langkah (`prepareInstall` memeriksa dan menampilkan dialog; `install(token)` menulis). Penulisan atomik (`.tmp` → `.old` → rename). Update memasang langsung; "Update all". Uninstall menghapus folder, storage, prefs, dan session `persist:ext-<id>`; source tetap di DB (anime tampil "source belum terpasang") | P0 |
| EXT-9 | Satu `id` hanya boleh berasal dari satu repo pada satu waktu; prioritas asal: folder dev > repo | P0 |
| EXT-10 | **Mode dev**: muat extension dari folder, hot reload, panel log extension | P0 |
| EXT-11 | Host API di sandbox: `http`, `html` (CSS selector, parsing di host), `storage`, `prefs`, `log`, `crypto` (md5/sha1/sha256/`aesDecrypt`), `base64`, `utf8`, `timers.sleep`, serta `URL` dan `URLSearchParams` (QuickJS tidak punya API web). Tanpa `require`, `fetch`, `process`, atau akses file. `eval` diizinkan (di dalam sandbox) | P0 |
| EXT-12 | Error bertipe: `NetworkError`, `HttpError(status)`, `CloudflareError`, `RateLimitedError`, `NotFoundError`, `ParseError`; UI menampilkan pesan yang sesuai | P0 |
| EXT-13 | Preferensi extension dideklarasikan sekali (`switch`/`select`/`multiselect`/`text`); UI setting dibuat otomatis | P0 |
| EXT-14 | Filter extension (`text`/`select`/`checkbox`/`tristate`/`sort`/`group`) dirender otomatis | P0 |
| EXT-15 | NSFW disembunyikan secara default (repo, browse, global search); bahasa konten menyaring source | P0 |
| EXT-16 | `migrateUrl` dipanggil sekali per update extension untuk anime dan episode di library dan history | P1 |
| EXT-17 | SDK menyediakan helper opsional (parser master playlist HLS, unpacker `eval(function(p,a,c,k,e,d)…)`, resolver umum) | P1 |
| EXT-18 | CLI `ma-ext`: `create`, `build`, `test` (sandbox yang sama dengan app), `bench`, `repo keygen|build|verify` | P0 |

### 6.2 Browse dan detail (BRW)

| ID | Persyaratan | Pri |
|---|---|---|
| BRW-1 | Daftar source (pin, bahasa), popular, latest (bila ada), search dengan filter, infinite scroll | P0 |
| BRW-2 | **Global search**: query ke banyak source paralel (maks 5 sekaligus), status per source, hasil bertahap | P0 |
| BRW-3 | "Buka dari URL": tempel URL situs, `resolveUrl` memetakannya ke anime | P0 |
| BRW-4 | Halaman detail: cover, judul, judul alternatif, deskripsi, genre, status, tipe, tahun, studio, daftar episode, tombol tambah ke library, "Mulai/Lanjut nonton", refresh, buka di browser | P0 |
| BRW-5 | Daftar episode: sort, filter (belum ditonton, terunduh), tandai ditonton/belum, "tandai semua sebelumnya", indikator unduhan dan progress mini per baris | P0 |
| BRW-6 | Detail pertama kali: ambil detail dan episode sekali otomatis; kegagalan menampilkan error + coba lagi tanpa menghilangkan data lama | P0 |
| BRW-7 | Saat offline: Browse dan global search dinonaktifkan dengan keterangan; library, history, downloads tetap jalan | P0 |
| BRW-8 | Migrasi source: pindahkan anime ke source lain, membawa status ditonton per nomor episode | P1 |
| BRW-9 | Warna aksen header detail dari warna dominan cover (kontras dijaga WCAG AA) | P1 |

### 6.3 Pemutar (PLY)

| ID | Persyaratan | Pri |
|---|---|---|
| PLY-1 | `<video>` HTML5. HLS lewat **hls.js** (MSE); mp4/webm diputar native. Pemutar layar penuh tanpa sidebar | P0 |
| PLY-2 | Kontrol: play/pause, seek bar (menampilkan buffered), volume dan mute (diingat), **kecepatan 0.5×–2×** (diingat), fullscreen, waktu berjalan/total, judul anime + nama episode, tombol kembali | P0 |
| PLY-3 | **Shortcut keyboard** dengan default: `Space`/`K` play-pause, `←`/`→` ±5 s, `J`/`L` ±10 s, `↑`/`↓` volume, `M` mute, `F` fullscreen, `Shift+N`/`Shift+P` episode berikutnya/sebelumnya, `[`/`]` kecepatan, `Esc` keluar fullscreen/kembali. Semua bisa diubah di Setting | P0 |
| PLY-4 | **Next/previous episode**. **Autoplay**: saat episode selesai, hitung mundur 5 detik ("Episode berikutnya") yang bisa dibatalkan; bisa dimatikan di Setting; berhenti di episode terakhir | P0 |
| PLY-5 | Menu **server dan kualitas**: daftar stream dari extension; ganti manual **mempertahankan posisi**; pilihan diingat per anime (§6.4) | P0 |
| PLY-6 | Indikator buffering. **Error state** dengan pesan jelas dan aksi (coba lagi, ganti server): jaringan, stream kedaluwarsa, diblokir (403/Cloudflare), format/codec tidak didukung | P0 |
| PLY-7 | Kontrol tersembunyi setelah 3 detik tanpa gerakan (kursor ikut hilang); klik = play/pause; klik ganda = fullscreen; roda mouse = volume | P0 |
| PLY-8 | Anti-sleep layar selama memutar (`powerSaveBlocker`); dilepas saat jeda atau keluar | P0 |
| PLY-9 | Posisi terakhir dipulihkan saat episode dibuka (aturan di §6.6) | P0 |
| PLY-10 | Panel daftar episode di dalam pemutar (ganti episode tanpa keluar) | P1 |
| PLY-11 | Media keys (MediaSession): play/pause, next, previous; metadata judul dan cover | P1 |
| PLY-12 | Stream dengan `CODECS` yang tidak didukung (`MediaSource.isTypeSupported`) diberi peringkat paling akhir | P1 (ditunda: main tidak bisa memanggil `isTypeSupported`, butuh probe kemampuan dari renderer; saat ini audio tanpa gambar dideteksi saat memutar dan memicu server berikutnya, [ADR 0014](adr/0014-playback-service.md)) |

Catatan: dukungan MKV, HEVC, dan codec lain **tidak dijamin** dan bergantung pada build Chromium dan OS. Hasil uji di Fase 0 dicatat di ADR; stream yang gagal diputar menghasilkan error yang jelas (PLY-6), bukan layar kosong.

### 6.4 Pemilihan stream: server, kualitas, fallback (STR)

`getStreams(episode)` mengembalikan daftar stream (server + kualitas). **Host** memilih dan mengatur fallback; extension tidak perlu tahu.

| ID | Persyaratan | Pri |
|---|---|---|
| STR-1 | **Urutan kandidat**: (1) pilihan manual terakhir untuk anime ini, (2) preferensi kualitas global (default "tertinggi yang tersedia"; alternatif tetap 1080/720/480/360 → yang terdekat di bawah, lalu terdekat di atas), (3) server yang terakhir berhasil untuk source ini, (4) urutan dari extension | P0 |
| STR-2 | **Probe** kandidat sebelum diputar: ambil manifest atau `Range: bytes=0-1` dengan timeout ±8 detik. Gagal → kandidat berikutnya, tanpa ditampilkan ke pengguna | P0 |
| STR-3 | **Fallback saat memutar**: error fatal hls.js atau media error → pindah ke kandidat berikutnya, melanjutkan di posisi yang sama, notifikasi singkat ("Beralih ke server X"). Maksimal 3 percobaan, lalu error state dengan daftar untuk dipilih manual | P0 |
| STR-4 | **Stream kedaluwarsa** (403/410 di tengah pemutaran): panggil ulang `getStreams` satu kali sebelum pindah server | P0 |
| STR-5 | Pilihan manual di pemutar disimpan per anime (`anime.playback_prefs_json`). Server yang berhasil disimpan per source di setting. Hanya pilihan **manual** yang menjadi preferensi per anime | P0 |
| STR-6 | Hasil `getStreams` hanya di-cache di memori ±2 menit (URL cepat kedaluwarsa); tidak disimpan di DB | P0 |
| STR-7 | Episode yang sudah diunduh **selalu didahulukan** dibanding streaming. File hilang → tandai unduhan rusak dan jatuh ke streaming | P0 |

### 6.5 Library (LIB)

| ID | Persyaratan | Pri |
|---|---|---|
| LIB-1 | Tambah/hapus anime dari library; kategori **multi** (satu anime di beberapa kategori); atur urutan kategori | P0 |
| LIB-2 | Grid cover dengan badge jumlah episode belum ditonton; tab per kategori | P0 |
| LIB-3 | Sort: judul, terakhir ditonton, episode terbaru, tanggal ditambahkan, jumlah belum ditonton. Filter: belum ditonton, sedang ditonton, terunduh, status, source | P0 |
| LIB-4 | Pencarian teks (SQLite FTS5) di judul dan judul alternatif | P0 |
| LIB-5 | Multi-select: pindah kategori, tandai ditonton, download, hapus | P0 |
| LIB-6 | Pintasan "Lanjut nonton" pada kartu | P0 |
| LIB-7 | Cover library disimpan **permanen** di disk (tidak kena LRU), diperbarui saat metadata di-refresh | P0 |
| LIB-8 | Cover kustom | P1 |
| LIB-9 | Library 1.000+ anime dan 50.000 episode tetap lancar (virtualisasi grid) | P0 |

### 6.6 Progress, history, dan lanjut nonton (PRG)

| ID | Persyaratan | Pri |
|---|---|---|
| PRG-1 | Per episode: `position_ms`, `duration_ms`, `watched`, `watched_at` | P0 |
| PRG-2 | Posisi disimpan lewat **heartbeat tiap 5 detik**, dan saat jeda, selesai seek, pindah episode, serta menutup pemutar atau app | P0 |
| PRG-3 | **Ambang ditonton**: episode otomatis ditandai ditonton saat posisi mencapai ambang (default **85%**, bisa 50–100%; 100% = hanya saat video selesai). Sekali ditandai, tidak dibatalkan otomatis bila pengguna memundurkan video | P0 |
| PRG-4 | **Resume**: bila posisi tersimpan > 10 detik dan sebelum ambang ditonton → lanjut dari posisi itu dikurangi 3 detik. Episode yang sudah ditonton atau posisi ≤ 10 detik dimulai dari awal | P0 |
| PRG-5 | Status ditonton **per nomor episode**: menandai satu episode menandai semua varian dengan nomor yang sama; varian yang diputar adalah yang pertama dari daftar extension. Jumlah belum ditonton menghitung nomor yang berbeda (episode tanpa nomor dihitung satu per satu) | P0 |
| PRG-6 | **Logika "Lanjut nonton"**: (1) episode terakhir yang dibuka belum selesai → lanjutkan; (2) sudah selesai → episode belum ditonton berikutnya menurut nomor; (3) belum pernah menonton → episode pertama | P0 |
| PRG-7 | Aksi: tandai ditonton/belum, "tandai semua sebelumnya sudah ditonton", reset progress | P0 |
| PRG-8 | **History**: satu entri per anime (episode terakhir, posisi, waktu), dikelompokkan per tanggal; aksi lanjut, hapus entri, hapus semua | P0 |
| PRG-9 | Semua penulisan progress, history, dan sesi tontonan lewat **satu pintu di main** (`WatchService`). Renderer terus mengirim heartbeat tanpa tahu aturannya | P0 |
| PRG-10 | Tabel `watch_sessions` (waktu aktif tonton) dicatat sejak v1 agar statistik pasca-v1 punya data historis; UI statistik belum ada | P0 (data) |
| PRG-11 | **Incognito**: selama aktif, progress, history, dan sesi tontonan tidak dicatat (ditegakkan di `WatchService`); aksi eksplisit pengguna (tandai ditonton, kategori) tetap berlaku. Indikator selalu terlihat | P1 |

### 6.7 Download (DL)

| ID | Persyaratan | Pri |
|---|---|---|
| DL-1 | **Antrean persisten** di DB; dilanjutkan setelah app dibuka lagi. Paralel: **1 episode sekaligus** (bisa 1–3) × **6 segmen** per episode (HLS). Tunduk pada rate limit extension | P0 |
| DL-2 | Mendukung dua jenis stream: **HLS** (`.m3u8` VOD) dan **MP4 langsung** | P0 |
| DL-3 | **HLS**: pilih varian sesuai preferensi kualitas download (default sama dengan kualitas pemutaran), unduh playlist media, segmen `.ts`/fMP4 (termasuk `EXT-X-MAP`), kunci `AES-128` (`EXT-X-KEY`), lalu tulis ulang playlist ke path relatif lokal. Rendition audio terpisah (`EXT-X-MEDIA`) ikut diunduh bila ada. Playlist live (tanpa `EXT-X-ENDLIST`) ditolak dengan pesan jelas | P0 |
| DL-4 | **MP4**: unduh dengan `Range` dan resume ke `.part`, lalu rename atomik | P0 |
| DL-5 | **Penulisan aman**: segmen ke `<episode>.tmp/` (tiap file lewat `.part` + rename). Folder di-rename ke nama akhir hanya setelah semua segmen lengkap dan playlist lokal ditulis. Segmen yang sudah ada dipertahankan saat jeda, error, atau app ditutup, sehingga retry hanya mengambil yang kurang | P0 |
| DL-6 | **Tata letak**: `<folder>/<Source (LANG)>/<Anime>/<Episode>/` berisi `playlist.m3u8` + segmen (HLS) atau `<Episode>.mp4`. Nama disanitasi untuk semua OS. **Path disimpan di DB**, tidak dihitung ulang; memindahkan folder download menulis ulang path | P0 |
| DL-7 | Retry per segmen 3× dengan backoff eksponensial, hanya untuk error yang bisa dipulihkan. Tetap gagal → episode berstatus **error** dengan tombol "coba lagi". Antrean menunggu saat offline | P0 |
| DL-8 | Kontrol: pause/resume semua dan per item, susun ulang urutan, batalkan, hapus unduhan. Tampilan: progres (segmen dan byte), kecepatan, perkiraan sisa waktu | P0 |
| DL-9 | **Cek ruang disk** sebelum mulai. Estimasi ukuran dari `BANDWIDTH` × durasi; bila tidak diketahui, peringatkan saat ruang kosong < 2 GB | P0 |
| DL-10 | **Batas ukuran total** (default 20 GB, bisa diubah): melewatinya menghentikan auto-download dan memberi peringatan; download manual boleh setelah konfirmasi | P0 |
| DL-11 | **Auto-download episode baru** per kategori (include/exclude), **default mati**. Dijalankan setelah update check | P0 |
| DL-12 | **Download ahead**: saat menonton, N episode berikutnya (default 2) diunduh otomatis; hanya anime di library | P1 |
| DL-13 | **Hapus setelah ditonton**: opsi tunda N episode, kecualikan kategori tertentu | P1 |
| DL-14 | Tonton offline: episode terunduh diputar lewat sesi lokal pada protokol yang sama dengan streaming (§8.3) | P0 |

### 6.8 Update checker (UPD)

| ID | Persyaratan | Pri |
|---|---|---|
| UPD-1 | `UpdateService` di main, hanya untuk anime di library. Jadwal: mati / 6 / **12 (default)** / 24 / 48 jam / mingguan; saat app dibuka bila interval sudah lewat; manual (semua, per kategori, per anime). Offline → menunggu | P0 |
| UPD-2 | **Tiga anime sekaligus**, bisa dibatalkan, error dicatat per anime | P0 |
| UPD-3 | **Aturan lewati** untuk pengecekan library dan kategori (bukan satu anime): status *completed* (default aktif), belum pernah ditonton, jumlah belum ditonton > N | P0 |
| UPD-4 | **Episode baru** = episode anime di library dengan `fetched_at > anime.added_at`. Episode yang sudah ada saat anime ditambahkan tidak pernah muncul sebagai baru | P0 |
| UPD-5 | Episode yang **hilang dari source** tetap disimpan (ditandai) bila sudah ditonton, punya progress, unduhan, atau ada di history/sesi; selain itu dihapus. Daftar kosong dari source **tidak menghapus apa pun** | P0 |
| UPD-6 | Setelah pengecekan: `migrateUrl` bila versi extension berubah → auto-download (DL-11) → notifikasi | P0 |
| UPD-7 | **Notifikasi desktop** dikelompokkan ("5 episode baru dari 3 anime"): selalu untuk pengecekan otomatis, untuk manual hanya saat jendela di latar belakang. Klik membuka halaman **Updates** | P0 |
| UPD-8 | Halaman **Updates**: episode baru dikelompokkan per tanggal; aksi tonton, download, tandai ditonton (satuan dan massal); badge di sidebar | P0 |
| UPD-9 | **Tray** opsional ("tutup ke tray", default mati) dan **jalan saat login**, agar pengecekan dan download tetap berjalan | P1 |

### 6.9 UI, tema, i18n, dan setting (UI)

| ID | Persyaratan | Pri |
|---|---|---|
| UI-1 | **Title bar kustom** (frameless; macOS tetap memakai traffic light asli), tombol back/forward, indikator offline dan aktivitas | P0 |
| UI-2 | **Sidebar** yang bisa diciutkan: Library, Updates, History, Browse (Sources, Extensions, Global search), Downloads, Settings. Pemutar memakai layar penuh tanpa sidebar | P0 |
| UI-3 | **Tema Catppuccin**: Mocha (default, gelap), Latte (terang), Frappé, Macchiato, mengikuti sistem. Teks di atas aksen memakai warna `crust`/`base` agar kontras terjaga | P0 |
| UI-4 | **i18n**: i18next, **English + Indonesia**, default mengikuti bahasa sistem. Lint rule menolak string literal di JSX. Format tanggal/angka/waktu relatif memakai `Intl` | P0 |
| UI-5 | Setiap halaman punya **empty state** dan **error state** yang jelas; fokus keyboard selalu terlihat; `prefers-reduced-motion` dihormati; toast in-app | P0 |
| UI-6 | **Setting**: Umum, Library, Pemutar, Download, Browse & extension, Jaringan, Data & penyimpanan, Lanjutan (mode dev, log, info debug), Tentang | P0 |
| UI-7 | Setting pemutar: ambang ditonton, autoplay, kualitas pilihan, shortcut, lompatan seek, kecepatan awal | P0 |
| UI-8 | **Command palette (Ctrl+K)**: navigasi, cari library, lanjut nonton dari history teratas, aksi ("Cek update", "Pause download", "Toggle incognito") | P1 |
| UI-9 | **Onboarding**: bahasa UI dan tema, bahasa konten, folder download, ringkasan kontrol pemutar | P1 |
| UI-10 | **What's new** setelah update (isi dari changelog yang ikut di-bundle) | P1 |
| UI-11 | Tema AMOLED dan 14 warna aksen Catppuccin | P1 |
| UI-12 | **Info debug** ("Salin info debug"): versi app/OS/Electron, jenis paket, extension terpasang, 100 baris log terakhir; home, nama user, query URL, dan token disamarkan | P0 |

### 6.10 Jaringan (NET)

| ID | Persyaratan | Pri |
|---|---|---|
| NET-1 | Semua request lewat **main** dengan `net.request` dan **session terpisah per extension** (`persist:ext-<id>`). Skema dibatasi http(s), termasuk tiap redirect | P0 |
| NET-2 | **Rate limit** token bucket per extension (dari manifest, default 10/detik). Segmen dan media memakai **bucket terpisah yang lebih longgar** (default 30/detik) agar HLS tidak menunggu | P0 |
| NET-3 | Timeout 20 detik per request (permintaan media mengikuti kebijakan sendiri); retry dengan backoff hanya untuk error jaringan dan 5xx/429, hormati `Retry-After` | P0 |
| NET-4 | **User-Agent**: default Chrome Electron tanpa token "Electron". Prioritas: UA extension → UA global → default | P0 |
| NET-5 | **Cloudflare**: deteksi challenge → `BrowserWindow` tersembunyi di partition extension dengan UA yang sama → tampilkan jendela bila ±10 detik belum selesai → ulangi request. Request lain yang kena challenge menunggu satu penyelesaian yang sama | P0 |
| NET-6 | **DoH** (mati/otomatis/selalu; preset Cloudflare, Google, Quad9, AdGuard, atau URL kustom), **proxy** (sistem, tanpa, HTTP, SOCKS5, auth opsional; password via `safeStorage`), **User-Agent kustom** | P0 |
| NET-7 | **Deteksi offline** (`net.isOnline()` + event); indikator di UI; update check ditunda | P0 |
| NET-8 | Tes koneksi (memuat endpoint ping lewat setting jaringan saat ini dan menampilkan hasil) | P1 |

---

## 7. Kontrak extension (SDK)

Model data **sendiri** dan tidak kompatibel dengan Aniyomi. Nama dan bentuk mengikuti Matane agar penulis extension manga langsung paham.

```ts
// `url` = IDENTITAS STABIL yang dipilih extension (umumnya path relatif terhadap baseUrl).
// Untuk "buka di browser", pakai Source.getWebUrl(), jangan menyusun URL dari field ini.

interface AnimeSummary {
  url: string;
  title: string;
  thumbnailUrl?: string;
}

interface AnimeDetails extends AnimeSummary {
  altTitles?: string[];            // dipakai pencarian, migrasi, dan tracker nanti
  description?: string;
  genres?: string[];
  studio?: string;
  year?: number;
  status: 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown';
  type?: 'tv' | 'movie' | 'ova' | 'ona' | 'special';
}

interface Episode {
  url: string;
  name: string;
  number?: number;                 // boleh pecahan (12.5); extension yang memutuskan absolut atau per season
  variant?: string;                // mis. "Sub", "Dub", "BD"; episode bernomor sama dianggap satu
  uploadedAt?: number;             // epoch ms
}

type StreamKind = 'hls' | 'mp4' | 'auto';

interface Stream {
  url: string;                     // URL video LANGSUNG (sudah diresolve dari embed oleh extension)
  server: string;                  // label untuk UI, mis. "Server A"
  quality?: number;                // tinggi dalam piksel (1080, 720, …); dihitung dari master playlist bila kosong
  kind?: StreamKind;               // default 'auto' (dari ekstensi/Content-Type)
  headers?: Record<string, string>;// Referer, Origin, dsb. — ditambahkan oleh main
  // subtitles?: ...               // dicadangkan; ditambahkan pasca-v1 sebagai field opsional
}

interface AnimePage {
  items: AnimeSummary[];
  hasNextPage: boolean;
}

interface Source {
  baseUrl: string;

  getPopular(page: number): Promise<AnimePage>;
  getLatest?(page: number): Promise<AnimePage>;
  search(query: string, page: number, filters: FilterState): Promise<AnimePage>;
  getFilters?(): Filter[] | Promise<Filter[]>;

  getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails>;
  getEpisodes(anime: AnimeSummary): Promise<Episode[]>;     // urutan: terbaru di atas
  getStreams(episode: Episode): Promise<Stream[]>;          // ≥ 1 stream; host yang memilih dan fallback

  resolveUrl?(url: string): AnimeSummary | null;            // "buka dari URL"
  getWebUrl?(item: AnimeSummary | Episode): string;         // default: baseUrl + url
  migrateUrl?(url: string, kind: 'anime' | 'episode', fromVersion: string): string | null;
}

interface ExtensionDefinition {
  createSource(info: { key: string; lang: string; name: string }): Source;
  preferences?(): Preference[];
}
```

Aturan kontrak:
- `Filter`, `FilterState`, dan `Preference` sama dengan Matane (`text`, `select`, `checkbox`, `tristate`, `sort`, `group`, `header`, `separator`).
- **Resolve embed adalah tanggung jawab extension.** `getStreams` boleh melakukan beberapa request (halaman episode → embed → URL video). Host hanya menerima URL akhir dan header yang dibutuhkan.
- `getStreams` harus mengembalikan setidaknya satu stream atau melempar error bertipe (`NotFoundError`, `ParseError`, …). Daftar kosong dianggap `NotFoundError`.
- Penambahan field opsional ke kontrak **kompatibel ke belakang**. `apiVersion` hanya naik untuk perubahan yang merusak.
- Versi app (semver) terpisah dari `apiVersion`.

---

## 8. Arsitektur

### 8.1 Gambaran

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  Renderer (React + Vite)                                         │
│   ├─ UI: Library, Updates, History, Browse, Detail, Player,      │
│   │      Downloads, Settings                                     │
│   ├─ Data lokal & remote: TanStack Query · state sementara: Zustand
│   ├─ <video> + hls.js ──► anime://play/<sessionId>/…             │
│   └─ API lewat preload (contextBridge, IPC bertipe)              │
│                     │                                            │
│                     ▼ IPC                                        │
│  Main process                                                    │
│   ├─ Extension Host → utilityProcess + QuickJS (satu runtime/ext)│
│   ├─ Network layer  → net.request, rate limit, Cloudflare, DoH   │
│   ├─ Protocol anime:// → cover, sesi pemutaran (proxy/lokal)     │
│   ├─ PlaybackService → pilih stream, probe, fallback, sesi       │
│   ├─ WatchService  → satu pintu progress, history, sesi          │
│   ├─ Database      → SQLite (better-sqlite3 + Drizzle)           │
│   ├─ Download queue → HLS/MP4 ke disk                            │
│   └─ Update checker → cek episode baru terjadwal                 │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 Keputusan arsitektur

- **Tiga lapis Electron.** Main memegang semua yang menyentuh mesin (DB, file, jaringan, download, notifikasi). Renderer adalah React dan tidak menyentuh Node. Preload yang sandboxed adalah satu-satunya jembatan (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP ketat).
- **IPC bertipe.** Setiap panggilan renderer → main dan event main → renderer dideklarasikan sekali di `packages/shared` dengan skema zod. Main memvalidasi input dan menolak pengirim yang tidak tepercaya.
- **Aliran data renderer.** Data remote dari extension: TanStack Query dengan default (retry 2, tanpa refetch saat fokus). Data lokal milik main: TanStack Query sebagai cache baca (`staleTime: Infinity`), dibatalkan oleh event `db.changed` bertag entitas. **Posisi, buffer, dan state pemutar tidak masuk ke Query**: hidup di Zustand dan diperbarui lewat IPC.
- **Extension host.** Satu `utilityProcess`, satu runtime QuickJS per extension; jaringan dan penyimpanan lewat main, parsing HTML di host (QuickJS ±50× lebih lambat dari V8 untuk loop ketat).
- **Database.** SQLite (`better-sqlite3`) + Drizzle ORM + migrasi, FTS5 untuk pencarian library.

### 8.3 Protokol `anime://` dan alur pemutaran

Renderer tidak boleh meminta video langsung ke situs sumber: banyak sumber mewajibkan `Referer`/`Origin` yang tidak boleh diatur dari renderer, dan CORS akan menolaknya. Main yang mengambil.

Skema privileged didaftarkan sebelum `ready`:
- `anime://cover/<animeId>`: cover kustom → cover permanen → cache → fetch.
- `anime://play/<sessionId>/…`: sesi pemutaran, baik **proxy** (streaming) maupun **lokal** (unduhan). Satu kode jalur di renderer.

CSP: `media-src anime:`; `img-src anime: data:`; `connect-src 'self' anime:` (hls.js memakai fetch/XHR ke `anime://`).

Alur:
1. Renderer memanggil `playback.start({ episodeId })`.
2. `PlaybackService` memeriksa unduhan (STR-7). Bila tidak ada: `getStreams` → ranking (STR-1) → probe (STR-2) → membuat **sesi** `{ id, extensionId, headers, kind, upstreamUrl }`. Mengembalikan `{ url: anime://play/<id>/index.m3u8 | media.mp4, position, streams[], activeStream }`.
3. hls.js memuat `anime://play/<id>/…`. Handler di main:
   - **Manifest**: ambil upstream, **tulis ulang semua URI** (segmen, kunci, `EXT-X-MAP`, variant) menjadi `anime://play/<id>/r/<base64url(urlAbsolut)>`.
   - **Segmen/MP4**: teruskan ke upstream dengan `headers` sesi, mendukung `Range` (206) agar seek MP4 berfungsi, lewat session dan bucket media milik extension.
   - **Error**: status HTTP asli + header `x-error-code` agar renderer bisa membedakan.
4. Renderer melaporkan `playback.event` (error fatal, buffering lama) → main menjalankan fallback (STR-3/4), mengembalikan sesi baru, posisi dipertahankan.
5. Heartbeat posisi → `watch.progress` → `WatchService`.

Hardening: hanya http(s); URL upstream sebuah sesi dibatasi pada host yang muncul di rantai manifest/stream yang diresolve untuk sesi itu; sesi kedaluwarsa saat pemutar ditutup; renderer tidak bisa membuat sesi sendiri.

> Pendekatan alternatif bila protokol privileged terbukti bermasalah dengan hls.js/MSE di salah satu OS: **custom loader hls.js** yang memanggil main lewat IPC dan menerima `ArrayBuffer`. Keputusan diambil dari **spike Fase 0** dan dicatat di ADR (risiko R1).

### 8.4 Struktur monorepo

```
matane-anime/
├─ apps/
│  ├─ desktop/
│  │  ├─ src/main/
│  │  │  ├─ db/            # skema Drizzle, migrasi, repositori
│  │  │  ├─ network/       # net.request, rate limit, Cloudflare, DoH/proxy
│  │  │  ├─ extensions/    # host (utilityProcess), repo, signing, install
│  │  │  ├─ playback/      # sesi, pemilihan stream, fallback, protokol anime://
│  │  │  ├─ watch/         # progress, history, sesi tontonan (satu pintu)
│  │  │  ├─ library/       # library, kategori, detail, migrasi
│  │  │  ├─ downloads/     # antrean, HLS/MP4, otomatisasi
│  │  │  ├─ updates/       # update checker, notifikasi
│  │  │  └─ app/           # jendela, tray, auto-update, log
│  │  ├─ src/preload/      # contextBridge dari kontrak IPC
│  │  ├─ src/renderer/     # React: routes, features, components, i18n, tema
│  │  ├─ src/extension-host/
│  │  ├─ drizzle/          # migrasi SQL
│  │  └─ e2e/              # Playwright + situs tiruan (m3u8/ts/mp4)
│  └─ docs/                # VitePress: panduan pengguna + panduan extension
├─ packages/
│  ├─ shared/              # tipe domain + kontrak IPC (zod)
│  ├─ extension-sdk/       # MIT: tipe, defineExtension, helper
│  ├─ extension-runtime/   # MIT: QuickJS host
│  └─ extension-cli/       # MIT: CLI `ma-ext`
└─ docs/
   ├─ PRD.md               # dokumen ini
   ├─ adr/                 # Architecture Decision Records
   ├─ ui/                  # indeks mockup UI (MOCKUP_PLAN.md); mockup ada di Claude Design
   └─ plans/               # rencana per fase
```

Nama paket dan CLI di atas sudah ditetapkan (§4); ketersediaannya dicek sebelum publikasi pertama.

### 8.5 Tech stack

| Bagian | Pilihan |
|---|---|
| Bahasa | TypeScript `strict` di semua bagian |
| Scaffolding | electron-vite |
| Monorepo | pnpm workspaces |
| UI | React, TanStack Router, Tailwind CSS + shadcn/ui (Radix), `cmdk`, `sonner` |
| State | TanStack Query + Zustand |
| Virtualisasi | TanStack Virtual (grid library, daftar episode panjang) |
| Video | **hls.js** + `<video>` |
| i18n | i18next + react-i18next (EN + ID) |
| IPC | Kontrak bertipe sendiri + zod |
| DB | better-sqlite3 + Drizzle ORM, FTS5 |
| Sandbox extension | quickjs-emscripten di `utilityProcess` |
| HTML parsing (host) | cheerio |
| Gambar | sharp (warna dominan cover, ukuran cover) |
| Logging | electron-log |
| Test | Vitest, Playwright (`_electron`) |
| Lint/format | ESLint (typescript-eslint, react-hooks, aturan i18n) + Prettier |
| Rilis | electron-builder + electron-updater, GitHub Actions |
| Dokumentasi | VitePress |

Berbeda dari Matane: **tanpa** `yauzl`/`yazl` (tidak ada CBZ); **ditambah** hls.js. `sharp` tetap dipakai karena modul native, jadi build matrix per OS tetap wajib.

---

## 9. Model data (SQLite)

Seluruh skema dibuat sejak Fase 0 (termasuk tabel tracker dan sesi tontonan) agar migrasi berikutnya kecil.

| Tabel | Isi utama |
|---|---|
| `extension_repos` | `url`, `name`, `public_key` (kunci yang dipercaya), `index_json`, `signature`, `last_fetched_at`, `last_error` |
| `extensions` | `id`, `name`, `version`, `api_version`, `repo_id`, `nsfw`, `enabled`, `installed_at`, `updated_at` |
| `extension_storage`, `extension_prefs` | KV per extension (cascade saat uninstall) |
| `sources` | `id` (`<ext>/<key>`), `extension_id`, `key`, `name`, `lang`, `pinned`, `last_used_at`. **Tanpa FK ke extensions**: source bertahan setelah uninstall |
| `anime` | `source_id`, `url` (unik bersama `source_id`), `title`, `alt_titles_json`, `description`, `genres_json`, `studio`, `year`, `status`, `type`, `thumbnail_url`, `cover_path`, `custom_cover_path`, `cover_color`, `in_library`, `added_at`, `last_update_check_at`, `latest_episode_at`, `playback_prefs_json` (server/kualitas pilihan manual), `episode_view_json`, `created_at`, `updated_at` |
| `categories`, `anime_categories` | Kategori multi, urutan, setting per kategori |
| `episodes` | `anime_id`, `url` (unik bersama `anime_id`), `name`, `number`, `variant`, `uploaded_at`, `source_order`, `fetched_at`, `watched`, `watched_at`, `position_ms`, `duration_ms`, `source_missing` |
| `history` | Satu baris per anime: `anime_id`, `episode_id`, `watched_at` |
| `watch_sessions` | `anime_id`, `episode_id`, `started_at`, `ended_at`, `active_ms` (statistik pasca-v1; terpisah dari `history` sehingga menghapus history tidak menghapusnya) |
| `downloads` | `episode_id` (unik), `status` (`queued`/`downloading`/`paused`/`error`/`done`), `queue_order`, `kind` (`hls`/`mp4`), `segments_done`, `segments_total`, `bytes_done`, `size_bytes`, `quality`, `server`, `error`, `path`, `created_at`, `completed_at` |
| `image_cache` | `key`, `kind` (`browse_cover`), `path`, `size_bytes`, `content_type`, `last_access_at` (LRU, default 1 GB) |
| `tracker_accounts`, `anime_tracks`, `tracker_queue` | Disiapkan untuk pasca-v1 (token disimpan lewat `safeStorage`) |
| `settings` | `key` → `value_json` |

Catatan:
- URL stream **tidak** disimpan (cepat kedaluwarsa); hanya `playback_prefs_json` dan server terakhir yang berhasil per source.
- Data milik main; perubahan mengirim event `db.changed` bertag (`anime:<id>`, `episodes:<animeId>`, `downloads`, …) yang digabung per tick.

---

## 10. Persyaratan non-fungsional

### 10.1 Performa (diukur dengan benchmark lokal sebelum rilis)

| Metrik | Target |
|---|---|
| Startup sampai library tampil | < 2 detik |
| Klik episode sampai frame pertama, stream sehat, di luar latensi `getStreams` | < 3 detik |
| Seek (stream HLS sehat) sampai video berlanjut | < 1.5 detik |
| Pemutaran 24 menit | Memori renderer stabil (tanpa pertumbuhan terus-menerus), tanpa frame drop yang terlihat di perangkat menengah |
| Library 1.000 anime / 50.000 episode | Scroll lancar; `library.list` ≲ 100 ms |
| Download HLS | Memenuhi bandwidth yang tersedia dengan 6 segmen paralel; tanpa lonjakan memori (segmen langsung ke disk, tidak ditampung) |

### 10.2 Keamanan
- Extension tidak tepercaya: sandbox QuickJS, batas memori/CPU/waktu, `SECURITY.md` dengan jalur privat untuk melaporkan celah, test sandbox (`require`, `process`, batas memori/CPU, timeout harus gagal dengan benar) di CI.
- Repo bertanda tangan ed25519 + sha256 + ukuran; instalasi atomik.
- Renderer tanpa akses internet: CSP ketat; `anime://` hanya melayani sesi yang dibuat main (§8.3).
- Token tracker dan password proxy disimpan lewat `safeStorage`; tidak pernah dikirim ke renderer.

### 10.3 Privasi
- **Tanpa telemetri.** Crash dump disimpan lokal (upload dimatikan).
- Satu-satunya lalu lintas keluar: request ke sumber yang dipilih pengguna, dan pengecekan update app ke GitHub Releases.
- Info debug menyamarkan home, nama user, query URL, dan token.

### 10.4 Kompatibilitas
- Windows 10/11, macOS (Apple silicon dan Intel), Linux (AppImage, deb, rpm). Build matrix per OS karena `better-sqlite3` dan `sharp` adalah modul native.
- Codec dan container yang bisa diputar mengikuti Chromium; hasil uji dicatat di Fase 0 (§6.3, catatan).

### 10.5 Aksesibilitas
- Semua kontrol pemutar bisa dioperasikan dengan keyboard, fokus terlihat, label ARIA pada kontrol, `prefers-reduced-motion` dihormati, kontras mengikuti WCAG AA.

### 10.6 Kualitas dan pengujian
- **Unit (Vitest)**: rate limiter, pemilihan dan ranking stream, fallback, logika resume dan "lanjut nonton", ambang ditonton, pemilihan varian HLS, penulisan ulang playlist, pencocokan migrasi, LRU cache, parsing nomor episode.
- **DB**: SQLite in-memory dengan migrasi sungguhan.
- **Runtime extension**: dijalankan di QuickJS dengan fixture HTTP terekam; test sandbox.
- **E2E (Playwright `_electron`)**: browse → detail → putar → tambah ke library → download → tonton offline → episode baru → Updates, memakai **situs tiruan lokal** yang menyajikan `.m3u8`, segmen `.ts`, dan `.mp4` kecil (fixture pendek dibuat sekali dan di-commit). **CI tidak pernah menyentuh situs sungguhan.**
- **Workflow**: Conventional Commits, TypeScript strict, lint rule i18n. CI tiap PR: lint, typecheck, unit/integrasi, E2E (Linux, `xvfb-run`).

---

## 11. Pemetaan dari Matane

Matane dipakai sebagai acuan pola. Tidak ada kode yang disalin; tabel ini hanya memandu desain.

| Konsep Matane | Di Matane Anime |
|---|---|
| Sistem extension (QuickJS, `utilityProcess`, repo bertanda tangan, install atomik) | **Sama** secara arsitektur; kontrak `Source` diganti (§7); manifest ditambah `type: "anime"` |
| `Manga` / `Chapter` / `Page` | `Anime` / `Episode` / `Stream` |
| `getPages` + `getImageUrl` | `getStreams`; resolve dua langkah dikerjakan extension |
| `transformImage`, `reportImage`, crop/split gambar, sharp untuk halaman | **Dibuang**; `sharp` hanya untuk warna dominan cover |
| `manga://page/…` + cache gambar LRU 1 GB | `anime://play/<sessionId>/…` (proxy/lokal); **video tidak di-cache ke disk**; hanya cover di cache |
| Reader (single/double/webtoon, tap zone, filter warna) | Pemutar video (§6.3) |
| Progress per halaman + offset webtoon | Progress per episode (`position_ms`); ambang ditonton |
| Status baca per nomor chapter + prioritas scanlator | Status ditonton per nomor episode; `variant` menggantikan scanlator (tanpa prioritas di v1) |
| Download CBZ/folder gambar + ComicInfo | HLS: folder segmen + playlist lokal; MP4: file |
| Update checker (3 paralel, aturan lewati, "baru = fetched setelah ditambahkan") | **Sama** |
| History per manga, `reading_sessions` | History per anime, `watch_sessions` |
| `ProgressRepository.onRead` sebagai satu pintu tracker | `WatchService` sebagai satu pintu progress (§6.6) |
| Tracker (AniList/MAL/Kitsu/MangaUpdates, dua arah, antrean offline) | **P2**, tabel dan satu pintu siap; AniList/MAL/Kitsu mendukung anime |
| Backup/restore, import Mihon | Backup **P1**; import Aniyomi P2 |
| Statistik, Discord RPC, local files | **P2** |
| Tema Catppuccin, i18n EN/ID, command palette, onboarding, What's new, tray, updater, network settings | **Sama** (prioritas per §5) |
| Packaging (AppImage, NSIS, dmg, deb, rpm, AUR, Flatpak) | **Sama** (bertahap, §12) |

---

## 12. Rilis dan distribusi

- **Paket awal (beta)**: Windows NSIS, macOS dmg (arm64 + x64), Linux AppImage; auto-update lewat GitHub Releases dengan channel **stable** dan **beta** (pre-release). Berikutnya (P1): portable, deb, rpm, AUR, Flatpak.
- **Tanpa code signing dulu.** Cara melewati SmartScreen/Gatekeeper didokumentasikan; macOS tanpa signing tidak bisa auto-update, hanya diberi tahu.
- **Identitas**: `productName` `Matane Anime`; `appId` dan folder data berbeda dari Matane (mis. `dev.sukun.matane-anime`, `~/.config/Matane Anime`); folder download default `Documents/Matane Anime`. Dapat berdampingan dengan Matane di satu komputer.
- **Dokumentasi**: README (fitur, instalasi per OS, **disclaimer**), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, situs VitePress (panduan pengguna + panduan membuat extension), template issue (permintaan sumber diarahkan ke repo extension).
- **Disclaimer wajib**: app tidak meng-host, menyimpan, atau mendistribusikan konten; pengembang tidak berafiliasi dengan konten apa pun dari extension pihak ketiga.

---

## 13. Roadmap

> Karena alur dan pola sudah terbukti di Matane, urutan fase mengikuti Matane, tetapi **risiko terbesar (pemutaran dan download HLS) dibuktikan paling awal**. Beta dimulai setelah Fase 3.

**Fase 0: Fondasi dan spike pemutaran**
- Monorepo pnpm, electron-vite, React, Tailwind + shadcn/ui, TanStack Router/Query, Zustand; i18n EN + ID; ESLint/Prettier; CI untuk PR.
- SQLite + Drizzle + **seluruh skema §9** + migrasi; kontrak IPC bertipe; electron-log.
- Shell UI: title bar kustom, sidebar, sistem tema.
- **Spike pemutaran** (R1): `anime://play` memutar HLS dengan hls.js dan header `Referer` dari main (lewat header penanda, lihat ADR 0008); seek MP4 lewat `Range` 206; diuji di Windows, macOS, Linux; catat codec/container yang gagal; hasilnya menentukan ADR transport media.
- Kunci versi toolchain (ADR).
- ADR: mockup di Claude Design (`docs/ui/MOCKUP_PLAN.md`, tema Catppuccin) menjadi **sumber kebenaran UI**, setara ADR 0008 di Matane.

**Fase 1: Extension dan menonton** *(selesai 7 Okt 2026; rencana dan penyimpangannya di [docs/plans/fase-1-extension-menonton.md](plans/fase-1-extension-menonton.md))*
- `extension-runtime` (QuickJS) + batas sumber daya + test sandbox + benchmark; extension host; host API.
- Network layer: `net.request`, partition per extension, rate limit (termasuk bucket media), UA, Cloudflare.
- SDK + `ma-ext create|build|test|bench`; extension contoh untuk uji E2E (tidak dikirim bersama app). Setelah SDK jadi, pemilik produk menulis extension nyata pertama di **repo terpisah** untuk uji manual; repo app tidak merujuknya.
- Browse (source, popular/latest/search, filter, buka dari URL), detail + daftar episode.
- **Pemutar**: kontrol dasar, keyboard, next/prev, autoplay, menu server/kualitas, error state.
- `PlaybackService`: pemilihan stream, probe, fallback.
- Penutup: E2E dengan extension tiruan + situs tiruan di CI.

**Fase 2: Library dan progress**
- Library (kategori multi, sort/filter, FTS5, multi-select, cover permanen).
- `WatchService`: progress, resume, ambang ditonton, "lanjut nonton", history, `watch_sessions`.
- Global search; migrasi source (P1).
- Penutup: E2E alur penuh termasuk restart app; ukur performa 1.000 anime / 50 ribu episode.

**Fase 3: Download dan update → beta**
- Antrean download persisten, HLS dan MP4, penulisan atomik, tonton offline, cek ruang disk, batas ukuran.
- Auto-download episode baru; download ahead dan hapus setelah ditonton (P1).
- Update checker + aturan lewati, halaman Updates, notifikasi; tray dan jalan saat login (P1).
- Paket beta: AppImage, NSIS, dmg + auto-update (channel beta).
- Penutup: E2E (download → situs mati → tonton offline → episode baru → Updates → auto-download).

**Fase 4: Ekosistem extension**
- Repo extension (`index.json`), signing ed25519, install/update/uninstall, filter NSFW dan bahasa.
- Mode dev (hot reload, panel log), `ma-ext repo keygen|build|verify`.
- `migrateUrl`; publikasi SDK ke npm; panduan membuat extension.

**Fase 5: Polish dan rilis v1.0**
- Setting jaringan (DoH, proxy, UA), tes koneksi.
- Command palette, onboarding, What's new, tema AMOLED + aksen, incognito (P1).
- Backup/restore (P1; selambatnya v1.1).
- Paket tambahan (portable, deb, rpm, AUR, Flatpak), dokumentasi lengkap, rilis **v1.0**.

**Pasca-v1 (P2)**
- Tracker (AniList, MyAnimeList, Kitsu; progress = nomor episode; dua arah).
- Subtitle (SRT/VTT/ASS), pilihan audio, PiP, skip +85 detik, pemutar eksternal.
- Statistik tontonan, Discord RPC, ekspor mp4, local files, import backup Aniyomi, template extension, code signing.

---

## 14. Risiko

| ID | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | **hls.js/MSE di atas protokol privileged `anime://` bermasalah** (header, `Range`, CORS) di salah satu OS | Pemutaran inti gagal | Spike di Fase 0 (lulus di Linux; Windows dan macOS lewat workflow CI); alternatif custom loader hls.js lewat IPC (§8.3); keputusan di ADR 0008 |
| R2 | **Codec/container tidak didukung** Chromium (MKV, HEVC, dll.) | Video tidak bisa diputar | Error state yang jelas; ranking berdasar `CODECS` (PLY-12); pemutar eksternal di P2; uji dan catat di Fase 0 |
| R3 | **Download HLS kompleks** (enkripsi AES-128, fMP4, audio terpisah, playlist relatif/absolut, token kedaluwarsa) | Unduhan rusak atau bisu | Fixture HLS beragam di E2E; penulisan atomik; resume per segmen; playlist live ditolak; extension bisa dipanggil ulang untuk URL baru |
| R4 | **Ukuran file besar** (satu episode ratusan MB–beberapa GB) | Disk penuh | Cek ruang disk, batas total, auto-download default mati, ukuran terlihat per anime |
| R5 | **URL stream cepat kedaluwarsa** | Pemutaran/unduhan terputus di tengah | Resolve ulang `getStreams` sekali (STR-4); tidak menyimpan URL stream di DB |
| R6 | **Situs sumber berubah atau rusak, resolve embed rapuh** | Source berhenti bekerja | Extension diperbarui terpisah dari app; smoke test harian di repo extension; `migrateUrl`; fallback server |
| R7 | **Cloudflare/anti-bot** pada sumber maupun CDN video | Request ditolak | `BrowserWindow` tersembunyi → tampil; UA konsisten; partition per extension |
| R8 | **Pemblokiran ISP (mis. Internet Positif)** | Sumber tak terjangkau | DoH dan proxy di setting (P0) |
| R9 | **Legal/DMCA** | Proyek ditutup | App tanpa sumber, repo, atau kunci bawaan; tidak mengusulkan repo; disclaimer; permintaan sumber diarahkan ke repo extension |
| R10 | **Keamanan extension** | Pencurian data/eksekusi kode | Sandbox QuickJS, signing repo + kepercayaan per kunci, `SECURITY.md`, test sandbox di CI |
| R11 | **Cakupan v1 besar** | Rilis tertunda | Beta setelah Fase 3; P1 boleh bergeser ke v1.x tanpa mengganggu inti |
| R12 | **Modul native** (`better-sqlite3`, `sharp`) | Build gagal di OS tertentu | Build matrix per OS di CI; tanpa cross-compile |
| R13 | **Tanpa code signing** | Peringatan OS, macOS tanpa auto-update | Dokumentasikan; pertimbangkan signing setelah ada pengguna |
| R14 | **Tray di Linux tidak konsisten** | Update/download latar belakang tidak jalan | Tray opsional; app tidak bergantung padanya |
| R15 | **Perkiraan hardsub tidak berlaku** untuk sebagian sumber | Pengguna butuh subtitle | Kontrak dicadangkan untuk field `subtitles` opsional; subtitle menjadi prioritas pertama pasca-v1 bila diminta |

---

## 15. Open questions

### 15.1 Sudah diputuskan (6 Okt 2026)

- [x] **Extension pertama**: ditulis pemilik produk sendiri di repo terpisah setelah SDK jadi (Fase 1); repo app tidak merujuknya. Lihat §4.
- [x] **Varian episode (Sub/Dub/BD)**: satu status ditonton per nomor episode; varian yang diputar adalah yang pertama dari extension. Lihat §4 dan PRG-5.
- [x] **Backup/restore**: P1, target v1.0, selambatnya v1.1. Lihat §4.
- [x] **Nama paket dan CLI**: `@matane-anime/*`, `ma-ext`. Lihat §4.
- [x] **`appId`**: `dev.sukun.matane-anime`. Lihat §4.
- [x] **Field `season` pada kontrak**: tidak ada di v1. Penomoran episode (absolut atau per season) diputuskan extension; app memakai `number` hanya untuk urutan dan penandaan. Ditinjau lagi bila tracker membutuhkannya.

### 15.2 Masih terbuka, menunggu implementasi atau spike

Tiap butir punya **asumsi sementara** yang dipakai PRD ini sampai terbukti salah.

- [ ] **Transport media**: protokol `anime://` langsung, atau custom loader hls.js lewat IPC. *Asumsi:* protokol langsung. **Terbukti di Linux (6 Okt 2026)**: HLS TS, URI absolut lintas host, AES-128, fMP4, dan seek MP4 lewat `Range` 206 berjalan; ditutup setelah spike hijau di Windows dan macOS ([ADR 0008](adr/0008-media-transport.md)). Temuan: `Referer` dan `Origin` tidak bisa diset lewat `net.fetch`/`net.request` dan dikirim lewat header penanda yang diganti di `webRequest.onBeforeSendHeaders`.
- [ ] **Referensi codec** yang dianggap didukung (tabel di dokumentasi). **Linux terisi** (H.264, Hi10P, VP8, VP9, AV1, Opus, FLAC jalan; HEVC hanya audio, tanpa gambar); kolom Windows dan macOS menunggu spike ([ADR 0009](adr/0009-codec-support.md)).
- [ ] **Rendition audio terpisah di HLS (`EXT-X-MEDIA TYPE=AUDIO`)**: cara memilih grup audio saat mengunduh. *Asumsi:* grup audio `DEFAULT=YES` dari varian terpilih. **Diputuskan di Fase 3** dengan fixture HLS yang beragam.
- [ ] **Angka default** paralelisme download (1 episode × 6 segmen) dan bucket media (30/detik). *Asumsi:* angka awal. **Disetel ulang dari benchmark Fase 3.**
- [ ] **Ketersediaan nama**: scope npm `@matane-anime`, repo GitHub, dan paket AUR/Flathub. **Dicek sebelum publikasi pertama** (Fase 4–5); bila bentrok, nama dikembalikan ke pembahasan.
- [ ] **Tracker**: field tambahan apa yang dibutuhkan agar pencocokan otomatis akurat selain `altTitles`, `year`, dan `type`. **Diputuskan saat tracker masuk roadmap** (P2).

---

## 16. Kriteria penerimaan v1.0

- [ ] Semua persyaratan P0 di §6 lulus uji (unit/integrasi/E2E) di Windows, macOS, dan Linux.
- [ ] Alur penuh E2E lulus di CI: browse → detail → putar → library → download → tonton offline (situs tiruan dimatikan) → episode baru → Updates → auto-download.
- [ ] Posisi tonton pulih setelah menutup pemutar dan setelah restart app (selisih ≤ 5 detik).
- [ ] Fallback server berjalan: stream pertama dibuat gagal, app pindah ke stream berikutnya tanpa tindakan pengguna, posisi dipertahankan.
- [ ] Target performa §10.1 terpenuhi pada benchmark lokal.
- [ ] Test sandbox extension lulus (`require`, `process`, batas memori/CPU, timeout).
- [ ] App tanpa sumber, repo, atau kunci bawaan; README memuat disclaimer.
- [ ] Paket AppImage, NSIS, dan dmg terbuat, dan auto-update di channel beta terverifikasi.
- [ ] Dokumentasi pengguna dan panduan membuat extension terbit.

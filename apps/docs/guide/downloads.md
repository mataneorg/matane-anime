# Downloads and offline

Episodes can be downloaded and watched without a connection. Downloaded episodes are always played in preference to streaming; if the file is missing, the download is marked broken and the app falls back to streaming.

## What can be downloaded

- **HLS** (`.m3u8`, video on demand): the app picks the variant that matches your download quality, fetches the segments (including encrypted AES-128 ones and separate audio), and rewrites the playlist to local paths. A live stream (no end marker) is refused with a clear message.
- **MP4**: downloaded with resume.

## The queue

The queue is persistent: it continues after you reopen the app. One episode downloads at a time by default (1 to 3 in Settings), with several segments in parallel. You can pause or resume everything or one item, reorder, cancel or delete. The Downloads page shows progress, speed and time left. Failed segments are retried three times; a download that still fails shows an error with a retry button, and the queue waits while you are offline.

## Safe writing

Segments are written to a temporary folder and only renamed into place when everything is complete. If the app is closed or a download fails, the segments already downloaded are kept, so a retry fetches only what is missing.

## Folder and limits

- The default folder is `Documents/Matane Anime`, in the layout `<folder>/<Source (LANG)>/<Anime>/<Episode>/`. Changing the folder in Settings moves the downloads.
- The app checks free disk space before it starts, and warns when it cannot estimate the size and less than 2 GB is free.
- A **total size limit** (20 GB by default) stops automatic downloads when it is reached; you can still download manually after confirming.
- **Auto-download** of new episodes is per category and **off by default**.

Settings, Downloads is where these options live.

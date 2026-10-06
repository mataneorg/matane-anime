CREATE TABLE `extension_prefs` (
	`extension_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	PRIMARY KEY(`extension_id`, `key`),
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `extension_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`public_key` text,
	`index_json` text,
	`signature` text,
	`last_fetched_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extension_repos_url_unique` ON `extension_repos` (`url`);--> statement-breakpoint
CREATE TABLE `extension_storage` (
	`extension_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	PRIMARY KEY(`extension_id`, `key`),
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`api_version` integer NOT NULL,
	`repo_id` integer,
	`nsfw` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `extension_repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`lang` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_extension_key_unique` ON `sources` (`extension_id`,`key`);--> statement-breakpoint
CREATE TABLE `anime` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`alt_titles_json` text DEFAULT '[]' NOT NULL,
	`description` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`studio` text,
	`year` integer,
	`status` text DEFAULT 'unknown' NOT NULL,
	`type` text,
	`thumbnail_url` text,
	`cover_path` text,
	`custom_cover_path` text,
	`cover_color` text,
	`in_library` integer DEFAULT false NOT NULL,
	`added_at` integer,
	`last_update_check_at` integer,
	`latest_episode_at` integer,
	`playback_prefs_json` text,
	`episode_view_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anime_source_url_unique` ON `anime` (`source_id`,`url`);--> statement-breakpoint
CREATE INDEX `anime_in_library_idx` ON `anime` (`in_library`);--> statement-breakpoint
CREATE TABLE `anime_categories` (
	`anime_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`anime_id`, `category_id`),
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `anime_categories_category_idx` ON `anime_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`settings_json` text
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`anime_id` integer NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`number` real,
	`variant` text,
	`uploaded_at` integer,
	`source_order` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer NOT NULL,
	`watched` integer DEFAULT false NOT NULL,
	`watched_at` integer,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`source_missing` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_anime_url_unique` ON `episodes` (`anime_id`,`url`);--> statement-breakpoint
CREATE INDEX `episodes_anime_number_idx` ON `episodes` (`anime_id`,`number`);--> statement-breakpoint
CREATE INDEX `episodes_fetched_at_idx` ON `episodes` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`episode_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`queue_order` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`segments_done` integer DEFAULT 0 NOT NULL,
	`segments_total` integer,
	`bytes_done` integer DEFAULT 0 NOT NULL,
	`size_bytes` integer,
	`quality` integer,
	`server` text,
	`error` text,
	`path` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloads_episodeId_unique` ON `downloads` (`episode_id`);--> statement-breakpoint
CREATE INDEX `downloads_status_order_idx` ON `downloads` (`status`,`queue_order`);--> statement-breakpoint
CREATE TABLE `image_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_type` text,
	`last_access_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `image_cache_last_access_idx` ON `image_cache` (`last_access_at`);--> statement-breakpoint
CREATE TABLE `anime_tracks` (
	`anime_id` integer NOT NULL,
	`service` text NOT NULL,
	`remote_id` text NOT NULL,
	`remote_url` text,
	`remote_title` text,
	`status` text,
	`score` real,
	`progress` real,
	`started_at` integer,
	`finished_at` integer,
	`sync_back` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`anime_id`, `service`),
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracker_accounts` (
	`service` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`username` text,
	`token_encrypted` text,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `tracker_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`anime_id` integer NOT NULL,
	`service` text NOT NULL,
	`payload_json` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `history` (
	`anime_id` integer PRIMARY KEY NOT NULL,
	`episode_id` integer NOT NULL,
	`watched_at` integer NOT NULL,
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `watch_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`anime_id` integer NOT NULL,
	`episode_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`active_ms` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `watch_sessions_started_at_idx` ON `watch_sessions` (`started_at`);
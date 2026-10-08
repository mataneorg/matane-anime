CREATE INDEX `anime_library_added_idx` ON `anime` (`in_library`,`added_at`);--> statement-breakpoint
CREATE INDEX `episodes_anime_watched_idx` ON `episodes` (`anime_id`,`watched`);--> statement-breakpoint
CREATE INDEX `history_watched_at_idx` ON `history` (`watched_at`);
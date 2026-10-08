ALTER TABLE `extension_repos` ADD `signing_key` text;--> statement-breakpoint
ALTER TABLE `extension_repos` ADD `serial` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `extensions` ADD `origin` text DEFAULT 'dev' NOT NULL;--> statement-breakpoint
ALTER TABLE `extensions` ADD `install_dir` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `sha256` text;
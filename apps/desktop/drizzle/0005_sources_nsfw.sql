ALTER TABLE `sources` ADD `nsfw` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `sources` SET `nsfw` = COALESCE((SELECT `nsfw` FROM `extensions` WHERE `extensions`.`id` = `sources`.`extension_id`), 0);

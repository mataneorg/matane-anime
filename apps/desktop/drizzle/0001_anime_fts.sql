-- Full-text search over the library by title and alternative titles (docs/PRD.md LIB-4).
-- Kept in sync with `anime` by triggers; rowid = anime.id. `alt_titles` is the JSON array flattened to text.
CREATE VIRTUAL TABLE `anime_fts` USING fts5(title, alt_titles, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `anime_fts_after_insert` AFTER INSERT ON `anime` BEGIN
  INSERT INTO `anime_fts` (rowid, title, alt_titles)
  VALUES (new.id, new.title, (SELECT coalesce(group_concat(value, ' '), '') FROM json_each(new.alt_titles_json)));
END;
--> statement-breakpoint
CREATE TRIGGER `anime_fts_after_delete` AFTER DELETE ON `anime` BEGIN
  DELETE FROM `anime_fts` WHERE rowid = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `anime_fts_after_update` AFTER UPDATE OF title, alt_titles_json ON `anime` BEGIN
  UPDATE `anime_fts`
  SET title = new.title,
      alt_titles = (SELECT coalesce(group_concat(value, ' '), '') FROM json_each(new.alt_titles_json))
  WHERE rowid = new.id;
END;

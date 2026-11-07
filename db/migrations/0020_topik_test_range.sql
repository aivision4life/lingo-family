ALTER TABLE `topik_tests` ADD `from_number` integer;--> statement-breakpoint
ALTER TABLE `topik_tests` ADD `to_number` integer;--> statement-breakpoint
-- Every sitting drawn before ranges existed started at question 1 and ran to its last item, so its
-- own items say what it covered. Backfilled rather than left null, so the history screen has one
-- shape to read and no "unknown range" case to carry for ever.
UPDATE `topik_tests` SET
  `from_number` = (SELECT MIN(i.`number`) FROM `topik_test_items` i WHERE i.`test_id` = `topik_tests`.`id`),
  `to_number` = (SELECT MAX(i.`number`) FROM `topik_test_items` i WHERE i.`test_id` = `topik_tests`.`id`)
WHERE `from_number` IS NULL
  AND EXISTS (SELECT 1 FROM `topik_test_items` i WHERE i.`test_id` = `topik_tests`.`id`);

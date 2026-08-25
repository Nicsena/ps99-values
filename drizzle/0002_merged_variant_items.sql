-- Revision 2 of the database redesign: merge variant dimensions back onto
-- `items` (one row per variant) and drop `item_variants`, remapping snapshots.
-- Data-carrying: existing rows become primary rows (ids/slugs preserved);
-- each item_variants row expands into an items row with prefixed displayName
-- and grammar slug (NULL slug for chroma/tier-only variants).
CREATE TABLE `items_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection` text NOT NULL,
	`name` text NOT NULL,
	`displayName` text,
	`description` text,
	`slug` text,
	`colorVariants` text,
	`hidden` integer DEFAULT false NOT NULL,
	`imageId` integer,
	`huge` integer DEFAULT false NOT NULL,
	`titanic` integer DEFAULT false NOT NULL,
	`gargantuan` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`variant` integer DEFAULT 0 NOT NULL,
	`shiny` integer DEFAULT false NOT NULL,
	`chroma` integer DEFAULT 0 NOT NULL,
	`tier` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`collection`) REFERENCES `collections`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `items_new` (`id`, `collection`, `name`, `displayName`, `description`, `slug`, `colorVariants`, `hidden`, `imageId`, `huge`, `titanic`, `gargantuan`, `createdAt`)
SELECT `id`, `collection`, `name`, `displayName`, `description`, `slug`, `colorVariants`, `hidden`, `imageId`, `huge`, `titanic`, `gargantuan`, `createdAt` FROM `items`;
--> statement-breakpoint
INSERT INTO `items_new` (`collection`, `name`, `displayName`, `description`, `slug`, `colorVariants`, `hidden`, `imageId`, `huge`, `titanic`, `gargantuan`, `createdAt`, `variant`, `shiny`, `chroma`, `tier`)
SELECT i.`collection`, i.`name`,
	CASE
		WHEN v.`shiny` = 1 AND v.`variant` = 1 THEN 'Shiny Golden ' || COALESCE(i.`displayName`, i.`name`)
		WHEN v.`shiny` = 1 AND v.`variant` = 2 THEN 'Shiny Rainbow ' || COALESCE(i.`displayName`, i.`name`)
		WHEN v.`variant` = 1 THEN 'Golden ' || COALESCE(i.`displayName`, i.`name`)
		WHEN v.`variant` = 2 THEN 'Rainbow ' || COALESCE(i.`displayName`, i.`name`)
		WHEN v.`shiny` = 1 THEN 'Shiny ' || COALESCE(i.`displayName`, i.`name`)
		ELSE COALESCE(i.`displayName`, i.`name`)
	END,
	i.`description`,
	CASE WHEN v.`chroma` = 0 AND v.`tier` = 0 THEN
		(CASE WHEN v.`shiny` = 1 THEN 'shiny-' ELSE '' END) ||
		(CASE WHEN v.`variant` = 1 THEN 'golden-' WHEN v.`variant` = 2 THEN 'rainbow-' ELSE '' END) ||
		i.`slug`
	ELSE NULL END,
	i.`colorVariants`, i.`hidden`, i.`imageId`, i.`huge`, i.`titanic`, i.`gargantuan`, i.`createdAt`,
	v.`variant`, v.`shiny`, v.`chroma`, v.`tier`
FROM `item_variants` v JOIN `items` i ON i.`id` = v.`item_id`
WHERE NOT (v.`variant` = 0 AND v.`shiny` = 0 AND v.`chroma` = 0 AND v.`tier` = 0);
--> statement-breakpoint
-- Slug collisions: primary/base rows win; other rows take a -<collection> suffix.
UPDATE `items_new` SET `slug` = `slug` || '-' || LOWER(`collection`)
WHERE `id` IN (
	SELECT `id` FROM (
		SELECT `id`, ROW_NUMBER() OVER (
			PARTITION BY `slug`
			ORDER BY CASE WHEN `variant` = 0 AND `shiny` = 0 AND `chroma` = 0 AND `tier` = 0 THEN 0 ELSE 1 END, `id`
		) AS rn
		FROM `items_new` WHERE `slug` IS NOT NULL
	) WHERE rn > 1
);
--> statement-breakpoint
-- Second pass for any residual duplicates introduced by suffixing.
UPDATE `items_new` SET `slug` = `slug` || '-m'
WHERE `id` IN (
	SELECT `id` FROM (
		SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `slug` ORDER BY `id`) AS rn
		FROM `items_new` WHERE `slug` IS NOT NULL
	) WHERE rn > 1
);
--> statement-breakpoint
CREATE TABLE `snapshots_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`metric` text NOT NULL,
	`value` integer NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items_new`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `snapshots_new` (`item_id`, `metric`, `value`, `captured_at`)
SELECT n.`id`, s.`metric`, s.`value`, s.`captured_at`
FROM `snapshots` s
JOIN `item_variants` v ON v.`id` = s.`variant_id`
JOIN `items` i ON i.`id` = v.`item_id`
JOIN `items_new` n ON n.`collection` = i.`collection` AND n.`name` = i.`name`
	AND n.`variant` = v.`variant` AND n.`shiny` = v.`shiny` AND n.`chroma` = v.`chroma` AND n.`tier` = v.`tier`;
--> statement-breakpoint
DROP TABLE `snapshots`;
--> statement-breakpoint
DROP TABLE `item_variants`;
--> statement-breakpoint
DROP TABLE `items`;
--> statement-breakpoint
ALTER TABLE `items_new` RENAME TO `items`;
--> statement-breakpoint
ALTER TABLE `snapshots_new` RENAME TO `snapshots`;
--> statement-breakpoint
CREATE UNIQUE INDEX `items_identity_uq` ON `items` (`collection`,`name`,`variant`,`shiny`,`chroma`,`tier`);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_slug_uq` ON `items` (`slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_unique_idx` ON `snapshots` (`item_id`,`metric`,`captured_at`);

CREATE TABLE `app_settings` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`type` text NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`name` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`date_synced` integer
);
--> statement-breakpoint
CREATE TABLE `item_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`variant` integer DEFAULT 0 NOT NULL,
	`shiny` integer DEFAULT false NOT NULL,
	`chroma` integer DEFAULT 0 NOT NULL,
	`tier` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_variants_uq` ON `item_variants` (`item_id`,`variant`,`shiny`,`chroma`,`tier`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection` text NOT NULL,
	`name` text NOT NULL,
	`displayName` text,
	`description` text,
	`slug` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`imageId` integer,
	`huge` integer DEFAULT false NOT NULL,
	`titanic` integer DEFAULT false NOT NULL,
	`gargantuan` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`collection`) REFERENCES `collections`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_identity_uq` ON `items` (`collection`,`name`);--> statement-breakpoint
CREATE INDEX `items_slug_idx` ON `items` (`slug`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`metric` text NOT NULL,
	`value` integer NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `item_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_unique_idx` ON `snapshots` (`variant_id`,`metric`,`captured_at`);
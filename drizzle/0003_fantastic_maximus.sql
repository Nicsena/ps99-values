CREATE TABLE `category` (
	`name` text PRIMARY KEY NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `collections` ADD `displayName` text;--> statement-breakpoint
ALTER TABLE `items` ADD `configData` text;
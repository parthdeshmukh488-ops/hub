CREATE TABLE `agents` (
	`address` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`view` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agents_owner` ON `agents` (`owner`);--> statement-breakpoint
CREATE TABLE `allowances` (
	`delegation` text PRIMARY KEY NOT NULL,
	`agent` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `allowances_agent` ON `allowances` (`agent`);--> statement-breakpoint
CREATE TABLE `cursors` (
	`source` text PRIMARY KEY NOT NULL,
	`last_signature` text,
	`last_slot` integer
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`signature` text NOT NULL,
	`slot` integer NOT NULL,
	`block_time` integer NOT NULL,
	`timestamp` integer NOT NULL,
	`owner` text,
	`principal` text,
	`agent` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id_unique` ON `events` (`id`);--> statement-breakpoint
CREATE INDEX `events_owner_order` ON `events` (`owner`,`slot`,`seq`);--> statement-breakpoint
CREATE INDEX `events_agent_order` ON `events` (`agent`,`slot`,`seq`);--> statement-breakpoint
CREATE INDEX `events_owner_time` ON `events` (`owner`,`timestamp`);--> statement-breakpoint
CREATE TABLE `payee_entries` (
	`address` text PRIMARY KEY NOT NULL,
	`agent` text NOT NULL,
	`payee` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_entries_agent_payee` ON `payee_entries` (`agent`,`payee`);--> statement-breakpoint
CREATE TABLE `payees` (
	`address` text PRIMARY KEY NOT NULL,
	`agent` text NOT NULL,
	`payee` text NOT NULL,
	`view` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payees_agent_payee` ON `payees` (`agent`,`payee`);--> statement-breakpoint
CREATE TABLE `principals` (
	`address` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`guardian` text,
	`view` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `principals_owner_unique` ON `principals` (`owner`);--> statement-breakpoint
CREATE INDEX `principals_guardian` ON `principals` (`guardian`);--> statement-breakpoint
CREATE TABLE `requests` (
	`address` text PRIMARY KEY NOT NULL,
	`agent` text NOT NULL,
	`owner` text NOT NULL,
	`nonce` text NOT NULL,
	`status` text NOT NULL,
	`view` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `requests_owner` ON `requests` (`owner`);--> statement-breakpoint
CREATE UNIQUE INDEX `requests_agent_nonce` ON `requests` (`agent`,`nonce`);
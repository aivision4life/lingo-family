ALTER TABLE `examples` ADD `image_key` text;--> statement-breakpoint
ALTER TABLE `examples` ADD `image_prompt` text;--> statement-breakpoint
ALTER TABLE `examples` ADD `image_source` text;--> statement-breakpoint
ALTER TABLE `examples` ADD `image_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `examples` ADD `image_nonce` text;--> statement-breakpoint
ALTER TABLE `examples` ADD `image_requested_at` integer;--> statement-breakpoint
ALTER TABLE `examples` ADD `image_model` text;--> statement-breakpoint
ALTER TABLE `phrases` ADD `image_key` text;--> statement-breakpoint
ALTER TABLE `phrases` ADD `image_prompt` text;--> statement-breakpoint
ALTER TABLE `phrases` ADD `image_source` text;--> statement-breakpoint
ALTER TABLE `phrases` ADD `image_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `phrases` ADD `image_nonce` text;--> statement-breakpoint
ALTER TABLE `phrases` ADD `image_requested_at` integer;--> statement-breakpoint
ALTER TABLE `phrases` ADD `image_model` text;--> statement-breakpoint
ALTER TABLE `words` ADD `image_prompt` text;--> statement-breakpoint
ALTER TABLE `words` ADD `image_source` text;--> statement-breakpoint
ALTER TABLE `words` ADD `image_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `image_nonce` text;--> statement-breakpoint
ALTER TABLE `words` ADD `image_requested_at` integer;--> statement-breakpoint
ALTER TABLE `words` ADD `image_model` text;
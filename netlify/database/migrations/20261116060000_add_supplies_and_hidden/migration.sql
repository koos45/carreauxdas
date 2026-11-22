CREATE TABLE IF NOT EXISTS "hidden_products" (
	"product_id" text PRIMARY KEY,
	"hidden_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_supplies" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

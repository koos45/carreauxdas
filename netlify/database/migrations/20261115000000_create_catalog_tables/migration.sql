CREATE TABLE "custom_products" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_overrides" (
	"product_id" text PRIMARY KEY,
	"in_stock" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

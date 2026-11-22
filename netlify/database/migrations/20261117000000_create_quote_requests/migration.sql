CREATE TABLE IF NOT EXISTS "quote_requests" (
	"id" text PRIMARY KEY,
	"client_name" text NOT NULL,
	"client_contact" text NOT NULL,
	"client_city" text NOT NULL,
	"total_estime" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

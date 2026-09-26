CREATE TABLE "storage_deletions" (
	"key" varchar(1024) PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);

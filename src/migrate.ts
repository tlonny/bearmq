export const generateMigrationSql = (schema : string) : string[] => {
    const escapedSchema = schema.replace(/"/g, "\"\"")
    return [
        `CREATE TABLE IF NOT EXISTS "${escapedSchema}"."job_schedule" (
            "id" TEXT PRIMARY KEY,
            "repeat_secs" INTEGER NOT NULL,
            "repeated_at" TIMESTAMP NOT NULL
        )`,

        `CREATE TABLE IF NOT EXISTS "${escapedSchema}"."job_group" (
            "id" TEXT PRIMARY KEY,
            "unlocked_at" TIMESTAMP NOT NULL,
            "num_refs" INTEGER NOT NULL
        )`,

        `CREATE TABLE IF NOT EXISTS "${escapedSchema}"."job" (
            "id" UUID PRIMARY KEY,
            "job_group_id" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "channel" TEXT NOT NULL,
            "payload" JSON NOT NULL,
            "num_attempts" INTEGER NOT NULL,
            "timeout_secs" INTEGER NOT NULL,
            "is_success" BOOLEAN NOT NULL,
            "created_at" TIMESTAMP NOT NULL,
            "available_at" TIMESTAMP NOT NULL,
            "finalized_at" TIMESTAMP,
            FOREIGN KEY ("job_group_id") REFERENCES "${escapedSchema}"."job_group" ("id")
        )`,

        `CREATE INDEX IF NOT EXISTS "job_group_idx" ON "${escapedSchema}"."job_group" (
            "unlocked_at"
        )`,

        `CREATE INDEX IF NOT EXISTS "job_idx" ON "${escapedSchema}"."job" (
            "job_group_id", 
            "name",
            "channel",
            "available_at", 
            "finalized_at"
        ) WHERE "finalized_at" IS NULL`,
    ]
}

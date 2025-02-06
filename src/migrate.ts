export const generateMigrationSql = (schema : string) : string[] => {
    const escapedSchema = schema.replace(/"/g, "\"\"")
    return [
        `
            CREATE TABLE IF NOT EXISTS "${escapedSchema}"."job_schedule" (
                "id" UUID PRIMARY KEY,
                "name" TEXT NOT NULL,
                "repeat_secs" INTEGER NOT NULL,
                "repeated_at" TIMESTAMP NOT NULL
            )
        `,

        `
            CREATE TABLE IF NOT EXISTS "${escapedSchema}"."job_mutex" (
                "id" UUID PRIMARY KEY,
                "name" TEXT NOT NULL,
                "job_name" TEXT NOT NULL,
                "queue" TEXT NOT NULL,
                "num_referenced_jobs" INTEGER NOT NULL,
                "num_active_jobs" INTEGER NOT NULL,
                "status" TEXT NOT NULL,
                "created_at" TIMESTAMP NOT NULL,
                "accessed_at" TIMESTAMP NOT NULL,
                "unlocked_at" TIMESTAMP NOT NULL
            )
        `,

        `
            CREATE TABLE IF NOT EXISTS "${escapedSchema}"."job" (
                "id" UUID PRIMARY KEY,
                "name" TEXT NOT NULL,
                "queue" TEXT NOT NULL,
                "job_mutex_id" UUID NOT NULL,
                "payload" JSON NOT NULL,
                "deduplication_key" TEXT NOT NULL,
                "timeout_secs" INTEGER NOT NULL,
                "num_attempts" INTEGER NOT NULL,
                "status" TEXT NOT NULL,
                "created_at" TIMESTAMP NOT NULL,
                "released_at" TIMESTAMP NOT NULL,
                "unlocked_at" TIMESTAMP NOT NULL,
                FOREIGN KEY ("job_mutex_id") REFERENCES "${escapedSchema}"."job_mutex" ("id")
            )
        `,

        `
            CREATE TABLE IF NOT EXISTS "${escapedSchema}"."finalized_job" (
                "id" UUID PRIMARY KEY,
                "name" TEXT NOT NULL,
                "payload" JSON NOT NULL,
                "created_at" TIMESTAMP NOT NULL,
                "is_success" BOOLEAN NOT NULL
            )
        `,

        `
            CREATE UNIQUE INDEX IF NOT EXISTS 
            "job_schedule_lookup_uidx" ON "${escapedSchema}"."job_schedule" (
                "name"
            )
        `,

        `
            CREATE UNIQUE INDEX IF NOT EXISTS 
            "job_mutex_lookup_uidx" ON "${escapedSchema}"."job_mutex" (
                "queue",
                "job_name",
                "name"
            )
        `,

        `
            CREATE INDEX IF NOT EXISTS
            "job_mutex_poll_idx" ON "${escapedSchema}"."job_mutex" (
                "queue",
                "job_name",
                "accessed_at"
            ) WHERE ("num_active_jobs" > 0 AND "status" = 'UNLOCKED')
        `,

        `
            CREATE UNIQUE INDEX IF NOT EXISTS
            "job_dedupe_uidx" ON "${escapedSchema}"."job" (
                "queue",
                "name",
                "deduplication_key"
            ) WHERE ("status" = 'WAITING')
        `,

        `
            CREATE INDEX IF NOT EXISTS
            "job_release_idx" ON "${escapedSchema}"."job" (
                "released_at"
            ) WHERE ("status" = 'WAITING')
        `,

        `
            CREATE INDEX IF NOT EXISTS
            "job_unlock_idx" ON "${escapedSchema}"."job" (
                "unlocked_at"
            ) WHERE ("status" = 'LOCKED')
        `,

        `
            CREATE INDEX IF NOT EXISTS
            "job_poll_idx" ON "${escapedSchema}"."job" (
                "job_mutex_id",
                "released_at"
            ) WHERE ("status" = 'ACTIVE')
        `,
    ]
}

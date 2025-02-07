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
            CREATE TABLE IF NOT EXISTS "${escapedSchema}"."job" (
                "id" UUID PRIMARY KEY,
                "name" TEXT NOT NULL,
                "queue" TEXT NOT NULL,
                "priority" INTEGER NOT NULL,
                "payload" JSON NOT NULL,
                "deduplication_key" TEXT NOT NULL,
                "timeout_secs" INTEGER NOT NULL,
                "num_attempts" INTEGER NOT NULL,
                "status" TEXT NOT NULL,
                "created_at" TIMESTAMP NOT NULL,
                "released_at" TIMESTAMP NOT NULL,
                "unlocked_at" TIMESTAMP NOT NULL
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
            "job_schedule_schedule_idx" ON "${escapedSchema}"."job_schedule" (
                "repeated_at" ASC
            )
        `,

        `
            CREATE UNIQUE INDEX IF NOT EXISTS
            "job_dedupe_uidx" ON "${escapedSchema}"."job" (
                "name",
                "deduplication_key"
            ) WHERE ("status" = 'WAITING')
        `,

        `
            CREATE INDEX IF NOT EXISTS
            "job_release_idx" ON "${escapedSchema}"."job" (
                "released_at" ASC
            ) WHERE ("status" = 'WAITING')
        `,

        `
            CREATE INDEX IF NOT EXISTS
            "job_unlock_idx" ON "${escapedSchema}"."job" (
                "unlocked_at" ASC
            ) WHERE ("status" = 'LOCKED')
        `,

        `
            CREATE INDEX IF NOT EXISTS
            "job_dequeue_idx" ON "${escapedSchema}"."job" (
                "queue",
                "priority" DESC,
                "released_at" ASC
            ) WHERE ("status" = 'ACTIVE')
        `,
    ]
}

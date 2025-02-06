import { createKyselyWrapper } from "@src/database"
import type { Job } from "@src/job"
import type { WorkerDirectory } from "@src/worker/directory"
import { sql } from "kysely"

export class JobFinalizeModule {

    private readonly directory : WorkerDirectory

    constructor(directory : WorkerDirectory) {
        this.directory = directory
    }

    async finalize(job : Job, params : { isSuccess: boolean }) {
        const context = this.directory.getContext()
        const database = createKyselyWrapper({
            pool: context.pool,
            schema: context.schema
        })

        await database.transaction().execute(async database => {
            const jobMutex = await database
                .selectFrom("jobMutex")
                .where("id", "=", job.jobMutexId)
                .select(["id", "numReferencedJobs"])
                .forUpdate()
                .executeTakeFirstOrThrow()

            await database
                .deleteFrom("job")
                .where("id", "=", job.id)
                .returning(["id", "name", "payload"])
                .execute()

            if(jobMutex.numReferencedJobs <= 1) {
                await database
                    .deleteFrom("jobMutex")
                    .where("id", "=", jobMutex.id)
                    .execute()
            } else {
                await database
                    .updateTable("jobMutex")
                    .where("id", "=", jobMutex.id)
                    .set({ "numReferencedJobs": jobMutex.numReferencedJobs - 1 })
                    .execute()
            }

            await database
                .insertInto("finalizedJob")
                .values({
                    id: job.id,
                    name: job.name,
                    isSuccess: params.isSuccess,
                    payload: job.payload,
                    createdAt: sql`NOW()`
                })
                .execute()
        })
    }

}

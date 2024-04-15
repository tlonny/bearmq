import { sql } from "kysely"
import type { Directory } from "@src/orchestrator/directory"
import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"

export class JobDeleteModule {
    private readonly directory : Directory
    private readonly pollSecs: number
    private readonly promise : Promise<void>
    private readonly semaphore : Semaphore

    private timeout : Timeout
    private shouldStop : boolean

    constructor(directory : Directory, params : {
        pollSecs : number
    }) {
        this.directory = directory
        this.pollSecs = params.pollSecs
        this.semaphore = new Semaphore(1)
        this.shouldStop = false
        this.timeout = new Timeout(() => this.semaphore.release())
        this.promise = this.deleteJobs()
    }

    private async deleteJobs() {
        const context = this.directory.getContext()
        while(!this.shouldStop) {

            const jobId = await context.database.transaction().execute(async (database) => {
                const row = await database
                    .selectFrom("job")
                    .innerJoin("jobGroup", "jobGroup.id", "job.jobGroupId")
                    .where("finalizedAt", "is not", null)
                    .where(eb => eb(sql<Date>`${eb.ref("finalizedAt")} + INTERVAL '1 second' * ${context.jobPostFinalizeDeleteSecs}`, "<=", sql<Date> `NOW()`))
                    .select(["job.id", "job.jobGroupId", "jobGroup.numRefs"])
                    .forUpdate()
                    .skipLocked()
                    .limit(1)
                    .executeTakeFirst()


                if(!row) {
                    return null
                }

                await database
                    .deleteFrom("job")
                    .where("id", "=", row.id)
                    .execute()

                if(row.numRefs <= 1) {
                    await database
                        .deleteFrom("jobGroup")
                        .where("id", "=", row.jobGroupId)
                        .returning(["numRefs"])
                        .execute()
                } else {
                    await database
                        .updateTable("jobGroup")
                        .where("id", "=", row.jobGroupId)
                        .set({ 
                            numRefs: row.numRefs - 1
                        })
                        .returning(["numRefs"])
                        .execute()
                }

                return row.id
            })

            if(!jobId) {
                this.timeout.set(this.pollSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            context.handleEvent({
                eventType: "ORCHESTRATOR_JOB_DELETE",
                jobId: jobId
            })

        }
    }

    async stop() {
        this.shouldStop = true
        this.semaphore.release()
        await this.promise
        this.timeout.clear()
    }
}

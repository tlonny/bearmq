import type { OrchestratorDirectory } from "@src/orchestrator/directory"
import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"
import { sql } from "kysely"

export class JobUnlockModule {
    private readonly directory : OrchestratorDirectory
    private readonly pollSecs: number
    private readonly promise : Promise<void>
    private readonly semaphore : Semaphore

    private timeout : Timeout
    private shouldStop : boolean

    constructor(directory : OrchestratorDirectory, params : {
        pollSecs : number
    }) {
        this.directory = directory
        this.pollSecs = params.pollSecs
        this.semaphore = new Semaphore(1)
        this.shouldStop = false
        this.timeout = new Timeout(() => this.semaphore.release())
        this.promise = this.unlockJobs()
    }

    private async unlockJobs() {
        const context = this.directory.getContext()
        const database = createKyselyWrapper({
            pool: context.pool,
            schema: context.schema
        })

        while(!this.shouldStop) {
            const lockedJob = await database.transaction().execute(async (database) => {
                const lockedJob = await database
                    .selectFrom("job")
                    .select(["id", "name", "jobMutexId"])
                    .where("status", "=", "LOCKED")
                    .where("unlockedAt", "<=", sql<Date>`NOW()`)
                    .orderBy("unlockedAt")
                    .forUpdate()
                    .skipLocked()
                    .limit(1)
                    .executeTakeFirst()

                if(!lockedJob) {
                    return null
                }

                const jobMutex = await database
                    .selectFrom("jobMutex")
                    .where("id", "=", lockedJob.jobMutexId)
                    .select(["id", "numActiveJobs"])
                    .forUpdate()
                    .executeTakeFirstOrThrow()

                await database
                    .updateTable("job")
                    .where("id", "=", lockedJob.id)
                    .set({ status: "ACTIVE" })
                    .execute()

                await database
                    .updateTable("jobMutex")
                    .where("id", "=", lockedJob.jobMutexId)
                    .set({ numActiveJobs: jobMutex.numActiveJobs + 1 })
                    .execute()

                return {
                    id: lockedJob.id,
                    name: lockedJob.name
                }
            })

            if(!lockedJob) {
                this.timeout.set(this.pollSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            context.handleEvent({
                eventType: "ORCHESTRATOR_JOB_UNLOCK",
                jobId: lockedJob.id,
                jobName: lockedJob.name
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


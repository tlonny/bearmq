import type { OrchestratorDirectory } from "@src/orchestrator/directory"
import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"

export class JobReleaseModule {
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
        this.promise = this.releaseJobs()
    }

    private async releaseJobs() {
        const context = this.directory.getContext()
        const database = createKyselyWrapper({
            pool: context.pool,
            schema: context.schema
        })

        while(!this.shouldStop) {
            const releasedJob = await database.transaction().execute(async (database) => {
                const waitingJob = await database
                    .selectFrom("job")
                    .select(["id", "name", "jobMutexId"])
                    .where("status", "=", "WAITING")
                    .orderBy("releasedAt")
                    .forUpdate()
                    .skipLocked()
                    .limit(1)
                    .executeTakeFirst()

                if(!waitingJob) {
                    return null
                }

                const jobMutex = await database
                    .selectFrom("jobMutex")
                    .where("id", "=", waitingJob.jobMutexId)
                    .select(["id", "numActiveJobs"])
                    .forUpdate()
                    .executeTakeFirstOrThrow()

                await database
                    .updateTable("job")
                    .where("id", "=", waitingJob.id)
                    .set({ status: "ACTIVE" })
                    .execute()

                await database
                    .updateTable("jobMutex")
                    .where("id", "=", waitingJob.jobMutexId)
                    .set({ numActiveJobs: jobMutex.numActiveJobs + 1 })
                    .execute()

                return {
                    id: waitingJob.id,
                    name: waitingJob.name
                }
            })

            if(!releasedJob) {
                this.timeout.set(this.pollSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            context.handleEvent({
                eventType: "ORCHESTRATOR_JOB_RELEASE",
                jobId: releasedJob.id,
                jobName: releasedJob.name
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


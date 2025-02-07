import type { OrchestratorDirectory } from "@src/orchestrator/directory"
import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"

type JobDetails = { id: string, name: string }

export class JobReleaseModule {
    private readonly directory : OrchestratorDirectory
    private readonly pollSecs: number
    private readonly promise : Promise<void>
    private readonly batchSize : number
    private readonly semaphore : Semaphore

    private timeout : Timeout
    private shouldStop : boolean

    constructor(directory : OrchestratorDirectory, params : {
        pollSecs : number
        batchSize : number
    }) {
        this.directory = directory
        this.pollSecs = params.pollSecs
        this.batchSize = params.batchSize
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
            const releasedJobs : JobDetails[] = await database.transaction().execute(async (database) => {
                const waitingJobs = await database
                    .selectFrom("job")
                    .select(["id", "name"])
                    .where("status", "=", "WAITING")
                    .orderBy("releasedAt")
                    .forUpdate()
                    .skipLocked()
                    .limit(this.batchSize)
                    .execute()

                if(waitingJobs.length === 0) {
                    return []
                }

                const jobIds = waitingJobs.map(j => j.id)
                await database
                    .updateTable("job")
                    .where("id", "in", jobIds)
                    .set({ status: "ACTIVE" })
                    .execute()

                return waitingJobs
            })

            if(releasedJobs.length === 0) {
                this.timeout.set(this.pollSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            for(const job of releasedJobs) {
                context.handleEvent({
                    eventType: "ORCHESTRATOR_JOB_RELEASE",
                    jobId: job.id,
                    jobName: job.name
                })
            }
        }
    }

    async stop() {
        this.shouldStop = true
        this.semaphore.release()
        await this.promise
        this.timeout.clear()
    }
}


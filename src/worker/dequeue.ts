import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"
import type { Job } from "@src/job"
import type { WorkerDirectory } from "@src/worker/directory"

type Request = (job : Job | null) => void

export class JobDequeueModule {

    private readonly directory : WorkerDirectory
    private readonly semaphore : Semaphore
    private readonly timeout : Timeout
    private readonly timeoutSecs : number
    private readonly promise : Promise<void>
    private readonly queue : string
    private readonly requestBuffer : Request[]
    private readonly batchSize : number

    private shouldStop : boolean

    constructor(directory : WorkerDirectory, params : {
        timeoutSecs : number
        batchSize : number
        queue: string
    }) {
        this.directory = directory
        this.semaphore = new Semaphore(1)
        this.shouldStop = false
        this.batchSize = params.batchSize
        this.timeoutSecs = params.timeoutSecs
        this.timeout = new Timeout(() => this.semaphore.release())
        this.queue = params.queue
        this.requestBuffer = []
        this.promise = this.processRequests()
    }

    async dequeue() : Promise<Job | null> {
        const result = new Promise<Job | null>(rs => {
            this.requestBuffer.push(rs)
        })
        this.semaphore.release()
        return result
    }

    private async processRequests() {
        const context = this.directory.getContext()
        const database = createKyselyWrapper({
            pool: context.pool,
            schema: context.schema
        })

        while(!this.shouldStop) {
            const numRequests = Math.min(this.requestBuffer.length, this.batchSize)
            if(numRequests === 0) {
                this.timeout.set(this.timeoutSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            const dequeuedJobs = await database.transaction().execute(async (database) => {
                const jobNames = this.directory.getContext()
                    .getJobDefinitions()
                    .map(jd => jd.name)

                if(jobNames.length === 0) {
                    return []
                }

                const dequeuedJobs = await database
                    .selectFrom("job")
                    .select([
                        "id",
                        "name",
                        "queue",
                        "payload",
                        "priority",
                        "deduplicationKey",
                        "numAttempts",
                        "timeoutSecs",
                        "status"
                    ])
                    .where("status", "=", "ACTIVE")
                    .where("queue", "=", this.queue)
                    .orderBy(["priority desc", "releasedAt"])
                    .limit(numRequests)
                    .forUpdate()
                    .skipLocked()
                    .execute()

                if(dequeuedJobs.length === 0) {
                    return []
                }

                const jobIds = dequeuedJobs.map(j => j.id)
                await database
                    .updateTable("job")
                    .where("id", "in", jobIds)
                    .set({ "status": "RUNNING" })
                    .execute()

                return dequeuedJobs
            })

            if(dequeuedJobs.length === 0) {
                this.timeout.set(this.timeoutSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            for(const dequeuedJob of dequeuedJobs) {
                context.handleEvent({
                    eventType: "WORKER_JOB_DEQUEUE",
                    jobId: dequeuedJob.id,
                    workerId: this.directory.getWorkerId(),
                    jobName: dequeuedJob.name
                })
                
                const request = this.requestBuffer.shift() as Request
                request(dequeuedJob)
            }
        }

    }

    async stop() {
        this.shouldStop = true
        this.semaphore.release()
        await this.promise
        this.timeout.clear()

        for(const request of this.requestBuffer) {
            request(null)
        }

    }

}

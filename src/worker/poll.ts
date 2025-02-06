import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"
import type { Job } from "@src/job"
import type { WorkerDirectory } from "@src/worker/directory"
import { sql } from "kysely"

export class JobPollModule {

    private readonly directory : WorkerDirectory
    private readonly semaphore : Semaphore
    private readonly timeout : Timeout
    private readonly timeoutSecs : number
    private readonly queue : string

    private shouldStop : boolean

    constructor(directory : WorkerDirectory, params : {
        timeoutSecs : number
        queue: string
    }) {
        this.directory = directory
        this.semaphore = new Semaphore(1)
        this.shouldStop = false
        this.timeoutSecs = params.timeoutSecs
        this.timeout = new Timeout(() => this.semaphore.release())
        this.queue = params.queue
    }

    async poll() : Promise<Job | null> {
        await this.semaphore.acquire()

        if(this.shouldStop) {
            return null
        }

        const context = this.directory.getContext()
        const database = createKyselyWrapper({
            pool: context.pool,
            schema: context.schema
        })

        const result = await database.transaction().execute(async (database) => {
            const jobNames = this.directory.getContext()
                .getJobDefinitions()
                .map(jd => jd.name)

            if(jobNames.length === 0) {
                return null
            }

            const jobMutex = await database
                .selectFrom("jobMutex")
                .where("status", "=", "UNLOCKED")
                .where("queue", "=", this.queue)
                .where("jobName", "in", jobNames)
                .where("numActiveJobs", ">", 0)
                .select([
                    "id",
                    "name",
                    "queue",
                    "numReferencedJobs",
                    "numActiveJobs",
                    "status"
                ])
                .forUpdate()
                .skipLocked()
                .orderBy("accessedAt")
                .limit(1)
                .executeTakeFirst()

            if(!jobMutex) {
                return null
            }

            const job : Job = await database
                .selectFrom("job")
                .select([
                    "id",
                    "name",
                    "jobMutexId",
                    "payload",
                    "deduplicationKey",
                    "numAttempts",
                    "timeoutSecs",
                    "status"
                ])
                .where("status", "=", "ACTIVE")
                .where("jobMutexId", "=", jobMutex.id)
                .orderBy("releasedAt")
                .limit(1)
                .forUpdate()
                .skipLocked()
                .executeTakeFirstOrThrow()

            await database
                .updateTable("jobMutex")
                .where("id", "=", jobMutex.id)
                .set({ 
                    "numActiveJobs": jobMutex.numActiveJobs - 1,
                    "accessedAt": sql<Date>`NOW()`,
                    "unlockedAt": sql<Date>`NOW() + ${context.jobMutexUnlockSecs} * INTERVAL '1 SECOND'`,
                    "status": "LOCKED"
                })
                .execute()

            await database
                .updateTable("job")
                .where("id", "=", job.id)
                .set({ "status": "RUNNING" })
                .execute()

            return job
        }) 

        if(result !== null) {
            this.semaphore.release()
        } else {
            this.timeout.set(this.timeoutSecs * 1000)
        }

        return result
    }

    reset() {
        this.timeout.clear()
        this.semaphore.release()
    }

    close() {
        this.shouldStop = true
        this.timeout.clear()

        for(let ix = 0; ix < this.directory.getConcurrency(); ix += 1) {
            this.semaphore.release()
        }
    }

}

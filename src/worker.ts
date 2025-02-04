import { Context } from "./context"
import { sql } from "kysely"
import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"
import { DEFAULT_CHANNEL } from "@src/job-definition"
import { randomUUID } from "crypto"

const defaultPollSecs = 2

export class Worker {
    private readonly pollSecs: number
    private readonly semaphore : Semaphore
    private readonly context : Context
    private readonly channel : string
    private readonly promise : Promise<void>

    private shouldStop : boolean
    private timeout: Timeout
    readonly workerId: string

    constructor(params : {
        context : Context
        channel?: string
        pollSecs?: number
    }) {
        this.context = params.context
        this.channel = params.channel ?? DEFAULT_CHANNEL
        this.workerId = randomUUID()
        this.pollSecs = params.pollSecs ?? defaultPollSecs
        this.shouldStop = false
        this.semaphore = new Semaphore(1)
        this.timeout = new Timeout(() => this.semaphore.release())
        this.promise = this.process()
    }

    private async process() {
        const database = createKyselyWrapper({
            pool: this.context.pool,
            schema: this.context.schema
        })

        while(!this.shouldStop) {
            const row = await database.transaction().execute(async (database) => {
                const jobNames = this.context
                    .getJobDefinitions()
                    .map(jd => jd.name)

                if(jobNames.length === 0) {
                    return null
                }

                const row = await database
                    .selectFrom("job")
                    .innerJoin("jobGroup", "job.jobGroupId", "jobGroup.id")
                    .select([
                        "job.id", 
                        "job.name", 
                        "job.payload", 
                        "job.jobGroupId", 
                        "job.timeoutSecs",
                        "job.numAttempts"
                    ])
                    .where("job.finalizedAt", "is", null)
                    .where("job.name", "in", jobNames)
                    .where("job.channel", "=", this.channel)
                    .where("job.availableAt", "<=", sql<Date>`NOW()`)
                    .where("jobGroup.unlockedAt", "<=", sql<Date>`NOW()`)
                    .forUpdate()
                    .skipLocked()
                    .executeTakeFirst()

                if(!row) {
                    return null
                }

                await database
                    .updateTable("jobGroup")
                    .where("id", "=", row.jobGroupId)
                    .set({ "unlockedAt": sql<Date>`NOW() + ${this.context.jobGroupUnlockSecs} * INTERVAL '1 second'` })
                    .execute()

                return row
            })

            if(!row) {
                this.timeout.set(this.pollSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            this.context.handleEvent({
                eventType: "WORKER_JOB_DEQUEUE",
                jobId: row.id,
                workerId: this.workerId,
                jobName: row.name
            })

            try {
                if(row.numAttempts <= 0) {
                    await database
                        .updateTable("job")
                        .where("id", "=", row.id)
                        .set({
                            "finalizedAt": sql`NOW()`,
                            "isSuccess": false
                        })
                        .execute()

                    this.context.handleEvent({
                        eventType: "WORKER_JOB_EXPIRE",
                        jobId: row.id,
                        workerId: this.workerId,
                        jobName: row.name
                    })
                    continue
                }

                const jobDefinition = await this.context.getJobDefinition(row.name)
                if(!jobDefinition) {
                    throw new Error(`Job definition with name: \"${row.name}\" not found`)
                }

                this.context.handleEvent({
                    eventType: "WORKER_JOB_RUN",
                    jobId: row.id,
                    workerId: this.workerId,
                    jobName: row.name
                })

                let isSuccess = true
                let error: any = null
                const startTime = Date.now()

                try {
                    await jobDefinition.run(row.payload, { 
                        jobId: row.id, 
                        jobGroup: row.jobGroupId,
                        markAsFailed: () => { isSuccess = false }
                    })
                } catch (err) {
                    isSuccess = false
                    error = err
                }

                const endTime = Date.now()

                if(isSuccess) {
                    await database
                        .updateTable("job")
                        .where("id", "=", row.id)
                        .set({
                            "finalizedAt": sql`NOW()`,
                            "isSuccess": true
                        })
                        .execute()

                    this.context.handleEvent({
                        eventType: "WORKER_JOB_RUN_SUCCESS",
                        jobId: row.id,
                        workerId: this.workerId,
                        jobName: row.name,
                        duration: endTime - startTime
                    })
                } else {
                    await database
                        .updateTable("job")
                        .where("job.id", "=", row.id)
                        .set({ 
                            "availableAt": sql<Date>`NOW() + ${row.timeoutSecs} * INTERVAL '1 second'`,
                            "numAttempts": row.numAttempts - 1,
                        })
                        .execute()

                    this.context.handleEvent({
                        eventType: "WORKER_JOB_RUN_FAILED",
                        jobId: row.id,
                        jobName: row.name,
                        workerId: this.workerId,
                        error: error,
                        duration: endTime - startTime
                    })
                }
            } finally {
                await database
                    .updateTable("jobGroup")
                    .where("id", "=", row.jobGroupId)
                    .set({ "unlockedAt": sql<Date>`NOW()` })
                    .execute()
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

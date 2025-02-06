import { sql } from "kysely"
import { randomUUID } from "crypto"
import type { Context } from "./context"
import { createKyselyWrapper } from "@src/database"

type Metadata = {
    jobId : string
    markAsFailed : () => void
}

type EnqueueParams = {
    mutex?: string
    deduplicationKey?: string
    delaySecs?: number
    timeoutSecs?: number
    numAttempts?: number
}

type WorkFunction<T> = (params : T, metadata : Metadata) => Promise<void>

type KeyGenerator<T> = (params : T) => string

export const DEFAULT_QUEUE = "DEFAULT"

const defaultKeyGenerator = () => randomUUID()
const defaultTimeoutSecs = 60 * 5
const defaultNumAttempts = 1
const defaultDelaySecs = 0

export class JobDefinition<T> {
    private readonly context : Context

    readonly name : string
    readonly queue : string
    readonly repeatSecs : number | null

    readonly numAttempts : number
    readonly timeoutSecs : number
    readonly delaySecs : number

    private readonly mutex : KeyGenerator<T>
    private readonly deduplicationKey : KeyGenerator<T>
    private readonly work : WorkFunction<T>

    constructor(params : {
        context : Context,
        work : WorkFunction<T>,
        deduplicationKey? : KeyGenerator<T>,
        mutex? : KeyGenerator<T>,
        name : string,
        queue? : string,
        numAttempts?: number
        delaySecs? : number
        repeatSecs? : T extends null ? (number | null) : null
        timeoutSecs? : number
    }) {
        this.name = params.name
        this.context = params.context
        this.work = params.work
        this.mutex = params.mutex ?? defaultKeyGenerator
        this.deduplicationKey = params.deduplicationKey ?? defaultKeyGenerator
        this.queue = params.queue ?? DEFAULT_QUEUE
        this.repeatSecs = params.repeatSecs ?? null
        this.numAttempts = params.numAttempts ?? defaultNumAttempts
        this.timeoutSecs = params.timeoutSecs ?? defaultTimeoutSecs
        this.delaySecs = params.delaySecs ?? defaultDelaySecs
    }

    async register() {
        this.context.registerJobDefinition(this)
        if(!this.repeatSecs) {
            return
        }

        const repeatSecs = this.repeatSecs
        const database = createKyselyWrapper({
            pool: this.context.pool,
            schema: this.context.schema
        })

        await database
            .insertInto("jobSchedule")
            .values({
                id: randomUUID(),
                repeatSecs: repeatSecs,
                name: this.name,
                repeatedAt: new Date(0)
            }).onConflict(oc => oc
                .column("name")
                .doUpdateSet({ repeatSecs })
            )
            .execute()
    }
    
    async enqueue(payload : T, params? : EnqueueParams) : Promise<string> {
        const mutex = params?.mutex ?? this.mutex(payload)
        const delaySecs = params?.delaySecs ?? this.delaySecs
        const timeoutSecs = params?.timeoutSecs ?? this.timeoutSecs
        const numAttempts = params?.numAttempts ?? this.numAttempts
        const deduplicationKey = params?.deduplicationKey ?? this.deduplicationKey(payload)

        const database = createKyselyWrapper({
            pool: this.context.pool,
            schema: this.context.schema
        })

        const event = await database.transaction().execute(async (database) => {

            const jobMutex = await database
                .insertInto("jobMutex")
                .values({
                    id: randomUUID(),
                    name: mutex,
                    jobName: this.name,
                    numReferencedJobs: 0,
                    queue: this.queue,
                    numActiveJobs: 0,
                    status: "UNLOCKED",
                    createdAt: sql<Date>`NOW()`,
                    unlockedAt: sql<Date>`NOW()`,
                    accessedAt: sql<Date>`NOW()`,
                })
                .onConflict(oc => oc
                    .columns(["name", "jobName", "queue"])
                    .doUpdateSet({ 
                        name: mutex, 
                        jobName: this.name, 
                        queue: this.queue 
                    })
                )
                .returning(["id", "numReferencedJobs"])
                .executeTakeFirstOrThrow()

            const newJobId = randomUUID()
            const job = await database
                .insertInto("job")
                .values({
                    id: newJobId,
                    jobMutexId: jobMutex.id,
                    name: this.name,
                    queue: this.queue,
                    payload: JSON.stringify(payload),
                    numAttempts: numAttempts,
                    timeoutSecs: timeoutSecs,
                    deduplicationKey: deduplicationKey,
                    createdAt: sql<Date>`NOW()`,
                    unlockedAt: sql<Date>`NOW()`,
                    releasedAt: sql<Date>`NOW() + ${delaySecs} * INTERVAL '1 SECOND'`,
                    status: "WAITING"
                })
                .onConflict(oc => oc
                    .columns([
                        "deduplicationKey",
                        "name",
                        "queue"
                    ])
                    .where("status", "=", "WAITING")
                    .doUpdateSet({ 
                        deduplicationKey,
                        name: this.name,
                        queue: this.queue,
                    })
                )
                .returning(["id"])
                .executeTakeFirstOrThrow()

            if(job.id === newJobId) {
                await database
                    .updateTable("jobMutex")
                    .where("id", "=", jobMutex.id)
                    .set({ numReferencedJobs: jobMutex.numReferencedJobs + 1 })
                    .execute()

                return {
                    eventType: "JOB_DEFINITION_JOB_ENQUEUE" as const,
                    jobId: job.id,
                    jobName : this.name,
                }
            }

            return {
                eventType: "JOB_DEFINITION_JOB_DEDUPLICATE" as const,
                jobId: job.id,
                jobName : this.name,
            }
        })

        this.context.handleEvent(event)
        return event.jobId
    }

    run(payload : T, metadata : Metadata) {
        return this.work(payload, metadata)
    }

}

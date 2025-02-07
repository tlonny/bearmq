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

const DEFAULT_DEDUPLICATION_KEY = () => randomUUID()
const DEFAULT_TIMEOUT_SECS = 60 * 5
const DEFAULT_NUM_ATTEMPTS = 1
const DEFAULT_DELAY_SECS = 0
const DEFAULT_PRIORITY = 0

export class JobDefinition<T> {
    private readonly context : Context

    readonly name : string
    readonly queue : string
    readonly repeatSecs : number | null

    readonly priority : number
    readonly numAttempts : number
    readonly timeoutSecs : number
    readonly delaySecs : number

    private readonly deduplicationKey : KeyGenerator<T>
    private readonly work : WorkFunction<T>

    constructor(params : {
        context : Context,
        work : WorkFunction<T>,
        deduplicationKey? : KeyGenerator<T>,
        priority? : number,
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
        this.deduplicationKey = params.deduplicationKey ?? DEFAULT_DEDUPLICATION_KEY
        this.queue = params.queue ?? DEFAULT_QUEUE
        this.priority = params.priority ?? DEFAULT_PRIORITY
        this.repeatSecs = params.repeatSecs ?? null
        this.numAttempts = params.numAttempts ?? DEFAULT_NUM_ATTEMPTS
        this.timeoutSecs = params.timeoutSecs ?? DEFAULT_TIMEOUT_SECS
        this.delaySecs = params.delaySecs ?? DEFAULT_DELAY_SECS
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
        const delaySecs = params?.delaySecs ?? this.delaySecs
        const timeoutSecs = params?.timeoutSecs ?? this.timeoutSecs
        const numAttempts = params?.numAttempts ?? this.numAttempts
        const deduplicationKey = params?.deduplicationKey ?? this.deduplicationKey(payload)

        const database = createKyselyWrapper({
            pool: this.context.pool,
            schema: this.context.schema
        })

        const newJobId = randomUUID()
        const job = await database
            .insertInto("job")
            .values({
                id: newJobId,
                name: this.name,
                queue: this.queue,
                priority: this.priority,
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
                    "name"
                ])
                .where("status", "=", "WAITING")
                .doUpdateSet({ deduplicationKey, name: this.name })
            )
            .returning(["id"])
            .executeTakeFirstOrThrow()

        if(job.id === newJobId) {
            this.context.handleEvent({
                eventType: "JOB_DEFINITION_JOB_ENQUEUE" as const,
                jobId: job.id,
                jobName : this.name,
            })
        } else {
            this.context.handleEvent({
                eventType: "JOB_DEFINITION_JOB_DEDUPLICATE" as const,
                jobId: job.id,
                jobName : this.name,
            })
        }

        return job.id
    }

    run(payload : T, metadata : Metadata) {
        return this.work(payload, metadata)
    }

}

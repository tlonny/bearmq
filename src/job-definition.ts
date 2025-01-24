import { sql } from "kysely"
import { randomUUID } from "crypto"
import type { Context } from "./context"

type Metadata = {
    jobId : string
    jobGroup : string
    markAsFailed : () => void
}

type EnqueueParams = {
    jobGroup?: string
    delaySecs?: number
    timeoutSecs?: number
    numAttempts?: number
    channel?: string
}

type JobFunction<T> = (params : T, metadata : Metadata) => Promise<void>

type JobGroupGenerator<T> = (params : T) => string

const defaultJobGroupGenerator = () => randomUUID()
const defaultTimeoutSecs = 60 * 5
const defaultNumAttempts = 1
const defaultDelaySecs = 0

export class JobDefinition<T> {
    private readonly context : Context

    readonly name : string
    readonly channel : string | null
    readonly repeatSecs : number | null

    readonly numAttempts : number
    readonly timeoutSecs : number
    readonly delaySecs : number

    private readonly jobGroupGenerator : JobGroupGenerator<T>
    private readonly workFunction : JobFunction<T>

    constructor(params : {
        workFunction : JobFunction<T>,
        jobGroupGenerator? : JobGroupGenerator<T>,
        name : string,
        channel? : string,
        context : Context,
        numAttempts?: number
        delaySecs? : number
        repeatSecs? : T extends null ? (number | null) : null
        timeoutSecs? : number
    }) {
        this.name = params.name
        this.context = params.context
        this.workFunction = params.workFunction
        this.jobGroupGenerator = params.jobGroupGenerator ?? defaultJobGroupGenerator
        this.channel = params.channel ?? null
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
        await this.context.database
            .insertInto("jobSchedule")
            .values({
                id: this.name,
                repeatSecs: repeatSecs,
                repeatedAt: new Date(0)
            }).onConflict(oc => oc
                .column("id")
                .doUpdateSet({ repeatSecs })
            )
            .execute()
    }
    
    async enqueue(payload : T, params? : EnqueueParams) : Promise<string> {
        const jobGroup = params?.jobGroup ?? this.jobGroupGenerator(payload)
        const delaySecs = params?.delaySecs ?? this.delaySecs
        const timeoutSecs = params?.timeoutSecs ?? this.timeoutSecs
        const numAttempts = params?.numAttempts ?? this.numAttempts
        const channel = params?.channel ?? this.channel

        return await this.context.database.transaction().execute(async (database) => {
            await database
                .insertInto("jobGroup")
                .values({
                    id: jobGroup,
                    unlockedAt: sql<Date>`NOW()`,
                    numRefs: 1
                })
                .onConflict(oc => oc
                    .column("id")
                    .doUpdateSet(eb => ({ 
                        numRefs: eb(eb.ref("jobGroup.numRefs"), "+", 1) 
                    }))
                )
                .returning(["numRefs"])
                .execute()

            const jobId = await database
                .insertInto("job")
                .values({
                    id: randomUUID(),
                    jobGroupId: jobGroup,
                    name: this.name,
                    channel: channel,
                    payload: JSON.stringify(payload),
                    numAttempts: numAttempts,
                    timeoutSecs: timeoutSecs,
                    delaySecs: delaySecs,
                    isSuccess: false,
                    createdAt: sql`NOW()`,
                    availableAt: sql<Date>`NOW() + ${delaySecs} * INTERVAL '1 second'`,
                })
                .returning("id")
                .executeTakeFirstOrThrow()
                .then(row => row.id)

            this.context.handleEvent({
                eventType: "JOB_DEFINITION_JOB_ENQUEUE",
                jobId: jobId,
                jobName : this.name,
            })

            return jobId
        })
    }

    run(payload : T, metadata : Metadata) {
        return this.workFunction(payload, metadata)
    }

}

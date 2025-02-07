import { sql } from "kysely"
import type { OrchestratorDirectory } from "@src/orchestrator/directory"
import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"

type ScheduledJobDetails = { name: string }

export class JobScheduleModule {
    private readonly directory : OrchestratorDirectory
    private readonly pollSecs: number
    private readonly promise : Promise<void>
    private readonly semaphore : Semaphore
    private readonly batchSize : number

    private timeout : Timeout
    private shouldStop : boolean

    constructor(directory : OrchestratorDirectory, params : {
        pollSecs : number
        batchSize : number
    }) {
        this.directory = directory
        this.pollSecs = params.pollSecs
        this.batchSize = params.batchSize
        this.shouldStop = false
        this.semaphore = new Semaphore(1)
        this.timeout = new Timeout(() => this.semaphore.release())
        this.promise = this.scheduleJobs()
    }

    private async scheduleJobs() {
        const context = this.directory.getContext()
        const database = createKyselyWrapper({
            pool: context.pool,
            schema: context.schema
        })

        while(!this.shouldStop) {

            const scheduledJobs : ScheduledJobDetails[] = await database.transaction().execute(async (database) => {
                const jobNames = this.directory.getContext()
                    .getJobDefinitions()
                    .map(jd => jd.name)

                if(jobNames.length === 0) {
                    return []
                }

                const scheduledJobs = await database
                    .selectFrom("jobSchedule")
                    .select(["id", "name"])
                    .where("name", "in", jobNames)
                    .where(eb => eb.and([
                        eb("repeatSecs", "is not", null),
                        eb(sql<Date> `${eb.ref("repeatedAt")} + INTERVAL '1 second' * ${eb.ref("repeatSecs")}`, "<=", sql<Date> `NOW()`)
                    ]))
                    .orderBy("repeatedAt")
                    .limit(this.batchSize)
                    .forUpdate()
                    .skipLocked()
                    .limit(this.batchSize)
                    .execute()

                if(scheduledJobs.length === 0) {
                    return []
                }

                const scheduleIds = scheduledJobs.map(j => j.id)
                await database
                    .updateTable("jobSchedule")
                    .where("id", "in", scheduleIds)
                    .set({ "repeatedAt" : sql<Date>`NOW()`})
                    .execute()

                return scheduledJobs
            })

            if(scheduledJobs.length === 0) {
                this.timeout.set(this.pollSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            for(const scheduledJob of scheduledJobs) {
                const jobDefinition = context.getJobDefinition(scheduledJob.name)
                if(!jobDefinition) {
                    throw new Error(`Job definition not found: ${scheduledJob.name}`)
                } 

                await jobDefinition.enqueue({})
                context.handleEvent({
                    eventType: "ORCHESTRATOR_JOB_SCHEDULE",
                    jobName: jobDefinition.name
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

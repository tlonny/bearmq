import { sql } from "kysely"
import type { Directory } from "@src/orchestrator/directory"
import { Semaphore } from "@src/core/semaphore"
import { Timeout } from "@src/core/timeout"
import { createKyselyWrapper } from "@src/database"

export class JobScheduleModule {
    private readonly directory : Directory
    private readonly pollSecs: number
    private readonly promise : Promise<void>
    private readonly semaphore : Semaphore

    private timeout : Timeout
    private shouldStop : boolean

    constructor(directory : Directory, params : {
        pollSecs : number
    }) {
        this.directory = directory
        this.pollSecs = params.pollSecs
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
            const row = await database.transaction().execute(async (database) => {
                const jobNames = this.directory.getContext()
                    .getJobDefinitions()
                    .map(jd => jd.name)

                if(jobNames.length === 0) {
                    return null
                }

                const row = await database
                    .selectFrom("jobSchedule")
                    .select(["id"])
                    .where("id", "in", jobNames)
                    .where(eb => eb.and([
                        eb("repeatSecs", "is not", null),
                        eb(sql<Date> `${eb.ref("repeatedAt")} + INTERVAL '1 second' * ${eb.ref("repeatSecs")}`, "<=", sql<Date> `NOW()`)
                    ]))
                    .forUpdate()
                    .skipLocked()
                    .executeTakeFirst()

                if(!row) {
                    return null
                }

                await database
                    .updateTable("jobSchedule")
                    .where("id", "=", row.id)
                    .set({ "repeatedAt" : sql<Date>`NOW()`})
                    .execute()

                return row
            })

            if(!row) {
                this.timeout.set(this.pollSecs * 1000)
                await this.semaphore.acquire()
                continue
            }

            const jobDefinition = context.getJobDefinition(row.id)
            if(!jobDefinition) {
                throw new Error(`Job definition with name: \"${row.id}\" not found`)
            } else {
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

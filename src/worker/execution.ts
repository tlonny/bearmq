import { createKyselyWrapper } from "@src/database"
import type { WorkerDirectory } from "@src/worker/directory"
import { sql } from "kysely"

export class JobExecutionModule {

    private readonly directory : WorkerDirectory

    private readonly promise : Promise<void>
    private shouldStop : boolean

    constructor(directory : WorkerDirectory) {
        this.directory = directory
        this.shouldStop = false
        this.promise = this.process()
    }

    private async process() {
        const jobDequeueModule = this.directory.getDequeueModule()
        const jobFinalizeModule = this.directory.getFinalizeModule()
        const context = this.directory.getContext()
        const workerId = this.directory.getWorkerId()

        const database = createKyselyWrapper({
            pool: context.pool,
            schema: context.schema
        })

        while(!this.shouldStop) {
            const job = await jobDequeueModule.dequeue()

            if(!job) {
                continue
            }

            const jobDefinition = await context.getJobDefinition(job.name)
            if(!jobDefinition) {
                throw new Error(`Job definition not found: ${job.name}`)
            }

            if(job.numAttempts <= 0) {
                await jobFinalizeModule.finalize(job, { isSuccess: false })
                context.handleEvent({
                    eventType: "WORKER_JOB_EXPIRE",
                    jobId: job.id,
                    workerId: workerId,
                    jobName: job.name
                })
                continue
            }

            context.handleEvent({
                eventType: "WORKER_JOB_RUN",
                jobId: job.id,
                workerId: workerId,
                jobName: job.name
            })

            let isSuccess = true
            let error: any = null
            const startTime = Date.now()

            try {
                await jobDefinition.run(job.payload, { 
                    jobId: job.id, 
                    markAsFailed: () => { isSuccess = false }
                })
            } catch (err) {
                isSuccess = false
                error = err
            }

            const endTime = Date.now()

            if(isSuccess) {
                await jobFinalizeModule.finalize(job, { isSuccess: false })
                context.handleEvent({
                    eventType: "WORKER_JOB_RUN_SUCCESS",
                    jobId: job.id,
                    workerId: workerId,
                    jobName: job.name,
                    duration: endTime - startTime
                })
            } else {
                await database
                    .updateTable("job")
                    .where("id", "=", job.id)
                    .set({ 
                        "numAttempts": job.numAttempts - 1,
                        "unlockedAt": sql<Date>`NOW() + ${job.timeoutSecs} * INTERVAL '1 SECOND'`,
                        "status": "LOCKED"
                    })
                    .execute()
            
                context.handleEvent({
                    eventType: "WORKER_JOB_RUN_FAILED",
                    jobId: job.id,
                    jobName: job.name,
                    workerId: workerId,
                    error: error,
                    duration: endTime - startTime
                })
            }
        }
    }

    async stop() {
        this.shouldStop = true
        await this.promise
    }

}

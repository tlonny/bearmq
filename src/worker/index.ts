import { Context } from "../context"
import { DEFAULT_QUEUE } from "@src/job-definition"
import { randomUUID } from "crypto"
import { JobDequeueModule } from "@src/worker/dequeue"
import { JobFinalizeModule } from "@src/worker/finalize"
import { JobExecutionModule } from "@src/worker/execution"

const DEFAULT_TIMEOUT_SECS = 2
const DEFAULT_CONCURRENCY = 1

export class Worker {
    private readonly jobDequeueModule : JobDequeueModule
    private readonly jobFinalizeModule : JobFinalizeModule
    private readonly jobExecutionModules : JobExecutionModule[]

    readonly concurrency : number
    readonly workerId: string

    constructor(params : {
        context : Context
        queue?: string
        concurrency?: number
        timeoutSecs?: number
    }) {
        const directory = { 
            getContext: () => params.context,
            getFinalizeModule: () => this.jobFinalizeModule,
            getDequeueModule: () => this.jobDequeueModule,
            getWorkerId: () => this.workerId
        }

        this.concurrency = params.concurrency ?? DEFAULT_CONCURRENCY
        this.jobDequeueModule = new JobDequeueModule(directory, {
            queue: params.queue ?? DEFAULT_QUEUE,
            timeoutSecs: params.timeoutSecs ?? DEFAULT_TIMEOUT_SECS,
            batchSize: this.concurrency
        })
        this.jobFinalizeModule = new JobFinalizeModule(directory)
        this.workerId = randomUUID()
        this.jobExecutionModules = Array.from({ length: this.concurrency }, () => {
            return new JobExecutionModule(directory)
        })
    }


    async stop() {
        await this.jobDequeueModule.stop()
        await Promise.all(this.jobExecutionModules.map(m => m.stop()))
    }
}

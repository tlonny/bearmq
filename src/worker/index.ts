import { Context } from "../context"
import { DEFAULT_QUEUE } from "@src/job-definition"
import { randomUUID } from "crypto"
import { JobPollModule } from "@src/worker/poll"
import { JobFinalizeModule } from "@src/worker/finalize"
import { JobExecutionModule } from "@src/worker/execution"

const DEFAULT_TIMEOUT_SECS = 2
const DEFAULT_CONCURRENCY = 1

export class Worker {
    private readonly jobPollModule : JobPollModule
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
            getConcurrency: () => this.concurrency,
            getPollModule: () => this.jobPollModule,
            getWorkerId: () => this.workerId
        }

        this.concurrency = params.concurrency ?? DEFAULT_CONCURRENCY
        this.jobPollModule = new JobPollModule(directory, {
            queue: params.queue ?? DEFAULT_QUEUE,
            timeoutSecs: params.timeoutSecs ?? DEFAULT_TIMEOUT_SECS
        })
        this.jobFinalizeModule = new JobFinalizeModule(directory)
        this.workerId = randomUUID()
        this.jobExecutionModules = Array.from({ length: this.concurrency }, () => {
            return new JobExecutionModule(directory)
        })
    }


    async stop() {
        this.jobPollModule.close()
        await Promise.all(this.jobExecutionModules.map(m => m.stop()))
    }
}

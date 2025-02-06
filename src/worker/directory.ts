import type { Context } from "@src/context"
import type { JobFinalizeModule } from "@src/worker/finalize"
import type { JobPollModule } from "@src/worker/poll"

export interface WorkerDirectory {
    getContext() : Context
    getConcurrency() : number
    getFinalizeModule() : JobFinalizeModule
    getPollModule() : JobPollModule
    getWorkerId() : string
}

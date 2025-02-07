import type { Context } from "@src/context"
import type { JobFinalizeModule } from "@src/worker/finalize"
import type { JobDequeueModule } from "@src/worker/dequeue"

export interface WorkerDirectory {
    getContext() : Context
    getFinalizeModule() : JobFinalizeModule
    getDequeueModule() : JobDequeueModule
    getWorkerId() : string
}

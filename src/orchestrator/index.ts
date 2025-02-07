import type { Context } from "@src/context"
import { JobScheduleModule } from "./job-schedule"
import type { OrchestratorDirectory } from "@src/orchestrator/directory"
import { JobReleaseModule } from "@src/orchestrator/job-release"
import { JobUnlockModule } from "@src/orchestrator/job-unlock"

const DEFAULT_JOB_SCHEDULE_POLL_SECS = 5
const DEFAULT_JOB_SCHEDULE_BATCH_SIZE = 20
const DEFAULT_JOB_RELEASE_POLL_SECS = 5
const DEFAULT_JOB_RELEASE_BATCH_SIZE = 20
const DEFAULT_JOB_UNLOCK_POLL_SECS = 5
const DEFAULT_JOB_UNLOCK_BATCH_SIZE = 20

export class Orchestrator {
    private jobScheduleModule : JobScheduleModule
    private jobReleaseModule : JobReleaseModule
    private jobUnlockModule : JobUnlockModule

    constructor(params : {
        context : Context
        jobSchedulePollSecs? : number
        jobScheduleBatchSize? : number
        jobReleasePollSecs? : number
        jobReleaseBatchSize? : number
        jobUnlockPollSecs? : number
        jobUnlockBatchSize? : number
    }) {
        const directory : OrchestratorDirectory = {
            getContext: () => params.context
        }

        this.jobScheduleModule = new JobScheduleModule(directory, {
            pollSecs: params.jobSchedulePollSecs ?? DEFAULT_JOB_SCHEDULE_POLL_SECS,
            batchSize: params.jobScheduleBatchSize ?? DEFAULT_JOB_SCHEDULE_BATCH_SIZE
        })

        this.jobReleaseModule = new JobReleaseModule(directory, {
            pollSecs: params.jobReleasePollSecs ?? DEFAULT_JOB_RELEASE_POLL_SECS,
            batchSize: params.jobReleaseBatchSize ?? DEFAULT_JOB_RELEASE_BATCH_SIZE
        })

        this.jobUnlockModule = new JobUnlockModule(directory, {
            pollSecs: params.jobUnlockPollSecs ?? DEFAULT_JOB_UNLOCK_POLL_SECS,
            batchSize: params.jobUnlockBatchSize ?? DEFAULT_JOB_UNLOCK_BATCH_SIZE
        })

    }

    async stop() {
        await Promise.all([
            this.jobScheduleModule.stop(),
            this.jobReleaseModule.stop(),
            this.jobUnlockModule.stop()
        ])
    }
}

import type { Context } from "@src/context"
import { JobScheduleModule } from "./job-schedule"
import { JobDeleteModule } from "./job-delete"
import type { Directory } from "@src/orchestrator/directory"

const defaultJobSchedulePollSecs = 5
const defaultJobDeletePollSecs = 60 * 5

export class Orchestrator {
    private jobScheduleModule : JobScheduleModule
    private jobDeleteModule : JobDeleteModule

    constructor(params : {
        context : Context
        jobSchedulePollSecs? : number
        jobDeletePollSecs? : number
    }) {
        const directory : Directory = {
            getContext: () => params.context
        }

        this.jobScheduleModule = new JobScheduleModule(directory, {
            pollSecs: params.jobSchedulePollSecs ?? defaultJobSchedulePollSecs
        })

        this.jobDeleteModule = new JobDeleteModule(directory, {
            pollSecs: params.jobDeletePollSecs ?? defaultJobDeletePollSecs
        })
    }

    async stop() {
        await Promise.all([
            this.jobScheduleModule.stop(),
            this.jobDeleteModule.stop(),
        ])
    }
}

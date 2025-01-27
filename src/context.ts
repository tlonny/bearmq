import type { BearEvent } from "@src/event"
import { JobDefinition } from "@src/job-definition"
import { Pool } from "pg"

type BearEventHandler = (event : BearEvent) => void

const defaultJobPostFinalizeDeleteSecs = 60 * 60
const defaultJobGroupUnlockSecs = 60 * 60 * 2

export class Context {
    readonly jobPostFinalizeDeleteSecs : number
    readonly jobGroupUnlockSecs : number
    readonly schema : string

    readonly pool : Pool
    private jobDefinitions : { [key: string] : JobDefinition<any> }
    private eventHandlers : BearEventHandler[]
    
    constructor(params : {
        pool: Pool,
        jobPostFinalizeDeleteSecs?: number,
        jobGroupUnlockSecs?: number,
        schema : string,
    }) {
        this.eventHandlers = []
        this.schema = params.schema
        this.pool = params.pool
        this.jobGroupUnlockSecs = params.jobGroupUnlockSecs ?? defaultJobGroupUnlockSecs
        this.jobPostFinalizeDeleteSecs = params.jobPostFinalizeDeleteSecs ?? defaultJobPostFinalizeDeleteSecs
        this.jobDefinitions = {}
    }

    addEventHandler(handler : BearEventHandler) {
        this.eventHandlers.push(handler)
    }

    handleEvent(event : BearEvent) {
        for(const handler of this.eventHandlers) {
            handler(event)
        }
    }

    getJobDefinitions() {
        return [...Object.values(this.jobDefinitions)]
    }

    getJobDefinition(name : string) : JobDefinition<any> | undefined {
        return this.jobDefinitions[name]
    }

    registerJobDefinition(jobDefinition : JobDefinition<any>) {
        if(this.jobDefinitions[jobDefinition.name]) {
            throw new Error(`Job definition with name '${jobDefinition.name}' already exists`)
        }

        this.jobDefinitions[jobDefinition.name] = jobDefinition
    }

}

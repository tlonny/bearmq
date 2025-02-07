import { type JobStatus } from "@src/database"

export type Job = {
    id: string
    name: string
    queue: string
    payload: any
    deduplicationKey: string
    priority: number
    numAttempts: number
    timeoutSecs: number
    status: JobStatus
}

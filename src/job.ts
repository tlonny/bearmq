import { type JobStatus } from "@src/database"

export type Job = {
    id: string
    name: string
    jobMutexId: string
    payload: any
    deduplicationKey: string
    numAttempts: number
    timeoutSecs: number
    status: JobStatus
}

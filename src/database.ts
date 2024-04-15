import type { ColumnType, JSONColumnType } from "kysely"

type Timestamp = ColumnType<Date, Date, Date>

interface JobScheduleTable {
    id: string
    repeatSecs: number
    repeatedAt: Timestamp
}

interface JobGroupTable {
    id: string
    unlockedAt: Timestamp
    numRefs: number
}

interface JobTable {
    id: string
    jobGroupId: string
    name: string
    channel: string | null
    payload: JSONColumnType<any>
    numAttempts: number
    timeoutSecs: number
    delaySecs: number
    isSuccess: boolean
    createdAt: Timestamp
    availableAt: Timestamp
    finalizedAt: Timestamp | null
}

export interface DB {
    job: JobTable
    jobGroup: JobGroupTable
    jobSchedule: JobScheduleTable
}

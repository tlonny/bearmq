import { CamelCasePlugin, PostgresDialect } from "kysely"
import { Kysely, type ColumnType, type JSONColumnType } from "kysely"
import type { Pool } from "pg"

type Timestamp = ColumnType<Date, Date, Date>

export type JobStatus =
    | "WAITING"
    | "ACTIVE"
    | "RUNNING"
    | "LOCKED"

export type MutexStatus =
    | "UNLOCKED"
    | "LOCKED"

interface JobScheduleTable {
    id: string
    name: string
    repeatSecs: number
    repeatedAt: Timestamp
}

interface JobMutexTable {
    id: string
    name: string
    jobName: string
    queue: string
    numReferencedJobs: number
    numActiveJobs: number
    status: MutexStatus
    createdAt: Timestamp
    accessedAt: Timestamp
    unlockedAt: Timestamp
}

interface JobTable {
    id: string
    name: string
    queue: string
    jobMutexId: string
    payload: JSONColumnType<any>
    deduplicationKey: string
    timeoutSecs: number
    numAttempts: number
    status: JobStatus
    createdAt: Timestamp
    releasedAt: Timestamp
    unlockedAt: Timestamp
}

interface FinalizedJobTable {
    id: string
    name: string
    payload: JSONColumnType<any>
    createdAt: Timestamp
    isSuccess: boolean
}

export interface DB {
    jobSchedule: JobScheduleTable
    jobMutex: JobMutexTable
    job: JobTable
    finalizedJob: FinalizedJobTable
}

export const createKyselyWrapper = (params : {
    pool : Pool, 
    schema : string
}) : Kysely<DB> => new Kysely<DB>({
    dialect: new PostgresDialect({ pool: params.pool }),
    plugins: [ new CamelCasePlugin() ]
}).withSchema(params.schema)

import { CamelCasePlugin, PostgresDialect } from "kysely"
import { Kysely, type ColumnType, type JSONColumnType } from "kysely"
import type { Pool } from "pg"

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
    channel: string
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

export const createKyselyWrapper = (params : {
    pool : Pool, 
    schema : string
}) : Kysely<DB> => new Kysely<DB>({
    dialect: new PostgresDialect({ pool: params.pool }),
    plugins: [ new CamelCasePlugin() ]
}).withSchema(params.schema)

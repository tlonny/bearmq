import { CamelCasePlugin, PostgresDialect, SelectQueryNode, TableNode, type KyselyPlugin, type PluginTransformQueryArgs, type PluginTransformResultArgs, type QueryResult, type RootOperationNode, type UnknownRow } from "kysely"
import { Kysely, type ColumnType, type JSONColumnType } from "kysely"
import type { Pool } from "pg"

type Timestamp = ColumnType<Date, Date, Date>

export type JobStatus =
    | "WAITING"
    | "ACTIVE"
    | "RUNNING"
    | "LOCKED"

interface JobScheduleTable {
    id: string
    name: string
    repeatSecs: number
    repeatedAt: Timestamp
}

interface JobTable {
    id: string
    name: string
    queue: string
    priority: number
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
    job: JobTable
    finalizedJob: FinalizedJobTable
}

class ForUpdatePlugin implements KyselyPlugin {
    transformQuery({ node }: PluginTransformQueryArgs): RootOperationNode {
        if (!SelectQueryNode.is(node) || !node.endModifiers?.length) {
            return node
        }

        return {
            ...node,
            endModifiers: node.endModifiers.map((m) => ({
                ...m,
                of: m.of?.map((o) => TableNode.is(o) ? o.table.identifier : o)
            }))
        }
    }

    transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
        return Promise.resolve(args.result)
    }
} 

export const createKyselyWrapper = (params : {
    pool : Pool, 
    schema : string
}) : Kysely<DB> => new Kysely<DB>({
    dialect: new PostgresDialect({ pool: params.pool }),
    plugins: [ new CamelCasePlugin(), new ForUpdatePlugin() ]
}).withSchema(params.schema)

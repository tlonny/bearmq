export type JobDefinitionJobEnqueue = {
    eventType : "JOB_DEFINITION_JOB_ENQUEUE"
    jobId: string
    jobName: string
}

export type WorkerJobDequeue = {
    eventType : "WORKER_JOB_DEQUEUE"
    jobId: string
    jobName: string
}

export type WorkerJobExpire = {
    eventType : "WORKER_JOB_EXPIRE",
    jobId: string
    jobName: string
}

export type WorkerJobRun = {
    eventType : "WORKER_JOB_RUN"
    jobId: string
    jobName: string
}

export type WorkerJobRunSuccess = {
    eventType : "WORKER_JOB_RUN_SUCCESS",
    jobId: string
    jobName: string
}

export type WorkerJobRunFailed = {
    eventType : "WORKER_JOB_RUN_FAILED",
    jobId: string
    error : any
    jobName: string
}

export type OrchestratorJobSchedule = {
    eventType : "ORCHESTRATOR_JOB_SCHEDULE",
    jobName : string,
}

export type OrchestratorJobDelete = {
    eventType : "ORCHESTRATOR_JOB_DELETE"
    jobId: string
}

export type BearEvent = 
    | JobDefinitionJobEnqueue
    | WorkerJobDequeue
    | WorkerJobExpire
    | WorkerJobRun
    | WorkerJobRunSuccess
    | WorkerJobRunFailed
    | OrchestratorJobSchedule
    | OrchestratorJobDelete

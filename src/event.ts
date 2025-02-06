export type JobDefinitionJobEnqueue = {
    eventType : "JOB_DEFINITION_JOB_ENQUEUE"
    jobId: string
    jobName: string
}

export type JobDefinitionJobDeduplicate = {
    eventType : "JOB_DEFINITION_JOB_DEDUPLICATE"
    jobId: string
    jobName: string
}

export type WorkerJobDequeue = {
    eventType : "WORKER_JOB_DEQUEUE"
    jobId: string
    workerId: string,
    jobName: string
}

export type WorkerJobExpire = {
    eventType : "WORKER_JOB_EXPIRE",
    jobId: string
    workerId: string,
    jobName: string
}

export type WorkerJobRun = {
    eventType : "WORKER_JOB_RUN"
    jobId: string
    jobName: string,
    workerId: string,
}

export type WorkerJobRunSuccess = {
    eventType : "WORKER_JOB_RUN_SUCCESS",
    jobId: string
    jobName: string,
    duration: number,
    workerId: string
}

export type WorkerJobRunFailed = {
    eventType : "WORKER_JOB_RUN_FAILED",
    jobId: string
    error : any
    jobName: string,
    duration: number
    workerId: string
}

export type OrchestratorJobSchedule = {
    eventType : "ORCHESTRATOR_JOB_SCHEDULE",
    jobName : string,
}

export type OrchestratorJobRelease = {
    eventType : "ORCHESTRATOR_JOB_RELEASE",
    jobId: string
    jobName: string
}

export type OrchestratorJobUnlock = {
    eventType : "ORCHESTRATOR_JOB_UNLOCK",
    jobId: string
    jobName: string
}

export type OrchestratorJobDelete = {
    eventType : "ORCHESTRATOR_JOB_DELETE"
    jobId: string
}

export type BearEvent = 
    | JobDefinitionJobEnqueue
    | JobDefinitionJobDeduplicate
    | WorkerJobDequeue
    | WorkerJobExpire
    | WorkerJobRun
    | WorkerJobRunSuccess
    | WorkerJobRunFailed
    | OrchestratorJobSchedule
    | OrchestratorJobUnlock
    | OrchestratorJobRelease
    | OrchestratorJobDelete

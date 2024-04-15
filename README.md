# BearMQ

A lightweight, configurable job queue backed by **Postgres**, offering an alternative to the redis-backed `bullmq`.

### Core Features:

- Built-in type safety
- Powerful concurrency semantics
- Repeating/scheduled jobs
- Delayed jobs
- Retryable jobs
- Robust event system
- Ability to utilize an existing `pg` connection pool instead of creating its own

## A First Look

```typescript
import process from "process"
import { Context } from "bearmq"
import { Pool } from "pg"

// Create the central "context" object
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const context = new Context({ pool, schema: "_job" })

// Define a "PING" job that echoes its received payload
const pingJob = new JobDefinition({
    name: "PING",
    context: context,
    workFunction: async (payload: { message: string }, metadata) => {
        console.log(`${metadata.jobId} - ${payload.message}`)
    }
})

await pingJob.register()

// Kick off an orchestrator and some workers
const orchestrator = new Orchestrator({ context })
const worker1 = new Worker({ context })
const worker2 = new Worker({ context })

for(let i = 0; i < 1000; i += 1) {
    await pingJob.enqueue({ message: `Hello: ${i}` })
}

// Listen for a SIGINT and gracefully shutdown
process.on("SIGINT", async () => {
    await orchestrator.stop()
    await worker1.stop()
    await worker2.stop()
    await pool.end()
})
```

## Installation & Setup

Install the package with:

```bash
yarn add bearmq
```

Next, prepare your database to host a BearMQ deployment by applying BearMQ's migrations to a specified postgres schema (this prevents naming collisions with your business logic tables):

```typescript
import process from "process"
import { generateMigrationSql } from "bearmq"
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const schema = "_bearmq"
const sqlFragments = generateMigrationSql(schema)

for(const sqlFragment of sqlFragments) {
    await pool.query(sqlFragment)
}

await pool.end()
```

## Getting Started

Once setup is complete, let's start writing some code!

### Context

First, define a `Context`. This will be passed to all BearMQ objects and contains shared configuration and a reference to the underlying database connection pool. Ensure the schema passed to the context matches the one used during migration!

```typescript
import process from "process"
import { Context } from "bearmq"
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const context = new Context({ pool, schema: "_bearmq" })
```

### Job Definitions

With a functional context in place, we can build out the remaining BearMQ machinery. `JobDefinition` objects define the jobs that BearMQ will run:

```typescript
import { JobDefinition } from "bearmq"

type JobParams = { foo: string }

const jobDefinition = new JobDefinition<JobParams>({
    name: "MY_JOB",
    context: context,
    workFunction: async (payload: JobParams, metadata) => {
        console.log(payload.foo)
    }
})
```

Each job definition requires a context, a unique name, and a work function that describes the work to be done. N.B. the type of `JobParams` _must_ be JSON serializable (as that is how payloads are persisted on the database). The default type for `JobParams` is `null`.

Enqueuing work is straightforward:

```typescript
await jobDefinition.enqueue({ foo: "hello" })
```

### Workers

Now create workers to perform the computation:

```typescript
import { Worker } from "bearmq"
import { context } from "./context"
import { jobDef } from "./job-definition"

const worker = new Worker({ context })

await jobDef.register()
```

Job definitions must be registered before workers can start picking up their work (the order in which this happens doesn't matter - i.e. we can initialize a worker before a job definition is registered)

To increase concurrency and job throughput, simply instantiate more worker objects. All workers share the same context and underlying connection pool, so increasing the number of workers has minimal performance impact.

Note: BearMQ distributes well - you can scale up the number of worker processes to further increase job throughput. Finding the right balance depends on whether your jobs are IO-bound or CPU-bound.

### The Orchestrator

While worker daemons handle the processing of outstanding jobs, each BearMQ deployment needs an orchestrator (only one is needed, but having more won't cause issues). The orchestrator is primarily responsible for scheduling repeated jobs and performing regular maintenance on persisted job metadata. Although not strictly required, running an orchestrator is highly recommended (even without scheduled/repeatable jobs) to keep persisted job metadata at reasonable levels:

```typescript
import { Orchestrator } from "bearmq"
import { context } from "./context"
import { jobDef } from "./job-definition"

await jobDef.register()

const orchestrator = new Orchestrator({ context })
```

As with the worker, we must ensure job definitions are registered in order for the orchestrator to start scheduling repeating jobs.

### Shutting Down

It's crucial to shut down the daemons gracefully. While BearMQ will recover from any shutdown event (even a hard crash), it may temporarily be locked out of processing certain jobs without a graceful shutdown. 

Graceful shutdown ensures worker daemons complete any jobs they're currently processing.

The recommended approach is to capture `SIGINT`/`SIGTERM` and await `Daemon#stop()` on all instantiated daemons before exiting.

Note: Only end the DB Pool after all daemons have shut down.

```typescript
import process from "process"
import { Worker } from "bearmq"
import { context } from "./context"
import { pool } from "./database"

const worker = new Worker({ context })
const orchestrator = new Orchestrator({ context })

process.on("SIGINT", () => Promise.all([
    worker.stop(),
    orchestrator.stop()
]).then(() => pool.end()))
```

## Advanced Topics

Now that you understand the basics of processing background jobs with BearMQ, let's explore its powerful advanced features!

### Repeating Jobs

Make a job definition repeat regularly by including a `repeatSecs: number` parameter in the job definition constructor:

```typescript
import { JobDefinition } from "bearmq"
import { context } from "./context"

const jobDefinition = new JobDefinition({
    name: "MY_REPEATING_JOB",
    context: context,
    repeatSecs: 60,
    workFunction: async (payload : null, metadata) => {
        console.log("hello")
    }
})
```

Note: Repeating jobs must have work functions that take `null` as the payload. This constraint is enforced by the type checker.

By default, the orchestrator polls for repeating jobs every 5 seconds. Adjust this by setting `jobSchedulePollSecs` in the orchestrator constructor.

### Delayed Jobs

Defer job execution by at least some period of time by specifying `delaySecs` in either the job definition constructor params _or_ as a one-time override, directly in the `enqueue` function:

```typescript
const jobDefinition = new JobDefinition({
    name: "MY_JOB",
    delaySecs: 5,
    workFunction: async (payload, metadata) => {
        console.log("hello")
    }
})

// Override default behaviour:
await jobDefinition.enqueue(payload, { delaySecs: 30 })
```

### Retries

By default, a job will only be attempted once. Modify this behavior using `numAttempts: number` to specify the number of attempts, and `timeoutSecs: number` (default: `300`) to specify how long workers should wait before retrying failed jobs. Specify both parameters in the job definition constructor _or_ as a one-time override in the `enqueue` function:

```typescript
const jobDefinition = new JobDefinition({
    name: "MY_JOB",
    numAttempts: 3,
    timeoutSecs: 60 * 5,
    workFunction: async (payload, metadata) => {
        console.log("hello")
    }
})

// Override default behaviour:
await jobDefinition.enqueue(payload, { numAttempts: 2, timeoutSecs: 5 })
```

Note: Unlike other queue implementations (such as Amazon's SQS), setting `timeoutSecs` very low or to zero will not cause multiple workers to pick up the same job. This is _safe_.

### Maintenance

Successfully processed jobs or jobs that have exhausted their retry attempts are "finalized". Finalized jobs remain in the database for a specified period (set by `jobPostFinalizeDeleteSecs` in the context constructor - default is 24 hours). 

After this time, the orchestrator permanently deletes them from the database, preventing unchecked growth of space requirements.

### Channels

Channels let you partition workers to process different sets of jobs. For example, you might have low-priority and high-priority jobs. You can dedicate workers exclusively to high-priority jobs to ensure they're processed promptly, regardless of low-priority job backlog.

Job definitions specify their channel using the `channel: string` parameter in the constructor - or as a one-time override, directly in the `enqueue` function.

Workers specify which channels they'll process using the `channels: string[]` parameter in their constructor. Without this parameter, workers can process all jobs.

Here's how to implement channel-based job processing:

```typescript
import { JobDefinition, Worker } from "bearmq"
import { context } from "./context"

const highPriorityJob = new JobDefinition({
    name: "HIGH_PRIORITY_JOB",
    channel: "HIGH_PRIORITY",
    context: context,
    workFunction: async (payload, metadata) => {
       // Do work 
    }
})

const lowPriorityJob = new JobDefinition({
    name: "LOW_PRIORITY_JOB",
    context: context,
    workFunction: async (payload, metadata) => {
       // Do work 
    }
})

const workers: Worker[] = [
    new Worker({ context, channels: ["HIGH_PRIORITY"] }),
    new Worker({ context }),
    new Worker({ context }),
]

// Perform low priority work with high priority on a one-time basis
await lowPriorityJob.enqueue(null, {channel: "HIGH_PRIORITY" })
```

This setup ensures all three workers process high-priority jobs when available, with one worker dedicated exclusively to high-priority jobs.

### Job Groups

Each job belongs to a job group when enqueued. BearMQ processes only one job from a given job group at a time (globally). By default, each enqueued job receives a random `UUIDv4` as its job group, but you can override this by providing a `jobGroupGenerator` function as a parameter to the job definition constructor. This function goes from `TParams => string`. Alternatively, you can provide a one-time override of the `jobGroup` by passing it as an argument in the `enqueue` function:

```typescript

await jobDefinition.enqueue(payload, { jobGroup: "MY_CUSTOM_JOB_GROUP" })
```

Each job group has its own global lock. Workers must acquire this lock before processing a job, and release it after processing (regardless of success or failure).

During graceful shutdown, job group locks are always released. However, during a hard crash or power-off event, locks may remain in a locked state, preventing certain jobs from processing.

Set `jobGroupUnlockSecs` in the context constructor to specify a maximum time a job group can remain locked. After a crash where locks aren't released, affected jobs won't process until `jobGroupUnlockSecs` has elapsed.

When setting this value (default is 3 hours), ensure it's high enough to prevent unlocking during long-running job processing. If a job group unlocks while processing, another job from the same group could start processing simultaneously.

### Events

BearMQ provides a rich set of events. Subscribe to them using `Context#addEventHandler` with a custom event handler. Available events include:

| Key | Description |
| --- | ----------- |
| `JOB_DEFINITION_JOB_ENQUEUE` | A job has been explicitly enqueued and persisted to the database |
| `WORKER_JOB_DEQUEUE` | A worker has dequeued a job for processing |
| `WORKER_JOB_EXPIRE` | A dequeued job has run out of attempts and will now be finalized |
| `WORKER_JOB_RUN` | A job has started to run on a worker |
| `WORKER_JOB_RUN_ERROR` | A job threw an error during processing |
| `WORKER_JOB_RUN_SUCCESS` | A job was successfully processed and was subsequently finalized |
| `ORCHESTRATOR_JOB_SCHEDULE` | A repeating job is due to be enqueued |
| `ORCHESTRATOR_JOB_DELETE` | A finalized job was permanently deleted |
| `ORCHESTRATOR_JOB_GROUP_DELETE` | An unused job group was permanently deleted |

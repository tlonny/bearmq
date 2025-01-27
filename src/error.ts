type ErrorCode =
    | "MISSING_JOB_DEPENDENCY"

export class BearError extends Error {

    public readonly code : ErrorCode

    constructor(params : {
        message : string
        code : ErrorCode
    }) {
        super(params.message)
        this.code = params.code
    }
}

type TimeoutFn = () => void

export class Timeout {

    private readonly timeoutFn : TimeoutFn
    private timer : Timer | null

    constructor(timeoutFn : TimeoutFn) {
        this.timeoutFn = timeoutFn
        this.timer = null
    }

    set(timeoutMs : number) {
        if(this.timer) {
            clearTimeout(this.timer)
        }
        this.timer = setTimeout(this.timeoutFn, timeoutMs)
    }

    clear() {
        if(this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
    }

}

/**
 * A strictly serial task queue (concurrency = 1). All learning work that could
 * be expensive or that touches a model (a later slice) is funneled through one
 * of these so calls never overlap, never fire on bursts, and run in submission
 * order. Pure and Electron-free, so it is unit-testable on its own.
 */
export class LearningQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private depth = 0

  /** Enqueue `task`; it runs after all previously-enqueued tasks settle. */
  add<T>(task: () => Promise<T>): Promise<T> {
    this.depth++
    const run = this.tail.then(() => task())
    // Keep the chain alive regardless of success/failure, and decrement depth
    // once this task settles. The returned promise still rejects to the caller.
    this.tail = run.then(
      () => {
        this.depth--
      },
      () => {
        this.depth--
      }
    )
    return run
  }

  /** Number of tasks queued or running but not yet settled. */
  get pending(): number {
    return this.depth
  }

  /** Resolve once every currently-queued task has settled. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined)
  }
}

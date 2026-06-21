export type JobExecutionOwnershipPhase = 'before-send' | 'after-send';

export interface ExecutionOwnershipLostErrorContext {
  phase: JobExecutionOwnershipPhase;
  idempotencyKey: string;
  jobId: string;
  reason: string;
}

export class ExecutionOwnershipLostError extends Error {
  override readonly name = 'ExecutionOwnershipLostError';

  readonly phase: JobExecutionOwnershipPhase;

  readonly idempotencyKey: string;

  readonly jobId: string;

  readonly reason: string;

  constructor(context: ExecutionOwnershipLostErrorContext) {
    const phaseLabel = context.phase === 'before-send' ? 'before email send' : 'after email send';

    super(`Job execution ownership was lost ${phaseLabel}: ${context.reason}`);
    this.phase = context.phase;
    this.idempotencyKey = context.idempotencyKey;
    this.jobId = context.jobId;
    this.reason = context.reason;
  }
}

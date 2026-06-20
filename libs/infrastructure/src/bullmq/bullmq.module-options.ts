export type BullMqModuleOptions = {
  connection: {
    host: string;
    port: number;
    password?: string;
    db: number;
    connectTimeoutMs: number;
  };
  defaultJobOptions?: {
    attempts: number;
    backoffDelay: number;
  };
};

export const BULLMQ_MODULE_OPTIONS = Symbol('BULLMQ_MODULE_OPTIONS');
export const BULLMQ_REGISTERED_QUEUES = Symbol('BULLMQ_REGISTERED_QUEUES');

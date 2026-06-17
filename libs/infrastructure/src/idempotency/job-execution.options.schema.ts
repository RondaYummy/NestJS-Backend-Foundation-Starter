import { z } from 'zod';

import type { JobExecutionOptions } from '@contracts/idempotency/job-execution.options';

export const jobExecutionEnvSchema = z
  .object({
    JOB_EXECUTION_LEASE_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
    JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(100),
    JOB_EXECUTION_COMPLETED_RETENTION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .default(2_592_000),
  })
  .superRefine((env, ctx) => {
    const maxHeartbeat = Math.floor(env.JOB_EXECUTION_LEASE_TTL_SECONDS / 2);

    if (env.JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS > maxHeartbeat) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS'],
        message: `JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS must be less than or equal to ${maxHeartbeat}`,
      });
    }
  });

export type JobExecutionEnv = z.infer<typeof jobExecutionEnvSchema>;

export function mapJobExecutionEnvToOptions(env: JobExecutionEnv): JobExecutionOptions {
  return {
    leaseTtlSeconds: env.JOB_EXECUTION_LEASE_TTL_SECONDS,
    heartbeatIntervalSeconds: env.JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS,
    completedRetentionTtlSeconds: env.JOB_EXECUTION_COMPLETED_RETENTION_TTL_SECONDS,
  };
}

export function parseJobExecutionEnv(env: Record<string, unknown>): JobExecutionOptions {
  const parsed = jobExecutionEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid job execution env: ${parsed.error.message}`);
  }

  return mapJobExecutionEnvToOptions(parsed.data);
}

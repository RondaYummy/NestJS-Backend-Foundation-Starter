export interface JobExecutionOptions {
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  completedRetentionTtlSeconds: number;
}

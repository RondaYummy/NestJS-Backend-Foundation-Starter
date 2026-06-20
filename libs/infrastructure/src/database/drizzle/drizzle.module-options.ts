export type DrizzleModuleOptions = {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
};

export const DRIZZLE_MODULE_OPTIONS = Symbol('DRIZZLE_MODULE_OPTIONS');

export type LoggerModuleOptions = {
  level: string;
  pretty: boolean;
};

export const LOGGER_MODULE_OPTIONS = Symbol('LOGGER_MODULE_OPTIONS');

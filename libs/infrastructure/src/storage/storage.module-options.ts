export type StorageS3Options = {
  endpoint?: string;
  region: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type StorageModuleOptions =
  | {
      driver: 'local';
      localPath: string;
    }
  | {
      driver: 's3';
      s3: StorageS3Options;
    };

export const STORAGE_MODULE_OPTIONS = Symbol('STORAGE_MODULE_OPTIONS');

export function isS3StorageOptions(
  options: StorageModuleOptions,
): options is Extract<StorageModuleOptions, { driver: 's3' }> {
  return options.driver === 's3';
}

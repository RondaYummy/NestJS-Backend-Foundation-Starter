export interface IStorageGateway {
  putObject(input: {
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType?: string;
  }): Promise<{ key: string; url?: string }>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

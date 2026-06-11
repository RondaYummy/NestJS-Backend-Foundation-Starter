import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema';
import { AppConfigService } from './app-config.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => {
        const parsed = envSchema.safeParse(env);
        if (!parsed.success) throw new Error(`Invalid env: ${parsed.error.message}`);
        const e = parsed.data;
        return {
          app: { env: e.NODE_ENV, port: e.APP_PORT },
          database: { url: e.DATABASE_URL },
          redis: {
            host: e.REDIS_HOST,
            port: e.REDIS_PORT,
            password: e.REDIS_PASSWORD,
            db: e.REDIS_DB,
          },
          bullmq: {
            defaultAttempts: e.BULLMQ_DEFAULT_ATTEMPTS,
            backoffDelay: e.BULLMQ_BACKOFF_DELAY,
          },
          mail: {
            driver: e.MAIL_DRIVER,
            smtp: {
              host: e.SMTP_HOST,
              port: e.SMTP_PORT,
              user: e.SMTP_USER,
              password: e.SMTP_PASSWORD,
              from: e.SMTP_FROM,
            },
          },
          storage: {
            driver: e.STORAGE_DRIVER,
            localPath: e.LOCAL_STORAGE_PATH,
            s3: {
              endpoint: e.S3_ENDPOINT,
              region: e.S3_REGION,
              bucket: e.S3_BUCKET,
              accessKeyId: e.S3_ACCESS_KEY_ID,
              secretAccessKey: e.S3_SECRET_ACCESS_KEY,
            },
          },
          auth: {
            driver: e.AUTH_DRIVER,
            sessionTtlSeconds: e.AUTH_SESSION_TTL_SECONDS,
            passwordSaltRounds: e.PASSWORD_SALT_ROUNDS,
          },
          jwt: {
            secret: e.JWT_SECRET,
            expiresIn: e.JWT_EXPIRES_IN,
            refreshSecret: e.JWT_REFRESH_SECRET,
            refreshExpiresIn: e.JWT_REFRESH_EXPIRES_IN,
          },
          rateLimit: {
            ttl: e.RATE_LIMIT_TTL,
            max: e.RATE_LIMIT_MAX,
            authTtl: e.RATE_LIMIT_AUTH_TTL,
            authMax: e.RATE_LIMIT_AUTH_MAX,
          },
          logger: { level: e.LOGGER_LEVEL },
        };
      },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class InfrastructureConfigModule {}

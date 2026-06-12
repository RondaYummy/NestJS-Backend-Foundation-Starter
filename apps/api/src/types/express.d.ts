import 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      correlationId?: string;
    }
  }
}

export {};

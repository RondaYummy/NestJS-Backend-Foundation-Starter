import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  (req as Request & { requestId: string }).requestId = requestId;
  next();
}

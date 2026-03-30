import type { RequestHandler } from 'express';
import type { CorsOptions } from '../types';

export function buildCorsMiddleware(cors: boolean | CorsOptions | undefined): RequestHandler | null {
  if (!cors) return null;

  const options = cors === true ? {} : cors;
  const origin = options.origin ?? '*';
  const methods = (options.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']).join(', ');
  const headers = (options.headers ?? ['Content-Type', 'Authorization']).join(', ');
  const originValue = Array.isArray(origin) ? origin.join(', ') : origin;

  return (_req, res, next) => {
    res.setHeader('access-control-allow-origin', originValue);
    res.setHeader('access-control-allow-methods', methods);
    res.setHeader('access-control-allow-headers', headers);
    next();
  };
}

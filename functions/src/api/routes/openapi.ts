import type { Request, Response } from 'express';
import { buildOpenApiDocument } from '../openapi';

/** `GET /api/v1/openapi.json`: public (no token), so the document can be read before one exists. */
const body = JSON.stringify(buildOpenApiDocument());

export function openApiHandler(_req: Request, res: Response): void {
  // The document only changes with a deploy: let browsers and Hosting keep it for an hour.
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/json').send(body);
}

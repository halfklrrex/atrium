import type { McpService } from '@atrium/mcp-core';
import type { Request, Response } from 'express';
import type { ApiAuthInfo } from '../auth';

/** What a route handler gets. It returns the JSON body (status 200, or what it set with `res.status`) or throws. */
export interface RouteContext {
  req: Request;
  res: Response;
  auth: ApiAuthInfo;
  service: McpService;
}

export type RouteHandler = (ctx: RouteContext) => Promise<unknown>;

export interface RouteDef {
  method: 'get' | 'post' | 'patch';
  path: string;
  /** The scope the token needs. */
  scope: 'read' | 'write';
  handler: RouteHandler;
}

/** The board a call concerned, for the audit entry. */
export const noteBoard = (res: Response, boardId: string): void => {
  res.locals.boardId = boardId;
};

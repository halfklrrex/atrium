import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi';
import { accountRoutes } from './routes/account';
import { boardRoutes } from './routes/boards';
import { itemRoutes } from './routes/items';
import { writeRoutes } from './routes/writes';
import { API_DAILY_CALLS } from './limits';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- reading an untyped JSON document
const doc = buildOpenApiDocument() as Json;
const routes = [...accountRoutes, ...boardRoutes, ...itemRoutes, ...writeRoutes];
const openApiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1 with info, a server and a bearer scheme', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Atrium API');
    expect(doc.servers[0].url).toMatch(/^https:\/\/.+\/api\/v1$/);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(doc.info.description).toContain(String(API_DAILY_CALLS));
  });

  it('describes every route, and nothing else', () => {
    const expected = routes.map((r) => `${r.method} ${openApiPath(r.path)}`).sort();
    const actual = Object.entries(doc.paths as Json)
      .flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m} ${path}`))
      .sort();
    expect(actual).toEqual(expected);
  });

  it('asks for the scope each route needs', () => {
    for (const route of routes) {
      const op = doc.paths[openApiPath(route.path)][route.method];
      expect(op.security).toEqual([{ bearerAuth: [route.scope] }]);
    }
  });

  it('declares path parameters, unique operation ids and error responses', () => {
    const ids = new Set<string>();
    for (const [path, ops] of Object.entries(doc.paths as Json)) {
      for (const op of Object.values(ops as Json)) {
        expect(ids.has(op.operationId)).toBe(false);
        ids.add(op.operationId);
        const params = (path.match(/\{(\w+)\}/g) ?? []).length;
        const declared = (op.parameters ?? []).filter(
          (p: Json) => p.$ref === '#/components/parameters/Id' || p.in === 'path',
        ).length;
        expect(declared).toBe(params);
        for (const code of ['401', '403', '429']) expect(op.responses[code]).toBeDefined();
      }
    }
  });

  it('accepts Idempotency-Key on every POST and on no GET', () => {
    for (const [, ops] of Object.entries(doc.paths as Json)) {
      for (const [method, op] of Object.entries(ops as Json)) {
        const has = (op.parameters ?? []).some(
          (p: Json) => p.$ref === '#/components/parameters/IdempotencyKey',
        );
        expect(has).toBe(method === 'post');
      }
    }
    expect(doc.components.parameters.IdempotencyKey.in).toBe('header');
  });

  it('resolves every $ref and defines the error shape and codes', () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const found = ref.split('/').reduce((node: Json | undefined, key) => node?.[key], doc);
      expect(found, ref).toBeDefined();
    }
    expect(doc.components.schemas.Error.properties.error.properties.code.enum).toEqual(
      expect.arrayContaining([
        'not_found',
        'forbidden',
        'invalid',
        'conflict',
        'rate_limited',
        'read_only',
        'unauthorized',
      ]),
    );
    expect(doc.components.responses.RateLimited.headers['Retry-After']).toBeDefined();
  });

  it('takes the request bodies from the route schemas', () => {
    const patch = doc.paths['/items/{id}'].patch.requestBody.content['application/json'].schema;
    expect(patch.type).toBe('object');
    expect(Object.keys(patch.properties)).toEqual(['name', 'group', 'values']);
    expect(patch.additionalProperties).toBe(false);
    const create =
      doc.paths['/boards/{id}/items'].post.requestBody.content['application/json'].schema;
    expect(create.anyOf ?? create.oneOf).toHaveLength(2);
  });
});

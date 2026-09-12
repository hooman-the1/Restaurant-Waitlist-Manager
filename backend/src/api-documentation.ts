import { applyDecorators, INestApplication } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

type JsonObject = Record<string, unknown>;
type HttpMethod = 'get' | 'post' | 'patch';

const configuredApplications = new WeakSet<INestApplication>();
const contractPath = resolve(__dirname, '../../openapi.yaml');
const authoritativeFingerprints: Readonly<Record<string, string>> = Object.freeze({
  '/openapi': '536c8d78e8a0acbef96c0881c0b313c1dc7090176417df5982b2c7c82423ca16',
  '/info': '5ed3ebdaebf208a7e42d1a02450ce0884e862f740976862c9ac5d44f7c242f43',
  '/servers': 'dcd2f4e8af9c71adb8855be7e6d4966880b3c12565f88e0c4cebce0502dfde3f',
  '/tags': '108c98f13388e1189bf583ceb71bfb3fc169577830040fafb37260c0ebbfc6de',
  '/paths/~1api~1restaurants/post': '2495046af415fc6063f8041a3815b0d80ecae5ea4c42d2272a2791b04ed216fd',
  '/paths/~1api~1restaurant-verifications/post': '74975bee60ec2d9c7c4b27f9740f59a3df1b2f9a2ccf5f630fc2cbb9db04719a',
  '/paths/~1api~1restaurant-session/get': '8798153f6050e0b4856def177c9cb4e4b2d1f5f475be4d81d1a01517d9b59eb3',
  '/paths/~1api~1restaurants~1{restaurantSlug}/get': 'c39bb8c3ca4f1ccdb45597eaba43e8b8eb931248b71818e4c81497c93cf36cf3',
  '/paths/~1api~1restaurants~1{restaurantSlug}~1waitlist-entries/post': '114c678dcf58fc0d0dd5d63f985c9dcf728300fc76ba97439ded6ae7fc6888e6',
  '/paths/~1api~1waitlist-entries~1{privateToken}/get': 'c926a69f4e4a1d4179305147b5e5e3cea33282627dd0099fabb377e6a8203769',
  '/paths/~1api~1waitlist-entries~1{privateToken}~1cancellations/post': '64a950e25026068240bf45b136760d3a2396e6ef553116b88d9de48c9a018699',
  '/paths/~1api~1dashboard/get': 'fc4b1d1bd49fd67a0db9e89c027e583f72d4cc5d4e952a80b0143a072c9b566d',
  '/paths/~1api~1dashboard~1waitlist-entries~1{actionReference}/patch': '4fe404ddd931ff138aa2e5bf8f98e85b43379bf0ba2b5d61e474dce7fd19615c',
  '/components/securitySchemes/restaurantSession': '1b9b31759a41ac624a831ce75bb8c94db7e02830e598c8dca96c46ded85810a4',
  '/components/parameters/RestaurantSlug': 'f4cc30f9e88514ade5fd206101c89c3a36764b05524e889ad2dccb0c0fa125da',
  '/components/parameters/PrivateToken': '302291c88f17bb2cd3abf91b44e7b9ef53a88520a5031478c0afc8f56024fcd1',
  '/components/parameters/ActionReference': '35cf6abfba971b093eff5703c9b33352a48c554c4c1a20f2fcb452530bd2ad64',
  '/components/responses/ValidationFailure': '003622553538249d02169e7dc96802d1ff23d8fdcb06cb11a0f59be183d025ec',
  '/components/responses/UnauthorizedFailure': 'dc29a9745c9dd38081d418163bbac70366d67841210a29cdb2fe816e598f1229',
  '/components/responses/NotFoundFailure': '42bf4c3f95dce68e5140c87170181fbfa247911f9de7ba48fdcbd34667566cd6',
  '/components/responses/UnexpectedFailure': '6c4f5dafe1c2058104fb78f7f112afc0a4d0da111542e12d6923d0f7382ec3b3',
  '/components/schemas/RestaurantSignupInput': 'd6438b5289ccf0284fd75791a863af0f18aec5ede6c5146e7fa4abc9fd99ca37',
  '/components/schemas/VerificationInput': 'b4939f5bbb2a3ed5867913d2eede8910e7cff252269927dbffceb815130987d4',
  '/components/schemas/JoinWaitlistInput': '545965914287292f43edf19ec07c417889275e8d4df4f8d82696d40cd8226c50',
  '/components/schemas/StaffResolutionInput': '1ada873078cb5ad0006e75a048478059ad854f1d6c56329dd52a4efadb046464',
  '/components/schemas/Success': '942f0d4634748ef6eaae36bfb87ec378e0fd96575bb8fc2e089546e71b64e2a3',
  '/components/schemas/ValidationFailure': '0aec2ce8aa1244e4aef015b5c8a0ea3dbafaac4a152b2e48f37032b74f860f87',
  '/components/schemas/UnauthorizedFailure': 'c8c21a00eaee289f3be99b0ae73ace24ab829f5a7afe68138f6008ed9d1460d6',
  '/components/schemas/NotFoundFailure': '09c32af1cff7caa7be81bc3ca2835ae24f51a8db9e46163f6b6383fc2ed1f07e',
  '/components/schemas/UnexpectedFailure': 'baaddf586a3106cabafd5eb08d133c954467e364c3b3e67fe0e3b89a7dcb4096',
  '/components/schemas/InvalidOrUsedVerificationTokenFailure': '2f9ddb258d089e2a18ce07dd44e0517cbaa5cb60bcc39c50057e05c5f8871709',
  '/components/schemas/DashboardAccessAllowed': 'f96b6b813e728acb3aec0b66153254b52d94dda45282875743c015a4cd11cffa',
  '/components/schemas/PublicRestaurantView': 'e2cd7ecebcbee239e83ee8a451394e8b8a0c3c2d68d0428781bf4f3fe777e369',
  '/components/schemas/PublicWaitlistLookupSuccess': 'b315b1c8a278651bd9fca6f1118b16f6c426581f7365f22736eb741601a23fee',
  '/components/schemas/JoinWaitlistSuccess': 'af106145c42a553a6d750c879905e9592d17df80dc3ed11eb0ad0b2218a16b76',
  '/components/schemas/DuplicatePhoneFailure': 'eb8e3ee136d670a1b1dd0beb7fa4a60ae8cc5bfd3f288de42e4c170e05c1e01b',
  '/components/schemas/FinalStatus': '7dbc15c306bc453646ede2459946a7a8e5447f1cd08919a44cec93feb4bcf26d',
  '/components/schemas/ActivePrivateStatusView': '28afcb1014f1793dff9c18f54329dccb0a76c4e3643c04318bce2e79a3c7cc3c',
  '/components/schemas/ResolvedPrivateStatusView': '050685ab58a5f2ae2ef16de1c4d49b6c5a315269f883f44162ca1bf6c88661fb',
  '/components/schemas/CancellationSuccess': 'bcc828477f92cee84f229fa7c1c853b6336df8b5c6a8942a4514c69ed437b989',
  '/components/schemas/ActiveDashboardEntry': 'feacc914c59254f3bf32803622e630ae49ede03cef60f0edda234125ecc60fba',
  '/components/schemas/ResolvedDashboardEntry': '13903405c962dfb5f4cd37f8f9639df87e000f6f8bb3c5d19c71f8cf4054a92b',
  '/components/schemas/DashboardView': '667687e996c7786338afa258bb0978e2a4806c9183c9cef3bfcca5d261d2deaa',
  '/components/schemas/DashboardLoadSuccess': 'aee1304de1a820a2e22eb3263f4691c424f71ce61ebb345b47f622d4f2bf9e7d',
  '/paths': 'd6bcbef47b24c204d653658ceec271aed7eec255a7563a41c8adc4e6cb6b61a1',
  '/components': 'f5bf3d6b7732f92f105d69df6b0c879211ecc6480bb2d220c5879184b4b60ddb',
});

export function loadAuthoritativeOpenApiDocument(): OpenAPIObject {
  return parse(readFileSync(contractPath, 'utf8')) as OpenAPIObject;
}

export function ApiContractOperation(
  path: string,
  method: HttpMethod,
): MethodDecorator {
  const contract = loadAuthoritativeOpenApiDocument();
  const operation = getOperation(contract, path, method);
  const tags = operation.tags as string[];
  const parameters = (operation.parameters ?? []) as JsonObject[];
  const responses = operation.responses as JsonObject;
  const requestBody = operation.requestBody as JsonObject | undefined;
  const operationMetadata = { ...operation };
  delete operationMetadata.tags;
  delete operationMetadata.parameters;
  delete operationMetadata.responses;
  delete operationMetadata.requestBody;
  const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [
    ApiTags(...tags),
    ApiOperation(operationMetadata),
  ];

  for (const parameter of parameters) {
    const resolvedParameter = resolveParameter(contract, parameter);
    decorators.push(
      ApiParam(
        resolvedParameter as unknown as Parameters<typeof ApiParam>[0],
      ),
    );
  }
  if (requestBody !== undefined) {
    const content = requestBody.content as JsonObject;
    const json = content['application/json'] as JsonObject;
    decorators.push(
      ApiBody({
        required: requestBody.required as boolean,
        schema: json.schema as Parameters<typeof ApiBody>[0],
        ...(json.example === undefined ? {} : { example: json.example }),
      } as unknown as Parameters<typeof ApiBody>[0]),
    );
  }
  for (const [status, response] of Object.entries(responses)) {
    decorators.push(
      ApiResponse({
        status: Number(status),
        ...(response as JsonObject),
      } as Parameters<typeof ApiResponse>[0]),
    );
  }
  if (hasRestaurantSessionSecurity(operation)) {
    decorators.push(ApiCookieAuth('restaurantSession'));
  }

  return applyDecorators(...decorators);
}

export function configureApiDocumentation(app: INestApplication): void {
  if (configuredApplications.has(app)) {
    return;
  }
  configuredApplications.add(app);

  const authoritative = loadAuthoritativeOpenApiDocument();
  SwaggerModule.setup('docs', app, undefined as unknown as OpenAPIObject, {
    raw: false,
    swaggerUrl: '/openapi.json',
    customJsStr: 'window.__OPENAPI_DOCUMENT_URL__ = "/openapi.json";',
    customSiteTitle: 'Swagger UI',
  });

  const adapter = app.getHttpAdapter();
  adapter.get('/openapi.json', (_request: Request, response: Response) => {
    response.type('application/json').send(authoritative);
  });

  const scalarEntry = require.resolve('@scalar/api-reference');
  const scalarBundle = resolve(dirname(scalarEntry), 'browser/standalone.js');
  adapter.get('/redoc/scalar.js', (_request: Request, response: Response) => {
    response.sendFile(scalarBundle);
  });
  adapter.get(
    '/redoc',
    apiReference({
      cdn: '/redoc/scalar.js',
      url: '/openapi.json',
    }),
  );
}

export function createNestOpenApiDocument(
  app: INestApplication,
): OpenAPIObject {
  const authoritative = loadAuthoritativeOpenApiDocument();
  assertAuthoritativeContractFingerprint(authoritative);
  const builder = new DocumentBuilder()
    .setTitle(authoritative.info.title)
    .setVersion(authoritative.info.version)
    .setDescription(authoritative.info.description ?? '');
  for (const server of authoritative.servers ?? []) {
    builder.addServer(server.url, server.description);
  }
  for (const tag of authoritative.tags ?? []) {
    builder.addTag(tag.name, tag.description);
  }
  builder.addCookieAuth(
    'restaurant_session',
    {
      type: 'apiKey',
      in: 'cookie',
      description: (
        authoritative.components?.securitySchemes
          ?.restaurantSession as unknown as JsonObject
      ).description as string,
    },
    'restaurantSession',
  );

  const generated = SwaggerModule.createDocument(app, builder.build(), {
    deepScanRoutes: true,
  });
  const result = clone(authoritative);
  result.paths = {};

  for (const [path, pathItem] of Object.entries(generated.paths)) {
    for (const method of ['get', 'post', 'patch'] as const) {
      const generatedOperation = pathItem?.[method];
      if (generatedOperation === undefined) {
        continue;
      }
      const expectedOperation = authoritative.paths[path]?.[method];
      result.paths[path] ??= {};
      if (expectedOperation === undefined) {
        result.paths[path][method] = generatedOperation;
        continue;
      }
      validateGeneratedOperation(
        generatedOperation as unknown as JsonObject,
        expectedOperation as unknown as JsonObject,
        authoritative,
        path,
        method,
      );
      result.paths[path][method] = clone(expectedOperation);
    }
  }

  return result;
}

function validateGeneratedOperation(
  generated: JsonObject,
  expected: JsonObject,
  contract: OpenAPIObject,
  path: string,
  method: HttpMethod,
): void {
  const operationPointer = `/paths/${escapeJsonPointer(path)}/${method}`;
  for (const field of [
    'operationId',
    'summary',
    'description',
    'security',
  ]) {
    const difference = findDifference(generated[field], expected[field], '');
    if (difference !== undefined) {
      throw new Error(
        `OpenAPI contract drift at ${operationPointer}/${field}${difference === '/' ? '' : difference}`,
      );
    }
  }

  const generatedTags = [...new Set((generated.tags ?? []) as string[])];
  const tagDifference = findDifference(
    generatedTags,
    expected.tags,
    `${operationPointer}/tags`,
  );
  if (tagDifference !== undefined) {
    throw new Error(`OpenAPI contract drift at ${tagDifference}`);
  }

  const generatedParameters = (generated.parameters ?? []) as JsonObject[];
  const expectedParameters = ((expected.parameters ?? []) as JsonObject[]).map(
    (parameter) => resolveParameter(contract, parameter),
  );
  const parameterDifference = findDifference(
    generatedParameters,
    expectedParameters,
    `${operationPointer}/parameters`,
  );
  if (parameterDifference !== undefined) {
    throw new Error(`OpenAPI contract drift at ${parameterDifference}`);
  }

  const normalizedRequestBody =
    generated.requestBody === undefined
      ? undefined
      : (clone(generated.requestBody) as JsonObject);
  const expectedRequestBody = expected.requestBody as JsonObject | undefined;
  if (
    normalizedRequestBody !== undefined &&
    expectedRequestBody !== undefined
  ) {
    const generatedMedia = ((normalizedRequestBody.content as JsonObject)[
      'application/json'
    ] ?? {}) as JsonObject;
    const expectedMedia = ((expectedRequestBody.content as JsonObject)[
      'application/json'
    ] ?? {}) as JsonObject;
    if (expectedMedia.example !== undefined) {
      generatedMedia.example = expectedMedia.example;
    }
  }
  const bodyDifference = findDifference(
    normalizedRequestBody,
    expected.requestBody,
    `${operationPointer}/requestBody`,
  );
  if (bodyDifference !== undefined) {
    throw new Error(`OpenAPI contract drift at ${bodyDifference}`);
  }

  const normalizedResponses = clone(generated.responses) as JsonObject;
  for (const response of Object.values(normalizedResponses)) {
    if (
      isObject(response) &&
      typeof response.$ref === 'string' &&
      response.description === ''
    ) {
      delete response.description;
    }
  }
  const responseDifference = findDifference(
    normalizedResponses,
    expected.responses,
    `${operationPointer}/responses`,
  );
  if (responseDifference !== undefined) {
    throw new Error(`OpenAPI contract drift at ${responseDifference}`);
  }
}

export function assertAuthoritativeContractFingerprint(
  document: unknown,
): void {
  for (const [pointer, expectedHash] of Object.entries(
    authoritativeFingerprints,
  )) {
    const value = readJsonPointer(document, pointer);
    if (hashJson(value) !== expectedHash) {
      throw new Error(`OpenAPI contract drift at ${pointer}`);
    }
  }
}

export function assertOpenApiParity(
  generated: unknown,
  authoritative: unknown,
): void {
  const difference = findDifference(generated, authoritative, '');
  if (difference !== undefined) {
    throw new Error(`OpenAPI contract drift at ${difference}`);
  }
}

function getOperation(
  contract: OpenAPIObject,
  path: string,
  method: HttpMethod,
): JsonObject {
  const operation = contract.paths[path]?.[method];
  if (operation === undefined) {
    throw new Error(`Missing OpenAPI operation metadata for ${method} ${path}.`);
  }
  return operation as unknown as JsonObject;
}

function resolveParameter(
  contract: OpenAPIObject,
  parameter: JsonObject,
): JsonObject {
  const reference = parameter.$ref;
  if (typeof reference !== 'string') {
    return parameter;
  }
  const name = reference.split('/').at(-1);
  const resolvedParameter =
    name === undefined ? undefined : contract.components?.parameters?.[name];
  if (resolvedParameter === undefined || '$ref' in resolvedParameter) {
    throw new Error(`Missing OpenAPI parameter metadata for ${reference}.`);
  }
  return resolvedParameter as unknown as JsonObject;
}

function hasRestaurantSessionSecurity(operation: JsonObject): boolean {
  const security = operation.security;
  return (
    Array.isArray(security) &&
    security.some(
      (requirement) =>
        typeof requirement === 'object' &&
        requirement !== null &&
        Object.prototype.hasOwnProperty.call(requirement, 'restaurantSession'),
    )
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readJsonPointer(document: unknown, pointer: string): unknown {
  let value = document;
  for (const token of pointer.slice(1).split('/')) {
    if (!isObject(value)) {
      return undefined;
    }
    value = value[token.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return value;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function findDifference(
  left: unknown,
  right: unknown,
  path: string,
): string | undefined {
  if (Object.is(left, right)) {
    return undefined;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return path || '/';
    }
    if (left.length !== right.length) {
      return `${path}/length`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = findDifference(left[index], right[index], `${path}/${index}`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  if (isObject(left) && isObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left) || !(key in right)) {
        return `${path}/${escapeJsonPointer(key)}`;
      }
      const difference = findDifference(
        left[key],
        right[key],
        `${path}/${escapeJsonPointer(key)}`,
      );
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  return path || '/';
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

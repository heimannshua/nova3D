// Story 1.12. The application's side of the file gateway (workers/files), in two parts that share one configuration:
//
//   signingConfigOf(env)       what signs: the application's private key (SERVICE_SIGNING_KEY_APPLICATION), checked to be the private half of the active
//                              key of its public key set (SERVICE_KEYS_APPLICATION), the gateway's address (FILE_GATEWAY_URL) and this environment's
//                              INSTANCE_ID. Null when any is unset or wrong: the ticket route (lib/transfer-tickets.ts) answers 503 and the cleanup task
//                              answers `no_store`, so a deployment without a gateway fails closed and never half-works.
//   createGatewayClient(...)   the signed OUTBOUND commands. Storage deletions run only on the gateway, with its own key; the application tells it what
//                              to delete with a command it signs (`delete-staging`, `delete-root`) and what to attach with `attach`. Each command is
//                              valid for 5 minutes and is redeemed once, so a command that is replayed, signed by anyone else or sent from a browser (an
//                              Origin header) deletes nothing. The call has a timeout, refuses a redirect and is never cached.
//
// SERVER-ONLY. This is the one new module besides the ticket route that reads the environment: `configuredGatewayClient` (the pattern of
// `configuredLedgerStore` in lib/job-tasks.ts) reads it, and the rest takes what it needs as parameters. Erasable TypeScript syntax and relative
// `.ts` imports, like the modules it serves. Nothing here logs, and no error message holds a key, a token or a URL.
import {appOriginProblem, isPlaceholder, type Env} from './environment.ts';
import {keySetVariable, loadSigner, parseKeySet, signCommand, signingKeyVariable, type CommandClaims, type ParsedKeySet, type Signer} from './service-signing.ts';

if (typeof window !== 'undefined') {
  throw new Error('lib/gateway-client.ts is server-only and must not be imported by browser code.');
}

export type SigningConfig = {
  /** The gateway's origin, as the browser and the application both reach it. */
  gateway: string;
  instanceId: string;
  signer: Signer;
  keySet: ParsedKeySet;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configuration that signs tickets and commands, or null when any part is unset, a placeholder or wrong. It never throws and never says which. */
export function signingConfigOf(env: Env): SigningConfig | null {
  const keysText = env[keySetVariable('application')]?.trim();
  const privateKey = env[signingKeyVariable('application')]?.trim();
  const gateway = env.FILE_GATEWAY_URL?.trim();
  const instanceId = env.INSTANCE_ID?.trim();
  if (!keysText || !privateKey || !gateway || !instanceId) return null;
  if (isPlaceholder(keysText) || isPlaceholder(privateKey) || isPlaceholder(gateway) || isPlaceholder(instanceId)) return null;
  if (!uuidPattern.test(instanceId) || appOriginProblem(gateway, env.APP_ENV) !== null) return null;
  const keys = parseKeySet(keysText, 'application');
  if (!keys.ok) return null;
  const loaded = loadSigner(privateKey, keys.keySet);
  if (!loaded.ok) return null;
  return {gateway, instanceId: instanceId.toLowerCase(), signer: loaded.signer, keySet: keys.keySet};
}

/** The gateway did not do what a command asked: it answered a status that is not a success, or an answer that is not one. `status` is the HTTP status. */
export class GatewayError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('the file gateway refused a command');
    this.name = 'GatewayError';
    this.status = status;
  }
}

/** The gateway could not be reached, or did not answer in time. */
export class GatewayUnavailableError extends Error {
  constructor() {
    super('the file gateway did not answer');
    this.name = 'GatewayUnavailableError';
  }
}

export type GatewayClientOptions = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Seconds since the epoch, for the token's `iat` (the tests pin it). */
  now?: () => number;
  /** How long a command may take; 10 seconds by default. */
  timeoutMs?: number;
};

export type GatewayClient = {
  /** Removes a staging upload's objects if its lease is expired or released at the moment the gateway checks: `kept` when it is not. */
  deleteStaging(input: {accountId: string; uploadId: string}): Promise<{outcome: 'deleted' | 'kept'}>;
  /** Removes the object stored under `objects/<account>/<root>`. */
  deleteRoot(input: {accountId: string; root: string}): Promise<{outcome: 'deleted'}>;
  /** Attaches a complete upload: copies its verified object and publishes its manifest through a registered transform. */
  attach(input: {accountId: string; epoch: number; uploadId: string; transform: string}): Promise<{outcome: 'published' | 'exists'; manifest: {id: string; root: string; digest: string; length: number; kind: string}}>;
};

export function createGatewayClient(config: SigningConfig, options: GatewayClientOptions = {}): GatewayClient {
  const send = async (claims: CommandClaims): Promise<Record<string, unknown>> => {
    const now = options.now?.();
    const token = signCommand(config.signer, config.instanceId, claims, now === undefined ? {} : {now});
    let response: Response;
    try {
      // No cookie, no Origin (this is a server), no body; a redirect is an error so the token can never be sent anywhere else; never cached.
      response = await (options.fetch ?? fetch)(`${config.gateway}/v1/commands`, {
        method: 'POST',
        headers: {authorization: `Command ${token}`},
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new GatewayUnavailableError();
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) throw new GatewayError(response.status);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new GatewayError(response.status);
    return body as Record<string, unknown>;
  };

  return {
    async deleteStaging(input) {
      const body = await send({cmd: 'delete-staging', acct: input.accountId, uid: input.uploadId});
      if (body.outcome !== 'deleted' && body.outcome !== 'kept') throw new GatewayError(200);
      return {outcome: body.outcome};
    },
    async deleteRoot(input) {
      const body = await send({cmd: 'delete-root', acct: input.accountId, root: input.root});
      if (body.outcome !== 'deleted') throw new GatewayError(200);
      return {outcome: 'deleted'};
    },
    async attach(input) {
      const body = await send({cmd: 'attach', acct: input.accountId, epoch: input.epoch, uid: input.uploadId, tr: input.transform});
      const manifest = body.manifest as Record<string, unknown> | undefined;
      if ((body.outcome !== 'published' && body.outcome !== 'exists') || typeof manifest !== 'object' || manifest === null) throw new GatewayError(200);
      const {id, root, digest, length, kind} = manifest;
      if (typeof id !== 'string' || typeof root !== 'string' || typeof digest !== 'string' || typeof length !== 'number' || typeof kind !== 'string') throw new GatewayError(200);
      return {outcome: body.outcome, manifest: {id, root, digest, length, kind}};
    },
  };
}

/**
 * The gateway client this deployment is configured with, or null: the application's key and key set, the gateway's address and the instance ID, all
 * from the environment. With none the staging cleanup records `no_store` and nothing is deleted; nothing else about the application needs it.
 */
export function configuredGatewayClient(env: Env = process.env, options: GatewayClientOptions = {}): GatewayClient | null {
  const config = signingConfigOf(env);
  return config ? createGatewayClient(config, options) : null;
}

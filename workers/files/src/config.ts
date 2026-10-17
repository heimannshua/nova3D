// The gateway's configuration, read once from the environment at start-up. A missing or malformed value stops the gateway before it listens
// (main.ts exits non-zero): a gateway that guessed would be one that served the wrong environment. Problems name the VARIABLE, never its value.
//
//   APP_ENV                            local | staging | production, verified against artifacts.instance
//   INSTANCE_ID                        the environment's instance UUID, verified against artifacts.instance; also the `env` of every token
//   APP_ORIGIN                         the one origin that may call the gateway from a browser (https for staging and production)
//   SERVICE_KEYS_APPLICATION           the application issuer's PUBLIC key set (not secret): the keys that sign tickets and commands
//   GATEWAY_DATABASE_URL               a postgres URL for the role nova3d_gateway (secret); for staging and production it carries ?sslmode=require (or verify-ca, verify-full)
//   GATEWAY_STORAGE_S3_ENDPOINT        the Storage S3 endpoint (not secret)
//   GATEWAY_STORAGE_S3_REGION          its region (not secret)
//   GATEWAY_STORAGE_S3_ACCESS_KEY_ID   the gateway's own Storage key pair
//   GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY  (secret)
//   PORT                               the port to listen on (Railway sets it); 8080 when unset
import {parseKeySet, type ParsedKeySet} from '../../../lib/service-signing.ts';
import type {S3Settings} from './storage.ts';

export type Env = Record<string, string | undefined>;

export const appEnvironments = ['local', 'staging', 'production'] as const;

export type GatewayConfig = {
  port: number;
  appEnv: (typeof appEnvironments)[number];
  instanceId: string;
  appOrigin: string;
  keySet: ParsedKeySet;
  databaseUrl: string;
  s3: S3Settings;
};

export type ConfigResult = {ok: true; config: GatewayConfig} | {ok: false; problems: string[]};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placeholder = /^(?:replace-with-|<[^>]+>)|^(?:changeme|todo)$/i;

const value = (env: Env, name: string): string | null => {
  const text = env[name]?.trim();
  return text && !placeholder.test(text) ? text : null;
};

export function readConfig(env: Env): ConfigResult {
  const problems: string[] = [];
  const need = (name: string) => {
    const text = value(env, name);
    if (text === null) problems.push(`${name} is not set`);
    return text;
  };

  const appEnv = need('APP_ENV');
  if (appEnv !== null && !(appEnvironments as readonly string[]).includes(appEnv)) problems.push('APP_ENV must be local, staging or production');
  const instanceId = need('INSTANCE_ID');
  if (instanceId !== null && !uuidPattern.test(instanceId)) problems.push('INSTANCE_ID must be a UUID');

  const appOrigin = need('APP_ORIGIN');
  if (appOrigin !== null) {
    let origin: URL | null = null;
    try {
      origin = new URL(appOrigin);
    } catch {
      origin = null;
    }
    if (!origin || origin.origin === 'null' || origin.origin !== appOrigin || origin.username || origin.password) {
      problems.push('APP_ORIGIN must be an origin and nothing more: a scheme and a host (and a port), with no path, query, fragment or credentials');
    } else if ((appEnv === 'staging' || appEnv === 'production') && origin.protocol !== 'https:') {
      problems.push('APP_ORIGIN must be an https origin for staging and production');
    }
  }

  const keysText = need('SERVICE_KEYS_APPLICATION');
  let keySet: ParsedKeySet | null = null;
  if (keysText !== null) {
    const parsed = parseKeySet(keysText, 'application');
    if (parsed.ok) keySet = parsed.keySet;
    else problems.push(`SERVICE_KEYS_APPLICATION: ${parsed.problem}`);
  }

  const databaseUrl = need('GATEWAY_DATABASE_URL');
  if (databaseUrl !== null && !/^postgres(?:ql)?:\/\//.test(databaseUrl)) problems.push('GATEWAY_DATABASE_URL must be a postgres URL');
  else if (databaseUrl !== null && (appEnv === 'staging' || appEnv === 'production')) {
    // A hosted database is reached over the network, so the connection is encrypted: the URL says so (`?sslmode=require`, or verify-ca or verify-full).
    // The local stack, on loopback, is exempt.
    let mode: string | null = null;
    try {
      mode = new URL(databaseUrl).searchParams.get('sslmode');
    } catch {
      mode = null;
    }
    if (mode === null || !['require', 'verify-ca', 'verify-full'].includes(mode)) {
      problems.push('GATEWAY_DATABASE_URL must carry sslmode=require, sslmode=verify-ca or sslmode=verify-full for staging and production');
    }
  }

  const endpoint = need('GATEWAY_STORAGE_S3_ENDPOINT');
  if (endpoint !== null) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') problems.push('GATEWAY_STORAGE_S3_ENDPOINT must be an http or https URL');
      // The https rule is for the two hosted environments (as APP_ORIGIN's is); an APP_ENV that is none of the three has its own problem and adds no second one here.
      if ((appEnv === 'staging' || appEnv === 'production') && url.protocol !== 'https:') problems.push('GATEWAY_STORAGE_S3_ENDPOINT must be https for staging and production');
    } catch {
      problems.push('GATEWAY_STORAGE_S3_ENDPOINT must be a URL');
    }
  }
  const region = need('GATEWAY_STORAGE_S3_REGION');
  if (region !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(region)) problems.push('GATEWAY_STORAGE_S3_REGION must be a region name');
  const accessKeyId = need('GATEWAY_STORAGE_S3_ACCESS_KEY_ID');
  const secretAccessKey = need('GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY');

  const portText = env.PORT?.trim() || '8080';
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a port number');

  if (problems.length > 0 || !appEnv || !instanceId || !appOrigin || !keySet || !databaseUrl || !endpoint || !region || !accessKeyId || !secretAccessKey) {
    return {ok: false, problems};
  }
  return {
    ok: true,
    config: {
      port,
      appEnv: appEnv as GatewayConfig['appEnv'],
      instanceId: instanceId.toLowerCase(),
      appOrigin,
      keySet,
      databaseUrl,
      s3: {endpoint, region, accessKeyId, secretAccessKey},
    },
  };
}

// The heartbeat task's configuration, read once from the environment at start-up (main.ts). A missing or malformed value stops the task before it signs or
// sends anything (main.ts exits 1): a heartbeat that guessed would be one that vouched for the wrong environment. Problems name the VARIABLE, never its value.
//
//   APP_ENV                          local | staging | production
//   INSTANCE_ID                      the environment's instance UUID: the `env` of the token, which the application checks against its own
//   APP_ORIGIN                       the one origin the heartbeat is posted to (https for staging and production): `<APP_ORIGIN>/api/heartbeat`
//   SERVICE_KEYS_HEARTBEAT           the heartbeat issuer's PUBLIC key set (not secret): the task checks its own key against it before it signs
//   SERVICE_SIGNING_KEY_HEARTBEAT    the task's own Ed25519 private key (secret), the base64 PKCS#8 of the ACTIVE key of the set. It is the only secret the task
//                                    holds: no database access, no Storage key, no other credential.
import {loadSigner, parseKeySet, type Signer} from '../../../lib/service-signing.ts';

export type Env = Record<string, string | undefined>;

export const appEnvironments = ['local', 'staging', 'production'] as const;

/** Every name the task reads, in the order it lists them when they are missing. */
export const variableNames = ['APP_ENV', 'INSTANCE_ID', 'APP_ORIGIN', 'SERVICE_KEYS_HEARTBEAT', 'SERVICE_SIGNING_KEY_HEARTBEAT'] as const;

export type HeartbeatConfig = {
  appEnv: (typeof appEnvironments)[number];
  instanceId: string;
  /** `<APP_ORIGIN>/api/heartbeat`. */
  endpoint: string;
  signer: Signer;
};

export type ConfigResult = {ok: true; config: HeartbeatConfig} | {ok: false; problems: string[]};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placeholder = /^(?:replace-with-|<[^>]+>)|^(?:changeme|todo)$/i;

/** The path the heartbeat is posted to. */
export const heartbeatPath = '/api/heartbeat';

const value = (env: Env, name: string): string | null => {
  const text = env[name]?.trim();
  return text && !placeholder.test(text) ? text : null;
};

export function readConfig(env: Env, nowMs: number = Date.now()): ConfigResult {
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

  const keysText = need('SERVICE_KEYS_HEARTBEAT');
  const privateKey = need('SERVICE_SIGNING_KEY_HEARTBEAT');
  let signer: Signer | null = null;
  if (keysText !== null) {
    const parsed = parseKeySet(keysText, 'heartbeat', nowMs);
    if (!parsed.ok) problems.push(`SERVICE_KEYS_HEARTBEAT: ${parsed.problem}`);
    else if (privateKey !== null) {
      const loaded = loadSigner(privateKey, parsed.keySet);
      if (loaded.ok) signer = loaded.signer;
      else problems.push(`SERVICE_SIGNING_KEY_HEARTBEAT: ${loaded.problem}`);
    }
  }

  if (problems.length > 0 || !appEnv || !instanceId || !appOrigin || !signer) return {ok: false, problems};
  return {ok: true, config: {appEnv: appEnv as HeartbeatConfig['appEnv'], instanceId: instanceId.toLowerCase(), endpoint: `${appOrigin}${heartbeatPath}`, signer}};
}

// The file gateway's entry point: reads the environment, checks that the database it was pointed at is the environment it was told it is for,
// and listens. Run as `node workers/files/src/main.ts` (Node's type stripping; the image's CMD does the same).
//
// It EXITS NON-ZERO, before listening, when anything is missing or wrong: a configuration problem, a database that cannot be reached, or an
// APP_ENV or INSTANCE_ID that differs from the one row of `artifacts.instance`. A gateway that served the wrong environment would move one
// environment's files with another's authority, so it never starts. Nothing it prints holds a value of the environment.
import {realpathSync} from 'node:fs';
import type {Server} from 'node:http';
import {fileURLToPath} from 'node:url';
import {readConfig, type Env, type GatewayConfig} from './config.ts';
import {createPostgresDatabase, type GatewayDatabase} from './database.ts';
import {createGatewayServer, type GatewayDeps} from './server.ts';
import {createS3Storage, type GatewayStorage} from './storage.ts';

/** Start-up refused: `problems` name what is wrong (variables and rules, never values). */
export class StartupError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join('; '));
    this.name = 'StartupError';
    this.problems = problems;
  }
}

/** How long a shutdown waits for the transfers in flight before it cuts them: ten seconds. */
export const shutdownGraceMs = 10_000;

export type Started = {
  server: Server;
  config: GatewayConfig;
  port: number;
  /** Stops at once: every connection is cut. For the tests. */
  close: () => Promise<void>;
  /**
   * Stops gracefully: no new connection is accepted, idle ones are closed, and the requests in flight get up to `graceMs` to finish; what is still running
   * then is cut. A deploy that replaces the service no longer cuts every transfer at once. Resolves when the server and the database pool are closed.
   */
  shutdown: (graceMs?: number) => Promise<void>;
};

export type StartOptions = {
  /** For a test: the database and Storage to use instead of those the environment names. */
  database?: GatewayDatabase;
  storage?: GatewayStorage;
  hooks?: GatewayDeps['hooks'];
  clock?: GatewayDeps['clock'];
  resolvers?: GatewayDeps['resolvers'];
  log?: GatewayDeps['log'];
  /** Listens on this port instead of the configured one (0 asks the system for a free one). */
  port?: number;
  host?: string;
};

export async function start(env: Env, options: StartOptions = {}): Promise<Started> {
  const read = readConfig(env);
  if (!read.ok) throw new StartupError(read.problems);
  const {config} = read;
  const database = options.database ?? createPostgresDatabase({connectionString: config.databaseUrl});
  const closeDatabase = () => (options.database ? Promise.resolve() : database.close());
  try {
    let identity;
    try {
      identity = await database.instance();
    } catch {
      throw new StartupError(['the database cannot be asked for artifacts.instance (is GATEWAY_DATABASE_URL the role nova3d_gateway, and the Story 1.12 migration applied?)']);
    }
    const mismatches: string[] = [];
    if (identity.environment !== config.appEnv) mismatches.push('APP_ENV differs from the environment of this database');
    if (identity.instanceId.toLowerCase() !== config.instanceId) mismatches.push('INSTANCE_ID differs from the instance of this database');
    if (mismatches.length > 0) throw new StartupError(mismatches);

    const storage = options.storage ?? createS3Storage(config.s3);
    const server = createGatewayServer({
      instanceId: config.instanceId,
      appOrigin: config.appOrigin,
      keySet: config.keySet,
      database,
      storage,
      resolvers: options.resolvers,
      clock: options.clock,
      log: options.log,
      hooks: options.hooks,
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? config.port, options.host ?? '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : (options.port ?? config.port);
    return {
      server,
      config,
      port,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await closeDatabase();
      },
      shutdown: async (graceMs = shutdownGraceMs) => {
        // `close` stops accepting and resolves when every connection has ended; idle ones are closed now, and a connection that goes idle when its response
        // is done is closed with it (the server says `Connection: close` once it is closing, and the keep-alive timeout is short).
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeIdleConnections();
        const timer = setTimeout(() => server.closeAllConnections(), graceMs);
        try {
          await closed;
        } finally {
          clearTimeout(timer);
        }
        await closeDatabase();
      },
    };
  } catch (error) {
    await closeDatabase().catch(() => undefined);
    throw error;
  }
}

/** Whether this file is the program being run (and not imported by a test), by real path on both sides. */
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

/**
 * On SIGTERM or SIGINT the gateway shuts down gracefully: what is in flight gets `graceMs` to finish, and then the process exits (0 when the shutdown was
 * clean, 1 when it failed). A second signal does not wait: it cuts everything and exits. A transfer that is cut is restarted by its client with a new ticket,
 * which is why the grace is for the common case (a deploy) and not a promise.
 */
export function exitOnSignals(
  started: Pick<Started, 'server' | 'shutdown'>,
  options: {signals?: Pick<NodeJS.Process, 'on'>; exit?: (code: number) => void; graceMs?: number} = {},
) {
  const signals = options.signals ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const graceMs = options.graceMs ?? shutdownGraceMs;
  let stopping = false;
  const stop = () => {
    if (stopping) {
      started.server.closeAllConnections();
      return;
    }
    stopping = true;
    // The shutdown cuts what is still running at `graceMs`; this backstop is for a shutdown that does not return at all.
    const backstop = setTimeout(() => exit(1), graceMs + 5_000);
    backstop.unref();
    started.shutdown(graceMs).then(
      () => {
        clearTimeout(backstop);
        exit(0);
      },
      () => {
        clearTimeout(backstop);
        exit(1);
      },
    );
  };
  // (`on`, not `once`: a second signal while stopping is the instruction to stop waiting.)
  signals.on('SIGTERM', stop);
  signals.on('SIGINT', stop);
}

if (isEntryPoint()) {
  try {
    const started = await start(process.env);
    console.log(`The file gateway is listening (${started.config.appEnv}).`);
    exitOnSignals(started);
  } catch (error) {
    if (error instanceof StartupError) {
      console.error('The file gateway did not start:');
      for (const problem of error.problems) console.error(`  ${problem}`);
    } else {
      console.error('The file gateway did not start:', error instanceof Error ? error.name : 'unknown failure');
    }
    process.exit(1);
  }
}

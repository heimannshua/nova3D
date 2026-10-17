import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {createPostgresDatabase, type NewLease, type PoolLike} from '../../workers/files/src/database';

// The gateway's Postgres layer (workers/files/src/database.ts) over a fake pool, to show what a real database that is not there cannot be made to show:
// a connection that is DROPPED while it is checked out. Story 1.12 review (P6): the finding was real. A `pg` pool listens for a connection's 'error' event
// only while the connection is idle; one that is checked out and dropped (the database restarted, the pooler cut it) emits 'error' with nobody listening, and
// an unhandled 'error' event ends the process, with every transfer in flight.

const lease = (): NewLease => ({
  id: randomUUID(),
  accountId: randomUUID(),
  kid: 'test-key',
  kind: 'file',
  length: 100,
  sha256: 'a'.repeat(64),
  contentType: 'application/octet-stream',
  now: new Date(),
  expiresAt: new Date(Date.now() + 86_400_000),
  quotaBytes: 1000,
});

type Connection = EventEmitter & {query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>};

/** A pool that hands out one connection, which answers as a healthy database does until `script` makes it fail. */
function fakePool(script: (sql: string, client: Connection) => Promise<{rows: unknown[]}> | undefined = () => undefined) {
  const client = Object.assign(new EventEmitter(), {release: vi.fn()}) as Connection;
  const seen: {sql: string; listeners: number}[] = [];
  client.query = vi.fn(async (sql: string) => {
    seen.push({sql, listeners: client.listenerCount('error')});
    const scripted = script(sql, client);
    if (scripted) return scripted;
    if (/insert into artifacts\.staging_leases/.test(sql)) return {rows: [{id: 'x'}]};
    if (/sum\(length\)/.test(sql)) return {rows: [{bytes: '0'}]};
    return {rows: []};
  });
  const pool = {connect: vi.fn(async () => client), query: vi.fn(async () => ({rows: []})), end: vi.fn(async () => undefined), on: vi.fn()} as unknown as PoolLike;
  return {client, pool, seen};
}

describe('a connection that is dropped while a transaction has it checked out', () => {
  it('does not end the process: the error event has a listener while the connection is checked out, and the call that was using it fails', async () => {
    const dropped = new Error('Connection terminated unexpectedly');
    const {client, pool, seen} = fakePool((sql, connection) => {
      if (!/advisory/.test(sql)) return undefined;
      // The connection is dropped, as a pooler or a restart does: the event first (nobody is asking), and the query that was waiting on it fails.
      queueMicrotask(() => connection.emit('error', dropped));
      return new Promise((_resolve, reject) => setTimeout(() => reject(dropped), 5));
    });
    const database = createPostgresDatabase({connectionString: 'postgresql://unused', pool});
    // `emit('error')` with no listener throws; with the listener it does nothing, and the call fails by the query's own rejection.
    await expect(database.createLease(lease())).rejects.toBe(dropped);
    expect(seen.every((entry) => entry.listeners >= 1), 'a listener for the whole checkout').toBe(true);
    // The connection is not trusted again, and the listener is gone before it is released.
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount('error')).toBe(0);
    expect(seen.map((entry) => entry.sql).at(-1)).toBe('rollback');
  });

  it('survives an error event between two statements, with no statement waiting, and then fails the next one that is made on the dead connection', async () => {
    const dead = new Error('write EPIPE');
    const {client, pool} = fakePool((sql, connection) => {
      if (/insert into artifacts\.staging_leases/.test(sql)) {
        connection.emit('error', dead);
        return undefined;
      }
      if (/sum\(length\)/.test(sql)) return Promise.reject(dead);
      return undefined;
    });
    const database = createPostgresDatabase({connectionString: 'unused', pool});
    await expect(database.createLease(lease())).rejects.toBe(dead);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('is the same for the other transaction the gateway makes: opening a transfer', async () => {
    const dead = new Error('Connection terminated');
    const {client, pool} = fakePool((sql, connection) => {
      if (/insert into artifacts\.ticket_redemptions/.test(sql)) {
        queueMicrotask(() => connection.emit('error', dead));
        return new Promise((_resolve, reject) => setTimeout(() => reject(dead), 5));
      }
      return undefined;
    });
    const database = createPostgresDatabase({connectionString: 'unused', pool});
    await expect(
      database.openTransfer({jti: 'j'.repeat(22), kid: 'k', accountId: randomUUID(), sessionId: randomUUID(), epoch: 1, direction: 'download', targetKind: 'staging', targetId: randomUUID(), expiresAt: new Date(), handleHash: Buffer.alloc(32), handleExpiresAt: new Date(), now: new Date()}),
    ).rejects.toBe(dead);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('releases a healthy connection to the pool as it is (not destroyed), with no listener left of its own', async () => {
    const {client, pool} = fakePool();
    const database = createPostgresDatabase({connectionString: 'unused', pool});
    await expect(database.createLease(lease())).resolves.toBe('created');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('rolls back and fails the call, rather than reporting a lease, when the quota is exceeded: the connection is still released destroyed so a failed one is never reused', async () => {
    const {client, pool, seen} = fakePool((sql) => (/sum\(length\)/.test(sql) ? Promise.resolve({rows: [{bytes: '5000'}]}) : undefined));
    const database = createPostgresDatabase({connectionString: 'unused', pool});
    await expect(database.createLease(lease())).resolves.toBe('quota_exceeded');
    expect(seen.map((entry) => entry.sql)).toContain('rollback');
    expect(client.listenerCount('error')).toBe(0);
  });
});

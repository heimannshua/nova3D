import type {Client} from 'pg';

// Story 2.6. A truncate is refused by the first thing that can refuse it, and a table that other tables refer to is refused by a foreign key (0A000) before its own trigger is
// asked, unless the tables that refer to it are named in the same statement (or CASCADE is used) so that a trigger answers; and then it is the FIRST trigger that answers, not
// necessarily the table's own. A test that truncates a table and sees 55000 has therefore not shown that the table has its own guard. This reads the catalog instead.

/**
 * For each table (`schema.name`), the names of its enabled BEFORE TRUNCATE statement triggers whose function raises 55000 (the code a record that is never emptied answers
 * with). A table with no such trigger maps to an empty list.
 */
export async function truncateGuards(client: Client, tables: string[]): Promise<Record<string, string[]>> {
  const {rows} = await client.query(
    `select c.oid::regclass::text as "table", t.tgname as name
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 0 and (t.tgtype & 2) = 2 and (t.tgtype & 32) = 32
        and c.oid = any($1::regclass[])
        and pg_get_functiondef(p.oid) like '%55000%'
      order by 1, 2`,
    [tables],
  );
  const found: Record<string, string[]> = Object.fromEntries(tables.map((table) => [table, []]));
  for (const row of rows) found[row.table as string].push(row.name as string);
  return found;
}

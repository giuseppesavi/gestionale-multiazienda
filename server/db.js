'use strict';
// Accesso al database: PostgreSQL in produzione, PGlite (Postgres in memoria) nei test.

const DDL = [
  `create table if not exists tenants (
     id text primary key, nome text not null, email_admin text not null default '',
     classe int not null default 1, pacchetti jsonb not null default '[]'::jsonb,
     attiva boolean not null default true, creato timestamptz not null default now())`,
  `create table if not exists rows (
     tenant text not null, sheet text not null, id text not null, data jsonb not null,
     primary key (tenant, sheet, id))`,
  `create table if not exists props (
     tenant text not null, key text not null, value jsonb not null,
     primary key (tenant, key))`,
  `create table if not exists files (
     tenant text not null, id text not null, nome text not null, mime text not null,
     dimensione int not null, contenuto bytea not null, creato timestamptz not null default now(),
     primary key (tenant, id))`,
];

const pausa = ms => new Promise(r => setTimeout(r, ms));

async function apriDb(opt = {}) {
  let db;
  if (opt.url) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: opt.url, max: 10 });
    pool.on('error', e => console.error('Database:', e.message));
    // All'avvio il database può non essere ancora pronto: si riprova fino a 5 minuti.
    const fine = Date.now() + (opt.attesaMs ?? 5 * 60 * 1000);
    for (;;) {
      try { await pool.query('select 1'); break; }
      catch (e) {
        if (Date.now() > fine) throw new Error('Database non raggiungibile: ' + e.message);
        await pausa(3000);
      }
    }
    db = {
      query: (sql, par) => pool.query(sql, par),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const r = await fn({ query: (sql, par) => c.query(sql, par) });
          await c.query('commit');
          return r;
        } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
        finally { c.release(); }
      },
      close: () => pool.end(),
    };
  } else {
    let pgl = opt.pglite;
    if (!pgl) { const { PGlite } = await import('@electric-sql/pglite'); pgl = new PGlite(); }
    db = {
      query: (sql, par) => pgl.query(sql, par),
      tx: fn => pgl.transaction(t => fn({ query: (sql, par) => t.query(sql, par) })),
      close: async () => {},
      pglite: pgl,
    };
  }
  for (const s of DDL) await db.query(s);
  return db;
}

module.exports = { apriDb };

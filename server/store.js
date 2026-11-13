'use strict';
// Archivio in memoria per azienda: caricato alla prima richiesta, salva solo le righe modificate.
// Le richieste della stessa azienda sono eseguite una alla volta (coda), quindi non servono lock.

class StatoAzienda {
  constructor(id) {
    this.id = id;
    this.tab = new Map();      // entità -> Map(id -> riga)
    this.props = new Map();    // chiave -> valore
    this.sporche = new Map();  // "entità|id" -> riga oppure null (eliminata)
    this.propSporche = new Set();
  }
  tabella(e) {
    let t = this.tab.get(e);
    if (!t) { t = new Map(); this.tab.set(e, t); }
    return t;
  }
  metti(e, riga) { this.tabella(e).set(riga.id, riga); this.sporche.set(e + '|' + riga.id, riga); }
  togli(e, id) { if (this.tabella(e).delete(id)) this.sporche.set(e + '|' + id, null); }
  prop(k) { return this.props.get(k); }
  setProp(k, v) {
    if (v === null || v === undefined) this.props.delete(k); else this.props.set(k, v);
    this.propSporche.add(k);
  }
}

class Archivio {
  constructor(db) { this.db = db; this.cache = new Map(); this.code = new Map(); }

  // Esegue fn(stato) in esclusiva per l'azienda; al termine salva le modifiche in un'unica transazione.
  // In caso di errore le modifiche in memoria vengono scartate.
  conAzienda(id, fn) {
    const prima = this.code.get(id) || Promise.resolve();
    const lavoro = prima.catch(() => {}).then(async () => {
      let st = this.cache.get(id);
      try {
        if (!st) { st = await this._carica(id); this.cache.set(id, st); }
        const r = await fn(st);
        await this._salva(st);
        return r;
      } catch (e) { this.cache.delete(id); throw e; }
    });
    this.code.set(id, lavoro);
    return lavoro;
  }

  dimentica(id) { this.cache.delete(id); }

  async _carica(id) {
    const st = new StatoAzienda(id);
    const r = await this.db.query('select sheet, id, data from rows where tenant = $1', [id]);
    for (const x of r.rows) st.tabella(x.sheet).set(x.id, x.data);
    const p = await this.db.query('select key, value from props where tenant = $1', [id]);
    for (const x of p.rows) st.props.set(x.key, x.value);
    return st;
  }

  async _salva(st) {
    if (!st.sporche.size && !st.propSporche.size) return;
    await this.db.tx(async t => {
      for (const [chiave, riga] of st.sporche) {
        const i = chiave.indexOf('|');
        const e = chiave.slice(0, i), rid = chiave.slice(i + 1);
        if (riga === null) await t.query('delete from rows where tenant = $1 and sheet = $2 and id = $3', [st.id, e, rid]);
        else await t.query(
          `insert into rows (tenant, sheet, id, data) values ($1, $2, $3, $4::jsonb)
           on conflict (tenant, sheet, id) do update set data = excluded.data`,
          [st.id, e, rid, JSON.stringify(riga)]);
      }
      for (const k of st.propSporche) {
        if (!st.props.has(k)) await t.query('delete from props where tenant = $1 and key = $2', [st.id, k]);
        else await t.query(
          `insert into props (tenant, key, value) values ($1, $2, $3::jsonb)
           on conflict (tenant, key) do update set value = excluded.value`,
          [st.id, k, JSON.stringify(st.props.get(k))]);
      }
    });
    st.sporche.clear();
    st.propSporche.clear();
  }
}

module.exports = { Archivio, StatoAzienda };

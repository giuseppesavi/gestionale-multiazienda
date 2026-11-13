'use strict';
// Cuore del server: API delle aziende, API della piattaforma (/admin), applicazione Express.

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { Archivio } = require('./store');
const { creaAuth } = require('./auth');
const eng = require('../app/engine');
const { ErroreUtente } = eng;
const { SCHEMA, ELENCHI, FATTORI_RISCHIO, DOMANDE_QUALIFICA } = require('../app/schema');
const lic = require('../app/licenza');

function creaSistema({ db, postino, adminKey, emailPiattaforma }) {
  const archivio = new Archivio(db);
  const auth = creaAuth({ postino });

  // ---------- aziende ----------

  async function leggiAzienda(codice) {
    if (typeof codice !== 'string') return null;
    const r = await db.query('select id, nome, email_admin, classe, pacchetti, attiva, creato from tenants where id = $1', [codice]);
    return r.rows[0] || null;
  }
  const pacchettiDi = az => new Set(['base', ...az.pacchetti]);
  const ctxInterno = (st, az) => ({ st, azienda: az, pacchetti: new Set(lic.PACCHETTI.map(p => p.id)), interno: true, utente: null });

  // Setup automatico: aggiunge i valori iniziali mancanti. Non cancella né rinomina mai nulla.
  function prepara(st, az) {
    if (st.prop('setup') >= 1) return;
    const ctx = ctxInterno(st, az);
    const logPrima = new Set(st.tabella('Log').keys());
    const presenti = new Set([...st.tabella('Elenchi').values()].map(r => r.categoria));
    for (const [categoria, valori] of Object.entries(ELENCHI)) {
      if (presenti.has(categoria)) continue;
      valori.forEach((valore, i) => eng.salva(ctx, 'Elenchi', { categoria, valore, ordine: i + 1 }));
    }
    if (!st.tabella('FattoriRischio').size) for (const [descrizione, riferimento] of FATTORI_RISCHIO) eng.salva(ctx, 'FattoriRischio', { descrizione, riferimento });
    if (!st.tabella('DomandeQualifica').size) DOMANDE_QUALIFICA.forEach((domanda, i) => eng.salva(ctx, 'DomandeQualifica', { domanda, ordine: i + 1 }));
    for (const r of [...st.tabella('Log').values()]) if (!logPrima.has(r.id)) st.togli('Log', r.id); // il setup non riempie il registro
    st.setProp('setup', 1);
  }

  // Segnalazione della necessità di estendere la licenza (al massimo una e-mail al giorno).
  async function notificaLicenza(az) {
    await archivio.conAzienda(az.id, async st => {
      const og = eng.oggi();
      const c = lic.classe(az.classe);
      eng.registra({ st }, 'Licenza', 'Inserimento bloccato: raggiunto il limite di ' + c.max + ' addetti (classe ' + c.etichetta + ')');
      if (st.prop('licenza:avviso') === og) return;
      st.setProp('licenza:avviso', og);
      const destinatari = new Set();
      for (const d of st.tabella('Dipendenti').values()) {
        if (d.utente === 'SI' && d.ruolo === 'Amministratore' && d.email && !lic.cessato(d, og)) destinatari.add(d.email);
      }
      if (emailPiattaforma) destinatari.add(emailPiattaforma);
      const testo = 'L\'azienda "' + az.nome + '" (codice ' + az.id + ') ha raggiunto il numero massimo di addetti attivi previsto dalla licenza: ' +
        c.max + ' (classe ' + c.etichetta + ').\n\nL\'inserimento di nuovi addetti è bloccato finché la licenza non viene estesa alla classe superiore.\n' +
        'Tutte le altre funzioni continuano a lavorare normalmente.';
      for (const a of destinatari) postino.invia({ a, oggetto: 'Licenza da estendere – ' + az.nome, testo }).catch(() => {});
    });
  }

  // ---------- API delle aziende ----------

  async function api(codice, args, ip) {
    const [token, azione, par] = Array.isArray(args) ? args : [];
    const p = par && typeof par === 'object' ? par : {};
    const az = await leggiAzienda(codice);
    if (!az || !az.attiva) throw new ErroreUtente('Azienda non trovata o non attiva.', 'AZIENDA');
    try {
      const r = await archivio.conAzienda(az.id, async st => {
        prepara(st, az);
        if (azione === 'otp.richiedi') return auth.richiedi(st, az, p.email, ip);
        if (azione === 'otp.verifica') return auth.verifica(st, az, p.email, p.codice, ip);
        const utente = auth.utenteDaToken(st, token);
        if (!utente) return { _errore: 'La sessione è scaduta. Accedi di nuovo.', _codice: 'SESSIONE' };
        const ctx = { st, utente, azienda: az, pacchetti: pacchettiDi(az) };
        switch (azione) {
          case 'esci': return auth.esci(st, token);
          case 'avvio': return {
            utente, azienda: { codice: az.id, nome: az.nome },
            pacchetti: lic.PACCHETTI.filter(x => ctx.pacchetti.has(x.id)),
            licenza: lic.statoLicenza(st, az, eng.oggi()),
            schema: eng.schemaPerUtente(ctx), oggi: eng.oggi(),
          };
          case 'elenco': return eng.elenco(ctx, p.entita, p);
          case 'leggi': return eng.leggi(ctx, p.entita, p.id);
          case 'salva': return eng.salva(ctx, p.entita, p.dati, p.figli);
          case 'elimina': return eng.elimina(ctx, p.entita, p.id);
          case 'opzioni': return eng.opzioni(ctx, p.entita);
          default: throw new ErroreUtente('Operazione non riconosciuta.');
        }
      });
      if (r && r._errore) throw new ErroreUtente(r._errore, r._codice);
      return r;
    } catch (e) {
      if (e.codice === 'LICENZA') await notificaLicenza(az).catch(x => console.error('Avviso licenza:', x.message));
      throw e;
    }
  }

  // ---------- API della piattaforma ----------

  function normPacchetti(l) {
    if (!Array.isArray(l)) throw new ErroreUtente('Elenco dei pacchetti non valido.');
    for (const x of l) if (!lic.pacchettoValido(x)) throw new ErroreUtente('Pacchetto non riconosciuto: ' + x);
    return [...new Set(l)];
  }

  const AMMIN = {
    async 'catalogo'() { return { classi: lic.CLASSI, pacchetti: lic.PACCHETTI }; },

    async 'aziende.elenco'() {
      const r = await db.query('select id, nome, email_admin, classe, pacchetti, attiva, creato from tenants order by nome');
      const out = [];
      for (const az of r.rows) {
        const licenza = await archivio.conAzienda(az.id, async st => lic.statoLicenza(st, az, eng.oggi()));
        out.push({ codice: az.id, nome: az.nome, emailAdmin: az.email_admin, attiva: az.attiva, creato: az.creato, pacchetti: az.pacchetti, licenza });
      }
      return out;
    },

    async 'aziende.crea'(p) {
      const codice = String(p.codice || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(codice)) throw new ErroreUtente('Il codice azienda deve avere da 2 a 30 caratteri: lettere minuscole, numeri e trattini.');
      const nome = String(p.nome || '').trim();
      if (!nome) throw new ErroreUtente('Indica la ragione sociale dell\'azienda.');
      if (!lic.classe(p.classe)) throw new ErroreUtente('Scegli la classe di dipendenti.');
      const pacchetti = normPacchetti(p.pacchetti || []);
      const a = p.admin || {};
      const email = String(a.email || '').trim().toLowerCase();
      if (!a.cognome || !a.nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroreUtente('Indica cognome, nome ed e-mail dell\'amministratore iniziale.');
      if (await leggiAzienda(codice)) throw new ErroreUtente('Esiste già un\'azienda con questo codice.');
      await db.query('insert into tenants (id, nome, email_admin, classe, pacchetti) values ($1, $2, $3, $4, $5::jsonb)',
        [codice, nome, email, Number(p.classe), JSON.stringify(pacchetti)]);
      const az = await leggiAzienda(codice);
      try {
        await archivio.conAzienda(codice, async st => {
          prepara(st, az);
          st.setProp('config', { ragioneSociale: nome, email });
          eng.salva(ctxInterno(st, az), 'Dipendenti', { cognome: a.cognome, nome: a.nome, email, utente: 'SI', ruolo: 'Amministratore' });
        });
      } catch (e) { await db.query('delete from tenants where id = $1', [codice]); throw e; }
      return { codice };
    },

    async 'aziende.aggiorna'(p) {
      const az = await leggiAzienda(p.codice);
      if (!az) throw new ErroreUtente('Azienda non trovata.');
      const nuova = { nome: az.nome, classe: az.classe, pacchetti: az.pacchetti, attiva: az.attiva };
      const note = [];
      if (p.nome !== undefined && String(p.nome).trim()) nuova.nome = String(p.nome).trim();
      if (p.attiva !== undefined) { nuova.attiva = !!p.attiva; if (nuova.attiva !== az.attiva) note.push(nuova.attiva ? 'azienda riattivata' : 'azienda sospesa'); }
      if (p.pacchetti !== undefined) {
        nuova.pacchetti = normPacchetti(p.pacchetti);
        const prima = new Set(az.pacchetti), dopo = new Set(nuova.pacchetti);
        const piu = nuova.pacchetti.filter(x => !prima.has(x)), meno = az.pacchetti.filter(x => !dopo.has(x));
        if (piu.length) note.push('pacchetti attivati: ' + piu.join(', '));
        if (meno.length) note.push('pacchetti disattivati: ' + meno.join(', '));
      }
      if (p.classe !== undefined && Number(p.classe) !== az.classe) {
        const c = lic.classe(p.classe);
        if (!c) throw new ErroreUtente('Classe di dipendenti non valida.');
        const attivi = await archivio.conAzienda(az.id, async st => lic.contaAttivi(st, eng.oggi()));
        if (attivi > c.max) throw new ErroreUtente('L\'azienda ha ' + attivi + ' addetti attivi: non può passare alla classe ' + c.etichetta + '.');
        note.push('classe ' + lic.classe(az.classe).etichetta + ' → ' + c.etichetta);
        nuova.classe = c.id;
      }
      await db.query('update tenants set nome = $2, classe = $3, pacchetti = $4::jsonb, attiva = $5 where id = $1',
        [az.id, nuova.nome, nuova.classe, JSON.stringify(nuova.pacchetti), nuova.attiva]);
      if (note.length) await archivio.conAzienda(az.id, async st => {
        eng.registra({ st, utente: { email: 'piattaforma' } }, 'Licenza', note.join('; '));
        st.setProp('licenza:avviso', null);
      });
      return { codice: az.id, ...nuova };
    },

    async 'aziende.elimina'(p) {
      const az = await leggiAzienda(p.codice);
      if (!az) throw new ErroreUtente('Azienda non trovata.');
      if (p.conferma !== az.id) throw new ErroreUtente('Per confermare l\'eliminazione riscrivi esattamente il codice dell\'azienda.');
      await archivio.conAzienda(az.id, async () => {
        await db.tx(async t => {
          for (const tab of ['rows', 'props', 'files']) await t.query('delete from ' + tab + ' where tenant = $1', [az.id]);
          await t.query('delete from tenants where id = $1', [az.id]);
        });
      });
      archivio.dimentica(az.id);
      return { eliminata: true };
    },
  };

  async function admin(azione, par) {
    const f = Object.prototype.hasOwnProperty.call(AMMIN, azione) ? AMMIN[azione] : null;
    if (!f) throw new ErroreUtente('Operazione non riconosciuta.');
    return f(par && typeof par === 'object' ? par : {});
  }

  function chiaveValida(k) {
    if (!adminKey || typeof k !== 'string') return false;
    const a = crypto.createHash('sha256').update(k).digest();
    const b = crypto.createHash('sha256').update(adminKey).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // ---------- applicazione web ----------

  function rispostaErrore(res, e) {
    if (e && e.utente) return res.json({ ok: false, error: e.message, code: e.codice || undefined });
    console.error('Errore imprevisto:', e);
    res.json({ ok: false, error: 'Si è verificato un errore imprevisto. Riprova tra qualche istante.' });
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (req, res) => res.json({ ok: true }));

  app.post('/a/:azienda/run', async (req, res) => {
    try {
      const b = req.body || {};
      if (b.fn !== 'api') throw new ErroreUtente('Richiesta non valida.');
      res.json({ ok: true, data: await api(req.params.azienda, b.args, req.ip) });
    } catch (e) { rispostaErrore(res, e); }
  });

  app.post('/admin/api', async (req, res) => {
    if (!chiaveValida(req.get('X-Admin-Key'))) {
      await new Promise(r => setTimeout(r, 400)); // ritardo dopo una chiave errata
      return res.status(401).json({ ok: false, error: 'Chiave di amministrazione non valida.' });
    }
    try {
      const b = req.body || {};
      res.json({ ok: true, data: await admin(b.azione, b.parametri) });
    } catch (e) { rispostaErrore(res, e); }
  });

  app.use(express.static(path.join(__dirname, '..', 'app', 'public')));
  app.use((err, req, res, next) => { res.status(400).json({ ok: false, error: 'Richiesta non valida.' }); });

  return { api, admin, app, archivio, auth, SCHEMA };
}

module.exports = { creaSistema };

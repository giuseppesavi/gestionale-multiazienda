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
const firme = require('../app/firme');
const pin = require('../app/pin');
const regole = require('../app/regole');
const importa = require('../app/importa');
const esp = require('../app/esporta');
const stampe = require('../app/stampe');
const xlsx = require('./xlsx');
const crus = require('../app/cruscotto');

// Tipi di file ammessi negli allegati (il tipo è dedotto dall'estensione, non da quanto dichiara il browser).
const TIPI_FILE = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', heic: 'image/heic', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv',
};
const MAX_FILE = 15 * 1024 * 1024;

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
    if (st.prop('setup') >= 2) return;
    const ctx = ctxInterno(st, az);
    require('../app/rischi').predefiniti(ctx);   // metodi di valutazione e registri dei rischi iniziali
    if (st.prop('setup') >= 1) { st.setProp('setup', 2); return; }
    const logPrima = new Set(st.tabella('Log').keys());
    const presenti = new Set([...st.tabella('Elenchi').values()].map(r => r.categoria));
    for (const [categoria, valori] of Object.entries(ELENCHI)) {
      if (presenti.has(categoria)) continue;
      valori.forEach((valore, i) => eng.salva(ctx, 'Elenchi', { categoria, valore, ordine: i + 1 }));
    }
    if (!st.tabella('FattoriRischio').size) for (const [descrizione, riferimento] of FATTORI_RISCHIO) eng.salva(ctx, 'FattoriRischio', { descrizione, riferimento });
    if (!st.tabella('DomandeQualifica').size) DOMANDE_QUALIFICA.forEach((domanda, i) => eng.salva(ctx, 'DomandeQualifica', { domanda, ordine: i + 1 }));
    for (const r of [...st.tabella('Log').values()]) if (!logPrima.has(r.id)) st.togli('Log', r.id); // il setup non riempie il registro
    st.setProp('setup', 2);
  }

  // ---------- allegati ----------

  function servizi(st, az, utente, origine) {
    return {
      postino, origine: process.env.URL_PUBBLICO || origine || '',
      leggiFile: id => leggiContenuto(az.id, id),
      async salvaFile({ nome, mime, buffer, tipo, autore }) {
        const id = eng.nuovoId();
        await db.query('insert into files (tenant, id, nome, mime, dimensione, contenuto) values ($1, $2, $3, $4, $5, $6)', [az.id, id, nome, mime, buffer.length, buffer]);
        st.metti('FileReg', { id, nome, mime, tipo: tipo || 'allegato', createdBy: autore || (utente && utente.email) || 'sistema', createdAt: eng.adesso() });
        return id + '|' + nome;
      },
    };
  }

  async function leggiContenuto(azId, id) {
    const r = await db.query('select contenuto from files where tenant = $1 and id = $2', [azId, id]);
    return r.rows[0] ? Buffer.from(r.rows[0].contenuto) : null;
  }
  const comeFile = (nome, buffer) => ({ nome, base64: buffer.toString('base64') });
  function fileRicevuto(p) {
    if (typeof p.base64 !== 'string' || !p.base64) throw new ErroreUtente('Scegli il file da caricare.');
    const b = Buffer.from(p.base64, 'base64');
    if (!b.length || b.length > MAX_FILE) throw new ErroreUtente('Il file è vuoto oppure supera i 15 MB.');
    return b;
  }

  // Invia per e-mail il verbale di consegna DPI e annota la data.
  async function emailConsegna(ctx, p) {
    eng.esigi(ctx, 'Consegne', true);
    const c = ctx.st.tabella('Consegne').get(p.id);
    if (!c) throw new ErroreUtente('Consegna non trovata.');
    const cfg = eng.config(ctx.st);
    if (!cfg.emailDpi) throw new ErroreUtente('Nella configurazione dell\'azienda manca l\'indirizzo e-mail a cui inviare i verbali DPI.');
    const pdf = await stampe.genera(ctx, { nome: 'verbaleConsegna', id: c.id });
    const nome = eng.titolo(ctx, 'Dipendenti', ctx.st.tabella('Dipendenti').get(c.dipendenteId));
    const oggetto = String(cfg.oggettoDpi || 'CONSEGNA DPI {NOME} E {DATA}').replace('{NOME}', nome).replace('{DATA}', eng.dataIt(c.data));
    const ok = await postino.invia({ a: cfg.emailDpi, oggetto, testo: 'In allegato il verbale di consegna dei DPI a ' + nome + ' del ' + eng.dataIt(c.data) + '.', allegati: [{ filename: pdf.nome, content: pdf.buffer }] });
    if (!ok) return { _errore: 'L\'e-mail non è partita. Controlla la configurazione della posta e riprova.' };
    ctx.st.metti('Consegne', { ...c, emailInviata: eng.dataIt(eng.oggi()) });
    eng.registra(ctx, 'E-mail', 'Verbale DPI di ' + nome + ' inviato a ' + cfg.emailDpi);
    return { inviata: eng.dataIt(eng.oggi()) };
  }

  // Esportazione dei dati aziendali richiesta dall'amministratore dell'azienda (confermata con un codice via e-mail).
  async function esportaPerAzienda(codice, token, p) {
    const az = await leggiAzienda(codice);
    if (!az || !az.attiva) throw new ErroreUtente('Azienda non trovata o non attiva.', 'AZIENDA');
    const r = await archivio.conAzienda(az.id, async st => {
      const utente = auth.utenteDaToken(st, token);
      if (!utente) return { _errore: 'La sessione è scaduta. Accedi di nuovo.', _codice: 'SESSIONE' };
      if (!utente.admin) return { _errore: 'L\'esportazione dei dati è riservata agli amministratori.', _codice: 'PERMESSO' };
      if (!auth.controllaCodice(st, 'esporta:' + utente.email, p && p.codice)) return { _errore: 'Codice di conferma non valido o scaduto. Richiedine uno nuovo.' };
      const ctx = { st, utente, azienda: az, pacchetti: pacchettiDi(az), servizi: servizi(st, az, utente) };
      return esp.esportaAzienda(ctx, p || {}, id => leggiContenuto(az.id, id));
    });
    if (r && r._errore) throw new ErroreUtente(r._errore, r._codice);
    return r;
  }
  async function esportaDaPiattaforma(codice, p) {
    const az = await leggiAzienda(codice);
    if (!az) throw new ErroreUtente('Azienda non trovata.');
    return archivio.conAzienda(az.id, async st => esp.esportaAzienda(ctxInterno(st, az), p || {}, id => leggiContenuto(az.id, id)));
  }

  async function caricaFile(ctx, p) {
    const nome = String(p.nome || '').replace(/^.*[\\/]/, '').replace(/[|\u0000-\u001f]/g, '').trim().slice(0, 150);
    const est = (/\.([A-Za-z0-9]+)$/.exec(nome) || [])[1];
    const mime = est && TIPI_FILE[est.toLowerCase()];
    if (!nome || !mime) throw new ErroreUtente('Tipo di file non ammesso. Puoi caricare PDF, immagini, Word, Excel, ODT, ODS e CSV.');
    if (typeof p.base64 !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(p.base64)) throw new ErroreUtente('Il file non è stato ricevuto correttamente. Riprova.');
    const buffer = Buffer.from(p.base64, 'base64');
    if (!buffer.length) throw new ErroreUtente('Il file è vuoto.');
    if (buffer.length > MAX_FILE) throw new ErroreUtente('Il file supera la dimensione massima di 15 MB.');
    return { valore: await ctx.servizi.salvaFile({ nome, mime, buffer }) };
  }

  // Un file è scaricabile solo se appartiene a una scheda visibile all'utente,
  // oppure se l'ha caricato lui e non è ancora stato salvato in nessuna scheda.
  function fileVisibile(ctx, id) {
    const reg = ctx.st.tabella('FileReg').get(id);
    if (!reg) return false;
    let usato = false;
    const visibile = e => eng.entitaAttiva(ctx, e) && eng.puoLeggere(ctx, e);
    for (const E of Object.values(SCHEMA)) {
      if (E.name === 'Firme') continue;
      const campi = E.fields.filter(f => f.type === 'file');
      if (!campi.length) continue;
      for (const r of ctx.st.tabella(E.name).values()) {
        if (!campi.some(f => String(r[f.name] || '').split('|')[0] === id)) continue;
        usato = true;
        const madre = E.child ? ctx.st.tabella(E.parent).get(r[SCHEMA[E.parent].children.find(c => c.e === E.name).fk]) : r;
        if (madre && visibile(E.child ? E.parent : E.name) && eng.visibileRiga(ctx, E.child ? E.parent : E.name, madre)) return true;
      }
    }
    for (const f of ctx.st.tabella('Firme').values()) {
      if (String(f.fileId || '').split('|')[0] !== id) continue;
      usato = true;
      const scheda = SCHEMA[f.rifEntity] && ctx.st.tabella(f.rifEntity).get(f.rifId);
      if (scheda && visibile(f.rifEntity) && eng.visibileRiga(ctx, f.rifEntity, scheda)) return true;
    }
    return !usato && reg.createdBy === ctx.utente.email;
  }

  async function scaricaFile(codice, token, id) {
    const az = await leggiAzienda(codice);
    if (!az || !az.attiva) return null;
    const reg = await archivio.conAzienda(az.id, async st => {
      const utente = auth.utenteDaToken(st, token);
      if (!utente) return null;
      const ctx = { st, utente, azienda: az, pacchetti: pacchettiDi(az) };
      return fileVisibile(ctx, id) ? st.tabella('FileReg').get(id) : null;
    });
    if (!reg) return null;
    const r = await db.query('select contenuto from files where tenant = $1 and id = $2', [az.id, id]);
    return r.rows[0] ? { nome: reg.nome, mime: reg.mime, buffer: Buffer.from(r.rows[0].contenuto) } : null;
  }

  async function sessioneValida(codice, token) {
    const az = await leggiAzienda(codice);
    if (!az || !az.attiva) return false;
    return archivio.conAzienda(az.id, async st => !!auth.utenteDaToken(st, token));
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

  async function api(codice, args, ip, origine) {
    const [token, azione, par] = Array.isArray(args) ? args : [];
    const p = par && typeof par === 'object' ? par : {};
    const az = await leggiAzienda(codice);
    if (!az || !az.attiva) throw new ErroreUtente('Azienda non trovata o non attiva.', 'AZIENDA');
    try {
      const r = await archivio.conAzienda(az.id, async st => {
        prepara(st, az);
        if (azione === 'otp.richiedi') return auth.richiedi(st, az, p.email, ip);
        if (azione === 'otp.verifica') return auth.verifica(st, az, p.email, p.codice, ip);
        if (azione === 'firmalink.info' || azione === 'firmalink.firma') {
          const c = { st, utente: null, azienda: az, pacchetti: pacchettiDi(az), servizi: servizi(st, az, null, origine) };
          return azione === 'firmalink.info' ? firme.linkInfo(c, p.token) : firme.linkFirma(c, p);
        }
        const utente = auth.utenteDaToken(st, token);
        if (!utente) return { _errore: 'La sessione è scaduta. Accedi di nuovo.', _codice: 'SESSIONE' };
        const ctx = { st, utente, azienda: az, pacchetti: pacchettiDi(az), servizi: servizi(st, az, utente, origine) };
        const soloAdmin = () => { if (!utente.admin) throw new ErroreUtente('Operazione riservata agli amministratori.', 'PERMESSO'); };
        switch (azione) {
          case 'stampa': { const f = await stampe.genera(ctx, p); return comeFile(f.nome, f.buffer); }
          case 'esporta': { const f = esp.esporta(ctx, p); return comeFile(f.nome, xlsx.scrivi(f.fogli)); }
          case 'scheda.dipendente': return esp.schedaDipendente(ctx, p.id);
          case 'consegna.email': return emailConsegna(ctx, p);
          case 'import.modello': { const f = importa.modello(ctx, p.tipo); return comeFile(f.nome, xlsx.scrivi(f.fogli)); }
          case 'import.esegui': {
            let fogli;
            try { fogli = xlsx.leggi(fileRicevuto(p)); } catch (e) { if (e.utente) throw e; throw new ErroreUtente('Non riesco a leggere il file: usa il modello Excel (.xlsx) oppure un file .csv.'); }
            const rep = importa.esegui(ctx, p.tipo, fogli, !!p.prova);
            if (p.prova) throw { annulla: rep };   // la verifica non scrive nulla: tutte le modifiche vengono scartate
            return rep;
          }
          case 'esporta.richiedi': {
            soloAdmin();
            const { codice, minuti } = auth.nuovoCodice(st, 'esporta:' + utente.email);
            postino.invia({ a: utente.email, segreto: true, oggetto: 'Codice di conferma per l\'esportazione dei dati – ' + az.nome,
              testo: 'Il codice per confermare l\'esportazione dei dati aziendali è: ' + codice + '\n\nÈ valido per ' + minuti + ' minuti.\nSe non hai richiesto tu l\'esportazione, avvisa subito il fornitore del servizio.' }).catch(() => {});
            return { messaggio: 'Ti abbiamo inviato via e-mail un codice di conferma.' };
          }
          case 'azione': return regole.azione(ctx, p);
          case 'funzione': return regole.funzione(ctx, p);
          case 'firma': return firme.firma(ctx, p);
          case 'firma.scansione': return firme.scansione(ctx, p);
          case 'firma.link': return firme.inviaLink(ctx, p);
          case 'firma.annulla': return firme.annulla(ctx, p);
          case 'file.carica': return caricaFile(ctx, p);
          case 'pin.imposta': soloAdmin(); return pin.imposta(ctx, p.dipId, p.pin);
          case 'pin.cambia': {
            if (st.tabella('Dipendenti').get(utente.id).pinHash) {
              const err = pin.verifica(ctx, utente.id, p.attuale);
              if (err) return { _errore: err === 'PIN non corretto.' ? 'Il PIN attuale non è corretto.' : err };
            }
            if (!pin.pinValido(p.nuovo)) throw new ErroreUtente('Il PIN deve essere composto da 4 a 8 cifre.');
            return pin.imposta(ctx, utente.id, p.nuovo);
          }
          case 'accesso.sblocca': soloAdmin(); return pin.sblocca(ctx, p.dipId);
          case 'esci': return auth.esci(st, token);
          case 'cruscotto': return crus.cruscotto(ctx);
          case 'scadenzario': return crus.scadenzario(ctx, p);
          case 'config.leggi': return crus.configLeggi(ctx);
          case 'config.salva': return crus.configSalva(ctx, p);
          case 'pref.salva': {   // preferenze dell'utente (gruppi del menu fissati aperti)
            const menu = {};
            for (const [k, v] of Object.entries(p.menu && typeof p.menu === 'object' ? p.menu : {}).slice(0, 30)) menu[String(k).slice(0, 60)] = !!v;
            st.setProp('pref:' + utente.id, { menu });
            return { menu };
          }
          case 'avvio': return {
            utente, azienda: { codice: az.id, nome: az.nome },
            pacchetti: lic.PACCHETTI.filter(x => ctx.pacchetti.has(x.id)),
            licenza: lic.statoLicenza(st, az, eng.oggi()),
            schema: eng.schemaPerUtente(ctx), oggi: eng.oggi(),
            config: crus.configPubblica(ctx), elenchi: crus.elenchi(ctx), pref: st.prop('pref:' + utente.id) || {},
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
      if (e && e.annulla) return e.annulla;
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

    async 'stato'() { return { posta: !!postino.configurata, database: db.pglite ? 'In memoria (prova)' : 'PostgreSQL' }; },
    async 'posta.registro'() { return postino.registro || []; },
    async 'posta.prova'(p) {
      const a = String(p.a || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) throw new ErroreUtente('Indica un indirizzo e-mail valido.');
      return { inviata: await postino.invia({ a, oggetto: 'Prova di invio dal gestionale', testo: 'Questa è un\'e-mail di prova: se la leggi, la posta del gestionale funziona.' }) };
    },
    // Genera un codice di accesso per un utente (fase di prova, oppure posta non funzionante). Resta nel registro dell'azienda.
    async 'accesso.codice'(p) {
      const az = await leggiAzienda(p.codice);
      if (!az) throw new ErroreUtente('Azienda non trovata.');
      const email = String(p.email || '').trim().toLowerCase();
      return archivio.conAzienda(az.id, async st => {
        prepara(st, az);
        if (!auth.trovaUtente(st, email)) throw new ErroreUtente('Questo indirizzo non corrisponde a un utente abilitato dell\'azienda.');
        const r = auth.nuovoCodice(st, email);
        eng.registra({ st, utente: { email: 'piattaforma' } }, 'Accesso', 'Codice di accesso generato dalla piattaforma per ' + email);
        return r;
      });
    },
    async 'accesso.sblocca'(p) {
      const az = await leggiAzienda(p.codice);
      if (!az) throw new ErroreUtente('Azienda non trovata.');
      const email = String(p.email || '').trim().toLowerCase();
      return archivio.conAzienda(az.id, async st => {
        const d = auth.trovaUtente(st, email);
        if (!d) throw new ErroreUtente('Questo indirizzo non corrisponde a un utente abilitato dell\'azienda.');
        return pin.sblocca({ st, utente: { email: 'piattaforma' } }, d.id);
      });
    },

    async 'aziende.elenco'() {
      const nr = await db.query('select tenant, count(*)::int as n, coalesce(sum(length(data::text)), 0)::float8 as b from rows group by tenant');
      const nf = await db.query('select tenant, count(*)::int as n, coalesce(sum(dimensione), 0)::float8 as b from files group by tenant');
      const righeDi = new Map(nr.rows.map(x => [x.tenant, x])), fileDi = new Map(nf.rows.map(x => [x.tenant, x]));
      const r = await db.query('select id, nome, email_admin, classe, pacchetti, attiva, creato from tenants order by nome');
      const out = [];
      for (const az of r.rows) {
        const licenza = await archivio.conAzienda(az.id, async st => lic.statoLicenza(st, az, eng.oggi()));
        const r = righeDi.get(az.id) || { n: 0, b: 0 }, f = fileDi.get(az.id) || { n: 0, b: 0 };
        out.push({ codice: az.id, nome: az.nome, emailAdmin: az.email_admin, attiva: az.attiva, creato: az.creato, pacchetti: az.pacchetti, licenza, righe: r.n, file: f.n, spazio: Number(r.b) + Number(f.b) });
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

    // Ricrea un'azienda da un archivio esportato (dati-ripristino.json e, se presenti, gli allegati).
    async 'aziende.ripristina'(p) {
      const codice = String(p.codice || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(codice)) throw new ErroreUtente('Il codice azienda deve avere da 2 a 30 caratteri: lettere minuscole, numeri e trattini.');
      if (await leggiAzienda(codice)) throw new ErroreUtente('Esiste già un\'azienda con questo codice.');
      if (typeof p.archivio !== 'string' || !p.archivio) throw new ErroreUtente('Scegli l\'archivio .zip da ripristinare.');
      const { dati, allegati } = esp.leggiEsportazione(Buffer.from(p.archivio, 'base64'));
      const c = lic.classe(p.classe || dati.azienda.classe);
      if (!c) throw new ErroreUtente('Classe di dipendenti non valida.');
      const og = eng.oggi();
      const attivi = (dati.tabelle.Dipendenti || []).filter(d => !lic.cessato(d, og)).length;
      if (attivi > c.max) throw new ErroreUtente('L\'archivio contiene ' + attivi + ' addetti attivi: serve una classe più alta di ' + c.etichetta + '.');
      const pacchetti = normPacchetti(p.pacchetti || (dati.azienda.pacchetti || []).filter(lic.pacchettoValido));
      const admin = (dati.tabelle.Dipendenti || []).find(d => d.utente === 'SI' && d.ruolo === 'Amministratore');
      const registro = new Map((dati.tabelle.FileReg || []).map(f => [f.id, f]));
      await db.tx(async t => {
        await t.query('insert into tenants (id, nome, email_admin, classe, pacchetti) values ($1, $2, $3, $4, $5::jsonb)',
          [codice, String(p.nome || dati.azienda.nome || codice), admin ? admin.email : '', c.id, JSON.stringify(pacchetti)]);
        for (const [e, righe] of Object.entries(dati.tabelle)) for (const r of righe) {
          if (r && typeof r.id === 'string') await t.query('insert into rows (tenant, sheet, id, data) values ($1, $2, $3, $4::jsonb)', [codice, e, r.id, JSON.stringify(r)]);
        }
        await t.query('insert into props (tenant, key, value) values ($1, $2, $3::jsonb), ($1, $4, $5::jsonb)', [codice, 'config', JSON.stringify(dati.config || {}), 'setup', '1']);
        for (const a of allegati) {
          const f = registro.get(a.id);
          if (f) await t.query('insert into files (tenant, id, nome, mime, dimensione, contenuto) values ($1, $2, $3, $4, $5, $6)', [codice, a.id, f.nome, f.mime, a.contenuto.length, a.contenuto]);
        }
      });
      archivio.dimentica(codice);
      return { codice, tabelle: Object.keys(dati.tabelle).length, allegati: allegati.length };
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
  // Le richieste oltre 1 MB (caricamento di allegati) sono accettate solo con una sessione valida.
  app.use('/a/:azienda/run', async (req, res, next) => {
    try {
      const n = Number(req.get('content-length'));
      if (!Number.isFinite(n)) return res.status(411).json({ ok: false, error: 'Richiesta non valida.' });
      if (n <= 1024 * 1024) return next();
      if (n <= 22 * 1024 * 1024 && await sessioneValida(req.params.azienda, req.get('X-Session'))) return next();
      res.status(413).json({ ok: false, error: 'Richiesta troppo grande.' });
    } catch (e) { rispostaErrore(res, e); }
  });
  // Limite di frequenza per indirizzo IP (finestra di 5 minuti).
  const contatori = new Map();
  setInterval(() => { const ora = Date.now(); for (const [k, c] of contatori) if (c.fine < ora) contatori.delete(k); }, 5 * 60000).unref();
  const limite = max => (req, res, next) => {
    const k = max + '|' + req.ip, ora = Date.now();
    let c = contatori.get(k);
    if (!c || c.fine < ora) { c = { n: 0, fine: ora + 5 * 60000 }; contatori.set(k, c); }
    if (++c.n > max) return res.status(429).json({ ok: false, error: 'Troppe richieste in poco tempo. Riprova tra qualche minuto.' });
    next();
  };
  app.use(limite(Number(process.env.LIMITE_RICHIESTE) || 1500));
  app.use(['/admin/api', '/admin/esporta'], limite(60));
  app.use(express.json({ limit: '22mb' }));
  app.get('/health', (req, res) => res.json({ ok: true }));
  const pagina = nome => (req, res) => res.sendFile(path.join(__dirname, '..', 'app', 'public', nome));
  app.get(['/a/:azienda', '/a/:azienda/'], pagina('app.html'));
  app.get('/admin', pagina('admin.html'));

  app.post('/a/:azienda/run', async (req, res) => {
    try {
      const b = req.body || {};
      if (b.fn !== 'api') throw new ErroreUtente('Richiesta non valida.');
      res.json({ ok: true, data: await api(req.params.azienda, b.args, req.ip, req.protocol + '://' + req.get('host')) });
    } catch (e) { rispostaErrore(res, e); }
  });

  app.get('/a/:azienda/file/:id', async (req, res) => {
    try {
      const f = await scaricaFile(req.params.azienda, req.get('X-Session'), req.params.id);
      if (!f) return res.status(404).json({ ok: false, error: 'File non trovato o non accessibile.' });
      res.set({ 'Content-Type': f.mime, 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(f.nome), 'Cache-Control': 'private, no-store' });
      res.send(f.buffer);
    } catch (e) { rispostaErrore(res, e); }
  });

  const inviaZip = (res, f) => { res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="' + f.nome + '"', 'Cache-Control': 'private, no-store' }); res.send(f.buffer); };
  app.post('/a/:azienda/esporta', async (req, res) => {
    try { inviaZip(res, await esportaPerAzienda(req.params.azienda, req.get('X-Session'), req.body)); } catch (e) { rispostaErrore(res, e); }
  });
  app.post('/admin/esporta', async (req, res) => {
    if (!chiaveValida(req.get('X-Admin-Key'))) { await new Promise(r => setTimeout(r, 400)); return res.status(401).json({ ok: false, error: 'Chiave di amministrazione non valida.' }); }
    try { inviaZip(res, await esportaDaPiattaforma((req.body || {}).codice, req.body)); } catch (e) { rispostaErrore(res, e); }
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

  return { api, admin, app, archivio, auth, scaricaFile, esportaPerAzienda, esportaDaPiattaforma, SCHEMA };
}

module.exports = { creaSistema };

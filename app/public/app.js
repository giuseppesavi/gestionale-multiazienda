'use strict';
// Interfaccia del gestionale (pagina unica, senza framework). Le pagine speciali sono in pagine.js.
const G = window.G = {};
(() => {
  const AZ = decodeURIComponent(location.pathname.split('/')[2] || '');
  let TOKEN = '';
  try { TOKEN = sessionStorage.getItem('tk:' + AZ) || ''; } catch (e) { /* archivio del browser non disponibile */ }
  G.AZ = AZ; G.S = null; G.ETI = {}; G.OPZ = {}; G.PAGINE = {};

  // ---------- utilità ----------
  function h(tag, attr, ...figli) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attr || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const f of figli.flat(Infinity)) if (f !== null && f !== undefined && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
    return e;
  }
  const D = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || ''); };
  const lista = v => String(v || '').split(',').filter(Boolean);

  async function api(azione, par) {
    let r, j;
    try {
      r = await fetch('/a/' + encodeURIComponent(AZ) + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session': TOKEN }, body: JSON.stringify({ fn: 'api', args: [TOKEN, azione, par || {}] }) });
      j = await r.json();
    } catch (e) { throw new Error('Il collegamento con il server non è riuscito. Controlla la connessione e riprova.'); }
    if (!j.ok) {
      const e = new Error(j.error || 'Operazione non riuscita.'); e.code = j.code;
      if (j.code === 'SESSIONE' && G.S) { salvaToken(''); G.S = null; accesso(); }
      throw e;
    }
    if (j.data && j.data.etichette) Object.assign(G.ETI, j.data.etichette);
    return j.data;
  }
  function salvaToken(t) { TOKEN = t; try { if (t) sessionStorage.setItem('tk:' + AZ, t); else sessionStorage.removeItem('tk:' + AZ); } catch (e) { /* niente */ } }

  function toast(msg, tipo) {
    const d = h('div', { class: tipo || '' }, msg);
    document.getElementById('toast').append(d);
    setTimeout(() => d.remove(), tipo === 'err' ? 7000 : 3500);
  }
  const errore = e => toast(e.message || String(e), 'err');
  // Esegue un'operazione mostrando l'eventuale errore; il pulsante resta disattivato nel frattempo.
  async function prova(fn, btn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { errore(e); return undefined; } finally { if (btn) btn.disabled = false; }
  }

  function finestra(titolo, corpo, pulsanti, larga) {
    return new Promise(ok => {
      const chiudi = v => { velo.remove(); ok(v); };
      const velo = h('div', { class: 'velo' }, h('div', { class: 'finestra' + (larga ? ' larga' : ''), role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, titolo), corpo,
        h('div', { class: 'azioni' }, pulsanti.map(p => h('button', { class: p.classe || '', onclick: async e => { const v = p.fn ? await prova(() => p.fn(), e.currentTarget) : p.valore; if (v !== undefined) chiudi(v); } }, p.t)))));
      document.body.append(velo);
      const primo = velo.querySelector('input, select, textarea, canvas');
      if (primo && primo.focus) primo.focus();
    });
  }
  const conferma = (testo, si) => finestra('Conferma', h('p', {}, testo), [{ t: 'Annulla', valore: false }, { t: si || 'Conferma', classe: 'primario', valore: true }]);
  // Piccola maschera: campi = [{ k, l, tipo, opzioni, req, valore }]. Restituisce i valori oppure null.
  function chiedi(titolo, campi, testoOk) {
    const el = {};
    const corpo = h('div', {}, campi.map(c => {
      let i;
      if (c.tipo === 'textarea') i = h('textarea', {});
      else if (c.tipo === 'select') i = h('select', {}, c.opzioni.map(o => h('option', { value: Array.isArray(o) ? o[0] : o }, Array.isArray(o) ? o[1] : o)));
      else if (c.tipo === 'check') i = h('input', { type: 'checkbox' });
      else if (c.tipo === 'nota') return h('p', { class: 'tenue' }, c.l);
      else i = h('input', { type: c.tipo || 'text', inputmode: c.inputmode, autocomplete: 'off' });
      if (c.tipo === 'check') i.checked = !!c.valore; else if (c.valore !== undefined) i.value = c.valore;
      el[c.k] = i;
      return h('div', { class: 'campo riga' }, h('label', {}, c.l, c.req ? h('span', { class: 'obbl' }, ' *') : null), i);
    }));
    return finestra(titolo, corpo, [{ t: 'Annulla', valore: null }, { t: testoOk || 'Conferma', classe: 'primario', fn: () => {
      const v = {};
      for (const c of campi) { if (!el[c.k]) continue; v[c.k] = c.tipo === 'check' ? el[c.k].checked : el[c.k].value.trim(); if (c.req && !v[c.k]) throw new Error('Compila il campo «' + c.l + '».'); }
      return v;
    } }]);
  }

  function scarica(nome, base64, mime) {
    const bin = atob(base64), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    salvaBlob(nome, new Blob([b], { type: mime || 'application/octet-stream' }));
  }
  function salvaBlob(nome, blob) {
    const url = URL.createObjectURL(blob), a = h('a', { href: url, download: nome });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function scaricaFile(valore) {
    const [id, nome] = String(valore).split('|');
    const r = await fetch('/a/' + encodeURIComponent(AZ) + '/file/' + encodeURIComponent(id), { headers: { 'X-Session': TOKEN } });
    if (!r.ok) throw new Error('Il file non è disponibile.');
    salvaBlob(nome || 'file', await r.blob());
  }
  function leggiFile(file) {
    return new Promise((ok, ko) => {
      if (file.size > 15 * 1024 * 1024) return ko(new Error('Il file supera la dimensione massima di 15 MB.'));
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1] || '');
      fr.onerror = () => ko(new Error('Non riesco a leggere il file.'));
      fr.readAsDataURL(file);
    });
  }
  async function stampa(nome, par) { const f = await api('stampa', { nome, ...par }); scarica(f.nome, f.base64, 'application/pdf'); toast('PDF pronto: ' + f.nome, 'ok'); }

  const ROSSO = /scadut|non conforme|non qualificato|mancante|bloccat|non idoneo|^aperta$|annullata|mai |critico|ritirato|^chiuso$|non efficace/i;
  const GIALLO = /in scadenza|avviso|in gestione|in corso|al limite|da firmare|da valutare|bozza|in approvazione|link inviato|proposta|prescrizioni|limitazioni|superat/i;
  const VERDE = /regolare|valida|^conforme$|chiusa|in vigore|qualificato|attivo|firmata|^idoneo$|svolta|efficace|attestato/i;
  function badge(v) { v = String(v ?? ''); if (!v) return ''; return h('span', { class: 'badge ' + (ROSSO.test(v) ? 'rosso' : GIALLO.test(v) ? 'giallo' : VERDE.test(v) ? 'verde' : '') }, v); }
  const STATI = /^(stato|esito|qualifica|giudizio|corrente)/i;

  // Valore di un campo come testo leggibile.
  function mostra(f, v) {
    if (v === '' || v === null || v === undefined) return '';
    if (f.type === 'ref') return G.ETI[v] || '';
    if (f.type === 'multiref') return lista(v).map(i => G.ETI[i] || '').filter(Boolean).join(', ');
    if (f.type === 'date') return D(v);
    if (f.type === 'datetime') return D(String(v).slice(0, 10)) + ' ' + new Date(v).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (f.type === 'bool') return v === 'SI' ? 'Sì' : 'No';
    if (f.type === 'file') return String(v).split('|')[1] || '';
    if (f.type === 'number') return String(v).replace('.', ',');
    return String(v);
  }
  async function opzioni(e) {
    if (!G.OPZ[e]) { G.OPZ[e] = api('opzioni', { entita: e }).then(l => { for (const o of l) G.ETI[o.id] = o.titolo; return l; }).catch(() => []); }
    return G.OPZ[e];
  }
  function tabella(colonne, righe, suClic, vuoto) {
    if (!righe.length) return h('p', { class: 'tenue' }, vuoto || 'Nessun dato.');
    return h('div', { class: 'scorri' }, h('table', {}, h('thead', {}, h('tr', {}, colonne.map(c => h('th', {}, c.l)))),
      h('tbody', {}, righe.map(r => h('tr', { class: suClic ? 'clic' : '', onclick: suClic ? () => suClic(r) : null }, colonne.map(c => h('td', { class: c.classe || '' }, c.v(r))))))));
  }

  // ---------- accesso ----------
  function accesso() {
    const root = document.getElementById('app');
    root.className = 'centro';
    const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'nome@azienda.it' });
    const codice = h('input', { class: 'codice', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', placeholder: '······' });
    const passo2 = h('div', { class: 'nascosto' }, h('p', {}, 'Scrivi il codice di 6 cifre che hai ricevuto via e-mail.'), h('div', { class: 'riga' }, codice),
      h('button', { onclick: () => { passo2.classList.add('nascosto'); passo1.classList.remove('nascosto'); } }, 'Cambia indirizzo'));
    const invia = async e => { await prova(async () => { const r = await api('otp.richiedi', { email: email.value.trim() }); toast(r.messaggio); passo1.classList.add('nascosto'); passo2.classList.remove('nascosto'); codice.value = ''; codice.focus(); }, e && e.currentTarget); };
    const passo1 = h('div', {}, h('p', {}, 'Scrivi la tua e-mail: riceverai un codice per entrare, senza password.'), h('div', { class: 'riga' }, email), h('button', { class: 'primario', onclick: invia }, 'Invia il codice'));
    email.addEventListener('keydown', e => { if (e.key === 'Enter') invia(); });
    // Con 6 cifre inserite l'accesso parte da solo.
    codice.addEventListener('input', async () => {
      codice.value = codice.value.replace(/\D/g, '');
      if (codice.value.length !== 6) return;
      codice.disabled = true;
      try { const r = await api('otp.verifica', { email: email.value.trim(), codice: codice.value }); salvaToken(r.token); await avvia(); }
      catch (e) { errore(e); codice.disabled = false; codice.value = ''; codice.focus(); }
    });
    root.replaceChildren(h('div', { class: 'scatola' }, h('h1', {}, 'Gestionale Sicurezza & Qualità'), passo1, passo2));
    email.focus();
  }

  // ---------- struttura e menu ----------
  const MENU = [
    { g: 'Generale', voci: [['#/', 'Cruscotto'], ['#/p/scadenzario', 'Scadenzario'], ['#/p/scheda', 'Scheda dipendente']] },
    { g: 'Documentazione', voci: [['#/p/miei', 'I miei documenti', 'Documenti'], ['Documenti'], ['PreseVisione'], ['#/p/import/documenti', 'Importa elenco documenti', 'Documenti', true]] },
    { g: 'Sorveglianza sanitaria', voci: [['SorveglianzaSanitaria', 'Visite'], ['#/p/sanitario', 'Registro', 'SorveglianzaSanitaria']] },
    { g: 'Registrazioni', voci: [['Consegne'], ['Corsi'], ['ValutazioniCompetenze'], ['NC'], ['Azioni'], ['#/p/riepilogoNc', 'Riepilogo NC e azioni', 'NC'], ['Manutenzioni'], ['#/p/massiva', 'Manutenzione massiva per sede', 'Manutenzioni'],
      ['#/p/import/formazione', 'Importa formazione storica', 'Corsi', true], ['#/p/import/nc', 'Importa NC', 'NC', true]] },
    { g: 'Rischi e opportunità', voci: [['#/p/rischi', 'Registri e valutazioni', 'Rischi'], ['#/p/metodi', 'Metodi di valutazione', 'MetodiRischio'], ['RegistriRischio'], ['Processi']] },
    { g: 'Anagrafiche', voci: [['Dipendenti'], ['Mansioni'], ['Competenze'], ['TipiDpi'], ['TipiCorso'], ['Soggetti'], ['FattoriRischio'], ['#/p/import/dipendenti', 'Importa dipendenti', 'Dipendenti', true], ['#/p/import/soggetti', 'Importa clienti/fornitori', 'Soggetti', true]] },
    { g: 'Fornitori', voci: [['QualificheFornitori', 'Qualifiche'], ['#/p/qualificati', 'Elenco qualificati', 'QualificheFornitori'], ['DomandeQualifica', 'Domande qualifica']] },
    { g: 'Strumenti di misura', voci: [['Strumenti', 'Strumenti'], ['Tarature'], ['#/p/registroStrumenti', 'Registro strumenti', 'Strumenti']] },
    { g: 'Attrezzature', voci: [['Attrezzature'], ['Sedi'], ['TipiAttrezzatura'], ['PianiManutenzione'], ['#/p/import/attrezzature', 'Importa attrezzature', 'Attrezzature', true]] },
    { g: 'Configurazione', voci: [['#/p/config', 'Dati azienda e logo', null, true], ['Elenchi'], ['Firme'], ['Log'], ['#/p/esporta', 'Esporta dati', null, true]] },
  ];
  function vociMenu() {
    const S = G.S, out = [];
    for (const g of MENU) {
      const voci = [];
      for (const v of g.voci) {
        if (v[0].startsWith('#')) { if ((v[2] && !S.schema[v[2]]) || (v[3] && !S.utente.admin)) continue; voci.push({ href: v[0], t: v[1] }); }
        else if (S.schema[v[0]] && !S.schema[v[0]].child) voci.push({ href: '#/e/' + v[0], t: v[1] || S.schema[v[0]].label });
      }
      if (voci.length) out.push({ g: g.g, voci });
    }
    return out;
  }
  function disegnaMenu() {
    const nav = document.querySelector('.menu'); if (!nav) return;
    const qui = location.hash.split('?')[0] || '#/', pref = G.S.pref.menu || {};
    const base = qui.replace(/^(#\/e\/[^/]+).*$/, '$1');
    nav.replaceChildren(...vociMenu().map(g => {
      const mia = g.voci.some(v => v.href === base);
      const aperto = mia || (pref[g.g] !== undefined ? pref[g.g] : ['Generale', 'Registrazioni'].includes(g.g));
      const box = h('div', { class: 'gruppo' + (aperto ? '' : ' chiuso') },
        h('div', { class: 'tit' }, h('button', { class: 'tit', 'aria-expanded': String(aperto), onclick: () => box.classList.toggle('chiuso') }, h('span', {}, g.g)),
          h('button', { class: 'pin' + (pref[g.g] ? ' attivo' : ''), title: 'Tieni aperto questo gruppo', 'aria-label': 'Tieni aperto ' + g.g, onclick: async e => {
            pref[g.g] = !pref[g.g]; G.S.pref.menu = pref; e.currentTarget.classList.toggle('attivo', pref[g.g]);
            api('pref.salva', { menu: pref }).catch(() => {});
          } }, '📌')),
        g.voci.map(v => h('a', { href: v.href, class: v.href === base ? 'attiva' : '' }, v.t)));
      return box;
    }));
  }
  function struttura() {
    const S = G.S, root = document.getElementById('app');
    root.className = 'app';
    document.documentElement.style.setProperty('--c', S.config.colore || '#1F4E79');
    document.title = S.config.ragioneSociale + ' – Gestionale';
    const nav = h('nav', { class: 'menu', 'aria-label': 'Menu principale' });
    root.replaceChildren(
      h('header', { class: 'testata' }, h('button', { id: 'hamb', 'aria-label': 'Apri il menu', onclick: () => nav.classList.toggle('aperto') }, '☰'), h('div', { class: 'nome' }, S.config.ragioneSociale),
        h('div', { class: 'utente' }, S.utente.nome),
        h('button', { title: 'Cambia il tuo PIN di firma', onclick: cambiaPin }, 'PIN'),
        h('button', { onclick: async () => { await api('esci').catch(() => {}); salvaToken(''); G.S = null; accesso(); } }, 'Esci')),
      nav, h('main', { id: 'main', tabindex: '-1' }));
    nav.addEventListener('click', e => { if (e.target.closest('a')) nav.classList.remove('aperto'); });
  }
  async function cambiaPin() {
    const v = await chiedi('Il tuo PIN di firma', [{ k: 'attuale', l: 'PIN attuale (lascia vuoto se non l\'hai mai impostato)', tipo: 'password', inputmode: 'numeric' }, { k: 'nuovo', l: 'Nuovo PIN (da 4 a 8 cifre)', tipo: 'password', inputmode: 'numeric', req: true }], 'Salva il PIN');
    if (v) await prova(async () => { await api('pin.cambia', v); toast('PIN aggiornato.', 'ok'); });
  }

  async function avvia() {
    G.S = await api('avvio');
    G.OPZ = {};
    struttura();
    naviga();
  }
  async function naviga() {
    if (!G.S) return;
    disegnaMenu();
    const main = document.getElementById('main');
    const [percorso, query] = (location.hash || '#/').slice(1).split('?');
    const parti = percorso.split('/').filter(Boolean).map(decodeURIComponent);
    const par = Object.fromEntries(new URLSearchParams(query || ''));
    main.replaceChildren(h('p', { class: 'tenue' }, 'Caricamento…'));
    try {
      let nodo;
      if (!parti.length) nodo = await G.PAGINE.cruscotto(par);
      else if (parti[0] === 'e' && parti[2]) nodo = await scheda(parti[1], parti[2], par);
      else if (parti[0] === 'e') nodo = await elenco(parti[1]);
      // collegamenti dei QR code: #/Entita/id
      else if (G.S.schema[parti[0]] && parti[1]) nodo = await scheda(parti[0], parti[1], par);
      else if (parti[0] === 'p' && G.PAGINE[parti[1]]) nodo = await G.PAGINE[parti[1]](par, parti.slice(2));
      else nodo = h('p', {}, 'Pagina non trovata.');
      main.replaceChildren(nodo);
      main.scrollTop = 0;
    } catch (e) { main.replaceChildren(h('div', { class: 'avviso rosso' }, e.message || String(e))); }
  }
  const vai = hash => { if (location.hash === hash) naviga(); else location.hash = hash; };

  // ---------- elenco ----------
  async function elenco(e) {
    const E = G.S.schema[e];
    if (!E || E.child) throw new Error('Questa sezione non è disponibile per la tua azienda.');
    const d = await api('elenco', { entita: e });
    const col = E.fields.filter(f => f.inList);
    const filtri = col.filter(f => f.filter && f.type !== 'bool');
    const cerca = h('input', { type: 'search', placeholder: 'Cerca…', 'aria-label': 'Cerca' });
    const sel = filtri.map(f => {
      const valori = [...new Set(d.righe.map(r => r[f.name]).filter(Boolean))].sort();
      return h('select', { 'aria-label': f.label, 'data-campo': f.name }, h('option', { value: '' }, f.label + ': tutti'), valori.map(v => h('option', { value: v }, v)));
    });
    let ordine = null, verso = 1;
    const corpo = h('div', {});
    const disegna = () => {
      const q = cerca.value.trim().toLowerCase();
      let righe = d.righe.filter(r => sel.every(s => !s.value || r[s.dataset.campo] === s.value) && (!q || col.some(f => mostra(f, r[f.name]).toLowerCase().includes(q)) || String(r._titolo).toLowerCase().includes(q)));
      const chiave = r => String(ordine.type === 'date' ? (r[ordine.name] || '') : mostra(ordine, r[ordine.name]));
      if (ordine) righe = [...righe].sort((a, b) => verso * chiave(a).localeCompare(chiave(b), 'it', { numeric: true }));
      const t = tabella(col.map(f => ({ l: f.label, v: r => (STATI.test(f.name) && f.type !== 'bool' ? badge(mostra(f, r[f.name])) : mostra(f, r[f.name])) })), righe, r => vai('#/e/' + e + '/' + r.id), 'Nessuna scheda trovata.');
      t.querySelectorAll('th').forEach((th, i) => { th.classList.add('ord'); th.title = 'Ordina'; th.addEventListener('click', () => { if (ordine === col[i]) verso = -verso; else { ordine = col[i]; verso = 1; } disegna(); }); });
      corpo.replaceChildren(h('p', { class: 'tenue' }, righe.length + (righe.length === 1 ? ' scheda' : ' schede')), t);
    };
    cerca.addEventListener('input', disegna); sel.forEach(s => s.addEventListener('change', disegna));
    disegna();
    return h('div', {}, h('h1', {}, E.label), h('div', { class: 'barra' }, cerca, sel, h('span', { class: 'spazio' }),
      d.puoScrivere && !G.SOLO_PAGINA[e] ? h('button', { class: 'primario', onclick: () => vai('#/e/' + e + '/nuovo') }, '＋ Nuovo') : null), corpo);
  }
  // Entità che si creano solo dalle pagine dedicate.
  G.SOLO_PAGINA = { Rischi: '#/p/rischi', MetodiRischio: '#/p/metodi', Firme: 1, Log: 1 };

  // ---------- scheda ----------
  function controllo(f, v, imposta, bloccato) {
    const E = G.S.elenchi;
    if (f.virtual || f.type === 'auto' || f.type === 'datetime' || (bloccato && f.type !== 'file') || (f.ro && f.type !== 'file')) {
      const t = mostra(f, v);
      return h('div', { class: 'sola' }, STATI.test(f.name) && t && f.type !== 'bool' ? badge(t) : (t || '—'));
    }
    const su = (el, ev) => { el.addEventListener(ev || 'change', () => imposta(el.type === 'checkbox' ? (el.checked ? 'SI' : 'NO') : el.value)); return el; };
    switch (f.type) {
      case 'textarea': return su(h('textarea', { value: v ?? '' }), 'input');
      case 'bool': { const c = h('input', { type: 'checkbox' }); c.checked = v === 'SI'; return su(c); }
      case 'select': case 'list': {
        const op = f.type === 'select' ? f.options : (E[f.list] || []);
        const tutti = v && !op.includes(v) ? [...op, v] : op;
        return su(h('select', { value: v ?? '' }, h('option', { value: '' }, '—'), tutti.map(o => h('option', { value: o, selected: o === v }, o))));
      }
      case 'ref': {
        const op = G.OPZC[f.ref] || [];
        const s = h('select', {}, h('option', { value: '' }, '—'), op.map(o => h('option', { value: o.id, selected: o.id === v }, o.titolo)));
        if (v && !op.some(o => o.id === v)) s.append(h('option', { value: v, selected: true }, G.ETI[v] || '(non disponibile)'));
        return su(s);
      }
      case 'multiref': {
        const scelti = new Set(lista(v)), op = G.OPZC[f.ref] || [];
        const box = h('div', { class: 'multi' }, op.length ? op.map(o => { const c = h('input', { type: 'checkbox', value: o.id }); c.checked = scelti.has(o.id);
          c.addEventListener('change', () => { if (c.checked) scelti.add(o.id); else scelti.delete(o.id); imposta([...scelti].join(',')); }); return h('label', {}, c, o.titolo); }) : h('span', { class: 'tenue' }, 'Nessuna voce disponibile.'));
        return box;
      }
      case 'file': {
        const box = h('div', { class: 'filecampo' });
        const disegna = val => {
          const inp = h('input', { type: 'file', class: 'nascosto' });
          inp.addEventListener('change', () => prova(async () => { const fl = inp.files[0]; if (!fl) return; const r = await api('file.carica', { nome: fl.name, base64: await leggiFile(fl) }); imposta(r.valore); disegna(r.valore); toast('File caricato: ricordati di salvare la scheda.'); }));
          box.replaceChildren(val ? h('button', { class: 'piccolo', type: 'button', onclick: e => prova(() => scaricaFile(val), e.currentTarget) }, '⬇ ' + (String(val).split('|')[1] || 'file')) : h('span', { class: 'tenue' }, 'Nessun file'),
            bloccato || f.ro ? null : [inp, h('button', { class: 'piccolo', type: 'button', onclick: () => inp.click() }, val ? 'Sostituisci' : 'Carica file'), val ? h('button', { class: 'piccolo', type: 'button', onclick: () => { imposta(''); disegna(''); } }, 'Togli') : null]);
        };
        disegna(v);
        return box;
      }
      default: return su(h('input', { type: f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text', step: f.type === 'number' ? 'any' : null, value: v ?? '' }), 'input');
    }
  }
  const visibile = (f, dati) => !f.showIf || Object.entries(f.showIf).every(([k, a]) => (Array.isArray(a) ? a.includes(dati[k] ?? '') : (dati[k] ?? '') === a));
  const predef = f => (f.def === undefined ? (f.type === 'bool' ? 'NO' : '') : f.def === 'today' ? G.S.oggi : f.def === 'me' ? G.S.utente.id : f.def);

  async function scheda(e, id, par) {
    const E = G.S.schema[e];
    if (!E || E.child) throw new Error('Questa sezione non è disponibile per la tua azienda.');
    const nuovo = id === 'nuovo';
    const d = nuovo ? { riga: {}, figli: {}, puoScrivere: E.puoScrivere, firme: null, firmata: false } : await api('leggi', { entita: e, id });
    const dati = { ...d.riga };
    if (nuovo) { for (const f of E.fields) if (!f.virtual) dati[f.name] = par[f.name] !== undefined && f.type !== 'hidden' ? par[f.name] : predef(f); }
    const figli = {};
    for (const c of E.children) figli[c.e] = (d.figli[c.e] || []).map(r => ({ ...r }));
    // Voci dei menu a tendina dei collegamenti (scheda e griglie).
    const rifs = new Set();
    for (const f of E.fields) if (f.ref && f.type !== 'fk') rifs.add(f.ref);
    for (const c of E.children) for (const f of G.S.schema[c.e].fields) if (f.ref && f.type !== 'fk') rifs.add(f.ref);
    G.OPZC = {};
    await Promise.all([...rifs].map(async r => { G.OPZC[r] = await opzioni(r); }));
    const bloccato = !d.puoScrivere || d.firmata || !!G.SOLO_PAGINA[e];

    const involucri = [];
    const aggiornaVis = () => { for (const [f, el] of involucri) el.classList.toggle('nascosto', !visibile(f, dati)); };
    const griglia = h('div', { class: 'griglia' }, E.fields.filter(f => f.type !== 'fk').map(f => {
      const el = h('div', { class: 'campo' + (f.w === 'full' || f.type === 'multiref' ? ' pieno' : '') }, h('label', {}, f.label, f.req ? h('span', { class: 'obbl' }, ' *') : null),
        controllo(f, dati[f.name], v => { dati[f.name] = v; aggiornaVis(); }, bloccato));
      involucri.push([f, el]);
      return el;
    }));
    aggiornaVis();

    // Griglie dei figli.
    const sezFigli = E.children.map(c => {
      const C = G.S.schema[c.e], campi = C.fields.filter(f => f.type !== 'fk');
      const box = h('div', {});
      const disegna = () => {
        const righe = figli[c.e];
        box.replaceChildren(h('div', { class: 'scorri figli' }, h('table', {}, h('thead', {}, h('tr', {}, campi.map(f => h('th', {}, f.label, f.req ? ' *' : '')), bloccato ? null : h('th', {}, ''))),
          h('tbody', {}, righe.length ? righe.map((r, i) => h('tr', {}, campi.map(f => h('td', {}, visibile(f, r) ? controllo(f, r[f.name], v => { const cambia = campi.some(x => x.showIf && x.showIf[f.name] !== undefined); r[f.name] = v; if (cambia) disegna(); }, bloccato) : '')),
            bloccato ? null : h('td', { class: 'stretto' }, h('button', { class: 'piccolo pericolo', type: 'button', 'aria-label': 'Togli la riga', onclick: () => { righe.splice(i, 1); disegna(); } }, '✕'))))
            : h('tr', {}, h('td', { colspan: String(campi.length + 1), class: 'tenue' }, 'Nessuna riga.'))))),
          bloccato ? null : h('div', { class: 'barra' }, h('button', { class: 'piccolo', type: 'button', onclick: () => { const r = {}; for (const f of campi) if (!f.virtual) r[f.name] = predef(f); righe.push(r); disegna(); } }, '＋ Aggiungi riga')));
      };
      disegna();
      return { c, disegna, nodo: h('div', { class: 'card' }, h('h2', {}, c.l), box) };
    });

    const raccogli = () => {
      const out = { dati: {}, figli: {} };
      if (!nuovo) out.dati.id = id;
      for (const f of E.fields) if (!f.virtual && f.type !== 'fk' && f.type !== 'datetime') out.dati[f.name] = dati[f.name] ?? '';
      for (const c of E.children) out.figli[c.e] = figli[c.e].map(r => { const o = r.id ? { id: r.id } : {}; for (const f of G.S.schema[c.e].fields) if (!f.virtual && f.type !== 'fk') o[f.name] = r[f.name] ?? ''; return o; });
      return out;
    };
    const salva = async () => {
      const r = await api('salva', { entita: e, ...raccogli() });
      delete G.OPZ[e];
      toast('Scheda salvata.', 'ok');
      if (nuovo) vai('#/e/' + e + '/' + r.riga.id); else naviga();
      return r;
    };
    // Contesto passato ai pulsanti delle azioni (in pagine.js).
    const F = { e, id: nuovo ? null : id, nuovo, dati, d, bloccato, salva, ricarica: naviga,
      impostaFigli(nomeFiglio, righe) { figli[nomeFiglio] = righe; const s = sezFigli.find(x => x.c.e === nomeFiglio); if (s) s.disegna(); } };
    const azioni = (G.AZIONI[e] || []).filter(a => (!a.salvata || !nuovo) && (!a.nuova || !bloccato) && (!a.admin || G.S.utente.admin) && (!a.se || a.se(F)))
      .map(a => h('button', { type: 'button', onclick: ev => prova(() => a.fn(F), ev.currentTarget) }, a.t));

    return h('div', {}, h('div', { class: 'barra' }, h('button', { onclick: () => vai(G.SOLO_PAGINA[e] && typeof G.SOLO_PAGINA[e] === 'string' ? G.SOLO_PAGINA[e] : '#/e/' + e) }, '← Elenco'), h('h1', {}, nuovo ? 'Nuova scheda – ' + E.label : (d.titolo || E.label))),
      d.firmata ? h('div', { class: 'avviso' }, 'Questa scheda è firmata: è in sola lettura. Per modificarla un amministratore deve prima annullare le firme.') : null,
      G.SOLO_PAGINA[e] && typeof G.SOLO_PAGINA[e] === 'string' ? h('div', { class: 'avviso' }, 'Questa scheda si modifica dalla pagina dedicata. ', h('a', { href: G.SOLO_PAGINA[e] }, 'Apri la pagina')) : null,
      h('div', { class: 'card' }, griglia), sezFigli.map(s => s.nodo),
      h('div', { class: 'barra' }, bloccato ? null : h('button', { class: 'primario', onclick: ev => prova(salva, ev.currentTarget) }, 'Salva'), azioni, h('span', { class: 'spazio' }),
        !nuovo && d.puoScrivere && G.S.utente.admin && !G.SOLO_PAGINA[e] ? h('button', { class: 'pericolo', onclick: async ev => { if (await conferma('Eliminare definitivamente questa scheda?', 'Elimina')) await prova(async () => { await api('elimina', { entita: e, id }); delete G.OPZ[e]; toast('Scheda eliminata.', 'ok'); vai('#/e/' + e); }, ev.currentTarget); } }, 'Elimina') : null),
      d.firme && d.firme.length ? riquadroFirme(e, id, d.firme) : null,
      !nuovo && d.riga.updatedAt ? h('p', { class: 'tenue' }, 'Aggiornato il ' + mostra({ type: 'datetime' }, d.riga.updatedAt)) : null);
  }

  // ---------- firme ----------
  function tavoletta() {
    const c = h('canvas', { class: 'firma', width: '900', height: '300', 'aria-label': 'Riquadro per la firma' });
    const x = c.getContext('2d');
    x.lineWidth = 3.5; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#14285a';
    let giu = false;
    const punto = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener('pointerdown', e => { giu = true; c.setPointerCapture(e.pointerId); x.beginPath(); x.moveTo(...punto(e)); e.preventDefault(); });
    c.addEventListener('pointermove', e => { if (!giu) return; x.lineTo(...punto(e)); x.stroke(); });
    c.addEventListener('pointerup', () => { giu = false; });
    c.pulisci = () => x.clearRect(0, 0, c.width, c.height);
    return c;
  }
  async function firmaDisegnata(titolo) {
    const c = tavoletta();
    return finestra(titolo, h('div', {}, h('p', { class: 'tenue' }, 'Firma con il dito o con il mouse nel riquadro.'), c), [{ t: 'Annulla', valore: null }, { t: 'Cancella', fn: () => { c.pulisci(); } }, { t: 'Conferma la firma', classe: 'primario', valore: undefined, fn: () => c.toDataURL('image/png') }]);
  }
  function riquadroFirme(e, id, firme) {
    const box = h('div', { class: 'card firme' });
    const esegui = async (azione, par, btn) => { const r = await prova(() => api(azione, { entita: e, id, ...par }), btn); if (r) { toast('Firma registrata.', 'ok'); naviga(); } };
    const ETICHETTE = { credenziali: 'Firma con le mie credenziali', pin: 'PIN del dipendente', disegno: 'Firma su schermo', scansione: 'Scansione cartacea', link: 'Invia link via e-mail' };
    box.append(h('h2', {}, 'Firme'), ...firme.map(s => h('div', { class: 'voce' },
      h('div', { class: 'chi' }, h('strong', {}, s.ruolo), ' – ', s.nome, s.esterno ? ' (esterno)' : '', h('br'), badge(s.stato), s.metodo ? h('span', { class: 'tenue' }, ' ' + s.metodo + (s.dataFirma ? ', ' + D(s.dataFirma.slice(0, 10)) : '')) : null),
      s.metodi.map(m => h('button', { class: 'piccolo' + (m === 'credenziali' ? ' primario' : ''), onclick: async ev => {
        const btn = ev.currentTarget;
        if (m === 'credenziali') { if (await conferma('Confermi di firmare come ' + s.ruolo + '?', 'Firma')) esegui('firma', { key: s.key, metodo: 'credenziali' }, btn); }
        else if (m === 'pin') { const v = await chiedi('PIN di ' + s.nome, [{ k: 'pin', l: 'PIN di firma', tipo: 'password', inputmode: 'numeric', req: true }], 'Firma'); if (v) esegui('firma', { key: s.key, metodo: 'pin', pin: v.pin }, btn); }
        else if (m === 'disegno') { const img = await firmaDisegnata('Firma di ' + s.nome); if (img) esegui('firma', { key: s.key, metodo: 'disegno', immagine: img }, btn); }
        else if (m === 'link') { const r = await prova(() => api('firma.link', { entita: e, id, key: s.key }), btn); if (r) { toast('Link inviato via e-mail.', 'ok'); naviga(); } }
        else if (m === 'scansione') {
          const inp = h('input', { type: 'file', accept: '.pdf,image/*' });
          const mancanti = firme.filter(x => x.metodi.includes('scansione'));
          const caselle = mancanti.map(x => { const c = h('input', { type: 'checkbox', value: x.key }); c.checked = x.key === s.key; return h('label', {}, c, x.ruolo + ' – ' + x.nome); });
          const ok = await finestra('Scansione del documento firmato', h('div', {}, h('p', { class: 'tenue' }, 'Carica il PDF o la foto del documento firmato su carta e indica per chi vale.'), h('div', { class: 'riga' }, inp), h('div', { class: 'multi' }, caselle)),
            [{ t: 'Annulla', valore: null }, { t: 'Registra le firme', classe: 'primario', fn: async () => {
              const keys = caselle.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.value);
              if (!inp.files[0]) throw new Error('Scegli il file della scansione.');
              if (!keys.length) throw new Error('Scegli almeno un firmatario.');
              const f = await api('file.carica', { nome: inp.files[0].name, base64: await leggiFile(inp.files[0]) });
              await api('firma.scansione', { entita: e, id, keys, file: f.valore });
              return true;
            } }]);
          if (ok) { toast('Firme registrate.', 'ok'); naviga(); }
        }
      } }, ETICHETTE[m])),
      s.file && /schermo|Scansione/.test(s.metodo) ? h('button', { class: 'piccolo', onclick: ev => prova(() => scaricaFile(s.file), ev.currentTarget) }, 'Vedi') : null,
      s.firmaId && G.S.utente.admin ? h('button', { class: 'piccolo pericolo', onclick: async ev => { const v = await chiedi('Annullare la firma di ' + s.nome + '?', [{ k: 'motivo', l: 'Motivo dell\'annullamento', tipo: 'textarea', req: true }], 'Annulla la firma');
        if (v) { const r = await prova(() => api('firma.annulla', { firmaId: s.firmaId, motivo: v.motivo }), ev.currentTarget); if (r) { toast('Firma annullata.'); naviga(); } } } }, 'Annulla firma') : null)));
    return box;
  }

  // ---------- pagina pubblica di firma tramite link ----------
  async function firmaPubblica(token) {
    const root = document.getElementById('app');
    root.className = 'centro';
    let info;
    try { info = await api('firmalink.info', { token }); } catch (e) { root.replaceChildren(h('div', { class: 'scatola' }, h('h1', {}, 'Firma'), h('div', { class: 'avviso rosso' }, e.message))); return; }
    const c = tavoletta(), pin = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'PIN di firma' });
    const fatto = () => root.replaceChildren(h('div', { class: 'scatola' }, h('h1', {}, 'Grazie'), h('p', {}, 'La firma è stata registrata. Puoi chiudere questa pagina.')));
    root.replaceChildren(h('div', { class: 'scatola larga' }, h('h1', {}, 'Richiesta di firma'), h('p', {}, info.azienda + ' ti chiede di firmare:'),
      h('div', { class: 'card' }, h('strong', {}, info.documento), h('br'), info.ruolo + ': ' + info.firmatario), h('p', {}, 'Firma nel riquadro con il dito o con il mouse.'), c,
      h('div', { class: 'barra' }, h('button', { onclick: () => c.pulisci() }, 'Cancella'), h('button', { class: 'primario', onclick: e => prova(async () => { await api('firmalink.firma', { token, immagine: c.toDataURL('image/png') }); fatto(); }, e.currentTarget) }, 'Conferma la firma')),
      info.pinDisponibile ? h('div', {}, h('p', {}, 'Oppure firma con il tuo PIN:'), h('div', { class: 'barra' }, pin, h('button', { onclick: e => prova(async () => { await api('firmalink.firma', { token, metodo: 'pin', pin: pin.value }); fatto(); }, e.currentTarget) }, 'Firma con il PIN'))) : null));
  }

  Object.assign(G, { h, D, lista, api, toast, errore, prova, finestra, conferma, chiedi, scarica, salvaBlob, scaricaFile, leggiFile, stampa, badge, mostra, opzioni, tabella, vai, naviga, token: () => TOKEN });
  G.AZIONI = {};

  window.addEventListener('hashchange', naviga);
  window.addEventListener('DOMContentLoaded', async () => {
    const firma = new URLSearchParams(location.search).get('firma');
    if (firma) return firmaPubblica(firma);
    if (!TOKEN) return accesso();
    try { await avvia(); } catch (e) { if (!G.S) accesso(); }
  });
})();

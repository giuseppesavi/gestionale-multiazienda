'use strict';
// Pannello di amministrazione della piattaforma. La chiave resta solo in memoria: non viene mai salvata nel browser.
(() => {
  let CHIAVE = '', CAT = null;
  const root = document.getElementById('app');
  function h(tag, attr, ...figli) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attr || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else if (v === true) e.setAttribute(k, ''); else e.setAttribute(k, v);
    }
    for (const f of figli.flat(Infinity)) if (f !== null && f !== undefined && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
    return e;
  }
  function toast(msg, tipo) { const d = h('div', { class: tipo || '' }, msg); document.getElementById('toast').append(d); setTimeout(() => d.remove(), tipo === 'err' ? 7000 : 3500); }
  async function api(azione, parametri) {
    let r, j;
    try { r = await fetch('/admin/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': CHIAVE }, body: JSON.stringify({ azione, parametri: parametri || {} }) }); j = await r.json(); }
    catch (e) { throw new Error('Il collegamento con il server non è riuscito.'); }
    if (!j.ok) throw new Error(j.error || 'Operazione non riuscita.');
    return j.data;
  }
  async function prova(fn, btn) { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { toast(e.message, 'err'); return undefined; } finally { if (btn) btn.disabled = false; } }
  function finestra(titolo, corpo, pulsanti) {
    return new Promise(ok => {
      const chiudi = v => { velo.remove(); ok(v); };
      const velo = h('div', { class: 'velo' }, h('div', { class: 'finestra larga' }, h('h2', {}, titolo), corpo, h('div', { class: 'azioni' }, pulsanti.map(p => h('button', { class: p.classe || '', onclick: async e => { const v = p.fn ? await prova(() => p.fn(), e.currentTarget) : p.valore; if (v !== undefined) chiudi(v); } }, p.t)))));
      document.body.append(velo);
    });
  }
  const D = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  const mb = n => (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',') + ' MB';
  const campo = (l, nodo) => h('div', { class: 'campo riga' }, h('label', {}, l), nodo);
  const selClasse = v => h('select', {}, CAT.classi.map(c => h('option', { value: c.id, selected: c.id === v }, c.etichetta)));
  function selPacchetti(attivi) {
    const caselle = CAT.pacchetti.filter(p => !p.sempre).map(p => { const c = h('input', { type: 'checkbox', value: p.id }); c.checked = attivi.includes(p.id); return h('label', {}, c, p.nome); });
    const box = h('div', { class: 'multi' }, h('label', {}, h('input', { type: 'checkbox', checked: true, disabled: true }), 'Base (sempre attivo)'), caselle);
    box.valori = () => caselle.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.value);
    return box;
  }

  function ingresso() {
    root.className = 'centro';
    const k = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Chiave di amministrazione', 'aria-label': 'Chiave di amministrazione' });
    const entra = e => prova(async () => { CHIAVE = k.value; try { CAT = await api('catalogo'); } catch (x) { CHIAVE = ''; throw x; } await pannello(); }, e && e.currentTarget);
    k.addEventListener('keydown', e => { if (e.key === 'Enter') entra(); });
    root.replaceChildren(h('div', { class: 'scatola' }, h('h1', {}, 'Amministrazione della piattaforma'), h('p', {}, 'Inserisci la chiave di amministrazione. Non viene salvata nel browser.'), h('div', { class: 'riga' }, k), h('button', { class: 'primario', onclick: entra }, 'Entra')));
    k.focus();
  }

  async function nuovaAzienda() {
    const codice = h('input', { placeholder: 'es. rossi' }), nome = h('input', {}), classe = selClasse(1), pk = selPacchetti([]), cognome = h('input', {}), nomeA = h('input', {}), email = h('input', { type: 'email' });
    return finestra('Nuova azienda', h('div', {}, campo('Codice (compare nell\'indirizzo: lettere minuscole, numeri, trattini)', codice), campo('Ragione sociale', nome), campo('Classe di dipendenti', classe), campo('Pacchetti attivi', pk),
      h('h2', {}, 'Amministratore iniziale'), campo('Cognome', cognome), campo('Nome', nomeA), campo('E-mail', email)),
    [{ t: 'Annulla', valore: null }, { t: 'Crea l\'azienda', classe: 'primario', fn: () => api('aziende.crea', { codice: codice.value, nome: nome.value, classe: Number(classe.value), pacchetti: pk.valori(), admin: { cognome: cognome.value, nome: nomeA.value, email: email.value } }) }]);
  }
  async function licenza(a) {
    const classe = selClasse(a.licenza.classe), pk = selPacchetti(a.pacchetti), nome = h('input', { value: a.nome });
    return finestra('Licenza – ' + a.nome, h('div', {}, campo('Ragione sociale', nome), campo('Classe di dipendenti (addetti attivi: ' + a.licenza.attivi + ')', classe), campo('Pacchetti attivi', pk),
      h('p', { class: 'tenue' }, 'Disattivando un pacchetto i suoi dati restano in archivio e tornano visibili alla riattivazione.')),
    [{ t: 'Annulla', valore: null }, { t: 'Salva', classe: 'primario', fn: () => api('aziende.aggiorna', { codice: a.codice, nome: nome.value, classe: Number(classe.value), pacchetti: pk.valori() }) }]);
  }
  async function accessoUtente(a) {
    const email = h('input', { type: 'email', value: a.emailAdmin || '' }), esito = h('div', {});
    return finestra('Accesso degli utenti – ' + a.nome, h('div', {}, campo('E-mail dell\'utente', email), esito, h('p', { class: 'tenue' }, 'Il codice generato vale pochi minuti e una sola volta; l\'operazione resta nel registro dell\'azienda.')),
      [{ t: 'Chiudi', valore: null }, { t: 'Sblocca l\'accesso', fn: async () => { await api('accesso.sblocca', { codice: a.codice, email: email.value }); toast('Accesso sbloccato.', 'ok'); } },
        { t: 'Genera un codice di accesso', classe: 'primario', fn: async () => { const r = await api('accesso.codice', { codice: a.codice, email: email.value }); esito.replaceChildren(h('p', {}, 'Codice valido ' + r.minuti + ' minuti:'), h('p', { class: 'codice' }, r.codice)); } }]);
  }
  async function esporta(a, allegati, btn) {
    await prova(async () => {
      const r = await fetch('/admin/esporta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': CHIAVE }, body: JSON.stringify({ codice: a.codice, allegati }) });
      if ((r.headers.get('content-type') || '').includes('json')) throw new Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob()), l = h('a', { href: url, download: a.codice + '.zip' });
      document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, btn);
  }
  async function ripristina() {
    const file = h('input', { type: 'file', accept: '.zip' }), codice = h('input', { placeholder: 'nuovo codice azienda' });
    return finestra('Ripristina un\'azienda da un archivio', h('div', {}, campo('Archivio .zip esportato dal gestionale', file), campo('Codice della nuova azienda', codice)), [{ t: 'Annulla', valore: null }, { t: 'Ripristina', classe: 'primario', fn: async () => {
      if (!file.files[0]) throw new Error('Scegli l\'archivio.');
      const b = new Uint8Array(await file.files[0].arrayBuffer()); let s = '';
      for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
      return api('aziende.ripristina', { codice: codice.value, archivio: btoa(s) });
    } }]);
  }

  async function pannello() {
    root.className = '';
    const [aziende, stato, posta] = await Promise.all([api('aziende.elenco'), api('stato'), api('posta.registro')]);
    const ricarica = () => prova(pannello);
    const dest = h('input', { type: 'email', placeholder: 'indirizzo di prova', 'aria-label': 'Indirizzo di prova' });
    root.replaceChildren(h('main', {}, h('div', { class: 'barra' }, h('h1', {}, 'Amministrazione della piattaforma'), h('span', { class: 'spazio' }),
      h('button', { onclick: async () => { if (await ripristina()) { toast('Azienda ripristinata.', 'ok'); ricarica(); } } }, 'Ripristina da archivio'),
      h('button', { class: 'primario', onclick: async () => { if (await nuovaAzienda()) { toast('Azienda creata.', 'ok'); ricarica(); } } }, '＋ Nuova azienda'), h('button', { onclick: () => { CHIAVE = ''; ingresso(); } }, 'Esci')),
    h('div', { class: 'tessere' }, [[aziende.length, 'Aziende'], [aziende.reduce((s, a) => s + a.licenza.attivi, 0), 'Addetti attivi'], [stato.posta ? 'Attiva' : 'Non configurata', 'Posta (SMTP)'], [stato.database, 'Database']].map(x => h('div', { class: 'tessera' }, h('div', { class: 'n' }, x[0]), h('div', { class: 'l' }, x[1])))),
    h('div', { class: 'card' }, h('h2', {}, 'Aziende'), aziende.length ? h('div', { class: 'scorri' }, h('table', {}, h('thead', {}, h('tr', {}, ['Azienda', 'Classe', 'Addetti', 'Pacchetti', 'Dati', 'Stato', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, aziende.map(a => h('tr', {}, h('td', {}, h('strong', {}, a.nome), h('br'), h('a', { href: '/a/' + a.codice + '/', target: '_blank', rel: 'noopener' }, '/a/' + a.codice + '/'), h('div', { class: 'tenue' }, 'dal ' + D(a.creato))),
        h('td', {}, a.licenza.etichetta), h('td', {}, h('span', { class: 'badge ' + (a.licenza.pieno ? 'rosso' : a.licenza.avviso ? 'giallo' : 'verde') }, a.licenza.attivi + ' / ' + a.licenza.max)),
        h('td', {}, a.pacchetti.length ? a.pacchetti.map(p => (CAT.pacchetti.find(x => x.id === p) || { nome: p }).nome).join(', ') : 'Solo Base'),
        h('td', {}, a.righe + ' righe', h('br'), a.file + ' file · ' + mb(a.spazio)), h('td', {}, h('span', { class: 'badge ' + (a.attiva ? 'verde' : 'rosso') }, a.attiva ? 'Attiva' : 'Sospesa')),
        h('td', {}, h('div', { class: 'barra' }, h('button', { class: 'piccolo primario', onclick: async () => { if (await licenza(a)) { toast('Licenza aggiornata.', 'ok'); ricarica(); } } }, 'Licenza'),
          h('button', { class: 'piccolo', onclick: () => accessoUtente(a) }, 'Accessi'), h('button', { class: 'piccolo', onclick: e => esporta(a, true, e.currentTarget) }, '⬇ Esporta'),
          h('button', { class: 'piccolo', onclick: e => prova(async () => { await api('aziende.aggiorna', { codice: a.codice, attiva: !a.attiva }); ricarica(); }, e.currentTarget) }, a.attiva ? 'Sospendi' : 'Riattiva'),
          h('button', { class: 'piccolo pericolo', onclick: async () => { const c = h('input', { placeholder: a.codice });
            if (await finestra('Eliminare definitivamente ' + a.nome + '?', h('div', {}, h('p', {}, 'Tutti i dati e gli allegati dell\'azienda verranno cancellati e non si potranno recuperare. Per confermare riscrivi il codice dell\'azienda: ' + a.codice), c),
              [{ t: 'Annulla', valore: null }, { t: 'Elimina definitivamente', classe: 'pericolo', fn: () => api('aziende.elimina', { codice: a.codice, conferma: c.value.trim() }) }])) { toast('Azienda eliminata.'); ricarica(); } } }, 'Elimina')))))))) : h('p', { class: 'tenue' }, 'Nessuna azienda. Creane una con "Nuova azienda".')),
    h('div', { class: 'card' }, h('h2', {}, 'Posta'), h('div', { class: 'barra' }, dest, h('button', { onclick: e => prova(async () => { const r = await api('posta.prova', { a: dest.value }); toast(r.inviata ? 'E-mail di prova inviata.' : 'L\'e-mail non è partita: guarda il registro qui sotto.', r.inviata ? 'ok' : 'err'); ricarica(); }, e.currentTarget) }, 'Invia e-mail di prova')),
      h('p', { class: 'tenue' }, 'Ultime e-mail. I codici di accesso sono nascosti se l\'e-mail è stata consegnata.'),
      posta.length ? h('div', { class: 'scorri' }, h('table', {}, h('thead', {}, h('tr', {}, ['Quando', 'A', 'Oggetto', 'Esito', 'Testo'].map(t => h('th', {}, t)))), h('tbody', {}, posta.map(m => h('tr', {}, h('td', {}, new Date(m.data).toLocaleString('it-IT')), h('td', {}, m.a), h('td', {}, m.oggetto), h('td', {}, h('span', { class: 'badge ' + (m.esito === 'Inviata' ? 'verde' : 'rosso') }, m.esito)), h('td', {}, m.testo)))))) : h('p', { class: 'tenue' }, 'Nessuna e-mail dall\'ultimo avvio del server.'))));
  }
  ingresso();
})();

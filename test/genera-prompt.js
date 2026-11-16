'use strict';
// Genera PROMPT.md: il prompt per ricreare il gestionale (struttura dei dati e funzionalità).
// La sezione sul modello dei dati è ricavata dallo schema del programma, quindi è sempre esatta.
//   node test/genera-prompt.js
const fs = require('fs');
const path = require('path');
const { SCHEMA, ELENCHI, FATTORI_RISCHIO, DOMANDE_QUALIFICA, CONFIG_PREDEFINITA } = require('../app/schema');
const { CLASSI, PACCHETTI } = require('../app/licenza');
const { PRESET } = require('../app/rischi');
const { STAMPE } = require('../app/stampe');
const { IMPORT } = require('../app/importa');

const nomePack = id => PACCHETTI.find(p => p.id === id).nome;
function campo(f) {
  let s = f.name + (f.req ? '*' : '') + (f.uniq ? '!' : '') + ':' + f.type;
  if (f.ref) s += '>' + f.ref;
  if (f.list) s += '[' + f.list + ']';
  if (f.options) s += '{' + f.options.join('/') + '}';
  if (f.virtual) s += '(calc)';
  if (f.ro) s += '(ro)';
  if (f.def !== undefined) s += '=' + f.def;
  if (f.showIf) s += '?' + JSON.stringify(f.showIf);
  return '  - ' + s + (f.label !== f.name ? ' "' + f.label + '"' : '');
}
function entita(E) {
  const p = ['gruppo:' + (E.group || '-'), 'perm:' + E.perm, 'pacchetto:' + E.packs.join(' oppure ')];
  if (E.signers) p.push('FIRME');
  if (E.child) p.push('CHILD di ' + E.parent);
  if (E.auto) p.push('numerazione:' + E.auto + '-AAAA-NNN');
  if (E.children.length) p.push('figli:' + E.children.map(c => c.e + '(' + c.fk + ')').join(','));
  p.push('titolo:' + E.title.join('+'));
  return '**' + E.name + ' — ' + E.label + '** — ' + p.join(' | ') + '\n' + E.fields.map(campo).join('\n');
}
const perPacchetto = PACCHETTI.map(p => '### Pacchetto ' + p.nome + (p.sempre ? ' (sempre attivo)' : '') + '\n\n' +
  Object.values(SCHEMA).filter(E => E.pack === p.id).map(entita).join('\n\n')).join('\n\n');
const metodo = ([k, m]) => '- **' + m.nome + '** (' + k + '): fattori ' + m.definizione.fattori.map(f => f.codice + ' ' + f.nome + ' [' + f.livelli.map(l => l[0] + '=' + l[1]).join(', ') + ']').join('; ') +
  '. Classi: ' + m.definizione.classi.map(c => c.nome + ' ' + c.min + '–' + c.max + ' (' + c.indicazione + ', riesame ' + c.riesameMesi + ' mesi, ' + c.colore + ')').join('; ') + '.';
const oggi = new Date().toLocaleDateString('it-IT');

const testo = `# PROMPT PER RICREARE IL "GESTIONALE SICUREZZA & QUALITÀ" MULTI-AZIENDA

> Copia tutto il testo qui sotto e dallo a un assistente di programmazione.
> Descrive il gestionale com'è al ${oggi} (archivio \`giuseppesavi/gestionale-multiazienda\`).
> La sezione 3 (modello dei dati) è generata dallo schema del programma con \`node test/genera-prompt.js\`.

---

## 0. Il tuo compito

Crea da zero un'applicazione web gestionale per piccole e medie imprese italiane che gestisca la **sicurezza sul lavoro** (D.Lgs. 81/2008), la **qualità** (ISO 9001) e l'**analisi dei rischi e delle opportunità**.

Requisiti generali:
- interfaccia, testi, stampe e messaggi d'errore in **italiano**;
- **multi-azienda**: un solo server ospita più aziende con dati separati;
- **pacchetti attivabili** per ogni azienda e **licenza per classi di dipendenti**;
- **esportazione** e ripristino dei dati di ogni azienda;
- l'utente finale **non ha competenze tecniche**: tutto guidato, messaggi chiari e mai tecnici.

Lavora per fasi (motore dei dati, accesso e permessi, firme, moduli di dominio, stampe, import/export, scadenzario e cruscotto, pannello della piattaforma, sicurezza, interfaccia, test). Alla fine di ogni fase esegui i test e mostra cosa funziona. Se un requisito è ambiguo, fai **una domanda alla volta**.

---

## 1. Architettura

- **Server:** Node.js 22 + Express 4. **Database:** PostgreSQL (nei test PGlite in memoria).
- **Hosting:** Render (Blueprint \`render.yaml\`, regione Francoforte) oppure Docker locale (\`docker-compose.yml\`: gestionale + PostgreSQL 17, dati in un volume, porta esposta solo su 127.0.0.1).
- **Interfaccia:** pagina unica in HTML/CSS/JavaScript senza framework. Una sola API: \`POST /a/<codiceAzienda>/run\` con \`{ fn:'api', args:[token, azione, parametri] }\` → \`{ ok, data }\` oppure \`{ ok:false, error, code }\`.
- **PDF:** generati sul server (pdfmake, font Helvetica). **Excel:** lettura e scrittura \`.xlsx\` sul server (fflate + XML minimale), lettura \`.csv\`. **E-mail:** SMTP (nodemailer); senza SMTP le e-mail non partono e restano nel registro del pannello.

**Tabelle del database:** \`tenants\` (id, nome, email_admin, classe, pacchetti, attiva, creato), \`rows\` (tenant, sheet, id, data JSON), \`props\` (tenant, key, value JSON), \`files\` (tenant, id, nome, mime, dimensione, contenuto).

**Motore guidato dallo schema.** Tutte le schede nascono da un unico schema dichiarativo (sezione 3). Ogni entità ha le colonne di sistema \`id\` (12 caratteri casuali), \`createdAt\`, \`updatedAt\`, \`createdBy\`. Il motore fornisce: elenco con ricerca, filtri e ordinamento; maschera; griglie dei figli; campi calcolati; validazioni; eliminazione con controllo dei riferimenti; numerazione automatica; registro delle operazioni.

- **Tipi di campo:** text, textarea, email, number, date (ISO, mostrata gg/mm/aaaa), datetime, bool (SI/NO), select (opzioni fisse), list (elenco personalizzabile), ref, multiref (id separati da virgola), file (\`idFile|nomeFile\`), auto (\`PREFISSO-AAAA-NNN\`), fk, hidden.
- **Proprietà:** \`*\` obbligatorio (solo se il campo è visibile), \`!\` univoco senza distinguere le maiuscole, \`(ro)\` sola lettura, \`(calc)\` calcolato e non salvato, \`=\` predefinito (\`today\`, \`me\` = dipendente collegato, oppure un valore), \`?{campo:valore}\` visibile solo a certe condizioni.
- **Salvataggio:** scheda e figli insieme; i figli inviati sostituiscono in blocco la griglia (quelli non inviati restano); una riga usata altrove non si può togliere. Ganci \`before\`/\`after\`/\`dopoEliminazione\`/\`primaDiFirmare\`/\`dopoFirma\`/\`dopoAnnullamento\` applicano le regole di dominio. I testi che iniziano con \`= + - @\` vengono neutralizzati con un apostrofo.
- **Prestazioni:** l'azienda è caricata in memoria alla prima richiesta, si salvano solo le righe modificate in un'unica transazione, le richieste della stessa azienda sono eseguite una alla volta (coda). In caso di errore le modifiche in memoria vengono scartate.
- **Setup automatico** alla prima richiesta di ogni azienda: valori iniziali di elenchi, fattori di rischio, domande di qualifica, metodi e registri dei rischi. Non cancella né rinomina mai nulla.
- **Filtro per scheda:** oltre ai permessi dell'entità, alcune entità hanno un filtro sulla singola scheda (documenti e prese visione).

---

## 2. Multi-azienda, pacchetti e licenze

### 2.1 Pacchetti attivabili
${PACCHETTI.map(p => '- **' + p.nome + '** (\`' + p.id + '\`)' + (p.sempre ? ' — sempre attivo' : '') + ': ' + Object.values(SCHEMA).filter(E => E.pack === p.id && !E.child).map(E => E.label).join(', ') + '.').join('\n')}

Regole:
- un pacchetto spento sparisce da menu, cruscotto, scadenzario, stampe e import, e il server rifiuta le chiamate (codice errore \`PACCHETTO\`);
- i campi che collegano a entità di un pacchetto spento non vengono mostrati e il loro valore viene conservato;
- le griglie figlie di un pacchetto spento non vengono toccate;
- **i dati non vengono mai cancellati**: riattivando il pacchetto si ritrova tutto;
- un'entità può appartenere a più pacchetti (le Azioni di miglioramento sono attive con \`nc\` oppure \`rischi\`).

### 2.2 Classi di dipendenti
${CLASSI.map(c => '- Classe ' + c.id + ': ' + c.etichetta).join('\n')}

- Si contano gli **addetti attivi**: dipendenti non cessati, interinali compresi.
- Al 90% compare un avviso; al limite compare un avviso rosso.
- **Al superamento l'inserimento di nuovi addetti è bloccato** (anche da import e anche la riattivazione di un cessato), con il messaggio che serve estendere la licenza (codice errore \`LICENZA\`). Tutto il resto continua a funzionare.
- Al blocco parte una **segnalazione**: riga nel registro dell'azienda ed e-mail agli amministratori dell'azienda e al fornitore (\`PIATTAFORMA_EMAIL\`), al massimo una al giorno.
- Classe e pacchetti si cambiano solo dal pannello della piattaforma; il passaggio a una classe troppo piccola per gli addetti presenti è rifiutato.

### 2.3 Esportazione dei dati aziendali
- **Chi:** l'amministratore dell'azienda (confermando con un codice ricevuto via e-mail) oppure la piattaforma (con la chiave di amministrazione).
- **Cosa:** archivio \`.zip\` con \`dati-leggibili.xlsx\` (un foglio per tabella, valori leggibili), \`dati-ripristino.json\` (copia completa), \`allegati/\` (facoltativi), \`LEGGIMI.txt\`.
- **Scelta dei pacchetti** da esportare; i dati sanitari solo se chi esporta è autorizzato.
- **Mai esportati:** PIN di firma, codici di accesso, sessioni, token dei link di firma.
- **Ripristino** dal pannello: l'archivio ricrea l'azienda con un nuovo codice (dati e allegati); rifiutato se la classe è troppo piccola.
- Ogni esportazione viene annotata nel registro.

### 2.4 Azienda dimostrativa
Dal pannello della piattaforma si crea un'azienda con tutti i pacchetti e **dati inventati in ogni scheda e in ogni griglia** (scadenze passate e future, firme, documenti, rischi). Durante la creazione non parte nessuna e-mail. Se la creazione fallisce non resta nulla a metà.

---

## 3. Modello dei dati (generato dallo schema)

**Legenda:** \`*\` obbligatorio, \`!\` univoco; \`:tipo\`; \`>Entità\` collegamento; \`[Elenco]\` elenco personalizzabile; \`{a/b}\` opzioni fisse; \`(calc)\` calcolato; \`(ro)\` sola lettura; \`=\` predefinito; \`?{...}\` visibile solo se; tra virgolette l'etichetta.
**Permessi (\`perm\`):** \`admin\` = modifica solo gli amministratori, lettura per tutti; \`reg\` = modificabile da tutti gli utenti; \`san\` = sorveglianza sanitaria, secondo configurazione; \`doc\` = modifica solo amministratori, lettura filtrata; \`ro\` = sola lettura per amministratori; \`sys\` = interna.

${perPacchetto}

### 3.1 Elenchi personalizzabili (valori iniziali)
${Object.entries(ELENCHI).map(([k, v]) => '- **' + k + ':** ' + v.join(', ')).join('\n')}

Fattori di rischio iniziali: ${FATTORI_RISCHIO.map(f => f[0]).join(', ')}.
Domande standard di qualifica dei fornitori: ${DOMANDE_QUALIFICA.join('; ')}.

### 3.2 Configurazione dell'azienda (valori predefiniti)
${Object.entries(CONFIG_PREDEFINITA).map(([k, v]) => '- \`' + k + '\`: ' + (v === '' ? '(vuoto)' : v)).join('\n')}
- \`logo\`: immagine PNG o JPG usata nelle stampe.

Limiti: \`otpMinuti\` 3–30, \`sessioneOre\` 1–6, \`linkFirmaGiorni\` 1–30, \`sogliaQualifica\` 1–10, \`accessoSanitaria\` = "Solo amministratori" oppure "Amministratori e utenti".

---

## 4. Utenti, ruoli e accesso

- Gli utenti sono **dipendenti** con "Utente del sistema = SI" e un'e-mail. Ruoli: **Amministratore** (tutto) e **Utente registrazioni** (registrazioni e consultazione). I cessati non accedono.
- **Eliminazioni:** solo amministratori; bloccate se la scheda è usata altrove (il messaggio dice dove) o se è firmata.
- **Accesso senza password:** l'utente scrive l'e-mail e riceve un codice di 6 cifre valido \`otpMinuti\`; la risposta è sempre la stessa per non rivelare quali indirizzi esistono; con 6 cifre l'accesso parte da solo. Sessione con token casuale a scorrimento (\`sessioneOre\`), di cui nel database si salva **solo l'hash**; sopravvive ai riavvii.
- **Limiti:** 5 tentativi per codice; 10 errori per connessione → blocco di 6 ore; 50 errori al giorno per indirizzo → blocco di 24 ore con e-mail di avviso; richieste di codice: 5 ogni 15 minuti per connessione+indirizzo, 20 al giorno per indirizzo.
- **PIN di firma** dei dipendenti (anche non utenti): 4–8 cifre, salvato come hash lento (scrypt) con salt; 5 errori → blocco di 15 minuti; 10 errori → blocco per la giornata con e-mail agli amministratori. L'amministratore lo imposta o lo genera (mostrato una sola volta); l'utente cambia il proprio.
- **Menu laterale** a gruppi comprimibili, con 📌 per fissare un gruppo aperto (preferenza salvata per utente). Gruppi: Generale, Documentazione, Sorveglianza sanitaria, Registrazioni, Rischi e opportunità, Anagrafiche, Fornitori, Strumenti di misura, Attrezzature, Configurazione.

---

## 5. Regole di dominio

### 5.1 Dipendenti
- "Cessato" se la data di cessazione è passata. Codice fiscale: 16 caratteri alfanumerici oppure 11 cifre. L'e-mail è obbligatoria per gli utenti del sistema.
- Mansione principale più mansioni aggiuntive: contano ovunque (DPI, formazione, documenti, sorveglianza).
- **Interinali:** agenzia, inizio e fine missione; lo storico dei rapporti si aggiorna da solo; "Assumi direttamente" chiude la missione il giorno prima e apre il rapporto diretto; le missioni in scadenza vanno nello scadenzario.
- **Scheda dipendente:** anagrafica, DPI consegnati, formazione richiesta e svolta, valutazioni, documenti, giudizio di idoneità (solo se autorizzati); export Excel e stampa.

### 5.2 Mansioni
Corsi richiesti, competenze con valore atteso 1–5, DPI con quantità; fattori di rischio se soggetta a sorveglianza. "Clona" copia la mansione con i figli e chiede un nuovo codice.

### 5.3 Consegne DPI
"Carica DPI della mansione" propone i DPI delle mansioni del dipendente (quantità più alta). Firme: lavoratore e incaricato. Verbale PDF con dichiarazione configurabile; invio per e-mail a \`emailDpi\` con oggetto \`CONSEGNA DPI {NOME} E {DATA}\`. Scadenza indicativa = ultima consegna + mesi indicati sul DPI.

### 5.4 Formazione
- Tipologia: durata, programma; se prevede aggiornamento: frequenza in mesi, ore richieste, decorrenza.
- Corso: "Formazione iniziale" oppure "Aggiornamento" (ammesso solo se la tipologia lo prevede); docenti interni o esterni; partecipanti con ore e attestato.
- **Scadenza** per dipendente e tipologia, scorrendo i corsi per data di fine: la formazione iniziale apre un periodo (fine + frequenza); gli aggiornamenti **sommano le ore** (anche frazionati); raggiunte le ore richieste il periodo si rinnova: dalla scadenza precedente se completato in tempo e la decorrenza lo prevede, altrimenti dalla data di completamento. Aggiornamento incompleto = "parziale X/Y h".
- Formazione richiesta: una tipologia collegata a una o più mansioni è richiesta solo a chi le ha; una tipologia non collegata è richiesta a tutti.
- Firme: docenti (anche esterni tramite link) e partecipanti; l'attestato caricato sostituisce la firma. I corsi importati non hanno firme.

### 5.5 Competenze
La griglia propone le competenze richieste dalle mansioni scelte con il valore atteso più alto e l'indicazione "richiesta da". Copertura = percentuale con valore reale ≥ atteso. Firma del valutatore.

### 5.6 Non conformità e azioni
- NC \`NC-AAAA-NNN\`, stati Aperta / In gestione / Chiusa; reclamo sì/no; rilevatore interno, fornitore o altro; costi come righe (quantità × costo); firma "Redatto da".
- **Azioni di miglioramento** \`AZ-AAAA-NNN\`, collegate a una NC e/o a un rischio. All'assegnazione parte un'e-mail al responsabile. **Completamento:** solo il responsabile o un amministratore, descrivendo cosa è stato fatto. **Verifica dell'efficacia:** solo amministratori, con evidenze; "Efficace" chiude, "Non efficace" riapre l'azione.
- Riepilogo con filtri per periodo, stato, tipologia e reclamo; totali e costi.

### 5.7 Attrezzature e manutenzioni
Sede con responsabile; tipologia con piano standard; piano = attività con frequenza (giorni, settimane, mesi, anni). "Applica piano" copia le attività nell'attrezzatura. Prossima scadenza = ultima esecuzione + frequenza; stati: Mai eseguita / Scaduta / In scadenza (30 giorni) / Regolare. La manutenzione aggiorna "ultima esecuzione" (ricalcolata anche se la manutenzione viene eliminata). Esecutore interno o esterno; firma anche il responsabile. **Manutenzione massiva per sede**: una manutenzione per ogni attrezzatura selezionata.

### 5.8 Fornitori
Qualifica con domande e voto 1–10 oppure N.A.; media dei soli voti applicabili; **qualificato se la media è maggiore della soglia**; senza voti "Da valutare". Stato, media e data dell'ultima valutazione compaiono sul fornitore.

### 5.9 Strumenti di misura e tarature
Errore massimo ammesso (EMA), frequenza in mesi, campione sì/no. Taratura interna (campione obbligatorio, diverso dallo strumento) o esterna (laboratorio, certificato). Punti: scarto = strumento − campione; Conforme / Al limite (scarto = tolleranza) / Non conforme / Tolleranza mancante. Esito: Non conforme se c'è un punto non conforme; "Conforme con avviso" se c'è un punto al limite; senza punti vale l'esito dichiarato. Stato dello strumento: Mai tarato / Valida / Valida con avviso / Non conforme / Scaduta.

### 5.10 Documentazione
- Una scheda per ogni **revisione**; niente revisioni doppie né due revisioni in lavorazione dello stesso codice.
- **Ciclo:** Bozza → (firma "Redatto da") In approvazione → (firma "Approvato da", possibile solo dopo le altre) **In vigore**. La revisione precedente diventa Superata e le sue prese visione non firmate vengono annullate. Annullando l'approvazione si torna indietro. "Ritira" e "Nuova revisione".
- Approva chi è indicato, anche se non è amministratore. Link accettati solo http/https.
- **Distribuzione:** tutti, mansioni (principale e aggiuntive), sedi, singoli. All'entrata in vigore nascono le **prese visione** (termine predefinito 15 giorni); scelta per revisione: tutti, solo chi non ha letto le revisioni precedenti, nessuna. Nuovi dipendenti e cambi di mansione le ricevono da soli.
- Presa visione: l'utente con "Ho letto" (credenziali); gli altri davanti a un incaricato (PIN, schermo, carta). Niente link.
- **Visibilità** per i non amministratori: documenti in vigore di cui sono destinatari, quelli che devono leggere, quelli di cui sono redattori, verificatori o approvatori.
- Collegamenti tra documenti (sempre verso la revisione corrente), "Citato in", riesame periodico.

### 5.11 Sorveglianza sanitaria (dati riservati)
Prossima visita = data + periodicità − 1 giorno (modificabile). Lavoratori soggetti: quelli con mansioni "soggette"; se nessuna è marcata, chi ha almeno una visita. Stati: Regolare / In scadenza / Scaduta / Visita mancante / Data mancante. Accesso, stampe, export e allegati solo per chi è autorizzato.

### 5.12 Rischi e opportunità
- **Registri** configurabili (iniziali: rischi per la qualità \`RQ\`, salute e sicurezza \`RS\`, ambientali \`RA\`, opportunità \`OP\`), ognuno con un proprio **metodo di valutazione**. Codice progressivo per registro (\`RQ-001\`).
- **Metodi** configurabili: fattori (codice di 1–3 lettere maiuscole, nome, livelli interi positivi con etichetta) e classi (nome, intervallo, colore, indicazione, mesi di riesame). Il punteggio è il **prodotto dei fattori**. Controlli: almeno un fattore, almeno due livelli per fattore, ogni punteggio possibile coperto da una classe.
- **Istantanea del metodo:** ogni valutazione salva la definizione del metodo usato; cambiare metodo non altera le valutazioni già fatte, che si aggiornano solo rivalutando la voce.
- **Valutazione iniziale e residua** (dopo il trattamento). Prossimo riesame = oggi + mesi della classe della valutazione di riferimento (residua se presente), modificabile a mano.
- **Stati:** Proposta (si conferma solo se valutata, oppure si scarta), Attivo, Chiuso (solo indicando il motivo; resta nello storico).
- **Matrice** dei rischi per i metodi a due fattori.
- **Piano di gestione:** stampa PDF (scopo, metodo, registro, efficacia) e, con il pacchetto Documentazione, documento controllato \`PIANO-<prefisso>\`: bozza, aggiornamento della bozza, nuova revisione se il piano è in vigore.
- Metodi e voci si modificano solo dalle pagine dedicate, non dalla maschera generica.

Metodi predefiniti:
${Object.entries(PRESET).map(metodo).join('\n')}

---

## 6. Firme

| Entità | Firmatari |
|---|---|
| Consegne | lavoratore, incaricato della consegna |
| Corsi | docenti (interni o esterni), partecipanti |
| NC | redatto da |
| Valutazioni competenze | valutatore |
| Manutenzioni | esecutore (dipendente o esterno), responsabile della manutenzione |
| Qualifiche fornitori | valutatore |
| Tarature | eseguita da (se interna), verificato da |
| Documenti | redatto da, verificato da, approvato da |
| Prese visione | il lavoratore |

**Metodi:** credenziali di accesso (solo a nome proprio, anche senza permesso di modifica); PIN del dipendente; firma disegnata sullo schermo (PNG; l'immagine vuota è rifiutata); link via e-mail (token lungo, monouso, con scadenza, di cui si salva solo l'hash; pagina pubblica con riepilogo); scansione cartacea (un file vale per più firmatari); attestato caricato (solo partecipanti ai corsi).
PIN, schermo, scansione e link li usa chi ha il permesso di modifica sulla scheda.
**Dopo la prima firma** la scheda è in sola lettura. Solo l'amministratore annulla una firma, indicando il motivo; l'annullamento resta nel registro firme. Le schede importate da archivio non hanno firme.

---

## 7. Scadenzario e cruscotto

**Scadenzario** (finestra regolabile, predefinita 60 giorni), sezioni secondo i pacchetti attivi: manutenzioni; formazione (anche richiesta e mai svolta); azioni di miglioramento; riesame di rischi e opportunità; DPI (indicativa); strumenti; missioni degli interinali; visite mediche; prese visione; riesame dei documenti. Ogni riga apre la scheda.

**Cruscotto:** dipendenti attivi, consegne degli ultimi 30 giorni, NC aperte, azioni aperte e scadute, azioni assegnate a me, rischi attivi per classe, schede con firme in attesa, documenti da leggere e da firmare, scadenze a 30 giorni per area, stato della licenza, azioni rapide.

---

## 8. Stampe PDF (${Object.keys(STAMPE).length})

Formato comune: A4, intestazione con logo e dati dell'azienda, titolo in maiuscolo, tabelle, riquadro firme con immagine della firma e metodo, piè di pagina con data e numero di pagina; QR code sulle schede di attrezzature e strumenti.
Elenco: ${Object.keys(STAMPE).join(', ')}.
Scheda documento, elenco documenti e matrice di distribuzione sono riservate agli amministratori; il registro sanitario agli autorizzati.

---

## 9. Import ed export Excel

**Regole comuni a ogni import** (solo amministratori): "Scarica modello" (foglio dati con intestazioni, riga d'esempio che inizia con "(esempio)" e viene ignorata, fogli di consultazione, istruzioni); "Verifica" (esegue tutto e poi annulla: l'anteprima è identica al risultato reale); "Importa" (salta errori e doppioni, mostra il resoconto riga per riga). Intestazioni riconosciute ignorando maiuscole, accenti e testo tra parentesi; date gg/mm/aaaa o in formato Excel; Sì/No/SI/NO/X; dipendenti riconosciuti per "Cognome Nome", "Nome Cognome" o codice fiscale; accettati \`.xlsx\` e \`.csv\`. Gli import rispettano il limite della licenza.

${Object.entries(IMPORT).map(([k, d]) => '- **' + d.titolo + '** (\`' + k + '\`): ' + d.fogli.map(f => 'foglio "' + f.nome + '"' + (f.facoltativo ? ' (facoltativo)' : '') + ': ' + f.col.map(c => c[0]).join(', ')).join('; ') + '.').join('\n')}

Regole particolari: la formazione raggruppa i partecipanti nello stesso corso (stessa tipologia, data e titolo), marcato "importato"; i soggetti si riconoscono per P.IVA o ragione sociale normalizzata; nelle NC le tipologie nuove vengono aggiunte all'elenco; nei documenti, con stato vuoto la revisione più alta va in vigore e le altre sono superate, senza distribuzione automatica.

**Export Excel:** scheda dipendente, registro strumenti, registro sorveglianza sanitaria, esportazione completa dei dati aziendali.

---

## 10. Pannello della piattaforma (\`/admin\`)

Accesso con \`ADMIN_KEY\` (variabile d'ambiente, mai salvata nel browser; confronto a tempo costante; ritardo dopo una chiave errata; 60 richieste ogni 5 minuti).
Funzioni: elenco aziende con classe, addetti, pacchetti, righe, file e spazio usato; nuova azienda con amministratore iniziale; azienda dimostrativa; licenza (classe e pacchetti); sospensione e riattivazione; eliminazione definitiva riscrivendo il codice; esportazione e ripristino; codice di accesso per un utente e sblocco (annotati nel registro dell'azienda); e-mail di prova e registro delle ultime 50 e-mail (i codici sono nascosti se l'e-mail è stata consegnata).

---

## 11. Sicurezza

- Intestazioni: Content-Security-Policy (\`default-src 'self'\`, niente script o stili in linea, \`frame-ancestors 'none'\`, \`object-src 'none'\`), X-Frame-Options DENY, HSTS, nosniff, Referrer-Policy same-origin, Permissions-Policy.
- Limite di 1500 richieste ogni 5 minuti per connessione (\`LIMITE_RICHIESTE\`); richieste oltre 1 MB solo con sessione valida.
- Permessi e pacchetti sempre controllati sul server. Un file si scarica solo se appartiene a una scheda visibile all'utente, oppure se l'ha caricato lui e non è ancora salvato.
- Allegati: solo PDF, immagini, Word, Excel, ODT, ODS, CSV; massimo 15 MB; il tipo è dedotto dall'estensione; salvati nel database.
- Nessun segreto nel codice; i codici di accesso non finiscono mai nei registri. In produzione il server non parte senza database. Il database non è raggiungibile da Internet.
- Variabili: \`DATABASE_URL\`, \`ADMIN_KEY\`, \`PIATTAFORMA_EMAIL\`, \`SMTP_*\`, \`URL_PUBBLICO\`, \`LIMITE_RICHIESTE\`, \`TRUST_PROXY_HOPS\`, \`TZ=Europe/Rome\`.

---

## 12. Interfaccia

Pagina unica con menu laterale e area principale; adatta al telefono (nessuno scorrimento orizzontale a 390 px, tabelle scorrevoli al loro interno, pulsanti di almeno 44 px). Elenchi con ricerca, filtri, ordinamento e colori di stato. Maschere con campi condizionali, griglie dei figli, pulsanti delle azioni e delle stampe, riquadro firme. Avvisi a scomparsa e finestre di conferma, mai le finestre del browser.
Pagine speciali: cruscotto, scadenzario, scheda dipendente, I miei documenti, riepilogo NC, manutenzione massiva, elenco fornitori qualificati, registro strumenti, registro sanitario, rischi e opportunità (con matrice), metodi di valutazione, sei pagine di import, dati azienda e logo, esporta dati, pagina pubblica di firma tramite link, pannello della piattaforma.

---

## 13. Test e consegna

- \`npm test\` esegue tutti i test su database in memoria: aziende, pacchetti, licenze, motore, accesso, permessi, firme con tutti i metodi, regole di ogni pacchetto, documentazione, rischi, import, stampe, esportazione e ripristino, scadenzario, cruscotto, pannello, azienda dimostrativa.
- \`node test/demo.js\`: server di prova in locale con azienda dimostrativa. \`node test/verifica-installazione.js <indirizzo>\`: verifica di un'installazione vera (Docker o Render).
- Archivio: \`app/\` (schema, regole, stampe, import/export, pagine), \`server/\` (server, database, posta), \`test/\`, \`render.yaml\`, \`Dockerfile\`, \`docker-compose.yml\`, \`README.md\`, \`STATO.md\`.
- **Prima di ogni modifica ai piani o ai costi dell'hosting chiedi conferma al committente.** Ogni operazione che il committente deve fare su GitHub, Render o Docker va spiegata un passo alla volta. Non chiedere mai password.
`;

const file = path.join(__dirname, '..', 'PROMPT.md');
fs.writeFileSync(file, testo);
console.log('PROMPT.md: ' + testo.split('\n').length + ' righe, ' + Object.keys(SCHEMA).length + ' entità, ' + Object.values(SCHEMA).reduce((n, E) => n + E.fields.length, 0) + ' campi, ' + Object.keys(STAMPE).length + ' stampe');

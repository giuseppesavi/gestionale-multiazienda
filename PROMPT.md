# PROMPT PER RICREARE IL "GESTIONALE SICUREZZA & QUALITÀ" MULTI-AZIENDA

> Copia tutto il testo qui sotto e dallo a un assistente di programmazione.
> Descrive il gestionale com'è al 16/11/2026 (archivio `giuseppesavi/gestionale-multiazienda`).
> La sezione 3 (modello dei dati) è generata dallo schema del programma con `node test/genera-prompt.js`.

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
- **Hosting:** Render (Blueprint `render.yaml`, regione Francoforte) oppure Docker locale (`docker-compose.yml`: gestionale + PostgreSQL 17, dati in un volume, porta esposta solo su 127.0.0.1).
- **Interfaccia:** pagina unica in HTML/CSS/JavaScript senza framework. Una sola API: `POST /a/<codiceAzienda>/run` con `{ fn:'api', args:[token, azione, parametri] }` → `{ ok, data }` oppure `{ ok:false, error, code }`.
- **PDF:** generati sul server (pdfmake, font Helvetica). **Excel:** lettura e scrittura `.xlsx` sul server (fflate + XML minimale), lettura `.csv`. **E-mail:** SMTP (nodemailer); senza SMTP le e-mail non partono e restano nel registro del pannello.

**Tabelle del database:** `tenants` (id, nome, email_admin, classe, pacchetti, attiva, creato), `rows` (tenant, sheet, id, data JSON), `props` (tenant, key, value JSON), `files` (tenant, id, nome, mime, dimensione, contenuto).

**Motore guidato dallo schema.** Tutte le schede nascono da un unico schema dichiarativo (sezione 3). Ogni entità ha le colonne di sistema `id` (12 caratteri casuali), `createdAt`, `updatedAt`, `createdBy`. Il motore fornisce: elenco con ricerca, filtri e ordinamento; maschera; griglie dei figli; campi calcolati; validazioni; eliminazione con controllo dei riferimenti; numerazione automatica; registro delle operazioni.

- **Tipi di campo:** text, textarea, email, number, date (ISO, mostrata gg/mm/aaaa), datetime, bool (SI/NO), select (opzioni fisse), list (elenco personalizzabile), ref, multiref (id separati da virgola), file (`idFile|nomeFile`), auto (`PREFISSO-AAAA-NNN`), fk, hidden.
- **Proprietà:** `*` obbligatorio (solo se il campo è visibile), `!` univoco senza distinguere le maiuscole, `(ro)` sola lettura, `(calc)` calcolato e non salvato, `=` predefinito (`today`, `me` = dipendente collegato, oppure un valore), `?{campo:valore}` visibile solo a certe condizioni.
- **Salvataggio:** scheda e figli insieme; i figli inviati sostituiscono in blocco la griglia (quelli non inviati restano); una riga usata altrove non si può togliere. Ganci `before`/`after`/`dopoEliminazione`/`primaDiFirmare`/`dopoFirma`/`dopoAnnullamento` applicano le regole di dominio. I testi che iniziano con `= + - @` vengono neutralizzati con un apostrofo.
- **Prestazioni:** l'azienda è caricata in memoria alla prima richiesta, si salvano solo le righe modificate in un'unica transazione, le richieste della stessa azienda sono eseguite una alla volta (coda). In caso di errore le modifiche in memoria vengono scartate.
- **Setup automatico** alla prima richiesta di ogni azienda: valori iniziali di elenchi, fattori di rischio, domande di qualifica, metodi e registri dei rischi. Non cancella né rinomina mai nulla.
- **Filtro per scheda:** oltre ai permessi dell'entità, alcune entità hanno un filtro sulla singola scheda (documenti e prese visione).

---

## 2. Multi-azienda, pacchetti e licenze

### 2.1 Pacchetti attivabili
- **Base** (`base`) — sempre attivo: Dipendenti, Mansioni, Clienti e Fornitori, Sedi, Elenchi personalizzabili, Registro firme, Registro accessi, File caricati.
- **DPI** (`dpi`): Consegne DPI, Tipi DPI.
- **Formazione** (`formazione`): Corsi di formazione, Tipologie corso.
- **Competenze** (`competenze`): Valutazioni competenze, Competenze.
- **Sorveglianza sanitaria** (`sanitaria`): Sorveglianza sanitaria, Fattori di rischio.
- **Non conformità e azioni** (`nc`): Non conformità e reclami, Azioni di miglioramento.
- **Attrezzature e manutenzioni** (`attrezzature`): Manutenzioni, Piani di manutenzione, Tipologie attrezzatura, Attrezzature.
- **Qualifica fornitori** (`fornitori`): Qualifiche fornitori, Domande qualifica fornitori.
- **Strumenti di misura** (`strumenti`): Strumenti di misura, Tarature.
- **Documentazione** (`documenti`): Documenti, Prese visione.
- **Rischi e opportunità** (`rischi`): Processi, Metodi di valutazione, Registri dei rischi, Rischi e opportunità.

Regole:
- un pacchetto spento sparisce da menu, cruscotto, scadenzario, stampe e import, e il server rifiuta le chiamate (codice errore `PACCHETTO`);
- i campi che collegano a entità di un pacchetto spento non vengono mostrati e il loro valore viene conservato;
- le griglie figlie di un pacchetto spento non vengono toccate;
- **i dati non vengono mai cancellati**: riattivando il pacchetto si ritrova tutto;
- un'entità può appartenere a più pacchetti (le Azioni di miglioramento sono attive con `nc` oppure `rischi`).

### 2.2 Classi di dipendenti
- Classe 1: 0–9 dipendenti
- Classe 2: 10–50 dipendenti
- Classe 3: 51–100 dipendenti
- Classe 4: 101–250 dipendenti
- Classe 5: 251–1000 dipendenti

- Si contano gli **addetti attivi**: dipendenti non cessati, interinali compresi.
- Al 90% compare un avviso; al limite compare un avviso rosso.
- **Al superamento l'inserimento di nuovi addetti è bloccato** (anche da import e anche la riattivazione di un cessato), con il messaggio che serve estendere la licenza (codice errore `LICENZA`). Tutto il resto continua a funzionare.
- Al blocco parte una **segnalazione**: riga nel registro dell'azienda ed e-mail agli amministratori dell'azienda e al fornitore (`PIATTAFORMA_EMAIL`), al massimo una al giorno.
- Classe e pacchetti si cambiano solo dal pannello della piattaforma; il passaggio a una classe troppo piccola per gli addetti presenti è rifiutato.

### 2.3 Esportazione dei dati aziendali
- **Chi:** l'amministratore dell'azienda (confermando con un codice ricevuto via e-mail) oppure la piattaforma (con la chiave di amministrazione).
- **Cosa:** archivio `.zip` con `dati-leggibili.xlsx` (un foglio per tabella, valori leggibili), `dati-ripristino.json` (copia completa), `allegati/` (facoltativi), `LEGGIMI.txt`.
- **Scelta dei pacchetti** da esportare; i dati sanitari solo se chi esporta è autorizzato.
- **Mai esportati:** PIN di firma, codici di accesso, sessioni, token dei link di firma.
- **Ripristino** dal pannello: l'archivio ricrea l'azienda con un nuovo codice (dati e allegati); rifiutato se la classe è troppo piccola.
- Ogni esportazione viene annotata nel registro.

### 2.4 Azienda dimostrativa
Dal pannello della piattaforma si crea un'azienda con tutti i pacchetti e **dati inventati in ogni scheda e in ogni griglia** (scadenze passate e future, firme, documenti, rischi). Durante la creazione non parte nessuna e-mail. Se la creazione fallisce non resta nulla a metà.

---

## 3. Modello dei dati (generato dallo schema)

**Legenda:** `*` obbligatorio, `!` univoco; `:tipo`; `>Entità` collegamento; `[Elenco]` elenco personalizzabile; `{a/b}` opzioni fisse; `(calc)` calcolato; `(ro)` sola lettura; `=` predefinito; `?{...}` visibile solo se; tra virgolette l'etichetta.
**Permessi (`perm`):** `admin` = modifica solo gli amministratori, lettura per tutti; `reg` = modificabile da tutti gli utenti; `san` = sorveglianza sanitaria, secondo configurazione; `doc` = modifica solo amministratori, lettura filtrata; `ro` = sola lettura per amministratori; `sys` = interna.

### Pacchetto Base (sempre attivo)

**Dipendenti — Dipendenti** — gruppo:Anagrafiche | perm:admin | pacchetto:base | figli:RapportiLavoro(dipendenteId) | titolo:cognome+nome
  - cognome*:text "Cognome"
  - nome*:text "Nome"
  - cf!:text "Codice fiscale"
  - email:email "E-mail"
  - mansioneId:ref>Mansioni "Mansione"
  - mansioniAgg:multiref>Mansioni "Mansioni aggiuntive"
  - sedeId:ref>Sedi "Sede"
  - tipoRapporto:select{Dipendente diretto/Interinale (somministrazione)}=Dipendente diretto "Tipo rapporto"
  - agenziaId:ref>Soggetti?{"tipoRapporto":"Interinale (somministrazione)"} "Agenzia per il lavoro"
  - inizioMissione:date?{"tipoRapporto":"Interinale (somministrazione)"} "Inizio missione"
  - fineMissione:date?{"tipoRapporto":"Interinale (somministrazione)"} "Fine missione prevista"
  - rifContratto:text?{"tipoRapporto":"Interinale (somministrazione)"} "Riferimento contratto / ordine di somministrazione"
  - formGenAgenzia:bool?{"tipoRapporto":"Interinale (somministrazione)"} "Formazione generale a carico dell'agenzia"
  - contratto:list[Tipo contratto] "Tipo contratto"
  - dataAssunzione:date "Data assunzione"
  - dataLicenziamento:date "Data licenziamento / cessazione"
  - inAziendaDal:text(calc) "In azienda dal"
  - stato:text(calc) "Stato"
  - utente:bool "Utente del sistema"
  - ruolo:select{Amministratore/Utente registrazioni}=Utente registrazioni?{"utente":"SI"} "Ruolo di gestione"
  - pinImpostato:text(calc) "PIN di firma impostato"
  - pinHash:hidden
  - pinSalt:hidden

**RapportiLavoro — Storico rapporti di lavoro** — gruppo:- | perm:admin | pacchetto:base | CHILD di Dipendenti | titolo:dal
  - dipendenteId:fk
  - tipo*:select{Dipendente diretto/Interinale (somministrazione)} "Tipo"
  - agenziaId:ref>Soggetti "Agenzia"
  - dal*:date "Dal"
  - al:date "Al"
  - contratto:list[Tipo contratto] "Contratto"
  - rifContratto:text "Riferimento"
  - note:text "Note"

**Mansioni — Mansioni** — gruppo:Anagrafiche | perm:admin | pacchetto:base | figli:MansioniCompetenze(mansioneId),MansioniDpi(mansioneId),MansioniCorsi(mansioneId) | titolo:codice+descrizione
  - ordine:number "Ordine nel mansionario"
  - codice*!:text "Codice mansione"
  - descrizione*:text "Titolo della mansione"
  - descrizioneMansione:textarea "Descrizione della mansione"
  - riportaA:ref>Mansioni "Mansione a cui riporta"
  - sorveglianza:bool "Soggetta a sorveglianza sanitaria"
  - fattoriRischio:multiref>FattoriRischio?{"sorveglianza":"SI"} "Fattori di rischio (protocollo sanitario)"

**Soggetti — Clienti e Fornitori** — gruppo:Anagrafiche | perm:admin | pacchetto:base | titolo:ragioneSociale
  - ragioneSociale*:text "Ragione sociale"
  - indirizzo:text "Indirizzo"
  - comune:text "Comune"
  - piva:text "Partita IVA"
  - cf:text "Codice fiscale"
  - email:email "E-mail"
  - cliente:bool "Cliente"
  - fornitore:bool "Fornitore"
  - descrizioneFornitura:textarea?{"fornitore":"SI"} "Descrizione fornitura"
  - qualifica:text(calc)?{"fornitore":"SI"} "Stato qualifica"
  - mediaQualifica:text(calc)?{"fornitore":"SI"} "Media ultima valutazione"
  - dataQualifica:date(calc)?{"fornitore":"SI"} "Data ultima valutazione"

**Sedi — Sedi** — gruppo:Anagrafiche | perm:admin | pacchetto:base | titolo:denominazione
  - codice*!:text "Codice sede"
  - denominazione*:text "Denominazione"
  - indirizzo:text "Indirizzo"
  - comune:text "Comune"
  - responsabileId*:ref>Dipendenti "Responsabile manutenzione"
  - attiva:bool=SI "Attiva"

**Elenchi — Elenchi personalizzabili** — gruppo:Configurazione | perm:admin | pacchetto:base | titolo:valore
  - categoria*:select{Area competenze/Tipo contratto/Modalità valutazione efficacia/Tipologia NC/Area corso/Tipologia strumento/Tipologia visita medica/Giudizio di idoneità/Tipologia documento/Modalità revisione documento} "Elenco"
  - valore*:text "Valore"
  - ordine:number "Ordine"

**Firme — Registro firme** — gruppo:Configurazione | perm:ro | pacchetto:base | titolo:signerNome
  - rifEntity:text "Documento"
  - rifId:text "ID documento"
  - ruolo:text "Ruolo"
  - signerKey:hidden
  - signerNome:text "Firmatario"
  - signerEmail:text "E-mail"
  - metodo:text "Metodo"
  - stato:text "Stato"
  - dataFirma:datetime "Data firma"
  - fileId:file "File firma / scansione"
  - note:text "Note"
  - token:hidden
  - tokenScad:hidden

**Log — Registro accessi** — gruppo:Configurazione | perm:ro | pacchetto:base | titolo:data
  - data:datetime "Data e ora"
  - email:text "Utente"
  - evento:text "Evento"
  - dettaglio:text "Dettaglio"

**FileReg — File caricati** — gruppo:- | perm:sys | pacchetto:base | titolo:nome
  - nome:text "Nome"
  - mime:text "Tipo"
  - tipo:text "Categoria"

### Pacchetto DPI

**Consegne — Consegne DPI** — gruppo:Registrazioni | perm:reg | pacchetto:dpi | FIRME | figli:ConsegneRighe(consegnaId) | titolo:data
  - data*:date=today "Data consegna"
  - dipendenteId*:ref>Dipendenti "Dipendente"
  - consegnatoDa:ref>Dipendenti=me "Consegnato da"
  - emailInviata:text(ro) "E-mail inviata"
  - note:textarea "Note"

**ConsegneRighe — DPI consegnati** — gruppo:- | perm:reg | pacchetto:dpi | CHILD di Consegne | titolo:dpiId
  - consegnaId:fk
  - dpiId*:ref>TipiDpi "DPI"
  - quantita:number=1 "Q.tà"
  - taglia:text "Taglia"
  - note:text "Note"

**MansioniDpi — DPI previsti** — gruppo:- | perm:admin | pacchetto:dpi | CHILD di Mansioni | titolo:dpiId
  - mansioneId:fk
  - dpiId*:ref>TipiDpi "DPI"
  - quantita:number=1 "Quantità"

**TipiDpi — Tipi DPI** — gruppo:Anagrafiche | perm:admin | pacchetto:dpi | titolo:codice+descrizione
  - codice*!:text "Codice DPI"
  - descrizione*:text "Descrizione"
  - normativa:text "Normativa di riferimento"
  - utilizzo:textarea "Descrizione utilizzo"
  - manutenzione:textarea "Manutenzione"
  - scadenzaMesi:number "Scadenza indicativa (mesi – non vincolante)"
  - note:textarea "Note"

### Pacchetto Formazione

**Corsi — Corsi di formazione** — gruppo:Registrazioni | perm:reg | pacchetto:formazione | FIRME | figli:CorsiDocenti(corsoId),CorsiPartecipanti(corsoId) | titolo:titolo
  - titolo*:text "Titolo del corso"
  - tipoCorsoId*:ref>TipiCorso "Tipologia corso"
  - modalita*:select{Formazione iniziale/Aggiornamento}=Formazione iniziale "Formazione iniziale o aggiornamento"
  - luogo:text "Luogo"
  - enteFormatore:text "Ente formatore / docente (testo)"
  - importato:bool(ro) "Importato da archivio storico"
  - dataInizio*:date=today "Data inizio"
  - dataFine*:date=today "Data fine"
  - durataOre:number "Durata (ore)"
  - nPartecipanti:text(calc) "Partecipanti"
  - programma:textarea "Programma / contenuti"
  - effDescrizione:textarea "Descrizione"
  - effModalita:list[Modalità valutazione efficacia] "Modalità di valutazione"
  - effData:date "Data valutazione"
  - effValutatoreId:ref>Dipendenti "Valutata da"

**CorsiDocenti — Docenti** — gruppo:- | perm:reg | pacchetto:formazione | CHILD di Corsi | titolo:nominativo
  - corsoId:fk
  - tipo*:select{Dipendente/Esterno}=Dipendente "Tipo docente"
  - dipendenteId:ref>Dipendenti?{"tipo":"Dipendente"} "Dipendente"
  - soggettoId:ref>Soggetti?{"tipo":"Esterno"} "Cliente / Fornitore"
  - nominativo:text?{"tipo":"Esterno"} "Nominativo docente"
  - email:email?{"tipo":"Esterno"} "E-mail docente"

**CorsiPartecipanti — Partecipanti** — gruppo:- | perm:reg | pacchetto:formazione | CHILD di Corsi | titolo:dipendenteId
  - corsoId:fk
  - dipendenteId*:ref>Dipendenti "Partecipante"
  - ore:number "Ore frequenza"
  - attestato:file "Attestato"
  - scadenza:date(calc) "Scadenza aggiornamento"

**MansioniCorsi — Corsi richiesti** — gruppo:- | perm:admin | pacchetto:formazione | CHILD di Mansioni | titolo:tipoCorsoId
  - mansioneId:fk
  - tipoCorsoId*:ref>TipiCorso "Tipologia corso"
  - note:text "Note"

**TipiCorso — Tipologie corso** — gruppo:Anagrafiche | perm:admin | pacchetto:formazione | titolo:tipo
  - tipo*!:text "Tipo corso"
  - area*:list[Area corso] "Area"
  - durataOre:number "Durata formazione iniziale (ore)"
  - note:textarea "Programma formazione iniziale (proposto in automatico nei corsi)"
  - aggiornamento:bool "Previsto aggiornamento"
  - frequenzaMesi:number?{"aggiornamento":"SI"} "Frequenza aggiornamento (mesi)"
  - durataAggOre:number?{"aggiornamento":"SI"} "Ore di aggiornamento richieste nel periodo"
  - decorrenza:select{Dalla scadenza precedente/Dalla data di completamento}=Dalla scadenza precedente?{"aggiornamento":"SI"} "Decorrenza del nuovo periodo"
  - programmaAgg:textarea?{"aggiornamento":"SI"} "Programma aggiornamento (proposto in automatico nei corsi di aggiornamento)"

### Pacchetto Competenze

**ValutazioniCompetenze — Valutazioni competenze** — gruppo:Registrazioni | perm:reg | pacchetto:competenze | FIRME | figli:ValutazioniRighe(valutazioneId) | titolo:data
  - dipendenteId*:ref>Dipendenti "Dipendente"
  - mansioneId*:multiref>Mansioni "Mansioni valutate"
  - data*:date=today "Data valutazione"
  - valutatoreId:ref>Dipendenti=me "Valutatore"
  - copertura:text(calc) "Copertura competenze"
  - note:textarea "Note"

**ValutazioniRighe — Competenze valutate** — gruppo:- | perm:reg | pacchetto:competenze | CHILD di ValutazioniCompetenze | titolo:competenzaId
  - valutazioneId:fk
  - competenzaId*:ref>Competenze "Competenza"
  - mansioniRif:multiref>Mansioni(ro) "Richiesta da"
  - valoreAtteso:select{1/2/3/4/5} "Valore atteso"
  - valoreReale:select{1/2/3/4/5} "Valore reale"
  - note:text "Note"

**MansioniCompetenze — Competenze richieste** — gruppo:- | perm:admin | pacchetto:competenze | CHILD di Mansioni | titolo:competenzaId
  - mansioneId:fk
  - competenzaId*:ref>Competenze "Competenza"
  - valoreAtteso*:select{1/2/3/4/5}=3 "Valore previsto"

**Competenze — Competenze** — gruppo:Anagrafiche | perm:admin | pacchetto:competenze | titolo:descrizione
  - area*:list[Area competenze] "Area competenze"
  - descrizione*:textarea "Descrizione della competenza"

### Pacchetto Sorveglianza sanitaria

**SorveglianzaSanitaria — Sorveglianza sanitaria** — gruppo:Sorveglianza sanitaria | perm:san | pacchetto:sanitaria | titolo:dataVisita
  - dipendenteId*:ref>Dipendenti "Lavoratore"
  - mansioniIds:multiref>Mansioni "Mansione specifica"
  - sedeId:ref>Sedi "Sede di lavoro"
  - medicoCompetente:text "Medico competente"
  - strutturaId:ref>Soggetti "Struttura sanitaria / poliambulatorio"
  - tipologia*:list[Tipologia visita medica] "Tipologia visita"
  - dataVisita*:date=today "Data visita"
  - fattoriRischio:multiref>FattoriRischio "Fattori di rischio"
  - accertamenti:textarea "Accertamenti integrativi eseguiti"
  - giudizio*:list[Giudizio di idoneità] "Giudizio di idoneità"
  - inidoneitaFino:date?{"giudizio":"Temporaneamente non idoneo"} "Non idoneo temporaneamente fino al"
  - prescrizioni:textarea "Prescrizioni / limitazioni"
  - dataGiudizio:date "Data giudizio"
  - periodicita*:select{Semestrale/Annuale/Biennale/Triennale/Quinquennale/Altra (indicare i mesi)}=Annuale "Periodicità visita"
  - periodicitaMesi:number?{"periodicita":"Altra (indicare i mesi)"} "Periodicità (mesi)"
  - prossimaVisita:date "Da sottoporre a nuova visita entro il"
  - statoVisita:text(calc) "Stato"
  - fineRapporto:bool "Prevista visita di fine rapporto (agenti cancerogeni / chimici)"
  - trasmLavoratore:date "Trasmissione al lavoratore"
  - trasmDatore:date "Trasmissione al datore di lavoro"
  - modalitaTrasm:text "Modalità di trasmissione"
  - allegato:file "Giudizio di idoneità firmato (PDF)"
  - note:textarea "Note"

**FattoriRischio — Fattori di rischio** — gruppo:Anagrafiche | perm:admin | pacchetto:sanitaria | titolo:descrizione
  - descrizione*!:text "Fattore di rischio"
  - riferimento:text "Riferimento normativo"
  - attivo:bool=SI "Attivo (proposto nelle visite)"

### Pacchetto Non conformità e azioni

**NC — Non conformità e reclami** — gruppo:Registrazioni | perm:reg | pacchetto:nc | FIRME | numerazione:NC-AAAA-NNN | figli:NcCosti(ncId) | titolo:numero
  - numero:auto "Numero"
  - data*:date=today "Data"
  - riferimento:text "Riferimento"
  - stato:select{Aperta/In gestione/Chiusa}=Aperta "Stato"
  - reclamo:bool "Reclamo"
  - isNc:bool=SI "Non conformità"
  - tipologia:list[Tipologia NC] "Tipologia NC"
  - redattoDa:ref>Dipendenti=me "Redatto da"
  - descrizione*:textarea "Descrizione NC"
  - rilevatoreTipo:select{Interno/Fornitore/Altro}=Interno "Rilevato da"
  - rilevatoreDipId:ref>Dipendenti?{"rilevatoreTipo":"Interno"} "Dipendente rilevatore"
  - rilevatoreSoggId:ref>Soggetti?{"rilevatoreTipo":"Fornitore"} "Fornitore"
  - rilevatoreTesto:text?{"rilevatoreTipo":"Altro"} "Rilevatore (testo libero)"
  - gestione:textarea "Gestione / trattamento"
  - analisiCause:textarea "Analisi delle cause"
  - costoTotale:text(calc) "Costo totale €"
  - serveAzione:bool "Serve un'azione di miglioramento"
  - importata:bool(ro) "Importata da archivio storico"

**NcCosti — Costi** — gruppo:- | perm:reg | pacchetto:nc | CHILD di NC | titolo:descrizione
  - ncId:fk
  - descrizione*:text "Descrizione"
  - quantita:number=1 "Quantità"
  - costo:number "Costo unitario €"
  - totale:text(calc) "Totale €"

**Azioni — Azioni di miglioramento** — gruppo:Registrazioni | perm:reg | pacchetto:nc oppure rischi | numerazione:AZ-AAAA-NNN | titolo:numero
  - numero:auto "Numero"
  - ncId:ref>NC "NC di riferimento"
  - rischioId:ref>Rischi "Rischio / opportunità di riferimento"
  - data*:date=today "Data"
  - stato:select{Aperta/In corso/Chiusa}=Aperta "Stato"
  - descrizione*:textarea "Descrizione"
  - responsabileId:ref>Dipendenti "Responsabile"
  - dataPrevChiusura:date "Data prevista chiusura"
  - dataChiusura:date "Data chiusura effettiva"
  - noteEsecuzione:textarea "Cosa è stato fatto"
  - esitoEfficacia:select{Efficace/Non efficace} "Esito della verifica di efficacia"
  - effValutazione:textarea "Valutazione efficacia"
  - effData:date "Data valutazione"
  - effValutatoreId:ref>Dipendenti "Dipendente valutatore"

### Pacchetto Attrezzature e manutenzioni

**Manutenzioni — Manutenzioni** — gruppo:Registrazioni | perm:reg | pacchetto:attrezzature | FIRME | figli:ManutenzioniRighe(manutenzioneId) | titolo:data
  - data*:date=today "Data"
  - attrezzaturaId*:ref>Attrezzature "Attrezzatura"
  - tipo*:select{Ordinaria/Straordinaria}=Ordinaria "Tipo manutenzione"
  - esito:select{Conforme/Non conforme/Da ricontrollare}=Conforme "Esito"
  - descrizione:textarea "Attività realizzate / descrizione"
  - esecutoreTipo:select{Interno/Esterno}=Interno "Eseguita da"
  - esecutoreDipId:ref>Dipendenti?{"esecutoreTipo":"Interno"} "Dipendente esecutore"
  - esecutoreSoggId:ref>Soggetti?{"esecutoreTipo":"Esterno"} "Ditta esterna"
  - esecutoreNome:text?{"esecutoreTipo":"Esterno"} "Tecnico esterno"
  - responsabileId:ref>Dipendenti "Responsabile"
  - costo:number "Costo €"
  - allegato:file "Allegato (rapportino, foto…)"
  - note:textarea "Note"

**ManutenzioniRighe — Attività eseguite** — gruppo:- | perm:reg | pacchetto:attrezzature | CHILD di Manutenzioni | titolo:attivitaId
  - manutenzioneId:fk
  - attivitaId*:ref>AttrezzatureAttivita "Attività del piano"
  - eseguita:bool=SI "Eseguita"
  - note:text "Note / esito"

**PianiManutenzione — Piani di manutenzione** — gruppo:Attrezzature | perm:admin | pacchetto:attrezzature | figli:PianiAttivita(pianoId) | titolo:codice+descrizione
  - codice*!:text "Codice piano"
  - descrizione*:text "Descrizione"
  - note:textarea "Note"

**PianiAttivita — Attività del piano** — gruppo:- | perm:admin | pacchetto:attrezzature | CHILD di PianiManutenzione | titolo:attivita
  - pianoId:fk
  - attivita*:text "Attività"
  - frequenza*:number=1 "Ogni"
  - unita*:select{Giorni/Settimane/Mesi/Anni}=Mesi "Unità"
  - istruzioni:text "Istruzioni"

**TipiAttrezzatura — Tipologie attrezzatura** — gruppo:Attrezzature | perm:admin | pacchetto:attrezzature | titolo:codice+descrizione
  - codice*!:text "Codice tipologia"
  - descrizione*:text "Descrizione"
  - pianoId:ref>PianiManutenzione "Piano di manutenzione standard"

**Attrezzature — Attrezzature** — gruppo:Attrezzature | perm:admin | pacchetto:attrezzature | figli:AttrezzatureAttivita(attrezzaturaId) | titolo:codice+descrizione
  - codice*!:text "Codice attrezzatura"
  - descrizione*:text "Descrizione"
  - tipoId*:ref>TipiAttrezzatura "Tipologia"
  - sedeId*:ref>Sedi "Sede"
  - marca:text "Marca"
  - modello:text "Modello"
  - matricola:text "Matricola / n. serie"
  - dataAcquisto:date "Data acquisto"
  - fornitoreId:ref>Soggetti "Fornitore"
  - stato:select{In uso/Fuori servizio/Dismessa}=In uso "Stato"
  - pianoId:ref>PianiManutenzione "Piano di manutenzione"
  - responsabile:text(calc) "Responsabile manutenzione (dalla sede)"
  - prossimaScadenza:text(calc) "Prossima manutenzione"
  - note:textarea "Note"

**AttrezzatureAttivita — Attività di manutenzione** — gruppo:- | perm:admin | pacchetto:attrezzature | CHILD di Attrezzature | titolo:attivita
  - attrezzaturaId:fk
  - attivita*:text "Attività"
  - frequenza*:number=1 "Ogni"
  - unita*:select{Giorni/Settimane/Mesi/Anni}=Mesi "Unità"
  - attiva:bool=SI "Attiva"
  - ultimaEsecuzione:date(ro) "Ultima esecuzione"
  - prossima:date(calc) "Prossima"

### Pacchetto Qualifica fornitori

**QualificheFornitori — Qualifiche fornitori** — gruppo:Fornitori | perm:reg | pacchetto:fornitori | FIRME | figli:QualificheRighe(qualificaId) | titolo:soggettoId+data
  - soggettoId*:ref>Soggetti "Fornitore"
  - data*:date=today "Data valutazione"
  - valutatoreId:ref>Dipendenti=me "Valutatore"
  - media:text(calc) "Media voti applicabili"
  - esito:text(calc) "Esito"
  - note:textarea "Note / motivazioni"
  - importata:bool(ro) "Importata da archivio storico"
  - mediaImportata:number?{"importata":"SI"} "Punteggio medio importato (1-10)"
  - esitoImportato:select{Qualificato/Non qualificato}?{"importata":"SI"} "Esito importato"
  - valutatoreTesto:text?{"importata":"SI"} "Valutatore (da archivio)"

**QualificheRighe — Domande** — gruppo:- | perm:reg | pacchetto:fornitori | CHILD di QualificheFornitori | titolo:domandaId
  - qualificaId:fk
  - domandaId*:ref>DomandeQualifica "Domanda"
  - voto:select{1/2/3/4/5/6/7/8/9/10/N.A.} "Voto (1-10 / N.A.)"
  - note:text "Note"

**DomandeQualifica — Domande qualifica fornitori** — gruppo:Fornitori | perm:admin | pacchetto:fornitori | titolo:domanda
  - ordine:number "Ordine"
  - domanda*:text "Domanda"
  - attiva:bool=SI "Inclusa nel set standard (importata in ogni nuova qualifica)"

### Pacchetto Strumenti di misura

**Strumenti — Strumenti di misura** — gruppo:Strumenti di misura | perm:admin | pacchetto:strumenti | titolo:codice+descrizione
  - codice*!:text "Codice strumento"
  - descrizione*:text "Descrizione"
  - tipologia:list[Tipologia strumento] "Tipologia"
  - campione:bool "Campione di riferimento"
  - marca:text "Marca"
  - modello:text "Modello"
  - matricola:text "Matricola / n. serie"
  - stato:select{In uso/In taratura/Fuori servizio/Dismesso}=In uso "Stato"
  - campoMisura:text "Campo di misura"
  - risoluzione:text "Risoluzione"
  - unita:text "Unità di misura"
  - ema*:number "Errore massimo ammesso (±)"
  - frequenzaMesi*:number "Frequenza di taratura (mesi)"
  - sedeId:ref>Sedi "Sede"
  - ubicazione:text "Ubicazione / reparto"
  - assegnatarioId:ref>Dipendenti "Responsabile / assegnatario"
  - dataAcquisto:date "Data acquisto"
  - fornitoreId:ref>Soggetti "Fornitore"
  - ultimaTaratura:date(calc) "Ultima taratura"
  - esitoTaratura:text(calc) "Esito ultima taratura"
  - scadenza:date(calc) "Scadenza taratura"
  - statoTaratura:text(calc) "Stato taratura"
  - note:textarea "Note"

**Tarature — Tarature** — gruppo:Strumenti di misura | perm:reg | pacchetto:strumenti | FIRME | figli:TaratureRighe(taraturaId) | titolo:strumentoId+data
  - strumentoId*:ref>Strumenti "Strumento tarato"
  - data*:date=today "Data taratura"
  - tipo*:select{Interna/Esterna}=Interna "Tipo taratura"
  - scadenza:date(calc) "Scadenza (data + mesi di taratura)"
  - esito:text(calc) "Esito"
  - eseguitaDaId:ref>Dipendenti=me?{"tipo":"Interna"} "Eseguita da"
  - laboratorioId:ref>Soggetti?{"tipo":"Esterna"} "Laboratorio / centro di taratura"
  - numCertificato:text "N. certificato / rapporto"
  - certificato:file "Certificato (allegato)"
  - campioneId*:ref>Strumenti?{"tipo":"Interna"} "Campione utilizzato"
  - campioneInfo:text(calc)?{"tipo":"Interna"} "Stato del campione alla data di taratura"
  - condizioni:text "Condizioni ambientali (temperatura, umidità…)"
  - esitoDichiarato:select{Conforme/Conforme con avviso/Non conforme} "Esito dichiarato (solo se non si inseriscono punti di misura)"
  - verificatoDaId:ref>Dipendenti=me "Verificato da (responsabile)"
  - note:textarea "Note"

**TaratureRighe — Punti di misura** — gruppo:- | perm:reg | pacchetto:strumenti | CHILD di Tarature | titolo:punto
  - taraturaId:fk
  - punto:text "Punto / descrizione"
  - valoreCampione*:number "Valore campione"
  - valoreStrumento*:number "Valore strumento"
  - ema:number "Toll. ± (se diversa)"
  - scarto:text(calc) "Scarto"
  - esitoPunto:text(calc) "Esito punto"

### Pacchetto Documentazione

**Documenti — Documenti** — gruppo:Documentazione | perm:doc | pacchetto:documenti | FIRME | figli:DocumentiCollegamenti(documentoId) | titolo:codice+titolo
  - codice*:text "Codice documento"
  - titolo*:text "Titolo"
  - tipologia:list[Tipologia documento] "Tipologia"
  - revisione*:text=0 "Revisione"
  - dataRevisione*:date=today "Data revisione"
  - stato:select{Bozza/In approvazione/In vigore/Superato/Ritirato}(ro)=Bozza "Stato"
  - corrente:bool(calc) "Revisione corrente"
  - modalitaRevisione:list[Modalità revisione documento] "Modalità di revisione"
  - descrizioneModifica:textarea "Descrizione della modifica"
  - redattoDa*:ref>Dipendenti=me "Redatto da"
  - verificatoDa:ref>Dipendenti "Verificato da (facoltativo)"
  - approvatoDa*:ref>Dipendenti "Approvato da"
  - dataApprovazione:date(ro) "Data approvazione"
  - link:text "Link al documento"
  - file:file "File del documento"
  - distTutti:bool "Tutti i dipendenti"
  - distMansioni:multiref>Mansioni "Mansioni destinatarie"
  - distSedi:multiref>Sedi "Sedi destinatarie (tutti i dipendenti della sede)"
  - distDipendenti:multiref>Dipendenti "Altri destinatari singoli"
  - presaVisione:select{Tutti i destinatari/Solo chi non ha letto le revisioni precedenti/Nessuna}=Tutti i destinatari "Presa visione firmata per questa revisione"
  - giorniPresa:number=15 "Giorni per la presa visione"
  - avvisoEmail:bool=SI "Avvisa via e-mail gli utenti del sistema"
  - letture:text(calc) "Prese visione firmate"
  - riesameMesi:number "Riesame ogni (mesi)"
  - prossimoRiesame:date(calc) "Prossimo riesame"
  - note:textarea "Note"
  - importato:bool(ro) "Importato da elenco esistente"
  - sostituisceId:hidden
  - distribuitoIl:hidden

**DocumentiCollegamenti — Collegamenti** — gruppo:- | perm:doc | pacchetto:documenti | CHILD di Documenti | titolo:collegatoId
  - documentoId:fk
  - tipo*:select{Richiama/Modulo da usare/Istruzione di dettaglio/Sostituisce/Altro}=Richiama "Tipo di collegamento"
  - collegatoId*:ref>Documenti "Documento collegato"
  - note:text "Note"

**PreseVisione — Prese visione** — gruppo:Documentazione | perm:reg | pacchetto:documenti | FIRME | titolo:documentoId+dipendenteId
  - documentoId*:ref>Documenti "Documento"
  - dipendenteId*:ref>Dipendenti "Dipendente"
  - assegnataIl:date=today "Assegnata il"
  - entroIl:date "Da firmare entro il"
  - stato:text(calc) "Stato"
  - dataLettura:date(calc) "Firmata il"
  - note:text "Note"

### Pacchetto Rischi e opportunità

**Processi — Processi** — gruppo:Rischi e opportunità | perm:admin | pacchetto:rischi | titolo:codice+descrizione
  - codice*!:text "Codice processo"
  - descrizione*:text "Processo"
  - responsabileId:ref>Dipendenti "Responsabile del processo"

**MetodiRischio — Metodi di valutazione** — gruppo:Rischi e opportunità | perm:admin | pacchetto:rischi | titolo:nome
  - nome*:text "Nome del metodo"
  - riepilogo:text(calc) "Fattori e classi"
  - attivo:bool=SI "Attivo"
  - definizione:hidden

**RegistriRischio — Registri dei rischi** — gruppo:Rischi e opportunità | perm:admin | pacchetto:rischi | titolo:nome
  - codice*!:text "Codice registro"
  - nome*:text "Nome del registro"
  - prefisso*!:text "Prefisso dei codici"
  - tipo*:select{Rischi/Opportunità}=Rischi "Tipo"
  - metodoId*:ref>MetodiRischio "Metodo di valutazione"
  - attivo:bool=SI "Attivo"

**Rischi — Rischi e opportunità** — gruppo:Rischi e opportunità | perm:admin | pacchetto:rischi | titolo:codice+descrizione
  - codice:text(ro) "Codice"
  - registroId*:ref>RegistriRischio "Registro"
  - stato:select{Proposta/Attivo/Chiuso}=Attivo "Stato"
  - valutazione:text(calc) "Valutazione iniziale"
  - residua:text(calc) "Valutazione residua"
  - prossimoRiesame:date "Prossimo riesame"
  - processoId:ref>Processi "Processo"
  - descrizione*:textarea "Descrizione"
  - causa:textarea "Causa"
  - effetto:textarea "Effetto"
  - fonte:text "Fonte"
  - trattamento:textarea "Trattamento"
  - responsabileId:ref>Dipendenti "Responsabile"
  - nAzioni:text(calc) "Azioni"
  - efficacia:textarea "Valutazione dell'efficacia"
  - note:textarea "Note"
  - valIniziale:hidden
  - valResidua:hidden

### 3.1 Elenchi personalizzabili (valori iniziali)
- **Area competenze:** Tecniche, Sicurezza, Qualità, Ambiente, Trasversali
- **Tipo contratto:** Tempo indeterminato, Tempo determinato, Apprendistato, Somministrazione, Stage / Tirocinio
- **Modalità valutazione efficacia:** Colloquio, Attestato, Test scritto, Osservazione sul campo, Riesame della direzione
- **Tipologia NC:** Prodotto, Processo, Fornitore, Sicurezza, Ambiente, Documentale
- **Area corso:** Sicurezza, Qualità, Ambiente, Tecnica, Gestionale
- **Tipologia strumento:** Calibro, Micrometro, Comparatore, Manometro, Termometro, Bilancia, Multimetro, Dinamometro, Chiave dinamometrica
- **Tipologia visita medica:** Preventiva, Preventiva in fase preassuntiva, Periodica, Valutazione idoneità alla mansione, Su richiesta del lavoratore, Cambio mansione, Rientro dopo assenza oltre 60 giorni, Cessazione del rapporto di lavoro
- **Giudizio di idoneità:** Idoneo, Idoneo con prescrizioni, Idoneo con limitazioni, Idoneo con prescrizioni e limitazioni, Temporaneamente non idoneo, Non idoneo permanentemente
- **Tipologia documento:** Manuale, Politica, Procedura, Istruzione operativa, Modulo, Piano, Registro, Documento esterno
- **Modalità revisione documento:** Prima emissione, Revisione parziale, Revisione totale, Aggiornamento normativo, Correzione formale

Fattori di rischio iniziali: Movimentazione manuale dei carichi, Videoterminali, Rumore, Vibrazioni, Agenti chimici, Agenti cancerogeni e mutageni, Agenti biologici, Lavoro notturno, Lavori in quota.
Domande standard di qualifica dei fornitori: Qualità del prodotto / servizio fornito; Rispetto dei tempi di consegna; Conformità e completezza della documentazione; Competitività del prezzo; Assistenza e disponibilità; Gestione di reclami e non conformità.

### 3.2 Configurazione dell'azienda (valori predefiniti)
- `ragioneSociale`: (vuoto)
- `indirizzo`: (vuoto)
- `comune`: (vuoto)
- `piva`: (vuoto)
- `cf`: (vuoto)
- `email`: (vuoto)
- `telefono`: (vuoto)
- `colore`: #1F4E79
- `otpMinuti`: 10
- `sessioneOre`: 6
- `linkFirmaGiorni`: 7
- `emailDpi`: (vuoto)
- `oggettoDpi`: CONSEGNA DPI {NOME} E {DATA}
- `dichiarazioneDpi`: Il lavoratore dichiara di aver ricevuto i dispositivi di protezione individuale elencati, di essere stato informato sul loro corretto utilizzo e si impegna a usarli e conservarli con cura.
- `sogliaQualifica`: 6
- `accessoSanitaria`: Solo amministratori
- `logo`: immagine PNG o JPG usata nelle stampe.

Limiti: `otpMinuti` 3–30, `sessioneOre` 1–6, `linkFirmaGiorni` 1–30, `sogliaQualifica` 1–10, `accessoSanitaria` = "Solo amministratori" oppure "Amministratori e utenti".

---

## 4. Utenti, ruoli e accesso

- Gli utenti sono **dipendenti** con "Utente del sistema = SI" e un'e-mail. Ruoli: **Amministratore** (tutto) e **Utente registrazioni** (registrazioni e consultazione). I cessati non accedono.
- **Eliminazioni:** solo amministratori; bloccate se la scheda è usata altrove (il messaggio dice dove) o se è firmata.
- **Accesso senza password:** l'utente scrive l'e-mail e riceve un codice di 6 cifre valido `otpMinuti`; la risposta è sempre la stessa per non rivelare quali indirizzi esistono; con 6 cifre l'accesso parte da solo. Sessione con token casuale a scorrimento (`sessioneOre`), di cui nel database si salva **solo l'hash**; sopravvive ai riavvii.
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
"Carica DPI della mansione" propone i DPI delle mansioni del dipendente (quantità più alta). Firme: lavoratore e incaricato. Verbale PDF con dichiarazione configurabile; invio per e-mail a `emailDpi` con oggetto `CONSEGNA DPI {NOME} E {DATA}`. Scadenza indicativa = ultima consegna + mesi indicati sul DPI.

### 5.4 Formazione
- Tipologia: durata, programma; se prevede aggiornamento: frequenza in mesi, ore richieste, decorrenza.
- Corso: "Formazione iniziale" oppure "Aggiornamento" (ammesso solo se la tipologia lo prevede); docenti interni o esterni; partecipanti con ore e attestato.
- **Scadenza** per dipendente e tipologia, scorrendo i corsi per data di fine: la formazione iniziale apre un periodo (fine + frequenza); gli aggiornamenti **sommano le ore** (anche frazionati); raggiunte le ore richieste il periodo si rinnova: dalla scadenza precedente se completato in tempo e la decorrenza lo prevede, altrimenti dalla data di completamento. Aggiornamento incompleto = "parziale X/Y h".
- Formazione richiesta: una tipologia collegata a una o più mansioni è richiesta solo a chi le ha; una tipologia non collegata è richiesta a tutti.
- Firme: docenti (anche esterni tramite link) e partecipanti; l'attestato caricato sostituisce la firma. I corsi importati non hanno firme.

### 5.5 Competenze
La griglia propone le competenze richieste dalle mansioni scelte con il valore atteso più alto e l'indicazione "richiesta da". Copertura = percentuale con valore reale ≥ atteso. Firma del valutatore.

### 5.6 Non conformità e azioni
- NC `NC-AAAA-NNN`, stati Aperta / In gestione / Chiusa; reclamo sì/no; rilevatore interno, fornitore o altro; costi come righe (quantità × costo); firma "Redatto da".
- **Azioni di miglioramento** `AZ-AAAA-NNN`, collegate a una NC e/o a un rischio. All'assegnazione parte un'e-mail al responsabile. **Completamento:** solo il responsabile o un amministratore, descrivendo cosa è stato fatto. **Verifica dell'efficacia:** solo amministratori, con evidenze; "Efficace" chiude, "Non efficace" riapre l'azione.
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
- **Registri** configurabili (iniziali: rischi per la qualità `RQ`, salute e sicurezza `RS`, ambientali `RA`, opportunità `OP`), ognuno con un proprio **metodo di valutazione**. Codice progressivo per registro (`RQ-001`).
- **Metodi** configurabili: fattori (codice di 1–3 lettere maiuscole, nome, livelli interi positivi con etichetta) e classi (nome, intervallo, colore, indicazione, mesi di riesame). Il punteggio è il **prodotto dei fattori**. Controlli: almeno un fattore, almeno due livelli per fattore, ogni punteggio possibile coperto da una classe.
- **Istantanea del metodo:** ogni valutazione salva la definizione del metodo usato; cambiare metodo non altera le valutazioni già fatte, che si aggiornano solo rivalutando la voce.
- **Valutazione iniziale e residua** (dopo il trattamento). Prossimo riesame = oggi + mesi della classe della valutazione di riferimento (residua se presente), modificabile a mano.
- **Stati:** Proposta (si conferma solo se valutata, oppure si scarta), Attivo, Chiuso (solo indicando il motivo; resta nello storico).
- **Matrice** dei rischi per i metodi a due fattori.
- **Piano di gestione:** stampa PDF (scopo, metodo, registro, efficacia) e, con il pacchetto Documentazione, documento controllato `PIANO-<prefisso>`: bozza, aggiornamento della bozza, nuova revisione se il piano è in vigore.
- Metodi e voci si modificano solo dalle pagine dedicate, non dalla maschera generica.

Metodi predefiniti:
- **Probabilità × Gravità 3×3** (PG3): fattori P Probabilità [1=Bassa, 2=Media, 3=Alta]; G Gravità [1=Lieve, 2=Moderata, 3=Grave]. Classi: Basso 1–2 (Accettabile, monitorare, riesame 12 mesi, #2F855A); Medio 3–4 (Azioni pianificate, riesame 6 mesi, #B7791F); Alto 5–9 (Azioni prioritarie, riesame 3 mesi, #9B2C2C).
- **Probabilità × Gravità 5×5** (PG5): fattori P Probabilità [1=Improbabile, 2=Poco probabile, 3=Possibile, 4=Probabile, 5=Quasi certa]; G Gravità [1=Trascurabile, 2=Lieve, 3=Moderata, 4=Grave, 5=Molto grave]. Classi: Basso 1–4 (Accettabile, monitorare, riesame 12 mesi, #2F855A); Medio 5–9 (Azioni da pianificare, riesame 6 mesi, #B7791F); Alto 10–16 (Azioni prioritarie, riesame 3 mesi, #C05621); Critico 17–25 (Azioni immediate, riesame 1 mesi, #9B2C2C).
- **Probabilità × Gravità × Rilevabilità** (PGR): fattori P Probabilità [1=Remota, 2=Bassa, 3=Media, 4=Alta, 5=Molto alta]; G Gravità [1=Trascurabile, 2=Lieve, 3=Moderata, 4=Grave, 5=Molto grave]; R Rilevabilità (1 = facilmente rilevabile) [1=Certa, 2=Alta, 3=Media, 4=Bassa, 5=Nulla]. Classi: Basso 1–20 (Accettabile, monitorare, riesame 12 mesi, #2F855A); Medio 21–50 (Azioni da pianificare, riesame 6 mesi, #B7791F); Alto 51–125 (Azioni prioritarie, riesame 3 mesi, #9B2C2C).
- **Opportunità: Beneficio × Fattibilità 3×3** (BF3): fattori B Beneficio [1=Basso, 2=Medio, 3=Alto]; F Fattibilità [1=Difficile, 2=Possibile, 3=Agevole]. Classi: Priorità bassa 1–2 (Valutare in futuro, riesame 12 mesi, #718096); Priorità media 3–4 (Pianificare, riesame 6 mesi, #2B6CB0); Priorità alta 5–9 (Perseguire, riesame 3 mesi, #2F855A).

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

## 8. Stampe PDF (23)

Formato comune: A4, intestazione con logo e dati dell'azienda, titolo in maiuscolo, tabelle, riquadro firme con immagine della firma e metodo, piè di pagina con data e numero di pagina; QR code sulle schede di attrezzature e strumenti.
Elenco: verbaleConsegna, registroCorso, moduloNc, valutazione, rapportoManutenzione, schedaAttrezzatura, schedaDpi, schedaMansione, moduloQualifica, rapportoTaratura, schedaStrumento, schedaDocumento, storicoAttrezzatura, mansionario, interinali, storicoDipendente, riepilogoNc, fornitoriQualificati, registroStrumenti, registroSanitario, pianoRischi, elencoDocumenti, matriceDistribuzione.
Scheda documento, elenco documenti e matrice di distribuzione sono riservate agli amministratori; il registro sanitario agli autorizzati.

---

## 9. Import ed export Excel

**Regole comuni a ogni import** (solo amministratori): "Scarica modello" (foglio dati con intestazioni, riga d'esempio che inizia con "(esempio)" e viene ignorata, fogli di consultazione, istruzioni); "Verifica" (esegue tutto e poi annulla: l'anteprima è identica al risultato reale); "Importa" (salta errori e doppioni, mostra il resoconto riga per riga). Intestazioni riconosciute ignorando maiuscole, accenti e testo tra parentesi; date gg/mm/aaaa o in formato Excel; Sì/No/SI/NO/X; dipendenti riconosciuti per "Cognome Nome", "Nome Cognome" o codice fiscale; accettati `.xlsx` e `.csv`. Gli import rispettano il limite della licenza.

- **Attrezzature** (`attrezzature`): foglio "Attrezzature": Codice*, Descrizione*, Codice tipologia*, Codice sede*, Marca, Modello, Matricola, Data acquisto, P.IVA fornitore, Stato, Note.
- **Dipendenti** (`dipendenti`): foglio "Dipendenti": Cognome*, Nome*, Codice fiscale*, E-mail, Codice mansione, Codice sede, Tipo contratto, Data assunzione, Data cessazione.
- **Formazione storica** (`formazione`): foglio "Formazione": CF dipendente*, Tipologia corso*, Modalità, Data inizio, Data fine*, Ore, Titolo, Ente/docente, Luogo, Programma.
- **Clienti e fornitori** (`soggetti`): foglio "Soggetti": Ragione sociale*, P.IVA, CF, Indirizzo, Comune, E-mail, Fornitore, Cliente, Descrizione fornitura; foglio "Valutazioni" (facoltativo): Fornitore*, Data*, Punteggio medio, Esito, Valutatore, Note.
- **Non conformità e azioni** (`nc`): foglio "NC": Numero, Data*, Riferimento, Stato, Reclamo, NC, Tipologia, Redatto da, Descrizione*, Rilevato da, Rilevatore, Gestione, Cause, Costo totale, Serve azione; foglio "Azioni" (facoltativo): Numero NC, Numero azione, Data, Stato, Descrizione*, Responsabile, Data prevista, Data chiusura, Efficacia, Data valutazione, Valutatore.
- **Elenco documenti** (`documenti`): foglio "Documenti": Codice*, Titolo*, Tipologia, Revisione*, Data revisione*, Modalità, Descrizione modifica, Redatto da, Verificato da, Approvato da, Data approvazione, Link, Stato, Codici mansioni destinatarie, Tutti i dipendenti, Riesame mesi, Note; foglio "Collegamenti" (facoltativo): Codice documento*, Tipo, Codice collegato*, Note.

Regole particolari: la formazione raggruppa i partecipanti nello stesso corso (stessa tipologia, data e titolo), marcato "importato"; i soggetti si riconoscono per P.IVA o ragione sociale normalizzata; nelle NC le tipologie nuove vengono aggiunte all'elenco; nei documenti, con stato vuoto la revisione più alta va in vigore e le altre sono superate, senza distribuzione automatica.

**Export Excel:** scheda dipendente, registro strumenti, registro sorveglianza sanitaria, esportazione completa dei dati aziendali.

---

## 10. Pannello della piattaforma (`/admin`)

Accesso con `ADMIN_KEY` (variabile d'ambiente, mai salvata nel browser; confronto a tempo costante; ritardo dopo una chiave errata; 60 richieste ogni 5 minuti).
Funzioni: elenco aziende con classe, addetti, pacchetti, righe, file e spazio usato; nuova azienda con amministratore iniziale; azienda dimostrativa; licenza (classe e pacchetti); sospensione e riattivazione; eliminazione definitiva riscrivendo il codice; esportazione e ripristino; codice di accesso per un utente e sblocco (annotati nel registro dell'azienda); e-mail di prova e registro delle ultime 50 e-mail (i codici sono nascosti se l'e-mail è stata consegnata).

---

## 11. Sicurezza

- Intestazioni: Content-Security-Policy (`default-src 'self'`, niente script o stili in linea, `frame-ancestors 'none'`, `object-src 'none'`), X-Frame-Options DENY, HSTS, nosniff, Referrer-Policy same-origin, Permissions-Policy.
- Limite di 1500 richieste ogni 5 minuti per connessione (`LIMITE_RICHIESTE`); richieste oltre 1 MB solo con sessione valida.
- Permessi e pacchetti sempre controllati sul server. Un file si scarica solo se appartiene a una scheda visibile all'utente, oppure se l'ha caricato lui e non è ancora salvato.
- Allegati: solo PDF, immagini, Word, Excel, ODT, ODS, CSV; massimo 15 MB; il tipo è dedotto dall'estensione; salvati nel database.
- Nessun segreto nel codice; i codici di accesso non finiscono mai nei registri. In produzione il server non parte senza database. Il database non è raggiungibile da Internet.
- Variabili: `DATABASE_URL`, `ADMIN_KEY`, `PIATTAFORMA_EMAIL`, `SMTP_*`, `URL_PUBBLICO`, `LIMITE_RICHIESTE`, `TRUST_PROXY_HOPS`, `TZ=Europe/Rome`.

---

## 12. Interfaccia

Pagina unica con menu laterale e area principale; adatta al telefono (nessuno scorrimento orizzontale a 390 px, tabelle scorrevoli al loro interno, pulsanti di almeno 44 px). Elenchi con ricerca, filtri, ordinamento e colori di stato. Maschere con campi condizionali, griglie dei figli, pulsanti delle azioni e delle stampe, riquadro firme. Avvisi a scomparsa e finestre di conferma, mai le finestre del browser.
Pagine speciali: cruscotto, scadenzario, scheda dipendente, I miei documenti, riepilogo NC, manutenzione massiva, elenco fornitori qualificati, registro strumenti, registro sanitario, rischi e opportunità (con matrice), metodi di valutazione, sei pagine di import, dati azienda e logo, esporta dati, pagina pubblica di firma tramite link, pannello della piattaforma.

---

## 13. Test e consegna

- `npm test` esegue tutti i test su database in memoria: aziende, pacchetti, licenze, motore, accesso, permessi, firme con tutti i metodi, regole di ogni pacchetto, documentazione, rischi, import, stampe, esportazione e ripristino, scadenzario, cruscotto, pannello, azienda dimostrativa.
- `node test/demo.js`: server di prova in locale con azienda dimostrativa. `node test/verifica-installazione.js <indirizzo>`: verifica di un'installazione vera (Docker o Render).
- Archivio: `app/` (schema, regole, stampe, import/export, pagine), `server/` (server, database, posta), `test/`, `render.yaml`, `Dockerfile`, `docker-compose.yml`, `README.md`, `STATO.md`.
- **Prima di ogni modifica ai piani o ai costi dell'hosting chiedi conferma al committente.** Ogni operazione che il committente deve fare su GitHub, Render o Docker va spiegata un passo alla volta. Non chiedere mai password.

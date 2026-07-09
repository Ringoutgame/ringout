# Systemanalyse RingOut — 2026-07-09

Einmalige High-Level-Analyse des Entwicklungssystems (Rolle: Principal Engineer /
Technical Director / Senior Reviewer / AI Workflow Architect). Stand: M8-T3c
(Online-FFA) committed und gepusht (`ec70410`), Working Tree sauber, Live-Smoke
des Online-FFA (T3e) noch offen.

**Zweck:** Beste Arbeitsweisen, Qualitätsstandards und Projektregeln dieser
Sessions in dauerhafte Workflows, Regeln und Checklisten übersetzen, damit
zukünftige Claude-Code-Sessions (modellunabhängig) auf demselben Niveau arbeiten.

**Status: NUR Analyse.** Keine der folgenden Maßnahmen ist umgesetzt; die
Umsetzung erfolgt später in separaten Infra-/Workflow-Tasks mit eigener Freigabe.

---

## 1. Kurzfazit

**Sehr gut läuft:**
- Sicherheitsnetz-Kultur: Änderungen an simulationsnahem Code werden bit-exakt
  gegen Goldens bewiesen; Rules-Änderungen dreifach verifiziert (lokale
  Rules-Engine-Suite → Live-REST → Zwei-Tab-Smoke).
- Inkrementelle Task-Zerlegung mit Freigabe-Gates (Muster M8-T3a Vorbereitung →
  T3b Cutover → T3c Aktivierung) — Features gehen live, ohne Bestand (1v1/2v2)
  je zu gefährden.
- Doku (CHANGELOG/TODO/PROJECT) ist zum Push-Zeitpunkt immer synchron.
- Determinismus-Denken als Entwurfsmuster etabliert (Referenz: Leave-Sentinel).

**Größtes Risiko:**
- 7 von 9 Test-Suiten (Bestand 83, FFA-Kern, FFA-Online-Prep, FFA-Online-Flow,
  Rules-Suite, REST-Verify, Syntax-Check) liegen NUR im flüchtigen,
  session-spezifischen Scratchpad — ein Temp-Cleanup vernichtet sie, und
  „83/83 grün" ist dann unbeweisbar. Nur Golden + Mapping sind im Repo
  (`tools/`).
- Strukturell: `index.html`-Monolith mit Regex-Extraktion als ungeschriebenem
  „API-Vertrag" (Top-Level-`}` in Spalte 0, One-Line-Konstanten) — bricht bei
  harmlosen Umformatierungen und ist nirgends dokumentiert.

**Wichtigste dauerhafte Verbesserung:**
- Test-Infrastruktur ins Repo (`tools/` + `run_all_tests`-Runner + GitHub-
  Actions-CI) und die Session-Erfahrung als CLAUDE.md-Regeln kodifizieren.

---

## 2. Systembewertung (1–10)

| Bereich | Note | Begründung (kurz) |
|---|---|---|
| Architektur | 6 | Saubere logische Schichten, deterministischer Lockstep; aber Ein-Datei-Monolith, globale Mutable-State-Variablen, kein Build |
| Codequalität | 7 | Konsistent, absichtsvoll benannt, Kommentare an Trade-offs; sehr dichte Einzeiler erschweren Einstieg |
| Tests | 8 | Herausragend fürs Projektformat (bit-exakt, Rules-Engine, Flow-Harness, Selftests); Abzug: Suiten nicht committet, kein CI |
| Dokumentation | 8 | Immer synchron, Entscheidungen begründet; Abzug: CHANGELOG-Einträge sind Monster-Absätze (Token-/Lesekosten) |
| Git-Workflow | 8 | Konventionelle Commits, Push-Verifikation, sauberer Tree als Abschlusskriterium; alles auf main, keine Tags/Branches/CI |
| Security | 6 | Rules v2 verifiziert, beidseitiges sanitize, ehrliche Bedrohungsgrenze dokumentiert; ohne Auth/App Check/TTL nur Friend-Code-tauglich (bekannt) |
| Performance | 7 | Hot-Path-Disziplin, 60 FPS mobil gemessen; kein systematisches Profiling, 5-Spieler-3D ungemessen (prüfen) |
| Produktfokus | 9 | Jede Task zahlt auf den Playtest ein; 100k-Frage erzwingt Kommerz-Denken |
| Token-Effizienz | 4 | CLAUDE.md lang/redundant, Pflicht-Lektüre von 4 Docs pro Task, riesige CHANGELOG-Absätze, Wissensverlust bei /compact |
| Skalierbarkeit f. zukünftige Projekte | 6 | Meta-Workflows übertragbar, aber nicht als Template extrahiert; Extraktions-Testansatz ist index.html-spezifisch |

---

## 3. Die 10 wichtigsten Schwachstellen

1. **Test-Suiten ephemer.** Risiko: Totalverlust, unreproduzierbare
   „grün"-Aussagen. Lösung: nach `tools/` committen + `tools/run_all_tests.js`
   als Ein-Befehl-Runner (REST-Verify separat, da Live-Writes).
   Aufwand: niedrig. **P0.**
2. **Extraktions-Kontrakt undokumentiert.** Risiko: Umformatierung bricht 200+
   Checks oder Extraktion greift stillschweigend Falsches. Lösung: Kontrakt in
   PROJECT.md/CLAUDE.md festschreiben; Grep-Pflicht vor Rename.
   Aufwand: niedrig. **P1.**
3. **Kein CI.** Risiko: gepushter roter Zustand. Lösung: GitHub Action
   `node tools/run_all_tests.js` bei jedem Push (nur lokale Suiten, kein REST).
   Aufwand: niedrig (nach Nr. 1). **P1.**
4. **Token-Kostenstruktur.** Risiko: teure Sessions, frühe Kompaktierung,
   Kontextverlust. Lösung: Abschnitt 6. Aufwand: mittel. **P1.**
5. **Monolith ohne Modulpfad.** Risiko: Merge-/Kontext-/Testkosten steigen;
   Web-Worker-Bot und three.js-Self-Hosting blockiert. Lösung: Build-System als
   echtes Milestone nach dem Playtest, Golden-abgesichert. Aufwand: hoch. **P2.**
6. **Public-Launch-Security nicht als Gate formalisiert.** Risiko:
   versehentlicher Public-Launch im Friend-Code-Sicherheitsmodell. Lösung: harte
   „Public-Launch-Gate"-Checkliste (Auth, App Check, API-Key-Restriktion,
   Room-TTL) in TODO/ROADMAP. Aufwand: niedrig. **P1.**
7. **Desync wäre unsichtbar.** Lösung: lokaler Sim-Hash pro Rundenende in der
   Konsole (DB-Mitsenden unmöglich — Rules `$other:false`); im Playtest
   vergleichbar. Aufwand: niedrig. P3 (prüfen: Nutzen vs. Rauschen).
8. **Keine Versionsmarken.** Lösung: Git-Tag je akzeptiertem Milestone +
   Kurznotiz — Referenz-/Rollback-Punkte für Playtest-Feedback.
   Aufwand: niedrig. **P2.**
9. **Operatives Umgebungswissen nicht persistent** (PowerShell-5.1-Fallen,
   `git commit -F`, Testkommandos, Cutover-Reihenfolge). Lösung: kompakter
   Betriebshandbuch-Abschnitt (CLAUDE.md oder docs/ENGINEERING.md).
   Aufwand: niedrig. **P1.**
10. **T3d-Rest + Rematch-„Geist".** Verlassene bleiben im Rematch als
    Sofort-Eliminierte; kein Reconnect; Host-Crash zwischen state/seats lässt
    Gäste kurz hängen (Presence-Abbruch fängt es). Lösung: T3d als
    Entscheidungsliste, dann Umsetzung. Aufwand: mittel. **P2.**

---

## 4. Regel-Vorschläge für CLAUDE.md (noch NICHT eingebaut)

```markdown
### Determinismus-Regel (Online)
- Simulationsrelevante Entscheidungen dürfen NUR aus Daten abgeleitet werden, die
  alle Clients identisch aus der DB lesen (Moves/gen/seats). Presence-Events,
  Wall-Clock oder lokale Timings dürfen NIE Sim-Zustand ändern — nur UI/Meta.
  (Referenzmuster: Leave-Sentinel M8-T3c.)

### Gating-Regel (Bestandsschutz)
- Neue Online-/Modus-Features strikt hinter Format-Gates (z. B. fmt==='ffa').
  Bestandspfade müssen verhaltensgleich bleiben und per Regressionssuite +
  gepinnten Code-Kontrakten (byte-identische Substrings) bewiesen werden.

### Extraktions-Kontrakt (Tests)
- Top-Level-Funktionen in index.html schließen mit `}` in Spalte 0; Physik-/
  Konfig-Konstanten bleiben einzeilig. Vor Rename/Umformatierung extrahierter
  Funktionen: grep des Namens über tools/ und Testdateien, danach kompletter
  Suiten-Lauf.

### Rules-/Cutover-Reihenfolge
- Rules-Änderung: lokale Rules-Suite grün → Owner publisht in der Console →
  SOFORT REST-Verify gegen die Live-DB → erst danach Client-Commit/Push.
  Client-Fixtures beziehen die Protokollversion IMMER aus index.html (nie hardcoden).

### Test-Verankerung
- Jede neue Suite wird nach tools/ committet — niemals nur im Scratchpad.
  Vor jedem Push: node tools/run_all_tests.js (ein Befehl, alle lokalen Suiten).

### CHANGELOG-Format
- Max. ~5 Zeilen pro Eintrag: Was + Warum + Testergebnis. Details gehören in
  PROJECT.md bzw. den Commit-Body.

### Session-Start (statt Volltext-Lektüre aller Docs)
- git log --oneline -5 + git status + TODO.md-Kopf + NUR den PROJECT.md-Abschnitt
  des betroffenen Systems lesen. Volltext nur bei Architektur-Tasks.

### Windows/PowerShell
- Commits mit mehrzeiliger Message via `git commit -F <datei>`; kein `&&` in
  PowerShell 5.1; POSIX-Skripte über die Bash.
```

---

## 5. Standard-Workflows (Checklisten)

- **Feature-Task:** Briefing+Freigabe → betroffene Funktionen greppen (auch in
  tools/) → Gating-Design → implementieren → Suiten komplett → neue Tests für
  neues Verhalten → manuelle Prüfung/Sichtprüfung → Doku → Commit → Push → Verify.
- **Bugfix:** Repro zuerst (Test, der rot ist) → minimaler Fix → Test grün +
  Gesamtlauf → Regressionstest bleibt im Repo → CHANGELOG „fix:" → Rest wie oben.
- **Refactor:** Nur mit grüner Ausgangslage → Verhalten pinnen
  (Golden/Substring/Suite) → kleine Schritte, nach jedem Schritt Suiten →
  keine Feature-Beimischung.
- **Firebase/Rules:** Änderung lokal in firebase.rules.json → Rules-Suite
  erweitern & grün → Briefing (was wird strenger/lockerer, Bestandsschutz) →
  Owner publisht → REST-Verify sofort → Client-Änderung → Zwei-Tab-Smoke →
  Doku/Push.
- **Protocol-Bump:** Nur bei sim-/schema-relevanten Änderungen → Version +
  Kommentar in index.html → Fixtures folgen automatisch (VER-Extraktion) →
  Rules-`v`-Check anpassen → Cutover-Reihenfolge wie oben → Live-Smoke beide
  Seiten.
- **Performance:** Erst messen (`?perf=1`, konkrete Zahl) → Hypothese → Änderung
  → erneut messen → Golden bit-exakt beweisen → nie „gefühlt schneller" committen.
- **Großer Architektur-Umbau:** Eigenes Milestone → Sicherheitsnetz VOR Umbau
  erweitern → reviewbare Schritte (jeder einzeln grün+gepusht) → Feature-Freeze
  währenddessen → Rollback-Punkt taggen.
- **Vor Commit:** Suiten komplett grün · git diff --staged gelesen · nur
  geplante Dateien · Doku synchron · keine Debug-Reste.
- **Vor Push:** Bekannte Fehler? → nicht pushen · Commit-Message konventionell
  ≤72 · Blocker/Gates unangetastet?
- **Nach Push:** git status clean · LOCAL==REMOTE · ggf. Live-URL-Smoke ·
  Abschlussmeldung nur wenn alles verifiziert.
- **/compact sinnvoll:** an Task-Grenzen (nach Abschluss+Push, vor neuem
  Briefing) — nie mitten in Implementierung/Debugging.
- **/clear sinnvoll:** komplett neues, unabhängiges Thema; vorher offene
  Erkenntnisse in Memory/Doku sichern.

---

## 6. Token-Sparsystem

1. CLAUDE.md um ~40–50 % kürzen: Allgemeinplätze straffen, projektspezifische
   Workflows behalten — wirkt in jeder Session, jedem Turn.
2. Gezielte Reads statt Volltext: Grep + Offset-Reads; index.html nie am Stück;
   Testausgaben mit `tail -1`.
3. Ein Runner statt 9 Einzelkommandos pro Testlauf.
4. CHANGELOG-Diät (Format-Regel): weniger schreiben UND weniger lesen.
5. Wissen in Dateien statt Konversation: Betriebshandbuch + Memory — nach
   /compact muss nichts neu hergeleitet werden.
6. Kompakte Briefings beibehalten; Detailanalysen nur auf Abruf.
7. Session-Zuschnitt: eine Task pro Session, /compact an der Grenze —
   verhindert teure Mid-Task-Kompaktierungen.

---

## 7. Tool-/Integrationsanalyse

- **Claude Code:** Kernwerkzeug. Ungenutzte Hebel: `/code-review` vor großen
  Diffs; Memory-Verzeichnis konsequenter für Betriebswissen.
- **OpenAI Codex CLI / ChatGPT:** Zweitmeinung/Konzept-Sparring sinnvoll.
  Regel: nur EIN Agent schreibt in den Working Tree (Konfliktrisiko mit dem
  strengen Stage-/Clean-Tree-Workflow). Konkrete heutige ChatGPT-Nutzung:
  prüfen (im Repo nicht sichtbar).
- **GitHub:** Größter ungenutzter Nutzen: Actions-CI (kostenlos, nach
  Test-Commit trivial), Tags/Releases je Milestone. Branch-Protection optional
  bei Solo-Entwicklung.
- **Firebase:** Console-Publish + REST-Verify ist als Prozess solide;
  `firebase-tools`-CLI-Deploy wäre reproduzierbarer, aber neue Dependency →
  Owner-Gate, später. App Check/Auth/TTL = Public-Gate.
- **Tests/Skripte:** Extraktions-Suiten sind das Kronjuwel — committen, Runner,
  CI.
- **MCPs/Integrationen:** Einzig mit klarem Nutzen: Browser-Automation
  (Playwright-artig) für Multi-Tab-Smokes — berührt die bewusste „keine
  Headless-Tests"-Entscheidung → Owner-Entscheid, prüfen. Firebase-MCPs: kein
  Bedarf, REST-Skripte decken es ab.

---

## 8. Die 20 wichtigsten Verbesserungen

| # | Verbesserung | Warum | Nutzen | Aufwand | Risiko | Prio | Wann | Ziel |
|---|---|---|---|---|---|---|---|---|
| 1 | Scratchpad-Suiten nach tools/ committen | Verlustrisiko | sehr hoch | niedrig | niedrig | 10 | sofort | tools/ |
| 2 | run_all_tests.js-Runner | 1 Befehl statt 9 | hoch | niedrig | niedrig | 9 | sofort | tools/ |
| 3 | GitHub-Actions-CI | roter Push unmöglich | hoch | niedrig | niedrig | 9 | sofort | .github/ |
| 4 | CLAUDE.md straffen + Regeln (§4) | Token+Qualität dauerhaft | hoch | mittel | niedrig | 9 | sofort | CLAUDE.md |
| 5 | Extraktions-Kontrakt dokumentieren | stiller Testbruch | hoch | niedrig | niedrig | 8 | sofort | PROJECT/CLAUDE.md |
| 6 | Betriebshandbuch (PS-Fallen, Kommandos, Cutover) | Session-Anlaufzeit | mittel | niedrig | niedrig | 8 | sofort | docs/ o. CLAUDE.md |
| 7 | Public-Launch-Gate-Checkliste | Sicherheits-Fehlstart | hoch | niedrig | niedrig | 8 | sofort | TODO/ROADMAP |
| 8 | CHANGELOG-Kurzformat-Regel | Token/Lesbarkeit | mittel | niedrig | niedrig | 7 | sofort | CLAUDE.md |
| 9 | Milestone-Tags | Referenz/Rollback | mittel | niedrig | niedrig | 7 | später | Git |
| 10 | T3e Live-Smoke Online-FFA | Abnahme steht aus | hoch | niedrig | niedrig | 8 | nächste Task | Workflow |
| 11 | T3d Disconnect-Restmatrix | Playtest-UX | mittel | mittel | mittel | 6 | später | index.html |
| 12 | REST-Testräume löschen (7SNX/DDKU/5CZ4) | DB-Hygiene | niedrig | niedrig | niedrig | 4 | später | Firebase-Console |
| 13 | Sim-Hash-Desync-Wächter (Konsole) | unsichtbare Desyncs | mittel | niedrig | niedrig | 5 | später | index.html |
| 14 | M5-T2 Tuning-Pass (→v3) nach Playtest | Spielgefühl | hoch | mittel | mittel | 6 | später | index.html+Rules |
| 15 | API-Key-Restriktion + Room-TTL | Public-Vorstufe | hoch | mittel | mittel | 6 | später | Firebase |
| 16 | Auth + App Check | Public-Gate | sehr hoch | hoch | mittel | 6 | großes Projekt | Firebase+Client |
| 17 | Build-System / Modul-Split | Skalierung, Worker, Self-Hosting | sehr hoch | hoch | hoch | 6 | großes Projekt | Repo-Struktur |
| 18 | Bot in Web Worker | UI-Blockierung Schwer-Bot | mittel | mittel | mittel | 5 | großes Projekt (nach 17) | src/ |
| 19 | Workflow-Template für neue Projekte | Wiederverwendung | mittel | mittel | niedrig | 5 | später | separates Repo/Doc |
| 20 | Browser-Automation für Multi-Tab-Smokes | manuelle Testlast | mittel | hoch | mittel | 4 | prüfen/Owner-Entscheid | Tooling |

---

## 9. Sofortplan (empfohlene Reihenfolge)

1. **Analyse sichern** (diese Datei). ✅
2. **Test-Rettung:** Scratchpad-Suiten nach `tools/`, Runner-Skript, ein Commit
   (`test: commit full local test battery + runner`) — eigener Task mit Briefing.
3. **CI:** GitHub Action auf den Runner (~20 Zeilen YAML).
4. **CLAUDE.md-Überarbeitung:** Kürzung + Regeln (§4) + Checklisten (§5).
5. **Public-Launch-Gate** als Checkliste in TODO.md verankern.

## 10. Entscheidung zur Umsetzung

Empfehlung: Umsetzung als separate Tasks in obiger Reihenfolge; jeder Schritt
mit kompaktem Briefing und Owner-Freigabe (Option „D" mit Start bei „A").

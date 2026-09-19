#!/usr/bin/env node
// Shared Render Recovery: eine fehlgeschlagene Darstellung darf die Bildschleife nie beenden.
//
// Die Hauptschleife (loop) treibt Simulation UND Darstellung. Frueher meldete sie das
// naechste Bild erst ganz am Ende an - EIN Wurf in draw() oder r3d.render() verliess die
// Schleife davor, und danach gab es weder ein Bild noch einen Simulationsschritt mehr.
// Diese Suite fuehrt die ECHTEN Funktionen loop, presentFrame und presentFailed aus
// index.html in einer Sandbox aus und prueft:
//   A  ein einzelner Render-Fehler beendet die Schleife nicht
//   B  genau eine Anmeldung je Bild - keine zweite Kette, auch nicht waehrend der Erholung
//   C  ein wiederkehrender Fehler endet nach hoechstens drei Wiederherstellungen kontrolliert
//   D  die Simulation laeuft in jedem Bild weiter, auch waehrend der Erholung
//   E  ohne 3D-Szene (2D) laeuft die Schleife trotz Fehler weiter, gemeldet wird einmal
//   F  ein echter Kontextverlust bleibt beim bestehenden Ereignispaar
//   G  Quelltextvertrag: kein zweites Wiederherstellungssystem, Wiedergabe-Pfad geschuetzt
//   H  Matchstart: Kontextverlust im Szenenaufbau, Rueckgabe-Frist, Endzustand mit Knopf, Puffer
//
//   node tools/test_render_recovery.js
//   RENDER_TEST_HTML=<andere index.html> node tools/test_render_recovery.js   (Gegenprobe)
'use strict';
const fs = require('fs');
const { loadIndexHtml, grabFunction } = require('./extract');

const html = process.env.RENDER_TEST_HTML
  ? fs.readFileSync(process.env.RENDER_TEST_HTML, 'utf8').replace(/\r\n/g, '\n')
  : loadIndexHtml();

let passed = 0, failed = 0;
function ok(c, name, info) {
  if (c) passed++;
  else { failed++; console.log('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}

const hat = n => new RegExp('(^|\\n)function\\s+' + n + '\\s*\\(').test(html);
const quellen = [grabFunction(html, 'loop')];
if (hat('presentFrame')) quellen.unshift(grabFunction(html, 'presentFrame'));
if (hat('presentFailed')) quellen.unshift(grabFunction(html, 'presentFailed'));
const maxM = html.match(/const R3D_RENDER_RECOVERIES_MAX=(\d+);/);

// Eine Sandbox je Szenario: alles, was loop beruehrt, als beobachtbarer Stumpf.
function welt(opt) {
  const w = {
    raf: [], sim: 0, draws: 0, renders: 0, recovers: 0, giveUps: 0, errors: [], warns: [],
    r3dActive: opt.r3d !== false, r3dContextLost: false, replaying: !!opt.replaying,
    renderWirft: opt.renderWirft || (() => false), drawWirft: opt.drawWirft || (() => false),
    erholtNach: opt.erholtNach === undefined ? 2 : opt.erholtNach,   // Bilder bis zum bestaetigten Restore
    restoreKlappt: opt.restoreKlappt !== false,
    bis: 0
  };
  const sandbox = `
    let PERF=false, phase='aim', prevPhaseFx='aim', balls=[], bootDone=true;
    let replaying=W.replaying, r3dActive=W.r3dActive;
    let r3dContextLost=false, r3dRenderFails={};
    const R3D_RENDER_RECOVERIES_MAX=${maxM ? maxM[1] : 3};
    const console={error:(...a)=>W.errors.push(a.map(String).join(' ')),warn:(...a)=>W.warns.push(a.map(String).join(' '))};
    function perfTick(){}
    function simAdvance(){W.sim++;}
    function fbMusicSync(){} function tickCollapse(){} function showRingout(){} function devSync(){}
    function fbClockPaint(){} function finishBoot(){} function gameSurfaceSync(){}
    const SFX={rollUpdate(){}};
    function draw(){W.draws++; if(W.drawWirft(W.draws))throw new Error('Figur ohne Farbe');}
    function requestAnimationFrame(f){W.raf.push(f);}
    const r3d=!W.r3dActive?null:{
      render(){W.renders++; if(W.renderWirft(W.renders))throw new Error('GPU-Treiberfehler');},
      // Nachbildung des bestehenden Zyklus: pausieren, nach einigen Bildern bestaetigtes Bild.
      recover(){W.recovers++; r3dContextLost=true; W.bis=W.frame+W.erholtNach;},
      giveUp(){W.giveUps++; r3dContextLost=true; W.bis=Infinity;}
    };
    ${quellen.join('\n')}
    W.tick=(frame)=>{
      W.frame=frame;
      // der asynchrone Restore endet: bestaetigtes Bild aus dem aktuellen Zustand
      if(r3dContextLost&&frame>=W.bis){
        try{ r3d.render(); if(W.restoreKlappt)r3dContextLost=false; else W.bis=Infinity; }
        catch(_){ W.bis=Infinity; }
      }
      W.lost=r3dContextLost;
    };
    W.setLost=v=>{r3dContextLost=v; if(v)W.bis=Infinity;};
    return loop;`;
  const loop = new Function('W', sandbox)(w);
  w.loop = loop;
  return w;
}
// Faehrt die Schleife so, wie der Browser es tut: nur ein angemeldetes Bild wird ausgefuehrt.
function fahre(w, bilder) {
  w.raf.push(w.loop);
  let tot = null, jeBild = [];
  for (let i = 1; i <= bilder; i++) {
    const f = w.raf.shift();
    if (!f) { tot = i; break; }
    w.tick(i);
    const vorher = w.raf.length;
    try { f(i * 16.7); } catch (e) { w.errors.push('ENTKOMMEN: ' + e.message); }
    jeBild.push(w.raf.length - vorher);
  }
  return { tot, jeBild };
}

// ── A: ein einzelner Render-Fehler ────────────────────────────────────────────
{
  const w = welt({ renderWirft: n => n === 3 });
  const r = fahre(w, 60);
  ok(r.tot === null, 'A1 ein einzelner Render-Fehler beendet die Bildschleife NICHT', { totAbBild: r.tot });
  ok(!w.errors.some(e => e.startsWith('ENTKOMMEN')), 'A2 der Fehler verlaesst loop nicht', w.errors.slice(0, 3));
  ok(w.renders > 10, 'A3 nach dem Fehler wird weiter gerendert', w.renders);
  ok(w.recovers === 1, 'A4 genau eine Wiederherstellung ueber den bestehenden Zyklus', w.recovers);
  ok(w.giveUps === 0, 'A5 kein Endzustand nach einem einmaligen Fehler', w.giveUps);
  ok(w.lost === false, 'A6 nach der Erholung ist das Rendering wieder frei', w.lost);
  ok(w.errors.filter(e => /Bild fehlgeschlagen/.test(e)).length === 1, 'A7 der Fehler wird genau einmal gemeldet', w.errors);
}

// ── B: genau eine Anmeldung je Bild ───────────────────────────────────────────
{
  const w = welt({ renderWirft: n => n === 3 || n === 9 });
  const r = fahre(w, 80);
  ok(r.jeBild.every(n => n === 1), 'B1 jedes Bild meldet genau EIN Folgebild an (keine zweite Kette)',
    [...new Set(r.jeBild)]);
  ok(w.raf.length === 1, 'B2 nach 80 Bildern liegt genau eine Anmeldung bereit', w.raf.length);
}

// ── C: wiederkehrender Fehler endet begrenzt ──────────────────────────────────
{
  // wirft in JEDEM Bild, auch im Bestaetigungsbild des Restore
  const w = welt({ renderWirft: () => true });
  const r = fahre(w, 400);
  ok(r.tot === null, 'C1 auch ein Dauerfehler beendet die Schleife nicht', r.tot);
  ok(w.recovers <= (maxM ? +maxM[1] : 3), 'C2 hoechstens drei Wiederherstellungen', w.recovers);
  ok(w.errors.length <= 5, 'C3 kein Fehlerschwall in der Konsole (400 Bilder)', w.errors.length);
  ok(w.lost === true, 'C4 danach bleibt das Rendering kontrolliert angehalten', w.lost);
}
{
  // wirft in jedem regulaeren Bild, der Restore selbst gelingt jedes Mal -> Obergrenze greift
  let imRestore = false;
  const w = welt({ renderWirft: () => !imRestore, erholtNach: 2 });
  const t = w.tick; w.tick = i => { imRestore = true; t(i); imRestore = false; };
  const r = fahre(w, 400);
  ok(r.tot === null, 'C5 Schleife lebt nach wiederholten Rueckfaellen', r.tot);
  ok(w.recovers === (maxM ? +maxM[1] : 3), 'C6 genau drei Wiederherstellungen je Fehlerklasse', w.recovers);
  ok(w.giveUps === 1, 'C7 danach genau EIN kontrollierter Endzustand', w.giveUps);
  ok(w.errors.filter(e => /aufgegeben/.test(e)).length === 1, 'C8 das Aufgeben wird einmal gemeldet', w.errors);
  ok(w.warns.length === (maxM ? +maxM[1] : 3), 'C9 je Wiederherstellung eine Warnung, nicht je Bild', w.warns.length);
}

// ── D: Simulation laeuft weiter ───────────────────────────────────────────────
{
  const w = welt({ renderWirft: n => n === 3, erholtNach: 10 });
  fahre(w, 50);
  ok(w.sim === 50, 'D1 die Simulation laeuft in JEDEM Bild weiter - auch im Fehlbild und waehrend der Erholung', w.sim);
}
{
  const w = welt({ renderWirft: () => true });
  fahre(w, 200);
  ok(w.sim === 200, 'D2 auch im Endzustand laeuft die Simulation weiter', w.sim);
}

// ── E: 2D ohne Szene ──────────────────────────────────────────────────────────
{
  const w = welt({ r3d: false, drawWirft: () => true });
  const r = fahre(w, 120);
  ok(r.tot === null, 'E1 ohne 3D-Szene haelt ein Zeichenfehler die Schleife nicht an', r.tot);
  ok(w.errors.length === 1, 'E2 und wird genau einmal gemeldet', w.errors.length);
  ok(w.sim === 120, 'E3 die Simulation laeuft weiter', w.sim);
}

// ── F: echter Kontextverlust bleibt beim Ereignispaar ─────────────────────────
{
  // Das Ereignis hat den Kontext als verloren markiert: loop rendert nicht, stoesst keinen
  // eigenen Restore an und laeuft weiter; nach dem Restore-Ereignis wird wieder gerendert.
  const w = welt({});
  w.setLost(true);
  const r1 = fahre(w, 30);
  ok(r1.tot === null && w.renders === 0, 'F0 bei verlorenem Kontext: kein WebGL-Aufruf, Schleife lebt', { tot: r1.tot, renders: w.renders });
  ok(w.recovers === 0 && w.errors.length === 0, 'F0b kein zweiter Wiederaufbau neben dem Ereignispaar', { rec: w.recovers, err: w.errors });
  w.setLost(false); w.raf.length = 0;
  fahre(w, 10);
  ok(w.renders === 10, 'F0c nach dem Restore wird wieder in jedem Bild gerendert', w.renders);
}
{
  const src = html;
  const recover = (src.match(/r3d\.recover=\(\)=>\{[\s\S]*?\n    \};/) || [''])[0];
  ok(/isContextLost\(\)\)return;/.test(recover), 'F1 bei tatsaechlichem Kontextverlust stoesst r3d.recover nichts an', recover.slice(0, 120));
  ok(/r3dBeginRecovery\(\);\s*r3dRestore\(\);/.test(recover), 'F2 r3d.recover nutzt den bestehenden Zyklus und Wiederaufbau');
  ok(/addEventListener\('webglcontextlost',\(e\)=>\{e\.preventDefault\(\);r3dBeginRecovery\(\);\}\)/.test(src),
    'F3 der Kontextverlust laeuft ueber denselben Zyklusbeginn');
  ok(/addEventListener\('webglcontextrestored',\(\)=>\{r3dRestore\(\);\}\)/.test(src), 'F4 der Restore bleibt beim bestehenden Ereignis');
  ok((src.match(/async function r3dRestore\(/g) || []).length === 1, 'F5 genau EIN Wiederaufbau im Produkt');
  // Der Wiederaufbau steht verschachtelt in initR3D; direkt dahinter folgt r3d.recover.
  const rs = src.indexOf('async function r3dRestore(');
  const restore = rs >= 0 ? src.slice(rs, src.indexOf('r3d.recover=', rs)) : '';
  ok(/try\{[\s\S]*?renderer\.setRenderTarget\(null\);[\s\S]*?renderer\.setPixelRatio/.test(restore),
    'F6 der Wiederaufbau setzt das Zeichenziel ZUERST auf die Leinwand zurueck');
  ok(restore.indexOf('r3d.render();') < restore.indexOf('getRenderTarget()!==null') && restore.indexOf('getRenderTarget()!==null') > 0,
    'F7 das Bestaetigungsbild muss nachweislich auf der Leinwand gelandet sein');
}

// ── G: Quelltextvertrag ───────────────────────────────────────────────────────
{
  const loopSrc = grabFunction(html, 'loop');
  ok((loopSrc.match(/requestAnimationFrame\(loop\)/g) || []).length === 2, 'G1 loop meldet genau an zwei Stellen an (Wiedergabe + regulaer)');
  ok(!/r3d\.render\(\)/.test(loopSrc) && !/\bdraw\(\)/.test(loopSrc), 'G2 loop rendert und zeichnet nicht mehr direkt, nur ueber presentFrame');
  ok(/presentFrame\(true\);\s*requestAnimationFrame\(loop\)/.test(loopSrc), 'G3 auch die Wiedergabe laeuft ueber die Grenze');
  ok(/presentFrame\(false\);[^\n]*\n\s*requestAnimationFrame\(loop\);\s*\}$/.test(loopSrc), 'G4 das Folgebild wird nach der Grenze angemeldet');
  ok(!!maxM && +maxM[1] === 3, 'G5 Obergrenze der Wiederherstellungen ist 3', maxM && maxM[1]);
  ok((html.match(/requestAnimationFrame\(loop\)/g) || []).length === 3, 'G6 im ganzen Produkt genau drei Anmeldungen der Schleife (2 in loop + Start)');
}

// ── H: Kontextverlust beim Matchstart (Shared Mobile Match-Start) ───────────────
// Real reproduziert am emulierten Handy-Gast: verliert der Browser den WebGL-Kontext, WAEHREND
// die Szene beim START laedt, blieb die Flaeche WEISS (kein preventDefault -> nie zurueckgegeben,
// kein Hinweis, Eingabe frei). Nach dem Aufbau und ohne Rueckgabe stand endlos 'Grafik wird
// wiederhergestellt …' auf Schwarz. Geprueft: frueher Listener, Uebernahme in den Zyklus,
// Frist mit Endzustand, Endzustand mit Neu-laden-Knopf und Ursachen-Code, lokaler Puffer.
function verschachtelt(src, kopf) {   // Funktionsrumpf per Klammerzaehlung (auch in initR3D)
  const a = src.indexOf(kopf); if (a < 0) return '';
  let i = src.indexOf('{', a), t = 0;
  for (; i < src.length; i++) { if (src[i] === '{') t++; else if (src[i] === '}' && --t === 0) break; }
  return src.slice(a, i + 1);
}
{
  const init = verschachtelt(html, 'async function initR3D(');
  const frueh = init.indexOf("c3.addEventListener('webglcontextlost',onBootLost)");
  ok(frueh > 0 && frueh < init.indexOf('await applyEnvProfile(envProfile,true)') && frueh < init.indexOf("new GLTFLoader().load(assetUrl('assets/arena_platform"),
    'H1 der Verlust im Aufbau wird abgefangen, BEVOR HDR und Arena-GLB laden');
  ok(/const onBootLost=\(e\)=>\{e\.preventDefault\(\);bootLost=true;/.test(init), 'H2 der fruehe Listener erlaubt dem Browser die Rueckgabe (preventDefault)');
  const ab = init.indexOf("c3.removeEventListener('webglcontextlost',onBootLost)");
  ok(ab > 0 && ab < init.indexOf("c3.addEventListener('webglcontextlost',(e)=>{e.preventDefault();r3dBeginRecovery();})"),
    'H3 der fruehe Listener geht, bevor die regulaeren haengen - kein doppelter Zyklus');
  ok(/if\(bootLost\|\|renderer\.getContext\(\)\.isContextLost\(\)\)\{\s*r3dBeginRecovery\(\);\s*if\(renderer\.getContext\(\)\.isContextLost\(\)\)r3dArmRestoreDeadline\(\); else r3dRestore\(\);/.test(init),
    'H4 ein Verlust aus dem Aufbau landet im bestehenden Zyklus (Frist oder sofortiger Wiederaufbau)');
  ok(/addEventListener\('webglcontextlost',\(\)=>\{r3dDiag\('ctx-lost'\);r3dArmRestoreDeadline\(\);\}\)/.test(init), 'H5 jeder spaetere Verlust bekommt die Frist');
  const zyk = verschachtelt(init, 'function r3dBeginRecovery(');
  const rst = verschachtelt(init, 'async function r3dRestore(');
  ok(/c3\.style\.visibility='hidden'/.test(zyk) && rst.indexOf("c3.style.visibility=''") > rst.indexOf('r3d.render();'),
    'H5b die verlorene Flaeche ist waehrend des Zyklus verborgen (kein Weiss) und erst nach dem bestaetigten Bild wieder sichtbar');
  const w = html.match(/const R3D_RESTORE_WAIT_MS=(\d+);/);
  ok(!!w && +w[1] >= 3000 && +w[1] <= 30000, 'H6 Frist fuer die Rueckgabe ist begrenzt (3-30 s)', w && w[1]);
  ok(/r3dRecoveryHint\(true,T\('r3dRecoveryFailed'\),'R3D-RESTORE'\)/.test(init) && /r3dRecoveryHint\(true,T\('r3dRecoveryFailed'\),'R3D-RENDER'\)/.test(init),
    'H7 jeder Endzustand traegt einen Ursachen-Code (Wiederaufbau, Renderfehler)');

  // Verhalten der Frist: echte Funktion, nachgebaute Umgebung.
  const frist = verschachtelt(init, 'function r3dArmRestoreDeadline(');
  const fristWelt = (verlorenBleibt, neuerZyklus) => {
    const W = { timer: [], hint: null, diag: [] };
    try {
      new Function('W', `
        let r3dRecoveryGen=1, r3dContextLost=true, r3dRecoveryFailed=false; const R3D_RESTORE_WAIT_MS=${w ? w[1] : 10000};
        const renderer={getContext:()=>({isContextLost:()=>W.lost})};
        function setTimeout(f,ms){W.timer.push({f,ms});}
        function T(k){return k;} function r3dDiag(e){W.diag.push(e);}
        function r3dRecoveryHint(s,m,c){W.hint={s,m,c};}
        ${frist}
        W.lost=true; r3dArmRestoreDeadline();
        W.lost=${verlorenBleibt}; if(${neuerZyklus})r3dRecoveryGen++;
        W.timer.forEach(t=>t.f()); W.failed=r3dRecoveryFailed;`)(W);
    } catch (e) { W.fehler = e.message; }
    return W;
  };
  const a = fristWelt(true, false);
  ok(a.failed && a.hint && a.hint.c === 'R3D-CTX-LOST' && a.hint.m === 'r3dRecoveryFailed', 'H8 kein Kontext nach der Frist -> kontrollierter Endzustand statt endlosem Hinweis', a.hint || a.fehler);
  ok(a.timer.length === 1 && a.timer[0].ms === +(w ? w[1] : 0), 'H9 genau eine Frist je Verlust');
  const b = fristWelt(false, false);
  ok(!b.fehler && !b.failed && b.hint === null, 'H10 Kontext rechtzeitig zurueck -> die Frist schweigt, der Wiederaufbau laeuft');
  const c = fristWelt(true, true);
  ok(!c.fehler && !c.failed && c.hint === null, 'H11 eine ueberholte Frist meldet keinen Endzustand');

  // Endzustand: Knopf zum Neuladen, bedienbar; der Zwischenhinweis bleibt nicht klickbar.
  const hintSrc = grabFunction(html, 'r3dRecoveryHint');
  const mk = tag => ({ tag, style: {}, kids: [], _t: '', append(...k) { this.kids.push(...k); }, remove() { this.weg = true; },
    set textContent(v) { this._t = v; this.kids = []; }, get textContent() { return this._t; } });
  const hintWelt = (code) => {
    const W = { reload: 0 };
    W.doc = { createElement: mk, body: { appendChild: e => { W.el = e; } } };
    try {
      new Function('W', `const document=W.doc, location={reload(){W.reload++;}}; let r3dHintEl=null;
        function T(k){return k;} function r3dDiag(){}
        ${hintSrc}
        r3dRecoveryHint(true,'m',${code ? "'" + code + "'" : 'undefined'});`)(W);
    } catch (e) { W.fehler = e.message; }
    return W;
  };
  const t = hintWelt('R3D-CTX-LOST'), knopf = t.el && t.el.kids.find(k => k.tag === 'button');
  ok(!!knopf && knopf.textContent === 'r3dReload' && t.el.style.pointerEvents === 'auto', 'H12 Endzustand zeigt einen bedienbaren Neu-laden-Knopf', t.fehler);
  if (knopf && knopf.onclick) knopf.onclick();
  ok(t.reload === 1, 'H13 der Knopf laedt genau einmal neu - kein automatisches Neuladen');
  ok(!!t.el && t.el.kids.some(k => k.tag === 'div' && /R3D-CTX-LOST/.test(k.textContent)), 'H14 der Ursachen-Code steht sichtbar im Endzustand');
  const z = hintWelt(null);
  ok(!!z.el && z.el.kids.length === 0 && z.el.style.pointerEvents === 'none', 'H15 der Zwischenhinweis bleibt ohne Knopf und blockiert keine Eingabe', z.fehler);

  // Diagnosepuffer: begrenzt, nur lokal.
  const diagSrc = /(^|\n)function\s+r3dDiag\s*\(/.test(html) ? grabFunction(html, 'r3dDiag') : '';
  const m = html.match(/R3D_DIAG_MAX=(\d+)/);
  const D = { store: {} };
  try {
    new Function('D', `const R3D_DIAG_KEY='k',R3D_DIAG_MAX=${m ? m[1] : 40},R3D_DIAG_T0=0; let r3dDiagLog=[];
      const localStorage={setItem(k,v){D.store[k]=v;}}; const Date={now:()=>5};
      ${diagSrc}
      for(let i=0;i<500;i++)r3dDiag('e'+i,i); D.log=r3dDiagLog;`)(D);
  } catch (e) { D.fehler = e.message; }
  ok(!!D.log && !!m && D.log.length === +m[1] && D.log[D.log.length - 1][1] === 'e499', 'H16 Diagnosepuffer ist begrenzt und haelt die neuesten Eintraege', D.fehler || (D.log && D.log.length));
  ok(!!D.store.k && JSON.parse(D.store.k).log.length === D.log.length, 'H17 der Puffer ueberlebt ein Neuladen (localStorage)');
  ok(!!diagSrc && !/fetch\(|sendBeacon|XMLHttpRequest|window\.FB/.test(diagSrc), 'H18 der Puffer sendet nichts');
}

console.log('Render-Recovery: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

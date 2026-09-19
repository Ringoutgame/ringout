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

console.log('Render-Recovery: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

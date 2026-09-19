#!/usr/bin/env node
// Shared Mobile 3D Startup + Memory (Pass 01): der Szenenaufbau darf beim ersten Bild keine
// vermeidbaren Grafikpuffer mehr anlegen und keinen einzigen Riesenblock auf dem Hauptthread.
//
// Gemessen (WebGL-Instrumentierung, s. artifacts/mobile_startup_opt/) legte three.js intern beim
// ersten Bild zusaetzlich an: den PMREM-Zwischenpuffer (24 MiB, blieb dauerhaft), sechs
// Tiefenpuffer am Himmelswuerfel (24 MiB) und hielt das HDRI selbst (16 MiB). Dazu kam eine
// flache, optisch wirkungslose Marmor-Normal-Map (21 MiB). Diese Suite prueft die ECHTEN
// Funktionen aus index.html in einer Sandbox:
//   A  Himmel + IBL werden explizit gebaut; Generator und HDRI-Quelle werden freigegeben
//   B  Profilwechsel, gleiches HDRI, veraltetes Ergebnis, Fehler beim Bau - nichts leckt
//   C  der Context-Restore baut ueber denselben Weg neu (envTexPath=null)
//   D  die flache Normal-Map ist im Asset vorhanden und wird nicht verwendet
//   E  gestaffelter Erststart: Texturen einzeln vorab, Shader danach, nie fatal, VOR dem ersten Bild
//
//   node tools/test_r3d_startup_memory.js
//   STARTUP_TEST_HTML=<andere index.html> node tools/test_r3d_startup_memory.js   (Gegenprobe)
'use strict';
const fs = require('fs'), path = require('path');
const { loadIndexHtml } = require('./extract');
const html = process.env.STARTUP_TEST_HTML
  ? fs.readFileSync(process.env.STARTUP_TEST_HTML, 'utf8').replace(/\r\n/g, '\n')
  : loadIndexHtml();

let passed = 0, failed = 0;
function ok(c, name, info) {
  if (c) passed++;
  else { failed++; console.log('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function verschachtelt(src, kopf) {   // Funktionsrumpf per Klammerzaehlung (auch in initR3D)
  const a = src.indexOf(kopf); if (a < 0) return '';
  let i = src.indexOf('{', a), t = 0;
  for (; i < src.length; i++) { if (src[i] === '{') t++; else if (src[i] === '}' && --t === 0) break; }
  return src.slice(a, i + 1);
}
const init = verschachtelt(html, 'async function initR3D(');
const buildSrc = verschachtelt(init, 'function r3dBuildEnv(');
const applySrc = verschachtelt(init, 'async function applyEnvProfile(');
const vorSrc = verschachtelt(init, 'async function r3dVorladen(');

// ── Sandbox fuer applyEnvProfile + r3dBuildEnv ───────────────────────────────
function welt(opt) {
  const W = { log: [], disposed: [], built: 0, loads: 0, rt: null, opt: opt || {} };
  const mk = new Function('W', `
    let envGen=0, envApplied=null, envPending=null, envTexPath=null, envRT=null, skyRT=null, perfHdrMs=0;
    const cx=0, cy=0;
    const ENVIRONMENT_PROFILES={dawn:{hdri:'a.hdr',exposure:1,envIntensity:1,rotationY:0,fogColor:0,sunColor:0,sunIntensity:1,sunAzimuth:0,sunElevation:0.5},
                                night:{hdri:'b.hdr',exposure:1,envIntensity:1,rotationY:0,fogColor:0,sunColor:0,sunIntensity:1,sunAzimuth:0,sunElevation:0.5},
                                dawn2:{hdri:'a.hdr',exposure:2,envIntensity:1,rotationY:0,fogColor:0,sunColor:0,sunIntensity:1,sunAzimuth:0,sunElevation:0.5}};
    const ENV_FALLBACKS=[];
    function r3dDiag(){}
    const sun={color:{setHex(){}},position:{set(){}},intensity:0};
    const scene={environment:null,background:null,fog:{color:{setHex(){}}}};
    let rtTarget='canvas';
    const renderer={setRenderTarget(t){rtTarget=t===null?'canvas':t;},toneMappingExposure:1};
    let n=0;
    const tex=(name)=>({name,image:{height:1024,width:2048},mapping:0,dispose(){W.disposed.push(name);}});
    const rt=(kind)=>{const id=kind+(++n);return {id,texture:{id:id+'.tex'},dispose(){W.disposed.push(id);}};};
    const THREE={EquirectangularReflectionMapping:303,Euler:function(){},
      PMREMGenerator:function(){W.log.push('pmrem-new');
        this.fromEquirectangular=(t)=>{if(W.opt.pmremWirft)throw new Error('pmrem');rtTarget='offscreen';return rt('env');};
        this.dispose=()=>W.log.push('pmrem-dispose');},
      WebGLCubeRenderTarget:function(size,o){const r=rt('sky');W.lastSky={size,o};r.fromEquirectangularTexture=()=>{rtTarget='offscreen';};return r;}};
    const loadEnvHDR=(chain)=>{W.loads++;return W.opt.ladeFehler?Promise.reject(new Error('x')):Promise.resolve({tex:tex('hdr'+W.loads+':'+chain[0]),path:chain[0]});};
    ${buildSrc}
    ${applySrc}
    W.apply=applyEnvProfile; W.scene=scene; W.state=()=>({envTexPath,envRT,skyRT,rtTarget});
    W.setPath=v=>{envTexPath=v;}; W.bumpGen=()=>{envGen++;};`);
  mk(W);
  return W;
}

// ── A: expliziter Bau, Freigaben ─────────────────────────────────────────────
(async () => {
  process.on('unhandledRejection', e => { failed++; console.log('FAIL: Abbruch ' + (e && e.message)); });
  ok(!!buildSrc && !!applySrc, 'A0 r3dBuildEnv und applyEnvProfile sind im Produkt vorhanden');
  {
    const W = welt();
    const r = await W.apply('dawn', true);
    const s = W.state();
    ok(r === true && s.envRT && s.skyRT, 'A1 initialer Bau liefert IBL und Himmel');
    ok(!!s.envRT && W.scene.environment === s.envRT.texture && W.scene.background === s.skyRT.texture, 'A2 Szene nutzt die gebauten Ziele, nicht das HDRI selbst');
    ok(W.disposed.some(d => /^hdr1:/.test(d)), 'A3 die HDRI-Quelle wird nach dem Bau freigegeben', W.disposed);
    ok(W.log.includes('pmrem-dispose'), 'A4 der PMREM-Generator (samt Zwischenpuffer) wird freigegeben');
    ok(W.lastSky && W.lastSky.o && W.lastSky.o.depthBuffer === false, 'A5 der Himmelswuerfel hat keine Tiefenpuffer', W.lastSky);
    ok(W.lastSky && W.lastSky.size === 1024, 'A6 Himmelswuerfel in unveraenderter Groesse (HDRI-Hoehe) - gleiches Bild', W.lastSky && W.lastSky.size);
    ok(s.rtTarget === 'canvas', 'A7 nach dem Bau zeichnet der Renderer wieder auf die Leinwand', s.rtTarget);
  }
  // ── B: Wechsel, Reuse, veraltet, Fehler ────────────────────────────────────
  {
    const W = welt();
    await W.apply('dawn', true); const a = W.state();
    await W.apply('dawn2', false);
    ok(W.loads === 1 && W.state().envRT === a.envRT, 'B1 gleiches HDRI: kein neuer Load, Ziele wiederverwendet');
    await W.apply('night', false); const b = W.state();
    ok(W.loads === 2 && b.envRT !== a.envRT, 'B2 anderes HDRI: neu gebaut');
    ok(!!a.envRT && W.disposed.includes(a.envRT.id) && W.disposed.includes(a.skyRT.id), 'B3 die ersetzten Ziele werden freigegeben (kein Leck bei Profilwechsel)', W.disposed);
    ok(!!b.envRT && !W.disposed.includes(b.envRT.id) && !W.disposed.includes(b.skyRT.id), 'B4 die neuen Ziele bleiben');
  }
  {
    const W = welt(); await W.apply('dawn', true); const a = W.state();
    W.opt.pmremWirft = true;
    const r = await W.apply('night', false);
    ok(!!a.envRT && r === false && W.state().envRT === a.envRT && W.scene.environment === a.envRT.texture, 'B5 Fehler beim Bau (live): bisheriger Himmel bleibt');
    ok(W.disposed.some(d => /^hdr2:/.test(d)), 'B6 auch bei Fehler wird die HDRI-Quelle freigegeben');
    ok(W.state().rtTarget === 'canvas', 'B7 auch bei Fehler zeichnet der Renderer wieder auf die Leinwand');
    let wurf = null; const W2 = welt({ pmremWirft: true }); try { await W2.apply('dawn', true); } catch (e) { wurf = e; }
    ok(!!wurf, 'B8 Fehler beim initialen Bau geht an initR3D (2D-Rueckfall wie bisher)');
  }
  {
    const W = welt(); await W.apply('dawn', true);
    const p = W.apply('night', false); W.bumpGen(); const r = await p;
    ok(r === false && W.disposed.some(d => /^hdr2:/.test(d)) && W.state().envTexPath === 'a.hdr', 'B9 veraltetes Ladeergebnis wird verworfen und freigegeben');
  }
  // ── C: Restore-Weg ─────────────────────────────────────────────────────────
  {
    const W = welt(); await W.apply('dawn', true); const a = W.state();
    W.setPath(null); const r = await W.apply('dawn', false);
    ok(r === true && W.loads === 2 && !!a.envRT && W.state().envRT !== a.envRT && W.disposed.includes(a.envRT.id), 'C1 envTexPath=null (Context-Restore) baut neu und gibt die alten Ziele frei');
    const rs = init.indexOf('async function r3dRestore(');
    ok(rs > 0 && /envTexPath=null;\s*\n\s*const envOk=await applyEnvProfile\(/.test(init.slice(rs)), 'C2 der Restore nutzt weiterhin genau diesen Weg');
  }
  // ── D: flache Normal-Map ───────────────────────────────────────────────────
  {
    const m = init.match(/const R3D_FLAT_NORMAL_MAPS=new Set\(\[([^\]]*)\]\)/);
    const namen = m ? m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')) : [];
    ok(namen.length === 1 && namen[0] === 'Marble012_2K-JPG_NormalGL', 'D1 genau die gemessene flache Normal-Map ist gelistet', namen);
    const g = fs.readFileSync(path.join(__dirname, '..', 'assets', 'arena_platform_stage2.glb'));
    const j = JSON.parse(g.toString('utf8', 20, 20 + g.readUInt32LE(12)));
    ok(namen.every(n => (j.images || []).some(im => im.name === n)), 'D2 der Name existiert im Arena-GLB (Asset und Code passen zusammen)');
    ok(/if\(m&&m\.normalMap&&R3D_FLAT_NORMAL_MAPS\.has\(m\.normalMap\.name\)\)\{m\.normalMap=null;m\.needsUpdate=true;\}/.test(init), 'D3 betroffene Materialien verzichten auf die Karte');
    const glbAt = init.indexOf("new GLTFLoader().load(assetUrl('assets/arena_platform_stage2.glb')");
    const cutAt = init.indexOf('R3D_FLAT_NORMAL_MAPS.has(');
    ok(glbAt > 0 && cutAt > glbAt && cutAt < init.indexOf('    await r3dVorladen();'), 'D4 die Karte wird entfernt, bevor irgendetwas hochgeladen wird');
  }
  // ── E: gestaffelter Erststart ──────────────────────────────────────────────
  {
    const vorAt = init.indexOf('    await r3dVorladen();'), frameAt = init.indexOf('    frame();', vorAt), aktivAt = init.indexOf('r3dActive=true;');
    ok(vorAt > 0 && frameAt > vorAt && aktivAt > vorAt, 'E1 Vorladen laeuft vor dem ersten Bild und vor r3dActive');
    const W = { init: [], compiled: 0, pausen: 0, warn: [], diag: [] };
    const tx = (n, rt) => ({ isTexture: true, isRenderTargetTexture: !!rt, n });
    const t1 = tx('a'), t2 = tx('b'), t3 = tx('rt', true);
    const run = (wirft) => new Function('W', 'tx', 'wirft', `
      const scene={traverse(f){f({material:{map:W.t1,normalMap:W.t2}});f({material:[{map:W.t1},{envMap:W.t3}]});f({});}};
      const camera={};
      const renderer={initTexture(t){if(wirft)throw new Error('gl');W.init.push(t.n);},compileAsync(){W.compiled++;return Promise.resolve();}};
      const console={warn:(...a)=>W.warn.push(a.join(' '))};
      function r3dDiag(k,v){W.diag.push([k,v]);}
      const setTimeout=(f)=>{W.pausen++;f();};
      ${vorSrc}
      return r3dVorladen();`)(W, tx, wirft);
    Object.assign(W, { t1, t2, t3 });
    let fehler = null; try { await run(false); } catch (e) { fehler = e; }
    ok(!fehler && W.init.join(',') === 'a,b', 'E2 jede Textur genau einmal vorab, Render-Ziele nicht', W.init);
    ok(W.pausen >= 2, 'E3 zwischen den Texturen gibt der Hauptthread ab (eigener Arbeitsschritt je Textur)', W.pausen);
    ok(W.compiled === 1, 'E4 Shader werden danach uebersetzt (compileAsync)');
    const W2 = { init: [], compiled: 0, pausen: 0, warn: [], diag: [], t1, t2, t3 };
    let f2 = null; try { await (new Function('W', 'tx', 'wirft', `
      const scene={traverse(f){f({material:{map:W.t1}});}}; const camera={};
      const renderer={initTexture(){throw new Error('gl');},compileAsync(){W.compiled++;return Promise.resolve();}};
      const console={warn:(...a)=>W.warn.push(a.join(' '))}; function r3dDiag(){}
      const setTimeout=(f)=>{f();};
      ${vorSrc}
      return r3dVorladen();`))(W2, tx, true); } catch (e) { f2 = e; }
    ok(!f2 && W2.warn.length === 1, 'E5 ein Fehler beim Vorladen ist nie fatal - das erste Bild erledigt den Rest', f2 && f2.message);
  }
  // ── F: Quelltextvertrag ────────────────────────────────────────────────────
  ok(!/scene\.environment=tex;scene\.background=tex/.test(html), 'F1 das HDRI wird nicht mehr direkt als Himmel/IBL gesetzt (kein interner Doppelbau)');
  ok(/finally\{ pm\.dispose\(\); renderer\.setRenderTarget\(null\); \}/.test(buildSrc), 'F2 Generator-Freigabe und Leinwand-Ruecksetzung stehen im finally');

  console.log('R3D-Startup-Memory: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();

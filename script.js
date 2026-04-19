import * as THREE         from './three/core.js';
import { GLTFLoader }     from './three/GLTFLoader.js';
import { EXRLoader }      from './three/EXRLoader.js';
import { OrbitControls }  from './three/OrbitControls.js';

// ─────────────────────────────────────────────────
// LOADER HELPERS
// ─────────────────────────────────────────────────
let loadProgressShown  = 0;
let loadProgressTarget = 0;
let loadProgressMsg    = 'INITIALIZING STUDIO…';
let loadProgressRAF    = 0;
let loadProgressLastTS = 0;
let loadProgressWaiters = [];
let loadProgressStartedAt = 0;
let loadProgressDone = false;

const LOAD_PROGRESS_STEP_MS        = 16;
const LOAD_PROGRESS_FINISH_STEP_MS = 3;
const LOAD_PROGRESS_MAX_BEFORE_DONE = 99;

function paintLoadProgress() {
  const bar    = document.getElementById('load-bar');
  const status = document.getElementById('load-status');
  const pctEl  = document.getElementById('load-pct');
  if (bar)    bar.style.width    = `${loadProgressShown.toFixed(3)}%`;
  if (status) status.textContent = loadProgressMsg;
  if (pctEl)  pctEl.textContent  = `${Math.min(100, Math.floor(loadProgressShown))}%`;
}

function resolveLoadProgressWaiters() {
  loadProgressWaiters = loadProgressWaiters.filter(({ pct, resolve }) => {
    if (loadProgressShown >= pct - 0.001) { resolve(); return false; }
    return true;
  });
}

function getAutoLoadProgressTarget(ts) {
  if (!loadProgressStartedAt) loadProgressStartedAt = ts;
  const elapsed = ts - loadProgressStartedAt;
  return Math.min(LOAD_PROGRESS_MAX_BEFORE_DONE, elapsed / LOAD_PROGRESS_STEP_MS);
}

function tickLoadProgress(ts) {
  if (!loadProgressLastTS) loadProgressLastTS = ts;
  const dt = Math.min(ts - loadProgressLastTS, 64);
  loadProgressLastTS = ts;

  const visualTarget = loadProgressDone
    ? 100
    : Math.max(loadProgressTarget, getAutoLoadProgressTarget(ts));
  const stepMs = loadProgressDone ? LOAD_PROGRESS_FINISH_STEP_MS : LOAD_PROGRESS_STEP_MS;

  loadProgressShown = Math.min(visualTarget, loadProgressShown + (dt / stepMs));
  if (Math.abs(visualTarget - loadProgressShown) < 0.001) loadProgressShown = visualTarget;

  paintLoadProgress();
  resolveLoadProgressWaiters();

  if (loadProgressDone && loadProgressShown >= 100) {
    loadProgressRAF = 0; loadProgressLastTS = 0; return;
  }
  loadProgressRAF = requestAnimationFrame(tickLoadProgress);
}

function ensureLoadProgressAnim() {
  if (loadProgressRAF) return;
  loadProgressRAF = requestAnimationFrame(tickLoadProgress);
}

function setLoadProgress(pct, msg) {
  const clamped   = Math.max(0, Math.min(100, Math.round(pct)));
  const willAdvance = clamped >= loadProgressTarget;
  loadProgressTarget = Math.max(loadProgressTarget, loadProgressShown, clamped);
  if (clamped >= 100) loadProgressDone = true;
  if (typeof msg === 'string' && (loadProgressTarget < 100 || willAdvance)) loadProgressMsg = msg;
  paintLoadProgress();
  ensureLoadProgressAnim();
}

function waitForLoadProgress(pct) {
  if (loadProgressShown >= pct - 0.001) return Promise.resolve();
  return new Promise(resolve => loadProgressWaiters.push({ pct, resolve }));
}

function waitForNextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function hideLoader() {
  const ov  = document.getElementById('loading-overlay');
  const app = document.getElementById('app');
  if (!ov) return;
  ov.classList.add('fade-out');
  if (app) app.classList.add('visible');
  setTimeout(() => { if (ov?.parentNode) ov.parentNode.removeChild(ov); }, 820);
}

// ─────────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────────
let scene, camera, renderer, controls, stageEl;
let carGroup       = null;
let paintMeshes    = [];
let caliperMeshes  = [];
let rimMeshes      = [];
let envMap         = null;
let currentPaintHex = 0xF5C518;
let themeFadeSwapTimer = 0;
let themeFadeCleanupTimer = 0;

const THEME_STORAGE_KEY = 'cosmic-forge-theme';

const BODY_PAINT_PROPS = {
  metalness: 0.10,
  roughness: 0.17,
  envMapIntensity: 1.8,
  clearcoat: 1.0,
  clearcoatRoughness: 0.032,
  specularIntensity: 0.58,
};
const PAINT_TARGET_MESH_NAMES = new Set([
  'car_body',
  'front_fender_panel',
  'rear_fender_arch',
  'rear_fender_panel',
  'roof_panel',
  'engine_bay_side_panels',
  'inner_door',
  'seat_back_panels',
  'side_skirt',
  'side_skirt_extension',
  'side_skirt_fin',
  'roof_and_engine_bay_section',
]);
const WHEEL_TARGET_MESH_NAMES = new Set([
  'front_left_wheel_rim',
  'front_right_wheel_rim',
  'rear_left_wheel_rim',
  'rear_right_wheel_rim',
  'front_left_wheel_spokes',
  'front_right_wheel_spokes',
  'rear_left_wheel_spokes',
  'rear_right_wheel_spokes',
  'front_left_wheel_tire',
  'front_right_wheel_tire',
  'rear_left_wheel_tire',
  'rear_right_wheel_tire',
]);
const BRAKE_TARGET_MESH_NAMES = new Set([
  'brake_dics',
]);
const THEME_FADE_SWAP_MS = 120;
const THEME_FADE_TOTAL_MS = 360;
const CONFIG_VIEW_ORDER = ['original', 'body', 'wheel', 'brake'];
const CONFIG_VIEW_META = {
  original: {
    title: 'Original',
    copy: 'Return to the default modification layout.',
    cycleLabel: 'Body',
    cycleAria: 'Open body configuration',
  },
  body: {
    title: 'Body',
    copy: 'Premium exterior finishes with the full body color palette.',
    cycleLabel: 'Wheel',
    cycleAria: 'Open wheel configuration',
  },
  wheel: {
    title: 'Wheel',
    copy: 'Forged wheel finishes using the same preview shapes as the main panel.',
    cycleLabel: 'Brake',
    cycleAria: 'Open brake configuration',
  },
  brake: {
    title: 'Brake',
    copy: 'Brake disc previews styled like the rotor reference cards.',
    cycleLabel: 'Original',
    cycleAria: 'Return to the original modification layout',
  },
};

const CAMERA_BUTTON_CLICK_DELAY = 220;
const CAMERA_BUTTON_PRESETS = {
  front34: { single: 'front34', double: 'front' },
  rear:    { single: 'rear34',  double: 'rear'  },
  side:    { single: 'side',    double: 'sideAlt'},
  top:     { single: 'top',     double: 'topAlt' },
};

// ── Camera animation durations ──
const CAM_ANIM_MS_DEFAULT  = 960;   // standard preset transitions
const CAM_ANIM_MS_CLOSE    = 1380;  // ▶ CHANGE 2: close view — longer, silkier
const CAM_ANIM_MS_INTERIOR = 1500;  // ▶ CHANGE 1: interior fly-in

// Camera lerp state
let camAnimActive   = false;
let camAnimT0       = 0;
let camAnimDuration = CAM_ANIM_MS_DEFAULT;  // per-call override
const camP0         = new THREE.Vector3();
const camP1         = new THREE.Vector3();
const camTgt0       = new THREE.Vector3();
const camTgt1       = new THREE.Vector3();
let cameraClickTimer = 0;

// ── Easing functions ──
const easeCubic = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
// Smoother quintic easing for close/interior views
const easeQuint = t => t < .5 ? 16*t*t*t*t*t : 1 - Math.pow(-2*t+2,5)/2;

let appVisible = false;

// Interior mode tracking
let inInteriorMode = false;

// Saved orbit limits (restored when leaving interior)
const savedOrbitLimits = { minPolar: 0, maxPolar: 0, minDist: 0, maxDist: 0 };

// Track active preset name (used for interior control adjustments)
let activePresetName = 'front34';

// Model spatial data
const modelBounds = {
  center: new THREE.Vector3(0, 0.6, 0),
  size:   new THREE.Vector3(4.8, 1.4, 2.2),
  radius: 3.2,
};

const presetTargets = {
  front34:  { p: [ 4.4, 1.55, -5.15], t: [0, 0.72,  0.12] },
  front:    { p: [0,    1.35, -5.6],  t: [0, 0.72,  0.04] },
  side:     { p: [7.2,  1.5,   0],    t: [0, 0.65,  0   ] },
  sideAlt:  { p: [-7.2, 1.5,   0],    t: [0, 0.65,  0   ] },
  rear34:   { p: [-4.0, 1.7,   5.2],  t: [0, 0.72,  0.0 ] },
  rear:     { p: [0,    1.55,  5.8],  t: [0, 0.75,  0   ] },
  top:      { p: [-1.8, 7.9,  -1.6],  t: [0, 0.4,   0   ] },
  topAlt:   { p: [1.8,  7.9,   1.6],  t: [0, 0.4,   0   ] },
  close:    { p: [2.2,  1.35, -3.0],  t: [0, 0.95,  0.35] },
  interior: { p: [0.08, 1.0,  -0.35], t: [0, 0.95,  0.8 ] },
};

// ── Drive cinematic ──
let driveActive = false;
let driveStep   = 0;

// ▶ CHANGE 3: Hyper Drive constants — 5 full smooth rotations
const DRIVE_ROTATIONS   = 5;
const DRIVE_TOTAL_STEPS = 600;   // ~10 s at 60 fps → ~2 s per rotation

// ─────────────────────────────────────────────────
// RENDERER
// ─────────────────────────────────────────────────
function initRenderer() {
  stageEl = document.getElementById('stage');
  const canvas = document.getElementById('three-canvas');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(stageEl.clientWidth, stageEl.clientHeight);
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(30, stageEl.clientWidth / stageEl.clientHeight, 0.1, 140);
  camera.position.set(4.6, 1.48, -5.0);
  camera.lookAt(0, 0.72, 0.06);
}

// ─────────────────────────────────────────────────
// ORBIT CONTROLS
// ─────────────────────────────────────────────────
function initControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping    = true;
  controls.dampingFactor    = 0.07;
  controls.minDistance      = 3.2;
  controls.maxDistance      = 22.0;
  controls.enablePan        = false;
  controls.minPolarAngle    = 0.30;
  controls.maxPolarAngle    = Math.PI / 2.02;
  controls.target.set(0, 0.75, 0);
  controls.update();
}

// ─────────────────────────────────────────────────
// ENTER / LEAVE INTERIOR MODE
// ─────────────────────────────────────────────────
function enterInteriorMode() {
  // Save current limits so we can restore them
  savedOrbitLimits.minPolar = controls.minPolarAngle;
  savedOrbitLimits.maxPolar = controls.maxPolarAngle;
  savedOrbitLimits.minDist  = controls.minDistance;
  savedOrbitLimits.maxDist  = controls.maxDistance;

  // Full spherical freedom inside the cockpit
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.05;
  controls.minDistance   = 0.25;
  controls.maxDistance   = 1.6;
  controls.enablePan     = false;
  controls.update();
  inInteriorMode = true;
}

function leaveInteriorMode() {
  if (!inInteriorMode) return;
  controls.minPolarAngle = savedOrbitLimits.minPolar;
  controls.maxPolarAngle = savedOrbitLimits.maxPolar;
  controls.minDistance   = savedOrbitLimits.minDist;
  controls.maxDistance   = savedOrbitLimits.maxDist;
  controls.update();
  inInteriorMode = false;
}

// ─────────────────────────────────────────────────
// CAMERA — INSTANT JUMP
// ─────────────────────────────────────────────────
function jumpToPreset(name) {
  const p = presetTargets[name] || presetTargets.front34;
  controls.enabled = false;
  camera.position.set(...p.p);
  controls.target.set(...p.t);
  camera.lookAt(controls.target);
  controls.enabled       = true;
  controls.enableDamping = true;
  controls.update();
}

// ─────────────────────────────────────────────────
// CAMERA — ANIMATED LERP
// ─────────────────────────────────────────────────
function animToPreset(name, durationMs) {
  const p = presetTargets[name] || presetTargets.front34;
  activePresetName  = name;
  camAnimDuration   = durationMs !== undefined ? durationMs : CAM_ANIM_MS_DEFAULT;

  // If leaving interior mode, restore orbit limits first
  if (inInteriorMode && name !== 'interior') leaveInteriorMode();

  camP0.copy(camera.position);
  camTgt0.copy(controls.target);
  camP1.set(...p.p);
  camTgt1.set(...p.t);

  controls.enabled       = false;
  controls.enableDamping = false;

  camAnimT0     = performance.now();
  camAnimActive = true;
}

function setActiveCameraButton(btn) {
  document.querySelectorAll('.cbtn[data-camera]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function findCameraButton(name) {
  return document.querySelector(`#bpanel .views-panel .cbtn[data-camera="${name}"]`)
    || document.querySelector(`.cbtn[data-camera="${name}"]`)
    || document.getElementById(`cp-${name}`);
}

function runCameraButtonPreset(name, btn, useAlt = false) {
  const mapping    = CAMERA_BUTTON_PRESETS[name];
  const presetName = mapping ? (useAlt ? mapping.double : mapping.single) : name;
  setActiveCameraButton(btn || findCameraButton(name));
  animToPreset(presetName);
}

function bindCameraButtons() {
  document.querySelectorAll('.cbtn[data-camera]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      if (cameraClickTimer) clearTimeout(cameraClickTimer);
      cameraClickTimer = window.setTimeout(() => {
        runCameraButtonPreset(btn.dataset.camera, btn, false);
        cameraClickTimer = 0;
      }, CAMERA_BUTTON_CLICK_DELAY);
    });

    btn.addEventListener('dblclick', event => {
      event.preventDefault();
      if (cameraClickTimer) { clearTimeout(cameraClickTimer); cameraClickTimer = 0; }
      runCameraButtonPreset(btn.dataset.camera, btn, true);
    });
  });
}

// ─────────────────────────────────────────────────
// CAMERA — TICK ANIM
// ─────────────────────────────────────────────────
function tickCamAnim() {
  if (!camAnimActive) return;

  const elapsed = Math.min((performance.now() - camAnimT0) / camAnimDuration, 1);

  // ▶ CHANGE 2: Use easeQuint for close/interior, standard cubic for others
  const useSmooth = (activePresetName === 'close' || activePresetName === 'interior');
  const t = useSmooth ? easeQuint(elapsed) : easeCubic(elapsed);

  camera.position.lerpVectors(camP0, camP1, t);
  controls.target.lerpVectors(camTgt0, camTgt1, t);
  camera.lookAt(controls.target);

  if (elapsed >= 1) {
    camera.position.copy(camP1);
    controls.target.copy(camTgt1);
    camera.lookAt(controls.target);

    camAnimActive = false;
    controls.enableDamping = true;
    controls.enabled       = true;
    controls.update();

    // ▶ CHANGE 1: After arriving at interior, unlock full 360° orbit
    if (activePresetName === 'interior') enterInteriorMode();
  }
}

// ─────────────────────────────────────────────────
// MATERIAL HELPERS
// ─────────────────────────────────────────────────
const getMats = m => Array.isArray(m) ? m : [m];
const isRenderableMaterial = mat => !!(mat && mat.isMaterial === true && typeof mat.dispose === 'function');

function buildFallbackMaterial(source, meshName) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8b8b8,
    metalness: 0.15,
    roughness: 0.55,
  });
  if (source?.name) mat.name = source.name;
  if (source?.color?.isColor)             mat.color.copy(source.color);
  else if (typeof source?.color === 'number') mat.color.setHex(source.color);
  if (source?.emissive?.isColor)          mat.emissive.copy(source.emissive);
  if (source?.map?.isTexture)             mat.map             = source.map;
  if (source?.emissiveMap?.isTexture)     { mat.emissiveMap   = source.emissiveMap; mat.emissive.setHex(0xffffff); }
  if (source?.normalMap?.isTexture)       mat.normalMap       = source.normalMap;
  if (source?.roughnessMap?.isTexture)    mat.roughnessMap    = source.roughnessMap;
  if (source?.metalnessMap?.isTexture)    mat.metalnessMap    = source.metalnessMap;
  if (source?.alphaMap?.isTexture)        mat.alphaMap        = source.alphaMap;
  if (source?.aoMap?.isTexture)           mat.aoMap           = source.aoMap;
  if (typeof source?.transparent === 'boolean') mat.transparent = source.transparent;
  if (typeof source?.opacity     === 'number')  mat.opacity     = source.opacity;
  if (typeof source?.side        === 'number')  mat.side        = source.side;
  if (typeof source?.metalness   === 'number')  mat.metalness   = source.metalness;
  if (typeof source?.roughness   === 'number')  mat.roughness   = source.roughness;
  if (typeof source?.alphaTest   === 'number')  mat.alphaTest   = source.alphaTest;
  if (typeof source?.depthWrite  === 'boolean') mat.depthWrite  = source.depthWrite;
  if (typeof source?.depthTest   === 'boolean') mat.depthTest   = source.depthTest;
  if (typeof source?.wireframe   === 'boolean') mat.wireframe   = source.wireframe;
  if (typeof source?.vertexColors === 'boolean') mat.vertexColors = source.vertexColors;
  if (typeof source?.flatShading === 'boolean') mat.flatShading = source.flatShading;
  mat.needsUpdate = true;
  console.warn(`[COSMIC FORGE] Invalid material replaced on mesh "${meshName || 'unnamed'}"`, source);
  return mat;
}

function ensureRenderableMaterial(mesh) {
  if (!mesh?.isMesh) return;
  if (Array.isArray(mesh.material)) {
    let changed = false;
    const next = mesh.material.map(mat => {
      if (isRenderableMaterial(mat)) return mat;
      changed = true;
      return buildFallbackMaterial(mat, mesh.name);
    });
    if (changed) mesh.material = next;
    return;
  }
  if (!isRenderableMaterial(mesh.material)) {
    mesh.material = buildFallbackMaterial(mesh.material, mesh.name);
  }
}

function tuneMaterial(mat, env) {
  if (!mat || !mat.isMaterial) return;
  if (mat.map)         mat.map.colorSpace        = THREE.SRGBColorSpace;
  if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const name       = (mat.name || '').toLowerCase();
  const isGlass    = /glass|window|windshield/.test(name);
  const isTyre     = /tyre|tire|rubber/.test(name);
  const isChrome   = /chrome|exhaust/.test(name);
  const isBody     = /paint|body|door|hood|fender|bumper|panel|chassis/.test(name);
  const isInterior = /seat|interior|dash|carpet|leather/.test(name);

  if (isGlass) {
    mat.metalness = 0.02; mat.roughness = 0.02; mat.envMapIntensity = 1.65;
    if (mat.transparent && mat.opacity > 0.24) mat.opacity = 0.18;
  } else if (isTyre) {
    mat.metalness = 0.0; mat.roughness = 0.88; mat.envMapIntensity = 0.08;
  } else if (isChrome) {
    mat.metalness = 1.0; mat.roughness = 0.04; mat.envMapIntensity = 3.6;
  } else if (isBody) {
    mat.metalness = BODY_PAINT_PROPS.metalness;
    mat.roughness = BODY_PAINT_PROPS.roughness;
    mat.envMapIntensity = BODY_PAINT_PROPS.envMapIntensity;
    if ('clearcoat'          in mat) mat.clearcoat          = BODY_PAINT_PROPS.clearcoat;
    if ('clearcoatRoughness' in mat) mat.clearcoatRoughness = BODY_PAINT_PROPS.clearcoatRoughness;
    if ('specularIntensity'  in mat) mat.specularIntensity  = BODY_PAINT_PROPS.specularIntensity;
  } else if (isInterior) {
    mat.metalness = 0.08; mat.roughness = 0.62; mat.envMapIntensity = 0.55;
  } else {
    if ('metalness'          in mat) mat.metalness          = 0.70;
    if ('roughness'          in mat) mat.roughness          = 0.22;
    if ('envMapIntensity'    in mat) mat.envMapIntensity    = 3.2;
    if ('clearcoat'          in mat) mat.clearcoat          = 0.4;
    if ('clearcoatRoughness' in mat) mat.clearcoatRoughness = 0.08;
  }
  if (env && 'envMap' in mat) mat.envMap = env;
  mat.needsUpdate = true;
}

function reapplyEnvToAll() {
  if (!carGroup || !envMap || appVisible) return;
  carGroup.traverse(child => {
    if (!child.isMesh) return;
    getMats(child.material).forEach(m => {
      if (!m || !('envMap' in m)) return;
      m.envMap = envMap; m.needsUpdate = true;
    });
  });
}

// ─────────────────────────────────────────────────
// PAINT COLOR
// ─────────────────────────────────────────────────
function applyPaintColor(hex) {
  currentPaintHex = hex;
  const col = new THREE.Color(hex);
  const hsl = {};
  col.getHSL(hsl);
  if (hsl.s > 0.25 && hsl.l > 0.45) col.setHSL(hsl.h, Math.min(1, hsl.s * 1.02), hsl.l * 0.70);

  paintMeshes.forEach(mesh => {
    getMats(mesh.material).forEach(m => {
      if (!m) return;
      if (m.color)                   m.color.copy(col);
      if ('metalness'       in m)    m.metalness          = BODY_PAINT_PROPS.metalness;
      if ('roughness'       in m)    m.roughness          = BODY_PAINT_PROPS.roughness;
      if ('clearcoat'       in m)    m.clearcoat          = BODY_PAINT_PROPS.clearcoat;
      if ('clearcoatRoughness' in m) m.clearcoatRoughness = BODY_PAINT_PROPS.clearcoatRoughness;
      if ('envMapIntensity' in m)    m.envMapIntensity    = BODY_PAINT_PROPS.envMapIntensity;
      if ('specularIntensity' in m)  m.specularIntensity  = BODY_PAINT_PROPS.specularIntensity;
      if (envMap && 'envMap' in m)   m.envMap             = envMap;
      m.needsUpdate = true;
    });
  });
}

// ─────────────────────────────────────────────────
// STUDIO ENV
// ─────────────────────────────────────────────────
function buildStudioEnvSync() {
  const pmrem    = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const dome     = new THREE.Mesh(
    new THREE.SphereGeometry(42, 40, 20),
    new THREE.MeshBasicMaterial({ color: 0xcfcfcb, side: THREE.BackSide })
  );
  envScene.add(dome);

  const addPanel = (color, intensity, x, y, z, rx, ry, w = 22, h = 18, rz = 0) => {
    const col  = new THREE.Color(color).multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    envScene.add(mesh);
  };

  addPanel(0xffffff, 5.2,   0.6, 10.6,  1.6, -Math.PI/2+0.03,  0.10, 15.5, 8.8);
  addPanel(0xffffff, 3.4,  -1.3, 10.2,  3.0, -Math.PI/2+0.05, -0.04,  8.6, 4.2);
  addPanel(0xffffff, 4.0,   5.6,  5.4,  8.1, -0.40, -0.14,  7.6, 12.6);
  addPanel(0xfffef8, 2.2,   3.0,  4.0, 10.2, -0.22,  0.02,  9.6,  5.5);
  addPanel(0xf2f2ee, 1.2, -10.2,  4.1,  3.4,  0.05,  Math.PI/2, 9.1, 13.6);
  addPanel(0xfff8ea, 1.65, 10.4,  4.6, -1.8,  0.05, -Math.PI/2, 7.1, 13.2);
  addPanel(0xe9edf3, 0.64, -1.2,  4.0,-11.8,  0.05,  0, 13.5,  6.4);
  addPanel(0xd6d5d1, 0.34,  0,   -1.05, 0,   -Math.PI/2, 0, 32, 32);

  const cubeRT  = new THREE.WebGLCubeRenderTarget(512);
  const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
  envScene.add(cubeCam);
  cubeCam.update(renderer, envScene);

  const rt = pmrem.fromCubemap(cubeRT.texture);
  envMap   = rt.texture;
  scene.environment = envMap;

  cubeRT.dispose();
  pmrem.dispose();
  console.log('[COSMIC FORGE] Studio env ready (sync procedural) ✓');
}

function tryUpgradeEXR() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  new EXRLoader().load(
    './hdri/studio_small_09_4k.exr',
    texture => {
      if (appVisible) { texture.dispose(); pmrem.dispose(); return; }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const rt  = pmrem.fromEquirectangular(texture);
      envMap    = rt.texture;
      scene.environment = envMap;
      texture.dispose();
      pmrem.dispose();
      reapplyEnvToAll();
      applyPaintColor(currentPaintHex);
      console.log('[COSMIC FORGE] EXR HDRI ready ✓');
    },
    xhr => {
      if (appVisible) return;
      const pct = Math.min(Math.round((xhr.loaded / (xhr.total || 1)) * 14) + 44, 57);
      setLoadProgress(pct, 'LOADING HDRI…');
    },
    () => { pmrem.dispose(); console.log('[COSMIC FORGE] EXR not found — keeping procedural studio env'); }
  );
}

// ─────────────────────────────────────────────────
// LIGHTS
// ─────────────────────────────────────────────────
function buildLights() {
  scene.add(new THREE.AmbientLight(0xffffff, 0.035));
  scene.add(new THREE.HemisphereLight(0xf6f6f3, 0xc6c5c1, 0.20));

  const key = new THREE.DirectionalLight(0xfffcf5, 1.45);
  key.position.set(7.2, 8.8, 6.1);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 34;
  key.shadow.camera.left = -9; key.shadow.camera.right = 9;
  key.shadow.camera.top  = 6.5; key.shadow.camera.bottom = -4.5;
  key.shadow.bias = -0.00015; key.shadow.radius = 5;
  scene.add(key);

  const sideFill = new THREE.DirectionalLight(0xf7f8fb, 0.34);
  sideFill.position.set(-8.4, 4.6, 2.4);
  scene.add(sideFill);

  const wsKick = new THREE.DirectionalLight(0xffffff, 0.16);
  wsKick.position.set(-4.2, 4.0, 9.0);
  scene.add(wsKick);

  const rim1 = new THREE.DirectionalLight(0xe9eef8, 0.22);
  rim1.position.set(-5.6, 3.8, -8.8);
  scene.add(rim1);

  const rim2 = new THREE.DirectionalLight(0xffedd1, 0.14);
  rim2.position.set(5.8, 3.8, -5.8);
  scene.add(rim2);

  const topFill = new THREE.DirectionalLight(0xffffff, 0.20);
  topFill.position.set(-1.0, 13.0, 1.5);
  scene.add(topFill);

  const frontFill = new THREE.DirectionalLight(0xffffff, 0.11);
  frontFill.position.set(2.6, 2.4, 10.6);
  scene.add(frontFill);

  const bounce = new THREE.DirectionalLight(0xfff2de, 0.04);
  bounce.position.set(0, -4, 0);
  scene.add(bounce);
}

// ─────────────────────────────────────────────────
// FLOOR
// ─────────────────────────────────────────────────
function buildFloor() {
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xd7d7d4, roughness: 0.72, metalness: 0.02, envMapIntensity: 0.18,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 128), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.24, transparent: true });
  const shadow    = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.receiveShadow = true;
  scene.add(shadow);
}

// ─────────────────────────────────────────────────
// IDENTIFY CONFIGURABLE MESHES
// ─────────────────────────────────────────────────
function collectConfigTargets(mesh, candidates) {
  const meshName = (mesh.name || '').trim().toLowerCase();
  const name = `${meshName} ${getMats(mesh.material).map(m => m?.name || '').join(' ')}`.toLowerCase();
  const isNamedBrake = BRAKE_TARGET_MESH_NAMES.has(meshName);
  const isNamedWheel = WHEEL_TARGET_MESH_NAMES.has(meshName);
  const isNamedPaint = PAINT_TARGET_MESH_NAMES.has(meshName);

  if (isNamedBrake || /caliper|brake/.test(name)) { caliperMeshes.push(mesh); return; }
  if (isNamedWheel || /rim|wheel|alloy/.test(name)) rimMeshes.push(mesh);
  if (!isNamedPaint && /glass|window|windshield|tyre|tire|rubber/.test(name)) return;

  const box = new THREE.Box3().setFromObject(mesh);
  const sz  = box.getSize(new THREE.Vector3());
  candidates.push({ mesh, footprint: sz.x * sz.y * sz.z, name });

  if (isNamedPaint || /body|paint|door|hood|fender|bumper|panel|chassis/.test(name)) paintMeshes.push(mesh);
}

// ─────────────────────────────────────────────────
// CAR NORMALISATION
// ─────────────────────────────────────────────────
function normalizeCar(root) {
  root.scale.set(1, 1, 1);
  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);

  let box = new THREE.Box3().setFromObject(root);
  let sz  = box.getSize(new THREE.Vector3());
  if (sz.x > sz.z) {
    root.rotation.y = -Math.PI / 2;
    box = new THREE.Box3().setFromObject(root);
    sz  = box.getSize(new THREE.Vector3());
  }

  const scale = 4.15 / Math.max(sz.z, sz.x, 1);
  root.scale.setScalar(scale);

  box = new THREE.Box3().setFromObject(root);
  const ctr = box.getCenter(new THREE.Vector3());
  root.position.x -= ctr.x;
  root.position.z -= ctr.z;
  root.position.y -= box.min.y;

  box = new THREE.Box3().setFromObject(root);
  modelBounds.center.copy(box.getCenter(new THREE.Vector3()));
  modelBounds.size.copy(box.getSize(new THREE.Vector3()));
  modelBounds.radius = Math.max(modelBounds.size.x, modelBounds.size.z) * 0.82;
}

// ─────────────────────────────────────────────────
// UPDATE PRESETS AFTER MODEL LOAD
// ─────────────────────────────────────────────────
function updatePresets() {
  const c = modelBounds.center;
  const s = modelBounds.size;
  const r = Math.max(modelBounds.radius, 2.7);

  const makeOrbitPreset = (yawDeg, distMult, lift, tx = 0, tyOff = 0, tz = 0) => {
    const yaw    = THREE.MathUtils.degToRad(yawDeg);
    const target = new THREE.Vector3(c.x + tx, c.y + s.y * 0.22 + tyOff, c.z + tz);
    const dist   = r * distMult;
    return {
      p: [ target.x + Math.cos(yaw) * dist, target.y + lift, target.z + Math.sin(yaw) * dist ],
      t: [ target.x, target.y, target.z ],
    };
  };

  const makeTopPreset = (yawDeg) => {
    const yaw    = THREE.MathUtils.degToRad(yawDeg);
    const target = new THREE.Vector3(c.x, c.y + s.y * 0.10, c.z);
    const dist   = r * 0.92;
    return {
      p: [ target.x + Math.cos(yaw) * dist, target.y + Math.max(r * 2.02, 5.7), target.z + Math.sin(yaw) * dist ],
      t: [ target.x, target.y, target.z ],
    };
  };

  presetTargets.front34  = makeOrbitPreset( -44, 1.68, s.y * 0.19, 0,  s.y * 0.03, -s.z * 0.05);
  presetTargets.front    = makeOrbitPreset( -90, 1.54, s.y * 0.11, 0,  s.y * 0.02, -s.z * 0.03);
  presetTargets.side     = makeOrbitPreset(   0, 2.00, s.y * 0.07, 0,  0,            0          );
  presetTargets.sideAlt  = makeOrbitPreset( 180, 2.00, s.y * 0.07, 0,  0,            0          );
  presetTargets.rear34   = makeOrbitPreset( 136, 1.72, s.y * 0.18, 0,  s.y * 0.02,  s.z * 0.04);
  presetTargets.rear     = makeOrbitPreset(  90, 1.60, s.y * 0.12, 0,  s.y * 0.02,  s.z * 0.06);
  presetTargets.top      = makeTopPreset(-40);
  presetTargets.topAlt   = makeTopPreset( 140);
  presetTargets.close    = makeOrbitPreset(-58, 1.06, s.y * 0.34, 0,  s.y * 0.18, -s.z * 0.10);

  // ▶ CHANGE 1: Interior preset — camera right between the two seats, at seat height.
  // The car is centred at (cx, cy, cz).  Seats sit at about 60–65 % of car height,
  // centred X, and slightly aft of the longitudinal centre (z = +0.08 * size.z).
  // Camera is placed exactly there; it looks toward the windshield (–Z direction).
  presetTargets.interior = {
    p: [
      c.x,
      c.y + s.y * 0.58,        // between-seat height
      c.z + s.z * 0.08,        // slightly behind centre (closer to seats)
    ],
    t: [
      c.x,
      c.y + s.y * 0.56,        // level gaze
      c.z - s.z * 0.28,        // look forward toward windshield
    ],
  };

  if (controls) {
    controls.minDistance = Math.max(modelBounds.radius * 1.05, 3.2);
    controls.maxDistance = modelBounds.radius * 6.5;
    controls.target.set(c.x, c.y + s.y * 0.24, c.z);
    controls.update();
  }
}

// ─────────────────────────────────────────────────
// MODEL LOADING
// ─────────────────────────────────────────────────
function loadCarModel() {
  return new Promise(resolve => {
    const loader = new GLTFLoader();
    loader.load(
      './model/car_model/lamborghini_huracan.glb',

      gltf => {
        carGroup      = gltf.scene;
        paintMeshes   = [];
        rimMeshes     = [];
        caliperMeshes = [];
        scene.add(carGroup);

        const candidates = [];
        carGroup.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = child.receiveShadow = true;
          ensureRenderableMaterial(child);
          getMats(child.material).forEach(m => tuneMaterial(m, envMap));
          collectConfigTargets(child, candidates);
        });

        if (!paintMeshes.length) {
          candidates
            .sort((a, b) => b.footprint - a.footprint)
            .slice(0, 14)
            .forEach(({ mesh, name }) => {
              if (!/wheel|rim|tire|glass|window|interior|seat|trim/.test(name))
                paintMeshes.push(mesh);
            });
        }

        normalizeCar(carGroup);
        updatePresets();
        applyPaintColor(currentPaintHex);
        jumpToPreset('front34');
        resolve();
      },

      xhr => {
        const pct = Math.min(Math.round((xhr.loaded / (xhr.total || 1)) * 28) + 64, 92);
        setLoadProgress(pct, 'LOADING CAR MODEL…');
      },

      err => {
        console.warn('[COSMIC FORGE] GLB load failed — using fallback', err);
        buildFallbackCar();
        resolve();
      }
    );
  });
}

// ─────────────────────────────────────────────────
// FALLBACK PROCEDURAL CAR
// ─────────────────────────────────────────────────
function buildFallbackCar() {
  carGroup = new THREE.Group();

  const paint  = new THREE.MeshPhysicalMaterial({
    color: currentPaintHex, metalness: 0.80, roughness: 0.10,
    clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 4.2,
  });
  if (envMap) paint.envMap = envMap;

  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.88 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.02, metalness: 1.0 });
  const glass  = new THREE.MeshPhysicalMaterial({ color: 0x88aacc, transparent: true, opacity: 0.36, roughness: 0.04, metalness: 0.06 });

  const addMesh = (geo, mat, px, py, pz, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = cast;
    carGroup.add(m);
    return m;
  };

  const body = addMesh(new THREE.BoxGeometry(4.4, 0.52, 1.9), paint, 0, 0.54, 0);
  const roof = addMesh(new THREE.BoxGeometry(1.9, 0.42, 1.6), paint, -0.2, 1.07, 0);
  paintMeshes.push(body, roof);

  const ws = addMesh(new THREE.PlaneGeometry(0.95, 0.38), glass, 0.74, 1.02, 0);
  ws.rotation.y = -Math.PI/2 + 0.42;

  [-0.97, 0.97].forEach(z => {
    const sk = addMesh(new THREE.BoxGeometry(4.0, 0.12, 0.06), paint, 0, 0.3, z);
    paintMeshes.push(sk);
  });

  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.12, metalness: 0.95 });
  const calMat = new THREE.MeshStandardMaterial({ color: 0xF5C518, roughness: 0.40, metalness: 0.30 });

  [[1.35,0.28,1.05],[1.35,0.28,-1.05],[-1.35,0.28,1.05],[-1.35,0.28,-1.05]].forEach(([x,y,z]) => {
    const tyre = addMesh(new THREE.CylinderGeometry(0.28,0.28,0.24,32), rubber, x, y, z);
    tyre.rotation.x = Math.PI/2;

    const rim = addMesh(new THREE.CylinderGeometry(0.20,0.20,0.22,10,1,false), rimMat.clone(), x, y, z+(z>0?.01:-.01));
    rim.rotation.x = Math.PI/2;
    rimMeshes.push(rim);

    const cal = addMesh(new THREE.BoxGeometry(0.14,0.12,0.06), calMat.clone(), x+0.06, y+0.12, z);
    caliperMeshes.push(cal);
  });

  [[2.3,0.62,0.7],[2.3,0.62,-0.7]].forEach(([x,y,z]) => {
    addMesh(new THREE.BoxGeometry(0.06,0.12,0.32),
      new THREE.MeshStandardMaterial({ color:0xffffff, emissive:0xffffff, emissiveIntensity:0.6, roughness:0.0 }), x, y, z);
  });
  [[-2.3,0.62,0.7],[-2.3,0.62,-0.7]].forEach(([x,y,z]) => {
    addMesh(new THREE.BoxGeometry(0.06,0.10,0.28),
      new THREE.MeshStandardMaterial({ color:0xff2200, emissive:0xff2200, emissiveIntensity:0.5 }), x, y, z);
  });
  [0.35,-0.35].forEach(z => {
    const ex = addMesh(new THREE.CylinderGeometry(0.055,0.055,0.12,12), chrome, -2.34, 0.28, z);
    ex.rotation.x = Math.PI/2;
  });

  scene.add(carGroup);
  modelBounds.center.set(0, 0.55, 0);
  modelBounds.size.set(4.4, 1.1, 1.9);
  modelBounds.radius = 2.8;
  updatePresets();
  applyPaintColor(currentPaintHex);
  jumpToPreset('front34');
}

// ─────────────────────────────────────────────────
// RENDER LOOP
// ─────────────────────────────────────────────────
function loop() {
  if (driveActive) {
    tickDriveCinematic();
  } else if (camAnimActive) {
    tickCamAnim();
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────
// ▶ CHANGE 3: HYPER DRIVE — 5 smooth rotations
// ─────────────────────────────────────────────────
function initDriveButton() {
  const btn = document.getElementById('drive-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (driveActive || camAnimActive) return;

    // Leave interior mode if active
    if (inInteriorMode) leaveInteriorMode();

    driveActive  = true;
    driveStep    = 0;
    btn.textContent = 'HYPERDRIVING…';
    btn.classList.add('drive-active');
    controls.enabled = false;
  });
}

function tickDriveCinematic() {
  driveStep++;

  const progress = driveStep / DRIVE_TOTAL_STEPS;   // 0 → 1 over 600 frames

  // 5 full revolutions, constant radius, gentle height sine wave
  const angle = progress * Math.PI * 2 * DRIVE_ROTATIONS;

  const ot  = new THREE.Vector3().copy(modelBounds.center);
  ot.y     += modelBounds.size.y * 0.26;

  const rad = Math.max(modelBounds.radius * 1.82, 5.0);

  // Gentle camera height oscillation — one full breath per revolution
  const ht = modelBounds.center.y + modelBounds.size.y * 0.55
           + Math.sin(progress * Math.PI * 2) * 0.28;

  camera.position.set(
    ot.x + Math.cos(angle) * rad,
    ht,
    ot.z + Math.sin(angle) * rad
  );
  controls.target.copy(ot);
  camera.lookAt(controls.target);

  if (driveStep >= DRIVE_TOTAL_STEPS) {
    driveActive = false;

    const btn = document.getElementById('drive-btn');
    if (btn) {
      btn.classList.remove('drive-active');
      btn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="8"/><path d="M8 6l6 4-6 4V6z" fill="currentColor" stroke="none"/></svg> INITIATE HYPER DRIVE →`;
    }

    controls.target.copy(ot);
    controls.enabled       = true;
    controls.enableDamping = true;
    controls.update();
    animToPreset('front34');
  }
}

// ─────────────────────────────────────────────────
// RESIZE
// ─────────────────────────────────────────────────
function syncThemeToggleState() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = document.documentElement.classList.contains('dark-mode');
  btn.classList.toggle('is-active', isDark);
  btn.setAttribute('aria-pressed', String(isDark));
  btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

function applyThemeState(isDark) {
  document.documentElement.classList.toggle('dark-mode', isDark);
  syncThemeToggleState();

  try {
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  } catch {}
}

function setDarkMode(isDark, { animate = false } = {}) {
  const root = document.documentElement;
  window.clearTimeout(themeFadeSwapTimer);
  window.clearTimeout(themeFadeCleanupTimer);

  if (!animate || !root.classList.contains('theme-ready')) {
    root.classList.remove('theme-fade-active');
    applyThemeState(isDark);
    return;
  }

  root.classList.add('theme-fade-active');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      themeFadeSwapTimer = window.setTimeout(() => {
        applyThemeState(isDark);
      }, THEME_FADE_SWAP_MS);
      themeFadeCleanupTimer = window.setTimeout(() => {
        root.classList.remove('theme-fade-active');
      }, THEME_FADE_TOTAL_MS);
    });
  });
}

function toggleDarkMode() {
  const root = document.documentElement;
  if (root.classList.contains('theme-fade-active')) return;
  setDarkMode(!root.classList.contains('dark-mode'), { animate: true });
}

function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  syncThemeToggleState();
  btn.addEventListener('click', toggleDarkMode);

  requestAnimationFrame(() => {
    document.documentElement.classList.add('theme-ready');
  });
}

function onResize() {
  if (!stageEl || !renderer) return;
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// ─────────────────────────────────────────────────
// WHEEL CANVAS PREVIEWS
// ─────────────────────────────────────────────────
function drawWheel(id, rimColor, spokeColor, spokes) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 2;
  const spokeWidth = Math.max(2.8, r * 0.1);
  ctx.clearRect(0, 0, width, height);

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fillStyle = '#101010'; ctx.fill();

  ctx.beginPath(); ctx.arc(cx, cy, r*.74, 0, Math.PI*2);
  ctx.fillStyle = rimColor; ctx.fill();

  const grad = ctx.createRadialGradient(cx-5, cy-5, 2, cx, cy, r*.74);
  grad.addColorStop(0, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(cx, cy, r*.74, 0, Math.PI*2);
  ctx.fillStyle = grad; ctx.fill();

  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a)*r*.12, cy + Math.sin(a)*r*.12);
    ctx.lineTo(cx + Math.cos(a)*r*.68, cy + Math.sin(a)*r*.68);
    ctx.strokeStyle = spokeColor; ctx.lineWidth = spokeWidth; ctx.lineCap = 'round'; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, r*.12, 0, Math.PI*2);
  ctx.fillStyle = spokeColor; ctx.fill();
}

function drawBrakeDisc(id, accentHex) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const accent = new THREE.Color(accentHex);
  const accentCss = `#${accent.getHexString()}`;
  const width = canvas.width;
  const height = canvas.height;
  const cx = width * 0.52;
  const cy = height * 0.58;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.28);

  const shadow = ctx.createRadialGradient(8, 6, 8, 0, 0, 54);
  shadow.addColorStop(0, 'rgba(0,0,0,0.22)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(4, 12, 52, 24, 0, 0, Math.PI * 2);
  ctx.fill();

  const discGrad = ctx.createLinearGradient(-52, -10, 56, 24);
  discGrad.addColorStop(0, '#f4f5f6');
  discGrad.addColorStop(0.28, '#cfd4d9');
  discGrad.addColorStop(0.62, '#9ea5ab');
  discGrad.addColorStop(1, '#eef1f4');
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.ellipse(0, 8, 50, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(30,36,44,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 42, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  const ringGrad = ctx.createLinearGradient(-28, -20, 28, 14);
  ringGrad.addColorStop(0, '#fafafa');
  ringGrad.addColorStop(0.45, '#b8bec5');
  ringGrad.addColorStop(1, '#edf1f4');
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.ellipse(0, -2, 24, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = accentCss;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 8, 31, 10, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(25,30,38,0.24)';
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(angle) * 11, -2 + Math.sin(angle) * 5, 2.5, 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#d8dde2';
  ctx.beginPath();
  ctx.ellipse(0, -2, 8.5, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function renderWheelPreviews() {
  const configs = [
    ['wc-0', '#1c1c1c', '#808080', 10],
    ['wc-1', '#cccccc', '#eeeeee', 10],
    ['wc-2', '#7a5c2e', '#c49a45', 10],
    ['wc-f0', '#1c1c1c', '#808080', 10],
    ['wc-f1', '#cccccc', '#eeeeee', 10],
    ['wc-f2', '#7a5c2e', '#c49a45', 10],
  ];

  configs.forEach(([id, rimColor, spokeColor, spokes]) => {
    drawWheel(id, rimColor, spokeColor, spokes);
  });
}

function renderBrakePreviews() {
  [
    ['bd-f0', 0xF5C518],
    ['bd-f1', 0xCC1122],
    ['bd-f2', 0x111111],
  ].forEach(([id, hex]) => drawBrakeDisc(id, hex));
}

// ─────────────────────────────────────────────────
// PUBLIC UI API
// ─────────────────────────────────────────────────
window.toggleDarkMode = toggleDarkMode;

window.setView = function(mode, btn) {
  document.querySelectorAll('.vtb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (mode === 'close') {
    // ▶ CHANGE 2: close view uses longer, quintic-eased animation
    animToPreset('close', CAM_ANIM_MS_CLOSE);
    return;
  }

  if (mode === 'interior') {
    // ▶ CHANGE 1: interior fly-in — slow, smooth, then unlock 360°
    animToPreset('interior', CAM_ANIM_MS_INTERIOR);
    setActiveCameraButton(null);
    return;
  }

  animToPreset('front34');
  setActiveCameraButton(findCameraButton('front34'));
};

window.setPanelTab = function(btn, mode = 'exterior') {
  document.querySelectorAll('.bptab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const panel = document.getElementById('bpanel');
  if (panel) panel.dataset.mode = mode;
};

window.setCamera = function(name, btn) {
  runCameraButtonPreset(name, btn, false);
};

function toHexKey(value) {
  return `0x${Number(value).toString(16).padStart(6, '0').toUpperCase()}`;
}

function syncActiveByAttribute(attributeName, value) {
  const normalized = String(value).toLowerCase();
  document.querySelectorAll(`[${attributeName}]`).forEach(node => {
    node.classList.toggle('active', String(node.getAttribute(attributeName)).toLowerCase() === normalized);
  });
}

function updateConfigViewUI(view) {
  const panel = document.getElementById('bpanel');
  const cycleBtn = document.getElementById('bpanel-cycle');
  const cycleLabel = cycleBtn?.querySelector('.bpanel-cycle-text');
  const focusTitle = document.getElementById('config-focus-title');
  const focusCopy = document.getElementById('config-focus-copy');
  const focusWrap = document.querySelector('.bfocus');
  const meta = CONFIG_VIEW_META[view] || CONFIG_VIEW_META.original;

  if (panel) panel.dataset.configView = view;
  if (focusWrap) focusWrap.setAttribute('aria-hidden', view === 'original' ? 'true' : 'false');

  document.querySelectorAll('.focus-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.configView === view);
  });

  if (focusTitle) focusTitle.textContent = meta.title;
  if (focusCopy) focusCopy.textContent = meta.copy;
  if (cycleLabel) cycleLabel.textContent = meta.cycleLabel;
  if (cycleBtn) {
    cycleBtn.setAttribute('aria-label', meta.cycleAria);
    cycleBtn.setAttribute('title', meta.cycleAria);
  }
}

window.setConfigView = function(view = 'original') {
  updateConfigViewUI(CONFIG_VIEW_ORDER.includes(view) ? view : 'original');
};

window.cycleConfigView = function() {
  const panel = document.getElementById('bpanel');
  const current = panel?.dataset.configView || 'original';
  const currentIndex = CONFIG_VIEW_ORDER.indexOf(current);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % CONFIG_VIEW_ORDER.length : 0;
  updateConfigViewUI(CONFIG_VIEW_ORDER[nextIndex]);
};

window.selectColor = function(el, hex) {
  const value = Number(hex);
  syncActiveByAttribute('data-paint-hex', toHexKey(value));
  applyPaintColor(value);
};

const WCFG = {
  diamante: { hex: 0x1c1c1c, rc: '#1c1c1c', sc: '#808080' },
  silver:   { hex: 0xcccccc, rc: '#cccccc', sc: '#eeeeee' },
  bronze:   { hex: 0x7a5c2e, rc: '#7a5c2e', sc: '#c49a45' },
};

window.selectWheel = function(el, type) {
  syncActiveByAttribute('data-wheel-type', type);
  const cfg = WCFG[type] || WCFG.diamante;

  rimMeshes.forEach(mesh => {
    getMats(mesh.material).forEach(m => {
      if (!m) return;
      if (m.color) m.color.setHex(cfg.hex);
      if ('metalness' in m) m.metalness = 0.95;
      if ('roughness' in m) m.roughness = 0.10;
      m.needsUpdate = true;
    });
  });

  renderWheelPreviews();
};

window.selectCaliper = function(el, hex) {
  const value = Number(hex);
  syncActiveByAttribute('data-brake-hex', toHexKey(value));
  caliperMeshes.forEach(mesh => {
    getMats(mesh.material).forEach(m => {
      if (!m) return;
      if (m.color) m.color.setHex(value);
      m.needsUpdate = true;
    });
  });
};

function initConfigPanel() {
  updateConfigViewUI('original');
  renderWheelPreviews();
  renderBrakePreviews();
}

function reapplyActiveConfigSelections() {
  const activeWheel = document.querySelector('[data-wheel-type].active')?.getAttribute('data-wheel-type') || 'diamante';
  const activeBrake = Number(document.querySelector('[data-brake-hex].active')?.getAttribute('data-brake-hex') || '0xF5C518');

  window.selectWheel(null, activeWheel);
  window.selectCaliper(null, activeBrake);
}

// ─────────────────────────────────────────────────
// BOOT SEQUENCE
// ─────────────────────────────────────────────────
window.addEventListener('load', async () => {
  try {
    setLoadProgress(10, 'INITIALIZING STUDIO…');
    await waitForNextPaint();

    initRenderer();
    initControls();
    buildLights();
    buildFloor();

    setLoadProgress(46, 'BUILDING ENVIRONMENT…');
    await waitForNextPaint();

    buildStudioEnvSync();
    tryUpgradeEXR();

    setLoadProgress(62, 'LOADING CAR MODEL…');
    await waitForNextPaint();

    renderer.setAnimationLoop(loop);
    window.addEventListener('resize', onResize);
    initThemeToggle();
    initDriveButton();
    bindCameraButtons();
    initConfigPanel();

    loadCarModel().then(() => {
      renderWheelPreviews();
      renderBrakePreviews();
      reapplyActiveConfigSelections();
      bindCameraButtons();
    }).catch(err => {
      console.warn('[COSMIC FORGE] Model load error:', err);
    });

    await new Promise(resolve => setTimeout(resolve, 1600));
    setLoadProgress(100, 'READY');
    await new Promise(resolve => setTimeout(resolve, 180));
    hideLoader();
    appVisible = true;

  } catch (err) {
    console.error('[COSMIC FORGE] Boot error:', err);
    hideLoader();
    appVisible = true;
  }
});

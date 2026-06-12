/**
 * 3D viewer scaffolding for SimFoundry research page.
 *
 * Viewer types:
 *   - data-viewer-type="hybrid" : Gaussian splat background + textured GLB
 *                                  objects, driven by a scene.json manifest
 *                                  produced by tools/build_nv_desk_scene.py.
 *   - data-viewer-type="mesh"   : GLB/GLTF single-object viewer (three.js).
 *
 * To add a new scene: build a scene.json with tools/build_nv_desk_scene.py and
 * add an entry to SCENE_MANIFESTS below. The dropdown <option> value must
 * match the asset-map key.
 */

// The three.js + Gaussian-splat stack is the single heaviest payload on the
// page. Rather than statically importing it (which would download/parse it on
// first paint for every visitor, including mobile users who can't use the 3D
// viewers at all), we lazily dynamic-import it the first time a 3D viewer is
// actually about to initialize. See ensureLibs() / whenVisible().
let THREE, OrbitControls, GLTFLoader, KTX2Loader, MeshoptDecoder, RoomEnvironment, GaussianSplats3D;
let _libsPromise = null;

// Basis Universal transcoder for KTX2 textures. The GLBs are gltfpack-compressed
// (EXT_meshopt_compression geometry + KHR_texture_basisu / ETC1S textures), so
// GLTFLoader needs both a MeshoptDecoder and a KTX2Loader wired up to decode
// them. The transcoder ships with the same pinned three.js version on the CDN.
const BASIS_TRANSCODER_PATH =
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/";
let _ktx2Loader = null;

function ensureLibs() {
  if (!_libsPromise) {
    _libsPromise = Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/loaders/KTX2Loader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
      import("three/addons/environments/RoomEnvironment.js"),
      import("@mkkellogg/gaussian-splats-3d"),
    ]).then(([three, oc, gl, ktx, md, re, gs]) => {
      THREE = three;
      OrbitControls = oc.OrbitControls;
      GLTFLoader = gl.GLTFLoader;
      KTX2Loader = ktx.KTX2Loader;
      MeshoptDecoder = md.MeshoptDecoder;
      RoomEnvironment = re.RoomEnvironment;
      GaussianSplats3D = gs;
    });
  }
  return _libsPromise;
}

// Build a GLTFLoader that can decode meshopt geometry + KTX2 textures. The
// KTX2Loader is shared across viewers but must detectSupport() against the
// renderer that will display the mesh so it transcodes to a GPU-supported
// format. Vertex-colored GLBs with no textures simply never invoke it.
function makeGltfLoader(renderer) {
  if (!_ktx2Loader) {
    _ktx2Loader = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH);
  }
  if (renderer) _ktx2Loader.detectSupport(renderer);
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(_ktx2Loader);
}

// True when the device can't meaningfully use the WebGL 3D viewers (the page
// already tells these users to visit on desktop). We skip initializing them
// entirely so phones never download three.js, the splat lib, or the GLBs.
const IS_MOBILE =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(max-width: 768px), (hover: none) and (pointer: coarse)").matches;

// Run `cb` once the element scrolls near the viewport. Falls back to running
// immediately where IntersectionObserver isn't available.
function whenVisible(el, cb, { rootMargin = "300px" } = {}) {
  if (!el) return;
  if (typeof IntersectionObserver === "undefined") {
    cb();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          io.disconnect();
          cb();
          return;
        }
      }
    },
    { rootMargin },
  );
  io.observe(el);
}

// Copy any pending `<source data-src>` URLs onto the live `src` attribute and
// (re)load the element. Videos ship without a real `src` so the browser never
// fetches them until they're actually needed.
function hydrateVideo(video) {
  if (!video) return;
  let changed = false;
  video.querySelectorAll("source[data-src]").forEach((source) => {
    if (!source.getAttribute("src")) {
      source.setAttribute("src", source.dataset.src);
      changed = true;
    }
  });
  if (changed) {
    video.load();
    // load() resets playbackRate to 1, so reapply the requested rate (used by
    // the 2x input clips) once the new source has metadata.
    const rate = Number(video.dataset.playbackRate);
    if (rate && rate !== 1) {
      const applyRate = () => { video.playbackRate = rate; };
      applyRate();
      video.addEventListener("loadedmetadata", applyRate, { once: true });
    }
  }
}

// Replace a 3D viewer's loading placeholder with a desktop-only notice.
function showMobileNotice(container) {
  if (!container) return;
  const el = container.querySelector(".viewer-loading") || container;
  el.textContent = "3D viewer available on desktop";
  el.style.display = "";
}

// Standalone (non-tabbed) videos marked with `data-lazy-autoplay`: hydrate and
// play them when scrolled into view, pause when they leave. This keeps the
// large policy/task-cousin clips from buffering on initial load.
function wireLazyAutoplayVideos() {
  const videos = Array.from(document.querySelectorAll("video[data-lazy-autoplay]"));
  if (!videos.length) return;
  if (typeof IntersectionObserver === "undefined") {
    videos.forEach((video) => {
      hydrateVideo(video);
      video.play().catch(() => {});
    });
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          hydrateVideo(video);
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    { rootMargin: "200px" },
  );
  videos.forEach((video) => io.observe(video));
}

// Count `[data-countup]` numbers (e.g. "46%") up from zero, keeping any
// non-numeric suffix. Runs alongside the bar-grow transition below.
function animateCountUps(root) {
  root.querySelectorAll("[data-countup]").forEach((el) => {
    const target = parseFloat(el.textContent);
    if (!isFinite(target)) return;
    const suffix = el.textContent.replace(/^[\d.]+/, "");
    const duration = 900;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out, matches the bar curve
      el.textContent = Math.round(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Charts marked with `data-chart-grow` start zeroed out and grow to their
// real values the first time they scroll into view. Skipped (charts render
// fully grown) for reduced-motion users and, via whenVisible's fallback,
// where IntersectionObserver isn't available.
function wireChartGrowAnimations() {
  const charts = Array.from(document.querySelectorAll("[data-chart-grow]"));
  if (!charts.length) return;
  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;
  charts.forEach((chart) => {
    chart.classList.add("chart-grow-pending");
    whenVisible(
      chart,
      () => {
        // Commit the zeroed layout before releasing it so the change animates.
        void chart.offsetHeight;
        chart.classList.remove("chart-grow-pending");
        animateCountUps(chart);
      },
      { rootMargin: "-80px 0px" },
    );
  });
}

const SCENE_MANIFESTS = {
  "nv_desk":        "assets/viewers/nv_desk/scene.json",
  "kitchen_2_demo": "assets/viewers/kitchen_2_demo/scene.json",
  "dining_1_demo":  "assets/viewers/dining_1_demo/scene.json",
  "toys_1_demo":    "assets/viewers/toys_1_demo/scene.json",
  "outdoor_1_demo": "assets/viewers/outdoor_1_demo/scene.json",
};

const OBJECT_ASSETS = {
  // "object-01": "assets/viewers/object-01.glb",
};

// SAM3D GLBs are gltfpack-compressed (EXT_meshopt_compression), served from
// the site's own glb/ directory.
const SAM3D_RELEASE_BASE = "glb";

function sam3dEntry(key, label) {
  const base = `assets/viewers/sf_vs_sam3d/${key}`;
  return {
    label,
    image: `${base}/input.png`,
    simfoundry: `${base}/simfoundry.glb`,
    sam3d: `${SAM3D_RELEASE_BASE}/${key}_sam3d.glb`,
    view: `${base}/view.json`,
  };
}

const SAM3D_COMPARISON_ASSETS = {
  "OCID_2":        sam3dEntry("OCID_2",        "OCID 2"),
  "nv_desk":       sam3dEntry("nv_desk",       "Desk"),
  "bathroom_1":    sam3dEntry("bathroom_1",    "Bathroom"),
  "Gemini_1":      sam3dEntry("Gemini_1",      "Gemini 1"),
  "home_coffee_4": sam3dEntry("home_coffee_4", "Home Coffee 4"),
};

const meshViewers = new WeakMap();
const meshLoadTokens = new WeakMap();

async function loadMesh(container, src, viewPreset) {
  // Guards against races when libs/assets are still downloading and a newer
  // load (e.g. a fast tab switch) is requested for the same container.
  const token = (meshLoadTokens.get(container) || 0) + 1;
  meshLoadTokens.set(container, token);

  const existing = meshViewers.get(container);
  if (existing) {
    existing.dispose();
    meshViewers.delete(container);
  }

  container.innerHTML = "";
  const loadingEl = document.createElement("div");
  loadingEl.className = "viewer-loading";
  loadingEl.textContent = "Loading viewer…";
  container.appendChild(loadingEl);

  if (!src) {
    loadingEl.textContent = "Viewer asset not configured";
    return;
  }

  try {
    await ensureLibs();
  } catch (e) {
    loadingEl.textContent = "Failed to load 3D engine";
    console.warn("ensureLibs failed:", e);
    return;
  }
  if (meshLoadTokens.get(container) !== token) return;

  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
  camera.position.set(1, 0.8, 1.6);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const headlight = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(headlight);
  scene.add(headlight.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  let frameId = 0;
  let resizeObserver = null;
  let disposed = false;

  const animate = () => {
    if (disposed) return;
    frameId = requestAnimationFrame(animate);
    controls.update();
    headlight.position.copy(camera.position);
    headlight.target.position.copy(controls.target);
    headlight.target.updateMatrixWorld();
    renderer.render(scene, camera);
  };

  const handle = {
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      if (resizeObserver) resizeObserver.disconnect();
      controls.dispose();
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
  meshViewers.set(container, handle);

  makeGltfLoader(renderer).load(
    src,
    (gltf) => {
      if (disposed) return;

      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;

      if (viewPreset && viewPreset.camera) {
        // World-frame preset derived from the input image's cam2world.
        // Mesh is in metric Z-up world frame — do NOT recenter.
        const c = viewPreset.camera;
        camera.up.set(c.up[0], c.up[1], c.up[2]);
        camera.position.set(c.position[0], c.position[1], c.position[2]);
        if (c.fov_y_deg) camera.fov = c.fov_y_deg;
        camera.near = Math.max(maxDim / 1000, 0.001);
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();
        controls.target.set(c.target[0], c.target[1], c.target[2]);
      } else {
        // Fallback: center mesh on origin, fit camera to bbox.
        root.position.sub(center);
        const dist = maxDim * 1.8;
        camera.up.set(0, 1, 0);
        camera.position.set(dist, dist * 0.7, dist);
        camera.near = maxDim / 100;
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
      }
      controls.update();

      // Generated (e.g. Hunyuan) meshes ship a base-color texture but leave
      // metallic/roughness factors unset, which glTF defaults to fully metallic
      // — so the albedo renders as dark shiny metal under the env map. Force
      // textured PBR materials matte so the texture shows. Guarded by `.map`
      // so vertex-colored meshes (no texture) are left exactly as-is.
      root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) {
            if ("metalness" in m) m.metalness = 0;
            if ("roughness" in m) m.roughness = 1;
            if ("specularIntensity" in m) m.specularIntensity = 0;
            m.needsUpdate = true;
          }
        });
      });

      scene.add(root);

      if (loadingEl.parentNode === container) container.removeChild(loadingEl);
      container.appendChild(renderer.domElement);
      animate();
    },
    (xhr) => {
      if (disposed) return;
      if (xhr.total) {
        loadingEl.textContent = `Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
      } else {
        loadingEl.textContent = `Loading… ${(xhr.loaded / 1048576).toFixed(1)} MB`;
      }
    },
    (err) => {
      console.warn("GLB load failed:", src, err);
      loadingEl.textContent = "Failed to load viewer asset";
    }
  );

  resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);
}

const hybridViewers = new WeakMap();

function pickSplatUrl(splat) {
  // The splat files now live in this repo (splats/…) and are served
  // same-origin in both dev and production, so always use the manifest `url`.
  // `local_url` is a legacy symlink pointing outside the repo root; most dev
  // servers refuse to follow it, which manifested as an endless "initializing".
  return splat.url || splat.local_url;
}

// Download a URL to an ArrayBuffer while reporting progress. Warming the HTTP
// cache up front means GaussianSplats3D's own fetch resolves from cache, and it
// sidesteps progressive/range loading (which hangs on static servers that don't
// support HTTP range requests). `onPct` gets an integer 0–100, or null when the
// total size is unknown.
async function fetchWithProgress(url, onPct) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !res.body.getReader) {
    onPct(null);
    return res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onPct(total ? Math.round((received / total) * 100) : null);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return buf.buffer;
}

function lookAtFromQuaternion(camera) {
  // OmniGibson / USD camera convention: forward = local -Z, up = local +Y.
  // Apply the world-orientation quaternion to (0,0,-1) to get the world-frame
  // viewing direction, then synthesize a target 1 m in front of the camera so
  // OrbitControls has something to orbit around.
  const q = new THREE.Quaternion(
    camera.quaternion_xyzw[0],
    camera.quaternion_xyzw[1],
    camera.quaternion_xyzw[2],
    camera.quaternion_xyzw[3],
  );
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const pos = new THREE.Vector3().fromArray(camera.position);
  return pos.add(forward).toArray();
}

async function loadHybridScene(container, manifestUrl) {
  const existing = hybridViewers.get(container);
  if (existing) {
    existing.dispose();
    hybridViewers.delete(container);
  }

  container.innerHTML = "";
  const loadingEl = document.createElement("div");
  loadingEl.className = "viewer-loading";
  loadingEl.textContent = "";
  container.appendChild(loadingEl);

  // Loading circle + label, shown until the interactive viewer is ready.
  const spinner = document.createElement("div");
  spinner.className = "viewer-spinner";
  container.appendChild(spinner);
  const spinnerLabel = document.createElement("div");
  spinnerLabel.className = "viewer-spinner-label";
  spinnerLabel.textContent = "Initializing interactive viewer…";
  container.appendChild(spinnerLabel);
  const removeSpinner = () => {
    if (spinner.parentNode === container) container.removeChild(spinner);
    if (spinnerLabel.parentNode === container) container.removeChild(spinnerLabel);
  };

  // Created once the manifest is known; plays full-cover while the splat/mesh
  // assets stream in, then shrinks to its resting top-left spot when ready.
  let previewVideo = null;

  if (!manifestUrl) {
    removeSpinner();
    loadingEl.textContent = "Viewer asset not configured";
    return;
  }

  try {
    await ensureLibs();
  } catch (e) {
    removeSpinner();
    loadingEl.textContent = "Failed to load 3D engine";
    console.warn("ensureLibs failed:", e);
    return;
  }

  let manifest;
  try {
    const res = await fetch(manifestUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.warn("manifest fetch failed:", manifestUrl, err);
    removeSpinner();
    loadingEl.textContent = "Failed to load scene manifest";
    return;
  }

  // Start the source-capture preview right away so something is on screen
  // (and playing) while the heavy splat/mesh assets download.
  if (manifest.preview_video?.url) {
    previewVideo = document.createElement("video");
    previewVideo.src = manifest.preview_video.url;
    previewVideo.autoplay = true;
    previewVideo.loop = true;
    previewVideo.muted = true;
    previewVideo.playsInline = true;
    previewVideo.preload = "auto";
    previewVideo.className = "viewer-preview-video is-cover";
    container.appendChild(previewVideo);
    const rate = manifest.preview_video.playback_rate || 1.5;
    const applyRate = () => { previewVideo.playbackRate = rate; };
    previewVideo.addEventListener("loadedmetadata", applyRate);
    applyRate();
    previewVideo.play().catch(() => { /* autoplay blocked; ignore */ });
  }

  const splat = manifest.splat;
  if (!splat) {
    removeSpinner();
    loadingEl.textContent = "Manifest has no splat scene";
    return;
  }

  const camera = manifest.camera;
  const worldUp = manifest.world_up || [0, 0, 1];
  const initialPos = camera ? camera.position : [0, -1, 0.6];
  const initialLookAt = camera ? lookAtFromQuaternion(camera) : [0, 0, 0];

  loadingEl.textContent = "";

  // Self-driven mode: the lib owns the canvas, camera, OrbitControls, and
  // render loop. We add meshes through viewer.threeScene so the GS-vs-mesh
  // depth composition happens in one pass.
  //
  // Performance knobs tuned to keep this usable on integrated Apple GPUs:
  //   - sphericalHarmonicsDegree: 1 — view-dependent shading without the 16
  //     coefficient/channel cost of degree 2.
  //   - antialiased: false — splat shader AA is expensive; CSS scaling is
  //     enough at this resolution.
  //   - gpuAcceleratedSort kept off — the WebGPU sort path is fragile across
  //     browsers (broke our headless WebGL fallback entirely). WebGL2 CPU
  //     sort is plenty fast at 450k splats on a modern Mac.
  //   - devicePixelRatio capped at 1.5 so Retina displays don't pay 4× the
  //     fragment cost on the splat shader.
  const splatViewer = new GaussianSplats3D.Viewer({
    rootElement: container,
    cameraUp: worldUp,
    initialCameraPosition: initialPos,
    initialCameraLookAt: initialLookAt,
    sharedMemoryForWorkers: false,
    gpuAcceleratedSort: false,
    sphericalHarmonicsDegree: 1,
    useBuiltInControls: true,
    antialiased: false,
    showLoadingUI: false,
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
  });

  let disposed = false;
  const meshObjects = [];
  const handle = {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try { splatViewer.dispose(); } catch (e) { /* ignore */ }
      meshObjects.forEach((root) => {
        root.traverse((obj) => {
          if (obj.isMesh) {
            obj.geometry?.dispose?.();
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
            else obj.material?.dispose?.();
          }
        });
      });
    },
  };
  hybridViewers.set(container, handle);
  // Debug hook for local verification only; harmless in production.
  window.__hybridViewer = splatViewer;
  window.__hybridMeshes = meshObjects;

  const splatUrl = pickSplatUrl(splat);
  const FORMAT_BY_NAME = {
    ply: GaussianSplats3D.SceneFormat.Ply,
    ksplat: GaussianSplats3D.SceneFormat.KSplat,
    splat: GaussianSplats3D.SceneFormat.Splat,
  };
  const splatFormat =
    FORMAT_BY_NAME[(splat.format || "").toLowerCase()] ||
    GaussianSplats3D.LoaderUtils.sceneFormatFromPath(splatUrl);
  // Prefetch the splat ourselves so we can show a real download %, and so the
  // library's load resolves from the HTTP cache instead of progressively
  // range-requesting (which stalls on static servers without range support).
  const setLabel = (text) => {
    if (spinnerLabel.parentNode === container) spinnerLabel.textContent = text;
  };
  try {
    await fetchWithProgress(splatUrl, (pct) => {
      setLabel(pct === null ? "Loading scene…" : `Loading scene… ${pct}%`);
    });
  } catch (err) {
    console.warn("splat prefetch failed:", splatUrl, err);
    removeSpinner();
    loadingEl.textContent = "Failed to load splat background";
    return;
  }
  if (disposed) return;
  setLabel("Initializing interactive viewer…");

  // Watchdog: if addSplatScene never settles (e.g. the sort worker never
  // signals ready), surface that instead of spinning forever.
  const watchdog = setTimeout(() => {
    console.warn("[hybrid] addSplatScene still pending after 15s:", splatUrl);
    setLabel("Still initializing… (see console)");
  }, 15000);
  try {
    console.log("[hybrid] addSplatScene start:", splatUrl, splatFormat);
    await splatViewer.addSplatScene(splatUrl, {
      format: splatFormat,
      // Aggressive alpha-threshold drops near-transparent splats that
      // contribute little visually but cost full fragment work.
      splatAlphaRemovalThreshold: 20,
      position: splat.position,
      rotation: splat.quaternion_xyzw,
      scale: splat.scale,
      showLoadingUI: false,
      // Single cached download instead of progressive range requests.
      progressiveLoad: false,
    });
    console.log("[hybrid] addSplatScene resolved:", splatUrl);
  } catch (err) {
    console.warn("splat scene load failed:", splatUrl, err);
    clearTimeout(watchdog);
    removeSpinner();
    loadingEl.textContent = "Failed to load splat background";
    return;
  }
  clearTimeout(watchdog);

  if (disposed) return;

  // Everything past here is best-effort: once the splat is in, the viewer is
  // usable, so a failure in renderer tweaks/lights must not strand the spinner.
  const renderer = splatViewer.renderer;
  try {
    splatViewer.start();

    // PBR-textured GLBs render black without IBL or lights. The GS viewer's
    // internal threeScene starts empty, so add an environment map + a soft
    // directional + ambient — matches what loadMesh does for the object viewer.
    if (renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      splatViewer.threeScene.environment = envTex;
      pmrem.dispose();
    }
    splatViewer.threeScene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1.5, -2.0, 3.0);
    splatViewer.threeScene.add(sun);
  } catch (err) {
    console.warn("[hybrid] post-load setup failed (continuing):", err);
  }

  // Pause the render loop when the tab is hidden — biggest free GPU win for
  // users who switch tabs/windows. (Off-screen pause via IntersectionObserver
  // is tempting but races with initial layout and can park the viewer in a
  // permanently-stopped state.)
  const onHidden = () => {
    try {
      if (document.hidden) splatViewer.stop();
      else splatViewer.start();
    } catch (e) { /* lib may not implement stop in all versions */ }
  };
  document.addEventListener("visibilitychange", onHidden);
  const origDispose = handle.dispose;
  handle.dispose = () => {
    document.removeEventListener("visibilitychange", onHidden);
    origDispose();
  };

  // Interactive viewer is ready: drop the loading placeholder + spinner, and
  // shrink the preview video from full-cover down to its resting top-left spot.
  if (loadingEl.parentNode === container) container.removeChild(loadingEl);
  const revealViewer = () => {
    if (disposed) return;
    removeSpinner();
    if (previewVideo) previewVideo.classList.remove("is-cover");
  };
  // Wait for the first splat render to land before uncovering, so the handoff
  // from video to live viewer doesn't flash an empty canvas.
  requestAnimationFrame(() => requestAnimationFrame(revealViewer));

  const loader = makeGltfLoader(renderer);
  for (const obj of manifest.objects || []) {
    loader.load(
      obj.url,
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;
        root.position.fromArray(obj.position);
        root.quaternion.set(
          obj.quaternion_xyzw[0],
          obj.quaternion_xyzw[1],
          obj.quaternion_xyzw[2],
          obj.quaternion_xyzw[3],
        );
        root.scale.fromArray(obj.scale);
        splatViewer.threeScene.add(root);
        meshObjects.push(root);
      },
      undefined,
      (err) => {
        console.warn("GLB load failed:", obj.url, err);
      },
    );
  }
}

function setSrc(container, src, viewPreset) {
  if (!container) return;
  container.dataset.src = src || "";
  if (container.dataset.viewerType === "mesh") {
    loadMesh(container, src, viewPreset);
    return;
  }
  if (container.dataset.viewerType === "hybrid") {
    loadHybridScene(container, src);
    return;
  }
  const loading = container.querySelector(".viewer-loading");
  if (loading) {
    loading.textContent = src ? "Loading viewer…" : "Viewer asset not configured";
  }
}

async function fetchViewPreset(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function wireSelect(selectId, containerId, assetMap) {
  const select = document.getElementById(selectId);
  const container = document.getElementById(containerId);
  if (!select || !container) return;

  const apply = () => {
    const key = select.value;
    const src = assetMap[key] || "";
    setSrc(container, src);
  };

  select.addEventListener("change", apply);
  apply();
}

// Side-by-side scene buttons for the hybrid splat viewer (mirrors the SAM3D
// and qualitative tab pattern), replacing the old <select> dropdown.
function wireTabbedViewer(tablistId, containerId, assetMap, attr) {
  const tablist = document.getElementById(tablistId);
  const container = document.getElementById(containerId);
  if (!tablist || !container) return;

  const tabs = Array.from(tablist.querySelectorAll(`[data-${attr}]`));
  if (!tabs.length) return;

  const key = (tab) => tab.dataset[attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];

  const apply = (target) => {
    tabs.forEach((tab) => {
      const on = key(tab) === target;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
    });
    setSrc(container, assetMap[target] || "");
  };

  if (IS_MOBILE) {
    showMobileNotice(container);
    return;
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => apply(key(tab))));
  const initial = tabs.find((t) => t.classList.contains("is-active")) || tabs[0];
  // Defer the (heavy) initial load until the viewer scrolls near the viewport.
  whenVisible(container, () => apply(key(initial)));
}

function wireSam3dComparison() {
  const tablist = document.getElementById("sam3d-scene-tabs");
  const imageEl = document.getElementById("sam3d-input-image");
  const simContainer = document.getElementById("simfoundry-glb-viewer");
  const samContainer = document.getElementById("sam3d-glb-viewer");
  if (!tablist || !imageEl || !simContainer || !samContainer) return;

  const tabs = Array.from(tablist.querySelectorAll("[data-sam3d-target]"));
  if (!tabs.length) return;

  const imageWrap = imageEl.parentElement;
  const imageLoading = imageWrap ? imageWrap.querySelector(".viewer-loading") : null;
  const allContainers = [imageWrap, simContainer, samContainer].filter(Boolean);

  const applyAspect = () => {
    const w = imageEl.naturalWidth;
    const h = imageEl.naturalHeight;
    if (!w || !h) return;
    const ar = `${w} / ${h}`;
    allContainers.forEach((c) => { c.style.aspectRatio = ar; });
  };

  const apply = async (target) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.sam3dTarget === target;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    const entry = SAM3D_COMPARISON_ASSETS[target];
    if (!entry) {
      imageEl.removeAttribute("src");
      imageEl.style.display = "none";
      if (imageLoading) {
        imageLoading.textContent = "Image not configured";
        imageLoading.style.display = "";
      }
      setSrc(simContainer, "");
      setSrc(samContainer, "");
      return;
    }
    if (entry.image) {
      imageEl.src = entry.image;
      imageEl.style.display = "";
      if (imageLoading) imageLoading.style.display = "none";
      if (imageEl.complete && imageEl.naturalWidth) {
        applyAspect();
      } else {
        imageEl.addEventListener("load", applyAspect, { once: true });
      }
    } else {
      imageEl.removeAttribute("src");
      imageEl.style.display = "none";
      if (imageLoading) {
        imageLoading.textContent = "Image not configured";
        imageLoading.style.display = "";
      }
    }
    const viewPreset = await fetchViewPreset(entry.view);
    setSrc(simContainer, entry.simfoundry || "", viewPreset);
    setSrc(samContainer, entry.sam3d || "", viewPreset);
  };

  if (IS_MOBILE) {
    showMobileNotice(simContainer);
    showMobileNotice(samContainer);
    if (imageLoading) {
      imageLoading.textContent = "View on desktop";
      imageLoading.style.display = "";
    }
    return;
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => apply(tab.dataset.sam3dTarget));
  });

  const initialTab = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
  // Defer the (heavy) initial load until the comparison scrolls near the viewport.
  whenVisible(simContainer, () => apply(initialTab.dataset.sam3dTarget));
}

function wireReal2SimResults() {
  const root = document.querySelector("[data-real2sim-results]");
  if (!root) return;

  const tabs = Array.from(root.querySelectorAll("[data-real2sim-target]"));
  const groups = Array.from(root.querySelectorAll("[data-real2sim-group]"));

  const setActiveGroup = (target) => {
    groups.forEach((group) => {
      const isActive = group.dataset.real2simGroup === target;
      group.hidden = !isActive;
      group.classList.toggle("is-active", isActive);

      group.querySelectorAll("video").forEach((video) => {
        if (isActive) {
          hydrateVideo(video);
          video.currentTime = 0;
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    });

    tabs.forEach((tab) => {
      const isActive = tab.dataset.real2simTarget === target;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveGroup(tab.dataset.real2simTarget));
  });

  const activeTab = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
  // Don't buffer the active clip until the section scrolls near the viewport.
  if (activeTab) {
    whenVisible(root, () => setActiveGroup(activeTab.dataset.real2simTarget));
  }
}

function wireQualitativeResults() {
  const root = document.querySelector("[data-qualitative-results]");
  if (!root) return;

  const tabs = Array.from(root.querySelectorAll("[data-result-target]"));
  const groups = Array.from(root.querySelectorAll("[data-result-group]"));

  const toSeqSrc = (src) => src.replace(/\.mp4(\?.*)?$/i, "_seq.mp4$1");

  const updateVideoMode = (group, mode, shouldPlay) => {
    group.dataset.videoMode = mode;

    group.querySelectorAll("video:not([data-video-static])").forEach((video) => {
      const source = video.querySelector("source");
      if (!source) return;

      if (!source.dataset.normalSrc) {
        // Real URL lives in data-src until the clip is hydrated; fall back to a
        // live src for already-hydrated sources.
        source.dataset.normalSrc = source.dataset.src || source.getAttribute("src") || "";
        source.dataset.seqSrc = toSeqSrc(source.dataset.normalSrc);
      }

      const nextSrc = mode === "sequence" ? source.dataset.seqSrc : source.dataset.normalSrc;
      if (source.getAttribute("src") !== nextSrc) {
        video.pause();
        source.setAttribute("src", nextSrc);
        video.load();
      }

      video.currentTime = 0;
      if (shouldPlay) {
        video.play().catch(() => {});
      }
    });
  };

  groups.forEach((group) => {
    group.querySelectorAll("video[data-playback-rate]").forEach((video) => {
      video.playbackRate = Number(video.dataset.playbackRate) || 1;
    });

    group.dataset.videoMode = group.dataset.videoMode || "normal";

    const toggle = document.createElement("div");
    toggle.className = "qualitative-video-toggle";
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "Video type");
    toggle.innerHTML = `
      <button class="qualitative-toggle-button is-active" type="button" data-video-mode="normal" aria-pressed="true">Normal</button>
      <button class="qualitative-toggle-button" type="button" data-video-mode="sequence" aria-pressed="false">Sequence</button>
    `;

    const pair = group.querySelector(".qualitative-pair");
    if (pair) {
      group.insertBefore(toggle, pair);
    }

    toggle.querySelectorAll("[data-video-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.videoMode;
        const isActiveGroup = group.classList.contains("is-active");

        toggle.querySelectorAll("[data-video-mode]").forEach((toggleButton) => {
          const isActive = toggleButton.dataset.videoMode === mode;
          toggleButton.classList.toggle("is-active", isActive);
          toggleButton.setAttribute("aria-pressed", String(isActive));
        });

        updateVideoMode(group, mode, isActiveGroup);
      });
    });
  });

  const setActiveGroup = (target) => {
    groups.forEach((group) => {
      const isActive = group.dataset.resultGroup === target;
      group.hidden = !isActive;
      group.classList.toggle("is-active", isActive);

      group.querySelectorAll("video").forEach((video) => {
        if (isActive) {
          hydrateVideo(video);
          video.currentTime = 0;
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    });

    tabs.forEach((tab) => {
      const isActive = tab.dataset.resultTarget === target;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveGroup(tab.dataset.resultTarget));
  });

  const activeTab = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
  // Don't buffer the active clip until the section scrolls near the viewport.
  if (activeTab) {
    whenVisible(root, () => setActiveGroup(activeTab.dataset.resultTarget));
  }
}

// --- Interactive object picker -------------------------------------------
// Left: the real (padded+resized) scene image. Each object has a binary mask
// (in the same pixel space as the image) and a reconstructed GLB. Hovering
// highlights the object under the cursor; clicking loads its mesh on the right.
// A dropdown switches between scenes; each scene has its own manifest.json.
const INTERACTIVE_SCENES = {
  "flag_scene_1":    { label: "Clutter Table",         dir: "flag_scene_1" },
  "home_coffee_4":   { label: "Home Coffee",           dir: "home_coffee_4" },
  "quillen_kitchen": { label: "Kitchen",               dir: "quillen_kitchen" },
  "bathroom_1":      { label: "Bathroom",              dir: "bathroom_1" },
  "Gemini_1":        { label: "AI-Generated (Gemini)", dir: "Gemini_1" },
};
const INTERACTIVE_BASE = "assets/viewers/interactive_objects";

async function wireInteractiveObjects() {
  const root = document.getElementById("interactive-objects");
  const tabs = document.getElementById("io-scene-tabs");
  const imgEl = document.getElementById("io-scene-image");
  const overlay = document.getElementById("io-overlay");
  const sceneEl = document.getElementById("io-scene");
  const tooltip = document.getElementById("io-tooltip");
  const loadingEl = document.getElementById("io-scene-loading");
  const meshContainer = document.getElementById("io-mesh-viewer");
  const selectedLabel = document.getElementById("io-selected-label");
  if (!root || !imgEl || !overlay || !sceneEl || !meshContainer) return;

  if (IS_MOBILE) {
    if (loadingEl) {
      loadingEl.textContent = "Interactive viewer available on desktop";
      loadingEl.hidden = false;
    }
    showMobileNotice(meshContainer);
    return;
  }

  const octx = overlay.getContext("2d");
  const GLOW = [125, 211, 252];                   // bright edge core
  const GLOW_SHADOW = "rgba(56, 189, 248, 0.95)"; // halo color

  // Mutable per-scene state, swapped out on every scene load.
  let W = 1, H = 1;
  let objects = [];
  let hovered = null;
  let selected = null;
  let loadToken = 0; // guards against races when scenes are switched quickly

  const objectAt = (px, py) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return null;
    const idx = py * W + px;
    for (const o of objects) if (o.occ[idx]) return o;
    return null;
  };
  const paintGlow = (o, strong) => {
    octx.save();
    octx.shadowColor = GLOW_SHADOW;
    octx.shadowBlur = strong ? 30 : 18;
    const passes = strong ? 4 : 2; // stack blurred passes into a softer glow
    for (let k = 0; k < passes; k++) octx.drawImage(o.edge, 0, 0);
    octx.restore();
  };
  const redraw = () => {
    octx.clearRect(0, 0, W, H);
    if (selected) paintGlow(selected, true);
    if (hovered && hovered !== selected) paintGlow(hovered, false);
  };
  const toPixel = (ev) => {
    const r = imgEl.getBoundingClientRect();
    return [
      Math.round((ev.clientX - r.left) / r.width * W),
      Math.round((ev.clientY - r.top) / r.height * H),
    ];
  };

  // Build one object's hit-test occupancy + pre-rendered glowing outline.
  const buildObject = async (obj, base) => {
    const maskImg = new Image();
    maskImg.src = base + obj.mask;
    try { await maskImg.decode(); } catch (e) { return null; }

    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(maskImg, 0, 0, W, H);
    const data = cx.getImageData(0, 0, W, H).data;

    const occ = new Uint8Array(W * H);
    let area = 0;
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4] > 127) { occ[i] = 1; area++; }
    }

    // Outline band: occupied pixels touching a non-occupied pixel (the
    // silhouette), dilated once so the rim stays visible when scaled down.
    const band = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!occ[y * W + x]) continue;
        let onEdge = false;
        for (let dy = -1; dy <= 1 && !onEdge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || !occ[ny * W + nx]) { onEdge = true; break; }
          }
        }
        if (!onEdge) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && occ[ny * W + nx]) band[ny * W + nx] = 1;
          }
        }
      }
    }

    const edge = document.createElement("canvas");
    edge.width = W; edge.height = H;
    const ectx = edge.getContext("2d");
    const eimg = ectx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      if (band[i]) {
        eimg.data[i * 4] = GLOW[0];
        eimg.data[i * 4 + 1] = GLOW[1];
        eimg.data[i * 4 + 2] = GLOW[2];
        eimg.data[i * 4 + 3] = 255;
      }
    }
    ectx.putImageData(eimg, 0, 0);

    return { ...obj, occ, area, edge, url: base + obj.mesh };
  };

  const resetMeshViewer = () => {
    const existing = meshViewers.get(meshContainer);
    if (existing) { existing.dispose(); meshViewers.delete(meshContainer); }
    meshContainer.innerHTML = '<div class="viewer-loading">Click an object to load its mesh</div>';
  };

  async function loadScene(dir) {
    const myToken = ++loadToken;
    const base = `${INTERACTIVE_BASE}/${dir}/`;

    // Reset state + UI for the incoming scene.
    hovered = null;
    selected = null;
    objects = [];
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (selectedLabel) selectedLabel.textContent = "";
    resetMeshViewer();
    if (loadingEl) { loadingEl.textContent = "Loading scene…"; loadingEl.hidden = false; }

    let manifest;
    try {
      const res = await fetch(base + "manifest.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = await res.json();
    } catch (err) {
      console.warn("interactive-objects manifest failed:", base, err);
      if (myToken === loadToken && loadingEl) loadingEl.textContent = "Failed to load scene";
      return;
    }
    if (myToken !== loadToken) return;

    [W, H] = manifest.image_size || [1, 1];
    overlay.width = W;
    overlay.height = H;
    const ar = `${W} / ${H}`;
    sceneEl.style.aspectRatio = ar;
    meshContainer.style.aspectRatio = ar;

    imgEl.src = base + manifest.image;
    try { await imgEl.decode(); } catch (e) { /* ignore */ }
    if (myToken !== loadToken) return;
    if (loadingEl) loadingEl.hidden = true;

    const built = await Promise.all((manifest.objects || []).map((obj) => buildObject(obj, base)));
    if (myToken !== loadToken) return; // a newer scene started while we decoded

    objects = built.filter(Boolean).sort((a, b) => a.area - b.area); // smaller on top
    redraw();

    // Pre-select a fixed default (the largest object — visually prominent and
    // stable across reloads) so the mesh viewer starts populated instead of
    // waiting for the user's first click.
    if (objects.length) selectObject(objects[objects.length - 1]);
  }

  const selectObject = (o) => {
    selected = o;
    redraw();
    if (selectedLabel) selectedLabel.textContent = `— ${o.label}`;
    loadMesh(meshContainer, o.url);
  };

  sceneEl.addEventListener("mousemove", (ev) => {
    const [px, py] = toPixel(ev);
    const o = objectAt(px, py);
    if (o !== hovered) { hovered = o; redraw(); }
    if (o) {
      sceneEl.classList.add("io-hovering");
      if (tooltip) {
        tooltip.textContent = o.label;
        tooltip.hidden = false;
        const r = sceneEl.getBoundingClientRect();
        tooltip.style.left = `${ev.clientX - r.left}px`;
        tooltip.style.top = `${ev.clientY - r.top}px`;
      }
    } else {
      sceneEl.classList.remove("io-hovering");
      if (tooltip) tooltip.hidden = true;
    }
  });

  sceneEl.addEventListener("mouseleave", () => {
    hovered = null;
    sceneEl.classList.remove("io-hovering");
    if (tooltip) tooltip.hidden = true;
    redraw();
  });

  sceneEl.addEventListener("click", (ev) => {
    const [px, py] = toPixel(ev);
    const o = objectAt(px, py);
    if (!o) return;
    selectObject(o);
  });

  // Build the scene tab buttons and wire switching.
  const entries = Object.values(INTERACTIVE_SCENES);
  if (tabs) {
    tabs.innerHTML = "";
    entries.forEach((info, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qualitative-tab" + (i === 0 ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
      btn.dataset.ioTarget = info.dir;
      btn.textContent = info.label;
      btn.addEventListener("click", () => {
        tabs.querySelectorAll(".qualitative-tab").forEach((t) => {
          const on = t === btn;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", String(on));
        });
        loadScene(info.dir);
      });
      tabs.appendChild(btn);
    });
  }

  // Defer the initial scene download until the picker scrolls near the viewport.
  whenVisible(root, () => loadScene(entries[0].dir));
}

function init() {
  wireLazyAutoplayVideos();
  wireChartGrowAnimations();
  wireTabbedViewer("scene-tabs", "scene-splat-viewer", SCENE_MANIFESTS, "scene-target");
  wireInteractiveObjects();
  wireSam3dComparison();
  wireReal2SimResults();
  wireQualitativeResults();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

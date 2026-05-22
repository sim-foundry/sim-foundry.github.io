/**
 * 3D viewer scaffolding for Sim Foundry research page.
 *
 * Viewer types:
 *   - data-viewer-type="splat" : 3D Gaussian splat scene viewer (stub)
 *   - data-viewer-type="mesh"  : GLB/GLTF object mesh viewer (three.js)
 *
 * To add a new scene/object: drop the asset under assets/viewers/ and add an
 * entry to the matching asset map below. The dropdown <option> value must
 * match the asset-map key.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const SCENE_ASSETS = {
  // "scene-01": "assets/viewers/scene-01.splat",
};

const OBJECT_ASSETS = {
  // "object-01": "assets/viewers/object-01.glb",
};

// SAM3D GLBs are gltfpack-compressed (EXT_meshopt_compression) and hosted in
// the sim-foundry-website-assets public repo. raw.githubusercontent.com serves
// them with CORS so the in-browser GLTFLoader can fetch them.
const SAM3D_RELEASE_BASE =
  "https://raw.githubusercontent.com/sim-foundry/sim-foundry-website-assets/main/glb";

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
  "nv_desk":       sam3dEntry("nv_desk",       "NV Desk"),
  "bathroom_1":    sam3dEntry("bathroom_1",    "Bathroom"),
  "Gemini_1":      sam3dEntry("Gemini_1",      "Gemini 1"),
  "home_coffee_4": sam3dEntry("home_coffee_4", "Home Coffee 4"),
};

const meshViewers = new WeakMap();

function loadMesh(container, src, viewPreset) {
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

  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
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

      scene.add(root);

      if (loadingEl.parentNode === container) container.removeChild(loadingEl);
      container.appendChild(renderer.domElement);
      animate();
    },
    undefined,
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

function setSrc(container, src, viewPreset) {
  if (!container) return;
  container.dataset.src = src || "";
  if (container.dataset.viewerType === "mesh") {
    loadMesh(container, src, viewPreset);
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

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => apply(tab.dataset.sam3dTarget));
  });

  const initialTab = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
  apply(initialTab.dataset.sam3dTarget);
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
        source.dataset.normalSrc = source.getAttribute("src") || "";
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
  if (activeTab) setActiveGroup(activeTab.dataset.resultTarget);
}

function init() {
  wireSelect("scene-select", "scene-splat-viewer", SCENE_ASSETS);
  wireSelect("object-select", "object-mesh-viewer", OBJECT_ASSETS);
  wireSam3dComparison();
  wireQualitativeResults();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

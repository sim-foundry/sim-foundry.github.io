/**
 * 3D viewer scaffolding for Sim Foundry research page.
 *
 * Two viewer types are stubbed:
 *   - data-viewer-type="splat" : 3D Gaussian splat scene viewer
 *   - data-viewer-type="mesh"  : Object mesh viewer (e.g., GLB/PLY)
 *
 * To wire up real viewers later:
 *   1. Set data-src="path/to/asset" on each .viewer-container.
 *   2. Replace the loadSplat / loadMesh stubs with three.js loaders, or
 *      drop in a splat library such as antimatter15/splat or
 *      @mkkellogg/gaussian-splats-3d. The DOM target is the .viewer-container
 *      element passed in.
 *
 * Scene/object dropdowns map their values via data-src using the
 * `data-asset-map` attribute on the <select>. For now we keep the
 * placeholders blank so the page loads cleanly with no assets.
 */

const SCENE_ASSETS = {
  // "scene-01": "assets/viewers/scene-01.splat",
};

const OBJECT_ASSETS = {
  // "object-01": "assets/viewers/object-01.glb",
};

function setSrc(container, src) {
  if (!container) return;
  container.dataset.src = src || "";
  const loading = container.querySelector(".viewer-loading");
  if (loading) {
    loading.textContent = src ? "Loading viewer…" : "Viewer asset not configured";
  }
  // When you wire up a real viewer, dispatch the appropriate loader here.
  // e.g. if (container.dataset.viewerType === "splat") loadSplat(container, src);
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

function wireQualitativeResults() {
  const root = document.querySelector("[data-qualitative-results]");
  if (!root) return;

  const tabs = Array.from(root.querySelectorAll("[data-result-target]"));
  const groups = Array.from(root.querySelectorAll("[data-result-group]"));

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

document.addEventListener("DOMContentLoaded", () => {
  wireSelect("scene-select", "scene-splat-viewer", SCENE_ASSETS);
  wireSelect("object-select", "object-mesh-viewer", OBJECT_ASSETS);
  wireQualitativeResults();
});

/* ---------- Stubs for future implementation ----------

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function loadMesh(container, src) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
  camera.position.set(0.6, 0.4, 0.8);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(1, 1, 1);
  scene.add(dir);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  new GLTFLoader().load(src, (gltf) => scene.add(gltf.scene));

  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
}

------------------------------------------------------ */

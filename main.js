import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Enable clipping so we can slice the planet and see inside
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020309);

 // Group to hold the planet so we can flip it as a whole
const planetGroup = new THREE.Group();
scene.add(planetGroup);

// Explosion state
const explosionGroup = new THREE.Group();
const cloudGroup = new THREE.Group();
scene.add(explosionGroup);
scene.add(cloudGroup);
let planetExploded = false;

// State for transforming the planet into a sun
let planetIsSun = false;
let planetSunLight = null;

// Camera
const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 2.5, 7);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.5;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.9;
controls.minPolarAngle = 0.05;

// Lights
const ambient = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambient);

const sunLights = [];
const sunGroup = new THREE.Group();
scene.add(sunGroup);

 // Inside view / city state
let insideView = false;
const cityGroup = new THREE.Group();
const cityBuildings = [];
scene.add(cityGroup);
cityGroup.visible = false;

const savedCameraState = {
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
};

// Ship state
let ship = null;
let shipFlying = false;
let shipStart = new THREE.Vector3();
let shipTarget = new THREE.Vector3(0, 0, 6);
let shipProgress = 0;

// Background stars
function createStars() {
  const geo = new THREE.BufferGeometry();
  const count = 800;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 60 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.3,
    sizeAttenuation: true,
    color: 0xffffff,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
}
createStars();

 // Planet material using satellite texture
const textureLoader = new THREE.TextureLoader();
const earthTexture = textureLoader.load("./IMG_4212.jpeg");
earthTexture.colorSpace = THREE.SRGBColorSpace;

const sunTexture = textureLoader.load("./IMG_4215.jpeg");
sunTexture.colorSpace = THREE.SRGBColorSpace;

const planetMaterial = new THREE.MeshStandardMaterial({
  map: earthTexture,
  roughness: 1.0,
  metalness: 0.0,
});

const planetGeo = new THREE.SphereGeometry(2, 128, 128);
const planet = new THREE.Mesh(planetGeo, planetMaterial);
scene.add(planet);

 // Transparent atmosphere shell
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(2.1, 64, 64),
  new THREE.MeshBasicMaterial({
    color: 0x66aaff,
    transparent: true,
    opacity: 0.12,
  })
);
scene.add(atmosphere);

// Simple interior city so you can see the damage from the outside tools
function createInteriorCity() {
  // Ground disk inside the planet
  const groundGeo = new THREE.CircleGeometry(1.6, 48);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1b1b20,
    roughness: 0.9,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.8;
  cityGroup.add(ground);

  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 24; i++) {
    const height = 0.4 + Math.random() * 1.1;
    const radius = 0.3 + Math.random() * 1.3;
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xababbd,
      metalness: 0.4,
      roughness: 0.5,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.0,
    });

    const building = new THREE.Mesh(buildingGeo, mat);
    building.scale.set(0.25 + Math.random() * 0.18, height, 0.25 + Math.random() * 0.18);
    building.position.set(x, ground.position.y + height * 0.5, z);
    building.userData.baseHeight = height;
    building.userData.baseTilt = (Math.random() - 0.5) * 0.3;
    building.userData.baseColor = new THREE.Color(0xababbd);
    cityGroup.add(building);
    cityBuildings.push(building);
  }
}

createInteriorCity();

// Raycaster for tools
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let activeTool = "laser";

// Simulation state
const BASE_YEAR = 2025;

const sim = {
  timeYears: 0,
  sunCount: 1,
  tempOffset: 0, // -1..1
  iceLevel: 0,
  waterLevel: 0.25,
  mantleExposure: 0,
  stability: 1,
  climateIndex: 0,
  destructionScore: 0,
  timeSpeed: 0, // years per second (scaled)
};

const maxSuns = 10;
const minSuns = 0;

// DOM hooks
const stabilityValue = document.getElementById("stabilityValue");
const climateValue = document.getElementById("climateValue");
const destructionValue = document.getElementById("destructionValue");
const timeValue = document.getElementById("timeValue");
const sunValue = document.getElementById("sunValue");

const timeButtons = Array.from(
  document.querySelectorAll("#time-controls button[data-speed]")
);
const skip5mButton = document.getElementById("skip5m");
const toolButtons = Array.from(
  document.querySelectorAll(".tool-button")
);
const addSunBtn = document.getElementById("addSun");
const removeSunBtn = document.getElementById("removeSun");
const spawnShipBtn = document.getElementById("spawnShip");
const insideViewBtn = document.getElementById("insideView");

// Time controls
function setTimeSpeed(mode) {
  timeButtons.forEach((b) => b.removeAttribute("data-active"));
  let speed = 0;
  if (mode === "pause") speed = 0;
  if (mode === "1y") speed = 1;
  if (mode === "1k") speed = 1000;
  if (mode === "1m") speed = 1_000_000;
  if (mode === "5m") speed = 5_000_000;
  sim.timeSpeed = speed;
  const btn = timeButtons.find((b) => b.dataset.speed === mode);
  if (btn) btn.dataset.active = "true";
}

timeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setTimeSpeed(btn.dataset.speed);
  });
});
setTimeSpeed("1y");

// Tool controls
toolButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toolButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeTool = btn.dataset.tool;
  });
});

// Sun management
function updateSuns() {
  sunGroup.clear();
  sunLights.length = 0;

  for (let i = 0; i < sim.sunCount; i++) {
    const angle = (i / Math.max(1, sim.sunCount)) * Math.PI * 2;
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 24, 24),
      new THREE.MeshStandardMaterial({
        map: sunTexture,
        emissive: new THREE.Color(0xfff2a0),
        emissiveIntensity: 1.5,
        roughness: 0.4,
        metalness: 0.0,
      })
    );
    sunMesh.position.set(Math.cos(angle) * 6, 2, Math.sin(angle) * 6);

    const light = new THREE.PointLight(0xfff7d0, 1.0 / Math.max(1, sim.sunCount) * 2.0, 40);
    light.position.copy(sunMesh.position);

    sunGroup.add(sunMesh);
    sunGroup.add(light);
    sunLights.push(light);
  }

  // No suns: dark, cold
  ambient.intensity = sim.sunCount === 0 ? 0.05 : 0.2;
}

addSunBtn.addEventListener("click", () => {
  sim.sunCount = Math.min(maxSuns, sim.sunCount + 1);
  updateSuns();
});

removeSunBtn.addEventListener("click", () => {
  sim.sunCount = Math.max(minSuns, sim.sunCount - 1);
  updateSuns();
});

// Spawn and fly a big ship toward Earth
function createShip() {
  const shipGroup = new THREE.Group();

  const bodyGeo = new THREE.BoxGeometry(1.8, 0.6, 0.6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    metalness: 0.8,
    roughness: 0.3,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  shipGroup.add(body);

  const noseGeo = new THREE.ConeGeometry(0.35, 0.9, 16);
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    metalness: 0.9,
    roughness: 0.25,
  });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.rotation.z = Math.PI / 2;
  nose.position.x = 1.3;
  shipGroup.add(nose);

  const wingGeo = new THREE.BoxGeometry(0.1, 0.7, 1.6);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x333744,
    metalness: 0.5,
    roughness: 0.5,
  });
  const wingLeft = new THREE.Mesh(wingGeo, wingMat);
  wingLeft.position.set(-0.2, -0.35, 0);
  shipGroup.add(wingLeft);
  const wingRight = wingLeft.clone();
  wingRight.position.y = 0.35;
  shipGroup.add(wingRight);

  const engineGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.6, 12);
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    metalness: 0.8,
    roughness: 0.4,
    emissive: new THREE.Color(0x3366ff),
    emissiveIntensity: 0.7,
  });
  const engine1 = new THREE.Mesh(engineGeo, engineMat);
  engine1.rotation.z = Math.PI / 2;
  engine1.position.set(-1.1, -0.18, -0.25);
  shipGroup.add(engine1);
  const engine2 = engine1.clone();
  engine2.position.set(-1.1, 0.18, -0.25);
  shipGroup.add(engine2);

  return shipGroup;
}

spawnShipBtn.addEventListener("click", () => {
  if (shipFlying) return;

  if (!ship) {
    ship = createShip();
    scene.add(ship);
  }

  shipStart.set(0, 0, 40);
  ship.position.copy(shipStart);
  ship.lookAt(planet.position);
  shipTarget.set(0, 0, 6);

  shipProgress = 0;
  shipFlying = true;
});

// Toggle inside view to see the interior city
function setInsideView(enabled) {
  if (enabled === insideView) return;
  insideView = enabled;

  if (insideView) {
    // Save current camera + target
    savedCameraState.position.copy(camera.position);
    savedCameraState.target.copy(controls.target);

    // Hide outer layers, show city
    planet.visible = false;
    atmosphere.visible = false;
    tunnelsGroup.visible = false;
    cityGroup.visible = true;

    // Move camera just inside the planet looking at the city
    camera.position.set(0, 0.8, 4);
    controls.target.set(0, -0.6, 0);
  } else {
    // Restore outer view
    planet.visible = true;
    atmosphere.visible = !planetIsSun;
    tunnelsGroup.visible = true;
    cityGroup.visible = false;

    camera.position.copy(savedCameraState.position);
    controls.target.copy(savedCameraState.target);
  }
  controls.update();
}

insideViewBtn.addEventListener("click", () => {
  setInsideView(!insideView);
});

updateSuns();

 // Laser/beam visual
const effectGroup = new THREE.Group();
scene.add(effectGroup);

// Group for drilled tunnels & craters
const tunnelsGroup = new THREE.Group();
scene.add(tunnelsGroup);

let currentTunnel = null;

function spawnBeamEffect(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
  });
  const line = new THREE.Line(geo, mat);
  effectGroup.add(line);

  const impact = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
    })
  );
  impact.position.copy(to);
  effectGroup.add(impact);

  const start = performance.now();
  const duration = 220;
  const fade = () => {
    const t = (performance.now() - start) / duration;
    if (t >= 1) {
      effectGroup.remove(line);
      effectGroup.remove(impact);
      line.geometry.dispose();
      line.material.dispose();
      impact.geometry.dispose();
      impact.material.dispose();
      return;
    }
    const f = 1 - t;
    mat.opacity = f;
    impact.material.opacity = f;
    impact.scale.setScalar(1 + t * 1.5);
    requestAnimationFrame(fade);
  };
  fade();
}

// Giant laser & tunnel

let oreMaterial = null;

function getOreMaterial() {
  if (oreMaterial) return oreMaterial;

  const uniforms = {
    uTime: { value: 0 },
  };

  oreMaterial = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    transparent: false,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormal;
      void main() {
        vPos = position;
        vNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vPos;
      varying vec3 vNormal;
      uniform float uTime;

      float hash(vec3 p){
        p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 p){
        vec3 i = floor(p);
        vec3 f = fract(p);
        float n = dot(i, vec3(1.0,57.0,113.0));
        float res = mix(
          mix(
            mix(hash(i + vec3(0.0)), hash(i + vec3(1.0,0.0,0.0)), f.x),
            mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x),
            f.y
          ),
          mix(
            mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x),
            mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x),
            f.y
          ),
          f.z
        );
        return res;
      }

      void main() {
        vec3 n = normalize(vNormal);
        // radial distance along tunnel wall
        float stripe = fract((vPos.y * 0.35) + 10.0);
        float rockNoise = noise(vPos * 2.5);
        vec3 rockColor = vec3(0.12, 0.1, 0.08) + rockNoise * 0.15;

        // metallic ores
        float oreMask = smoothstep(0.82, 0.95, noise(vPos * 4.0 + 10.0));
        vec3 oreColor = mix(vec3(0.35, 0.28, 0.16), vec3(0.95, 0.75, 0.25), rockNoise);

        // diamonds as bright crystalline clusters
        float diamondNoise = noise(vPos * 6.0 + vec3(uTime * 1.2, 3.1, -1.7));
        float diamondMask = smoothstep(0.89, 0.96, diamondNoise) * (0.3 + stripe * 0.7);
        vec3 diamondColor = vec3(0.75, 0.95, 1.4);

        vec3 color = rockColor;
        color = mix(color, oreColor, oreMask * 0.9);
        color = mix(color, diamondColor, diamondMask);

        // soft inner glow
        float glow = smoothstep(0.2, 1.0, diamondMask + oreMask * 0.6);
        color += glow * 0.18;

        float light = dot(n, normalize(vec3(0.3, 0.7, 0.4))) * 0.5 + 0.5;
        color *= light * 1.3;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  return oreMaterial;
}

function createTunnelThroughPlanet(axis) {
  if (currentTunnel) {
    tunnelsGroup.remove(currentTunnel);
    currentTunnel.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose?.();
      }
    });
    currentTunnel = null;
  }

  const g = new THREE.Group();
  const planetRadius = 2;
  const holeRadius = 0.55;
  const length = planetRadius * 2.4;

  // Hollow cylinder representing the drilled shaft
  const tunnelGeo = new THREE.CylinderGeometry(
    holeRadius,
    holeRadius,
    length,
    64,
    1,
    true
  );
  const tunnel = new THREE.Mesh(tunnelGeo, getOreMaterial());
  const up = new THREE.Vector3(0, 1, 0);
  const dir = axis.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  tunnel.quaternion.copy(quat);
  tunnel.position.set(0, 0, 0);
  g.add(tunnel);

  // Craters at both ends
  const craterRadius = holeRadius * 1.35;
  const craterGeo = new THREE.CircleGeometry(craterRadius, 48);

  const craterMat = new THREE.MeshStandardMaterial({
    color: 0x2b1610,
    roughness: 0.95,
    metalness: 0.05,
    emissive: new THREE.Color(0x3b0f0a),
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
  });

  const normalAxis = dir.clone().normalize();
  const forwardPos = normalAxis.clone().multiplyScalar(planetRadius + 0.001);
  const backwardPos = normalAxis.clone().multiplyScalar(-planetRadius - 0.001);

  const crater1 = new THREE.Mesh(craterGeo, craterMat);
  const crater2 = new THREE.Mesh(craterGeo, craterMat);

  const zUp = new THREE.Vector3(0, 0, 1);
  const craterQuat = new THREE.Quaternion().setFromUnitVectors(zUp, normalAxis);

  crater1.quaternion.copy(craterQuat);
  crater2.quaternion.copy(craterQuat);
  crater1.position.copy(forwardPos);
  crater2.position.copy(backwardPos);

  g.add(crater1);
  g.add(crater2);

  tunnelsGroup.add(g);
  currentTunnel = g;
}

function transformPlanetToSun() {
  if (planetIsSun || planetExploded) return;
  planetIsSun = true;

  // swap material to a bright, emissive sun-like surface
  const sunMat = new THREE.MeshStandardMaterial({
    map: sunTexture,
    emissive: new THREE.Color(0xffe9a3),
    emissiveIntensity: 3.0,
    roughness: 0.4,
    metalness: 0.0,
  });
  planet.material.dispose();
  planet.material = sunMat;

  // remove atmosphere so the glow is clear
  atmosphere.visible = false;

  // add a strong point light at the planet center
  planetSunLight = new THREE.PointLight(0xfff3c0, 3.5, 60);
  planetSunLight.position.set(0, 0, 0);
  scene.add(planetSunLight);

  // push simulation toward extreme heat & destruction
  sim.tempOffset = 1.5;
  sim.mantleExposure = 1;
  sim.stability = 0;
  sim.climateIndex += 10;
  sim.destructionScore += 50;
}

// Blow the entire planet apart into chunks and clouds
function explodePlanet() {
  if (planetExploded) return;
  planetExploded = true;

  // Hide the intact planet / atmosphere / tunnels / city
  planet.visible = false;
  atmosphere.visible = false;
  tunnelsGroup.visible = false;
  cityGroup.visible = false;

  // Remove any sun light at the center
  if (planetSunLight) {
    scene.remove(planetSunLight);
    planetSunLight.dispose?.();
    planetSunLight = null;
  }

  // Create rocky fragments flying out
  explosionGroup.clear();
  const fragments = 80;
  for (let i = 0; i < fragments; i++) {
    const size = 0.12 + Math.random() * 0.28;
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x44352a,
      metalness: 0.2,
      roughness: 0.8,
      emissive: 0x772200,
      emissiveIntensity: 0.4 + Math.random() * 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);

    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();

    const radius = 2.0 + Math.random() * 0.4;
    mesh.position.copy(dir).multiplyScalar(radius);
    mesh.userData.velocity = dir
      .clone()
      .multiplyScalar(4 + Math.random() * 4); // fly out fast
    mesh.userData.rotationSpeed = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 4
    );
    explosionGroup.add(mesh);
  }

  // Big cloud plume blasting off the explosion
  cloudGroup.clear();
  const cloudGeo = new THREE.BufferGeometry();
  const cloudCount = 300;
  const positions = new Float32Array(cloudCount * 3);
  const velocities = [];
  for (let i = 0; i < cloudCount; i++) {
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();
    const r = 1.2 + Math.random() * 0.8;
    const idx = i * 3;
    positions[idx] = dir.x * r;
    positions[idx + 1] = dir.y * r;
    positions[idx + 2] = dir.z * r;
    velocities.push(
      dir.multiplyScalar(3 + Math.random() * 3) // clouds fly off Earth
    );
  }
  cloudGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const cloudMat = new THREE.PointsMaterial({
    color: 0xfff0dd,
    size: 0.35,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const clouds = new THREE.Points(cloudGeo, cloudMat);
  clouds.userData.velocities = velocities;
  clouds.userData.life = 0;
  cloudGroup.add(clouds);

  // Max out simulation destruction
  sim.tempOffset = 2;
  sim.mantleExposure = 1;
  sim.stability = 0;
  sim.climateIndex += 50;
  sim.destructionScore += 200;
}

function fireStarLaser(from, hitPoint) {
  // huge golden beam aimed at the planet
  const dir = hitPoint.clone().sub(from).normalize();
  const beamLength = 24;
  const beamRadius = 3.0;

  const beamGeo = new THREE.CylinderGeometry(
    beamRadius,
    beamRadius,
    beamLength,
    64,
    1,
    true
  );
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd56a,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  beam.quaternion.copy(quat);
  beam.position.copy(from.clone().add(dir.clone().multiplyScalar(beamLength * 0.5)));
  effectGroup.add(beam);

  const start = performance.now();
  const duration = 550;
  const animateBeam = () => {
    const t = (performance.now() - start) / duration;
    if (t >= 1) {
      effectGroup.remove(beam);
      beam.geometry.dispose();
      beam.material.dispose();
      return;
    }
    const f = 1 - t;
    beam.material.opacity = 0.85 * f;
    const scale = 1 + t * 0.4;
    beam.scale.set(scale, 1, scale);
    requestAnimationFrame(animateBeam);
  };
  animateBeam();

  // blow the entire planet apart into chunks and clouds
  explodePlanet();
}

function fireGiantLaser(from, hitPoint) {
  const dir = hitPoint.clone().sub(from).normalize();

  // Visual giant beam
  const beamLength = 18;
  const beamRadius = 1.7;
  const beamGeo = new THREE.CylinderGeometry(
    beamRadius,
    beamRadius,
    beamLength,
    48,
    1,
    true
  );
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xff4020,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  beam.quaternion.copy(quat);
  beam.position.copy(from.clone().add(dir.clone().multiplyScalar(beamLength * 0.5)));
  effectGroup.add(beam);

  const start = performance.now();
  const duration = 500;
  const animateBeam = () => {
    const t = (performance.now() - start) / duration;
    if (t >= 1) {
      effectGroup.remove(beam);
      beam.geometry.dispose();
      beam.material.dispose();
      return;
    }
    const f = 1 - t;
    beam.material.opacity = 0.6 * f;
    beam.scale.set(1 + t * 0.25, 1, 1 + t * 0.25);
    requestAnimationFrame(animateBeam);
  };
  animateBeam();

  // Drill straight through the planet along the laser direction
  const tunnelAxis = hitPoint.clone().normalize();
  createTunnelThroughPlanet(tunnelAxis);

  // Massive simulation impact
  sim.mantleExposure = Math.min(1, sim.mantleExposure + 0.35);
  sim.stability = Math.max(0, sim.stability - 0.35);
  sim.destructionScore += 8.0;
  sim.climateIndex += 1.5;
}

// Pointer events
function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  pointer.x = x * 2 - 1;
  pointer.y = -(y * 2 - 1);

  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(planet, false)[0];
  if (!hit) return;

  const hitPoint = hit.point.clone();
  const from = camera.position.clone();
  let color = 0xff0000;

  if (activeTool === "laser") {
    color = 0xff3030;
    sim.mantleExposure = Math.min(1, sim.mantleExposure + 0.05);
    sim.stability = Math.max(0, sim.stability - 0.02);
    sim.destructionScore += 0.3;
  } else if (activeTool === "megaLaser") {
    color = 0xff4020;
    fireGiantLaser(from, hitPoint);
  } else if (activeTool === "starLaser") {
    color = 0xffd56a;
    fireStarLaser(from, hitPoint);
  } else if (activeTool === "heat") {
    color = 0xffe066;
    sim.tempOffset = Math.min(1, sim.tempOffset + 0.03);
    sim.climateIndex += 0.1;
    sim.destructionScore += 0.1;
  } else if (activeTool === "freeze") {
    color = 0x66ccff;
    sim.tempOffset = Math.max(-1, sim.tempOffset - 0.03);
    sim.iceLevel = Math.min(1, sim.iceLevel + 0.03);
    sim.climateIndex += 0.08;
    sim.destructionScore += 0.1;
  } else if (activeTool === "gravity") {
    color = 0xcc66ff;
    sim.stability = Math.max(0, sim.stability - 0.05);
    sim.destructionScore += 0.4;
  }

  if (activeTool !== "megaLaser" && activeTool !== "starLaser") {
    spawnBeamEffect(from, hitPoint, color);
  }
}

canvas.addEventListener("pointerdown", onPointerDown);

// Time skip consequences
function applyLongTermConsequences(years) {
  const yearsMillions = years / 1_000_000;

  // Heat from suns
  const sunHeat = (sim.sunCount - 1) * 0.1 * yearsMillions;
  sim.tempOffset = THREE.MathUtils.clamp(
    sim.tempOffset + sunHeat,
    -1,
    1.5
  );

  // Without suns: freeze
  if (sim.sunCount === 0) {
    sim.tempOffset = THREE.MathUtils.clamp(
      sim.tempOffset - 0.4 * yearsMillions,
      -2,
      0
    );
    sim.iceLevel = THREE.MathUtils.clamp(
      sim.iceLevel + 0.2 * yearsMillions,
      0,
      1
    );
  }

  // Stability erosion over time
  sim.stability = THREE.MathUtils.clamp(
    sim.stability - 0.03 * yearsMillions,
    0,
    1
  );

  // Climate & destruction
  const climateDelta =
    Math.abs(sim.tempOffset) * 0.2 * yearsMillions +
    sim.mantleExposure * 0.15 * yearsMillions;
  sim.climateIndex += climateDelta;
  sim.destructionScore += climateDelta * 0.7;

  // Extreme cases
  if (sim.sunCount >= 5) {
    sim.destructionScore += 2 * yearsMillions;
    sim.stability = Math.max(0, sim.stability - 0.1 * yearsMillions);
  }
  if (sim.sunCount >= 8) {
    sim.destructionScore += 5 * yearsMillions;
  }
  if (sim.sunCount === 0 && sim.tempOffset < -0.6) {
    sim.destructionScore += 1.5 * yearsMillions;
  }
}

skip5mButton.addEventListener("click", () => {
  const years = 5_000_000;
  sim.timeYears += years;

  // Trigger full melt/explosion if we jump to or past 5M years with at least one sun
  if (sim.timeYears >= 5_000_000 && sim.sunCount > 0 && !planetExploded) {
    explodePlanet();
  }

  applyLongTermConsequences(years);
});

// Simulation step
function updateCityVisuals() {
  if (!cityBuildings.length) return;

  // Map overall destruction to 0..1.5 for stronger effects
  const damageFactor = THREE.MathUtils.clamp(sim.destructionScore / 20, 0, 1.5);
  const heatFactor = THREE.MathUtils.clamp(sim.tempOffset, -0.5, 1.5);

  const healthyColor = new THREE.Color(0xababbd);
  const damagedColor = new THREE.Color(0x4d4f57);
  const burningColor = new THREE.Color(0xff5a2f);

  cityBuildings.forEach((b, idx) => {
    const baseH = b.userData.baseHeight || 1;
    const baseTilt = b.userData.baseTilt || 0;
    const baseColor = b.userData.baseColor || healthyColor;

    // Collapse / shrink with destruction
    const collapse = THREE.MathUtils.clamp(damageFactor * 0.8, 0, 0.8);
    const heightScale = THREE.MathUtils.lerp(1, 0.2, collapse);
    b.scale.y = baseH * heightScale;

    // Tilt and wobble
    const extraTilt = damageFactor * 0.6;
    const wobble = Math.sin(performance.now() * 0.001 + idx) * 0.1 * damageFactor;
    b.rotation.z = baseTilt + extraTilt + wobble;

    // Color progression: normal -> dark/ruined -> glowing hot
    const ruinMix = THREE.MathUtils.clamp(damageFactor, 0, 1);
    const heatMix = THREE.MathUtils.clamp((damageFactor + heatFactor) * 0.5, 0, 1);

    const stage1 = baseColor.clone().lerp(damagedColor, ruinMix);
    const finalColor = stage1.clone().lerp(burningColor, heatMix);

    b.material.color.copy(finalColor);
    b.material.emissive.copy(burningColor);
    b.material.emissiveIntensity = heatMix * 1.2;
  });
}

/// Simulation step
function updateSimulation(dt) {
  if (sim.timeSpeed > 0) {
    const years = sim.timeSpeed * dt;
    sim.timeYears += years;

    // Trigger full melt/explosion if we reach 5M years in the future with at least one sun
    if (sim.timeYears >= 5_000_000 && sim.sunCount > 0 && !planetExploded) {
      explodePlanet();
    }

    // Integrate slowly each frame rather than one big jump
    applyLongTermConsequences(years * 0.000001);
  }

  // Auto water shift with temp
  const targetWater =
    sim.tempOffset > 0
      ? THREE.MathUtils.clamp(0.25 - sim.tempOffset * 0.15, 0.05, 0.25)
      : THREE.MathUtils.clamp(0.25 - sim.tempOffset * 0.05, 0.15, 0.35);
  sim.waterLevel = THREE.MathUtils.damp(
    sim.waterLevel,
    targetWater,
    1.8,
    dt
  );

  // Ice relax
  const targetIce =
    sim.tempOffset < -0.2
      ? THREE.MathUtils.clamp(-sim.tempOffset, 0, 1)
      : 0;
  sim.iceLevel = THREE.MathUtils.damp(sim.iceLevel, targetIce, 1.5, dt);

  // Lava exposure relax
  const targetMantle =
    sim.mantleExposure * 0.92 * (1 - sim.stability) + sim.mantleExposure * 0.08;
  sim.mantleExposure = THREE.MathUtils.damp(
    sim.mantleExposure,
    targetMantle,
    1.5,
    dt
  );

  // Climate index slow decay
  sim.climateIndex = Math.max(
    0,
    sim.climateIndex - dt * 0.01
  );

  // Update interior city visuals based on destruction and heat
  updateCityVisuals();

  // Material uniforms
  if (oreMaterial && oreMaterial.uniforms && oreMaterial.uniforms.uTime) {
    oreMaterial.uniforms.uTime.value += dt;
  }

  // Atmosphere opacity based on stability & suns
  if (!planetExploded) {
    const baseOpacity =
      sim.sunCount === 0 ? 0.05 : 0.12 + (sim.sunCount - 1) * 0.01;
    const leak = (1 - sim.stability) * 0.09;
    atmosphere.material.opacity = THREE.MathUtils.clamp(
      baseOpacity - leak,
      0.02,
      0.25
    );
  }

  // Camera shake when unstable or too many suns
  const instability = 1 - sim.stability;
  const chaos = Math.max(0, sim.sunCount - 4) / 6;
  const shake = (instability * 0.015 + chaos * 0.02);
  if (shake > 0) {
    const t = performance.now() * 0.005;
    camera.position.x += (Math.sin(t) * shake);
    camera.position.y += (Math.cos(t * 1.3) * shake);
  }

  // Update HUD
  stabilityValue.textContent = `${Math.round(sim.stability * 100)}%`;
  climateValue.textContent = sim.climateIndex.toFixed(1);
  destructionValue.textContent = sim.destructionScore.toFixed(1);
  sunValue.textContent = `${sim.sunCount}`;

  const currentYear = BASE_YEAR + sim.timeYears;
  const yearInt = Math.round(currentYear);
  timeValue.textContent = `Year ${yearInt.toLocaleString("en-US")}`;
}

// Resize
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", onResize);

function updateExplosion(dt) {
  if (!planetExploded) return;

  // Update rock fragments
  explosionGroup.children.forEach((frag) => {
    if (!frag.userData.velocity) return;
    frag.position.addScaledVector(frag.userData.velocity, dt);
    frag.rotation.x += frag.userData.rotationSpeed.x * dt;
    frag.rotation.y += frag.userData.rotationSpeed.y * dt;
    frag.rotation.z += frag.userData.rotationSpeed.z * dt;
  });

  // Update cloud plume
  cloudGroup.children.forEach((clouds) => {
    if (!clouds.isPoints) return;
    const positions = clouds.geometry.attributes.position;
    const velocities = clouds.userData.velocities || [];
    for (let i = 0; i < velocities.length; i++) {
      const v = velocities[i];
      const idx = i * 3;
      positions.array[idx] += v.x * dt;
      positions.array[idx + 1] += v.y * dt;
      positions.array[idx + 2] += v.z * dt;
    }
    positions.needsUpdate = true;

    clouds.userData.life += dt;
    const life = clouds.userData.life;
    const mat = clouds.material;
    mat.opacity = THREE.MathUtils.clamp(1.0 - life * 0.25, 0, 1);
  });
}

// Loop
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 0.033);

  // Orbit suns
  const t = now * 0.0001;
  sunGroup.children.forEach((child, idx) => {
    const orbitIndex = Math.floor(idx / 2); // mesh+light pair
    const angle =
      (orbitIndex / Math.max(1, sim.sunCount)) * Math.PI * 2 + t;
    const radius = 6;
    const y = 1.5 + Math.sin(angle * 0.7) * 1.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    child.position.set(x, y, z);
  });

  // Fly ship toward Earth and ride the camera on it
  if (ship && shipFlying && !insideView) {
    shipProgress += dt * 0.18;
    const eased = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp(shipProgress, 0, 1),
      0,
      1
    );
    ship.position.lerpVectors(shipStart, shipTarget, eased);
    ship.lookAt(planet.position);

    const camOffset = new THREE.Vector3(-3, 1.2, 0.6);
    const worldOffset = camOffset.applyQuaternion(ship.quaternion).add(ship.position);
    camera.position.copy(worldOffset);
    camera.lookAt(planet.position);

    if (shipProgress >= 1) {
      shipFlying = false;
    }
  }

  updateSimulation(dt);
  updateExplosion(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();


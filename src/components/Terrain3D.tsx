import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Plot from 'react-plotly.js';
import {
  Play,
  Pause,
  RotateCcw,
  Camera,
  Maximize2,
  Minimize2,
  Layers,
  Compass,
  Droplets,
  Sliders,
  ChevronRight,
  ChevronLeft,
  BarChart3,
  Bot,
  Mountain,
  Flame,
  Grid,
  CheckCircle2,
  Activity,
  Crosshair,
  Radio,
  Repeat,
  X,
  Route,
  Satellite
} from 'lucide-react';
import type { TelemetryRow } from '../types';

interface Terrain3DProps {
  telemetry: TelemetryRow[];
  showGPS?: boolean;
}

type CameraPreset = 'orbit' | 'top' | 'chase' | 'side';
type ColorTheme = 'moisture' | 'elevation' | 'thermal' | 'cyber';

export default function Terrain3D({ telemetry, showGPS = true }: Terrain3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // View mode: Modern 3D Simulation vs Plotly Scientific Surface
  const [viewMode, setViewMode] = useState<'three' | 'plotly'>('three');

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackIndex, setPlaybackIndex] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isLooping, setIsLooping] = useState<boolean>(true);

  // Display Settings
  const [colorTheme, setColorTheme] = useState<ColorTheme>('elevation');
  const [heightExaggeration, setHeightExaggeration] = useState<number>(1.5);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('orbit');
  const [showWaterMarkers, setShowWaterMarkers] = useState<boolean>(true);
  const [showPathLine, setShowPathLine] = useState<boolean>(true);
  const [showWaypoints, setShowWaypoints] = useState<boolean>(true);
  const [showRover, setShowRover] = useState<boolean>(true);
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [showGPSTrail, setShowGPSTrail] = useState<boolean>(showGPS);
  const [showPlotlyPath, setShowPlotlyPath] = useState<boolean>(true);
  const [showControlsMenu, setShowControlsMenu] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Selected waypoint inspection
  const [selectedPoint, setSelectedPoint] = useState<TelemetryRow | null>(null);

  // Smooth, faithful height & moisture interpolation directly from telemetry
  const getTerrainProfileAt = useCallback(
    (xCm: number, yCm: number) => {
      if (!telemetry || telemetry.length === 0) {
        return { elev: 2.5, moisture: 450 };
      }

      let weightSum = 0;
      let elevSum = 0;
      let moistureSum = 0;

      for (let i = 0; i < telemetry.length; i++) {
        const pt = telemetry[i];
        const dx = xCm - pt.synX;
        const dy = yCm - pt.synY;
        const distSq = dx * dx + dy * dy;

        if (distSq < 1) {
          const elevVal = pt.elev !== undefined ? pt.elev : 2.5;
          return {
            elev: elevVal,
            moisture: pt.moisture
          };
        }

        const w = 1 / (distSq + 100);
        weightSum += w;
        elevSum += w * (pt.elev !== undefined ? pt.elev : 2.5);
        moistureSum += w * pt.moisture;
      }

      return {
        elev: weightSum > 0 ? elevSum / weightSum : 2.5,
        moisture: weightSum > 0 ? moistureSum / weightSum : 450
      };
    },
    [telemetry]
  );

  // Unified Coordinate Normalizer: Ensures Terrain, Path, and Rover are on the exact same ground level
  const coords = useMemo(() => {
    if (!telemetry || telemetry.length === 0) return null;
    const xs = telemetry.map((t) => t.synX);
    const ys = telemetry.map((t) => t.synY);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const padX = Math.max(40, (maxX - minX) * 0.1);
    const padY = Math.max(40, (maxY - minY) * 0.1);
    const fieldW = Math.max(60, maxX - minX + padX * 2);
    const fieldH = Math.max(60, maxY - minY + padY * 2);
    const scaleFactor = 100 / Math.max(fieldW, fieldH);

    const validElevs = telemetry
      .map((t) => t.elev)
      .filter((e): e is number => typeof e === 'number' && !isNaN(e));
    const minElev = validElevs.length > 0 ? Math.min(...validElevs) : 0;
    const maxElev = validElevs.length > 0 ? Math.max(...validElevs) : 1;
    const elevSpan = Math.max(0.1, maxElev - minElev);

    const moistures = telemetry.map((t) => t.moisture);
    const minM = Math.min(...moistures);
    const maxM = Math.max(...moistures);
    const moistureSpan = Math.max(1, maxM - minM);

    const toSceneX = (xCm: number) => (xCm - (minX + maxX) / 2) * scaleFactor;
    const toSceneZ = (yCm: number) => (yCm - (minY + maxY) / 2) * scaleFactor;
    const toSceneY = (elevM: number) => (elevM - minElev) * 6 * heightExaggeration;

    return {
      minX,
      maxX,
      minY,
      maxY,
      fieldW,
      fieldH,
      scaleFactor,
      minElev,
      maxElev,
      elevSpan,
      minM,
      maxM,
      moistureSpan,
      toSceneX,
      toSceneZ,
      toSceneY
    };
  }, [telemetry, heightExaggeration]);

  // Three.js mutable scene refs
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    roverGroup: THREE.Group;
    roverWheels: THREE.Mesh[];
    beaconLight: THREE.PointLight;
    waterMarkersGroup: THREE.Group;
    pathLine: THREE.Line;
    waypointsGroup: THREE.Group;
    gpsTrailGroup: THREE.Group;
    terrainMesh: THREE.Mesh;
    terrainGeom: THREE.PlaneGeometry;
    gridHelper: THREE.GridHelper;
    interpolatedGrid: {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      width: number;
      height: number;
      elevationGrid: number[][];
      moistureGrid: number[][];
      getZ: (x: number, y: number) => number;
    };
    animFrameId: number;
  } | null>(null);

  // Active telemetry point
  const currentPoint = useMemo(() => {
    if (!telemetry || telemetry.length === 0) return null;
    const idx = Math.min(Math.max(0, Math.floor(playbackIndex)), telemetry.length - 1);
    return telemetry[idx];
  }, [telemetry, playbackIndex]);

  // Handle Play/Pause timeline ticker
  useEffect(() => {
    if (!isPlaying || !telemetry || telemetry.length <= 1) return;

    const intervalMs = 60 / playbackSpeed;
    const timer = setInterval(() => {
      setPlaybackIndex((prev) => {
        const next = prev + 0.15 * playbackSpeed;
        if (next >= telemetry.length - 1) {
          if (isLooping) return 0;
          setIsPlaying(false);
          return telemetry.length - 1;
        }
        return next;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, telemetry, playbackSpeed, isLooping]);

  // Color functions for terrain shaders
  const getThemeColor = useCallback((theme: ColorTheme, normMoisture: number, normElev: number): THREE.Color => {
    const color = new THREE.Color();
    if (theme === 'moisture') {
      // 0.0 (Dry brown/sand) -> 0.4 (Ochre) -> 0.7 (Lush Green) -> 1.0 (Hydrated Blue/Teal)
      if (normMoisture < 0.35) {
        color.setRGB(0.72, 0.48, 0.32).lerp(new THREE.Color(0.85, 0.68, 0.45), normMoisture / 0.35);
      } else if (normMoisture < 0.7) {
        const t = (normMoisture - 0.35) / 0.35;
        color.setRGB(0.85, 0.68, 0.45).lerp(new THREE.Color(0.25, 0.65, 0.28), t);
      } else {
        const t = (normMoisture - 0.7) / 0.3;
        color.setRGB(0.25, 0.65, 0.28).lerp(new THREE.Color(0.12, 0.55, 0.85), t);
      }
    } else if (theme === 'elevation') {
      // Valley (Emerald) -> Ridge (Amber/Gold) -> Peak (Snowy White)
      if (normElev < 0.5) {
        color.setRGB(0.18, 0.55, 0.34).lerp(new THREE.Color(0.85, 0.75, 0.35), normElev * 2);
      } else {
        color.setRGB(0.85, 0.75, 0.35).lerp(new THREE.Color(0.95, 0.95, 0.98), (normElev - 0.5) * 2);
      }
    } else if (theme === 'thermal') {
      // Blue -> Cyan -> Yellow -> Red
      if (normMoisture < 0.33) {
        color.setRGB(0.1, 0.2, 0.8).lerp(new THREE.Color(0.1, 0.8, 0.8), normMoisture / 0.33);
      } else if (normMoisture < 0.66) {
        color.setRGB(0.1, 0.8, 0.8).lerp(new THREE.Color(0.95, 0.9, 0.1), (normMoisture - 0.33) / 0.33);
      } else {
        color.setRGB(0.95, 0.9, 0.1).lerp(new THREE.Color(0.95, 0.15, 0.15), (normMoisture - 0.66) / 0.34);
      }
    } else {
      // Cyber Dark Grid
      color.setRGB(0.06, 0.10, 0.18).lerp(new THREE.Color(0.08, 0.22, 0.32), normMoisture);
    }
    return color;
  }, []);

  // Initialize Three.js Scene
  useEffect(() => {
    if (viewMode !== 'three' || !containerRef.current || !canvasRef.current || !telemetry || telemetry.length === 0 || !coords) {
      return;
    }

    const {
      minX,
      maxX,
      minY,
      maxY,
      fieldW,
      fieldH,
      scaleFactor,
      minElev,
      maxElev,
      elevSpan,
      minM,
      moistureSpan,
      toSceneX,
      toSceneZ,
      toSceneY
    } = coords;

    const container = viewportRef.current || containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); // Tailwind slate-900
    scene.fog = new THREE.FogExp2(0x0f172a, 0.003);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 2000);
    camera.position.set(120, 100, 140);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't flip upside down below ground
    controls.minDistance = 15;
    controls.maxDistance = 500;

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
    sunLight.position.set(150, 220, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 600;
    const shadowD = 180;
    sunLight.shadow.camera.left = -shadowD;
    sunLight.shadow.camera.right = shadowD;
    sunLight.shadow.camera.top = shadowD;
    sunLight.shadow.camera.bottom = -shadowD;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x90b0e0, 0x3a3020, 0.4);
    scene.add(hemiLight);

    // 3. Build 3D Terrain Surface Geometry
    const gridRes = 70;
    const terrainGeom = new THREE.PlaneGeometry(fieldW * scaleFactor, fieldH * scaleFactor, gridRes, gridRes);
    terrainGeom.rotateX(-Math.PI / 2);

    const posAttr = terrainGeom.attributes.position;
    const colors: number[] = [];

    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const pz = posAttr.getZ(i);

      // Back-project scene coords to real-world cm
      const realX = px / scaleFactor + (minX + maxX) / 2;
      const realY = pz / scaleFactor + (minY + maxY) / 2;

      const profile = getTerrainProfileAt(realX, realY);
      const py = toSceneY(profile.elev);
      posAttr.setY(i, py);

      const normM = (profile.moisture - minM) / moistureSpan;
      const normE = (profile.elev - minElev) / elevSpan;
      const c = getThemeColor(colorTheme, normM, normE);
      colors.push(c.r, c.g, c.b);
    }

    terrainGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrainGeom.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      wireframe: showWireframe,
      flatShading: false
    });

    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false;
    scene.add(terrainMesh);

    // Earthen Pedestal Skirt around terrain perimeter
    const skirtGeom = new THREE.BoxGeometry(fieldW * scaleFactor, 4, fieldH * scaleFactor);
    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.9
    });
    const skirtMesh = new THREE.Mesh(skirtGeom, skirtMat);
    skirtMesh.position.y = -2.1;
    skirtMesh.receiveShadow = true;
    scene.add(skirtMesh);

    // Subtle Grid on ground
    const gridHelper = new THREE.GridHelper(
      Math.max(fieldW, fieldH) * scaleFactor,
      20,
      0x38bdf8,
      0x334155
    );
    gridHelper.position.y = -0.05;
    scene.add(gridHelper);

    // 4. Mission Trajectory Path
    const pathPoints: THREE.Vector3[] = telemetry.map((pt) => {
      const sx = toSceneX(pt.synX);
      const sz = toSceneZ(pt.synY);
      const prof = getTerrainProfileAt(pt.synX, pt.synY);
      const sy = toSceneY(prof.elev) + 0.25;
      return new THREE.Vector3(sx, sy, sz);
    });

    const pathCurve = new THREE.CatmullRomCurve3(pathPoints, false, 'chordal', 0.1);
    const pathGeom = new THREE.TubeGeometry(pathCurve, pathPoints.length * 4, 0.25, 8, false);
    const pathMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.8
    });
    const pathTube = new THREE.Mesh(pathGeom, pathMat);
    pathTube.visible = showPathLine;
    scene.add(pathTube);

    // 5. Waypoints & Water Droplets
    const waypointsGroup = new THREE.Group();
    waypointsGroup.visible = showWaypoints;

    const waterMarkersGroup = new THREE.Group();
    waterMarkersGroup.visible = showWaterMarkers;

    const wpSphereGeom = new THREE.SphereGeometry(0.55, 16, 16);
    const waterDropGeom = new THREE.OctahedronGeometry(1.1, 1);
    const waterDropMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.92
    });

    telemetry.forEach((pt, idx) => {
      const pos = pathPoints[idx];

      // Moisture colored waypoint
      const normM = (pt.moisture - minM) / moistureSpan;
      const wpColor = normM < 0.4 ? 0xef4444 : normM < 0.7 ? 0x22c55e : 0x0ea5e9;

      const wpMat = new THREE.MeshStandardMaterial({
        color: wpColor,
        roughness: 0.3,
        metalness: 0.5
      });
      const wpMesh = new THREE.Mesh(wpSphereGeom, wpMat);
      wpMesh.position.copy(pos);
      wpMesh.userData = { telemetryIndex: idx, rowData: pt };
      waypointsGroup.add(wpMesh);

      // Watered Beacon Drop
      if (pt.watered === 1) {
        const dropMesh = new THREE.Mesh(waterDropGeom, waterDropMat);
        dropMesh.position.set(pos.x, pos.y + 2.0, pos.z);
        dropMesh.scale.set(0.8, 1.2, 0.8);
        waterMarkersGroup.add(dropMesh);

        // Ground Ripple Ring
        const ringGeom = new THREE.RingGeometry(0.8, 1.5, 24);
        ringGeom.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide
        });
        const ringMesh = new THREE.Mesh(ringGeom, ringMat);
        ringMesh.position.set(pos.x, pos.y + 0.05, pos.z);
        waterMarkersGroup.add(ringMesh);
      }
    });

    scene.add(waypointsGroup);
    scene.add(waterMarkersGroup);

    // 6. GPS Trail (if GPS fix available)
    const gpsTrailGroup = new THREE.Group();
    gpsTrailGroup.visible = showGPSTrail;
    const gpsPoints = telemetry.filter((t) => typeof t.gpsLat === 'number' && typeof t.gpsLng === 'number');

    if (gpsPoints.length > 1) {
      const gpsLinePoints = gpsPoints.map((pt) => {
        return new THREE.Vector3(
          toSceneX(pt.synX),
          toSceneY(pt.elev !== undefined ? pt.elev : 0) + 0.6,
          toSceneZ(pt.synY)
        );
      });
      const gpsGeom = new THREE.BufferGeometry().setFromPoints(gpsLinePoints);
      const gpsMat = new THREE.LineDashedMaterial({
        color: 0xf97316,
        dashSize: 1.5,
        gapSize: 0.8,
        linewidth: 2
      });
      const gpsLine = new THREE.Line(gpsGeom, gpsMat);
      gpsLine.computeLineDistances();
      gpsTrailGroup.add(gpsLine);
    }
    scene.add(gpsTrailGroup);

    // 7. HIGH-DETAIL 3D ROVER MODEL
    const roverGroup = new THREE.Group();
    roverGroup.visible = showRover;

    // Rover Body Chassis (Industrial Yellow)
    const bodyGeom = new THREE.BoxGeometry(3.6, 1.4, 2.6);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Amber yellow
      roughness: 0.4,
      metalness: 0.6
    });
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.position.y = 1.0;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    roverGroup.add(bodyMesh);

    // Solar Top Plate
    const solarGeom = new THREE.BoxGeometry(2.8, 0.1, 2.0);
    const solarMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      roughness: 0.2,
      metalness: 0.9
    });
    const solarMesh = new THREE.Mesh(solarGeom, solarMat);
    solarMesh.position.set(0, 1.75, 0);
    roverGroup.add(solarMesh);

    // 4 Wheels
    const roverWheels: THREE.Mesh[] = [];
    const wheelGeom = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 18);
    wheelGeom.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.9,
      metalness: 0.1
    });

    const wheelPositions = [
      [1.4, 0.7, 1.4],
      [-1.4, 0.7, 1.4],
      [1.4, 0.7, -1.4],
      [-1.4, 0.7, -1.4]
    ];

    wheelPositions.forEach(([wx, wy, wz]) => {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.position.set(wx, wy, wz);
      wheel.castShadow = true;
      roverGroup.add(wheel);
      roverWheels.push(wheel);
    });

    // Antenna & Status Beacon
    const mastGeom = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 });
    const mastMesh = new THREE.Mesh(mastGeom, mastMat);
    mastMesh.position.set(-1.0, 2.4, -0.6);
    roverGroup.add(mastMesh);

    const beaconLight = new THREE.PointLight(0x22c55e, 1.2, 12);
    beaconLight.position.set(-1.0, 3.4, -0.6);
    roverGroup.add(beaconLight);

    const beaconBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    );
    beaconBulb.position.set(-1.0, 3.4, -0.6);
    roverGroup.add(beaconBulb);

    // Dual Headlights
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const headlightL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.4), headlightMat);
    headlightL.position.set(1.85, 1.0, 0.75);
    const headlightR = headlightL.clone();
    headlightR.position.set(1.85, 1.0, -0.75);
    roverGroup.add(headlightL);
    roverGroup.add(headlightR);

    // Forward Spotlights
    const spotL = new THREE.SpotLight(0xfffaed, 2.5, 30, Math.PI / 6, 0.4);
    spotL.position.set(1.9, 1.0, 0.75);
    spotL.target.position.set(12, 0, 0.75);
    roverGroup.add(spotL);
    roverGroup.add(spotL.target);

    // Set initial position of rover on terrain surface
    const initP = telemetry[0];
    const initProf = getTerrainProfileAt(initP.synX, initP.synY);
    roverGroup.position.set(
      toSceneX(initP.synX),
      toSceneY(initProf.elev),
      toSceneZ(initP.synY)
    );
    const initHeadingRad = THREE.MathUtils.degToRad(-initP.absHead + 90);
    const initPitchRad = THREE.MathUtils.degToRad(initP.pitch || 0);
    const initRollRad = THREE.MathUtils.degToRad(initP.roll || 0);
    roverGroup.rotation.set(initPitchRad, initHeadingRad, initRollRad, 'YXZ');

    scene.add(roverGroup);

    // Center camera on field
    controls.target.set(0, toSceneY((minElev + maxElev) / 2), 0);

    // Save references
    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      roverGroup,
      roverWheels,
      beaconLight,
      waterMarkersGroup,
      pathLine: pathTube as any,
      waypointsGroup,
      gpsTrailGroup,
      terrainMesh,
      terrainGeom,
      gridHelper,
      interpolatedGrid: {
        minX,
        maxX,
        minY,
        maxY,
        width: fieldW,
        height: fieldH,
        elevationGrid: [],
        moistureGrid: [],
        getZ: (x: number, y: number) => toSceneY(getTerrainProfileAt(x, y).elev)
      },
      animFrameId: 0
    };

    // 8. Raycasting for Waypoint Click Selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleCanvasClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(waypointsGroup.children, false);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        if (hit.userData && hit.userData.rowData) {
          setSelectedPoint(hit.userData.rowData);
          setPlaybackIndex(hit.userData.telemetryIndex);
          setIsPlaying(false);
        }
      }
    };

    canvas.addEventListener('click', handleCanvasClick);

    // 9. Animation Loop
    let clock = new THREE.Clock();

    const animate = () => {
      const elapsed = clock.getElapsedTime();

      // Pulsing beacon light
      if (beaconLight) {
        beaconLight.intensity = 0.8 + Math.sin(elapsed * 6) * 0.6;
      }

      // Floating water droplet animation
      waterMarkersGroup.children.forEach((child, i) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.OctahedronGeometry) {
          child.position.y += Math.sin(elapsed * 3 + i) * 0.005;
          child.rotation.y += 0.02;
        }
      });

      controls.update();
      renderer.render(scene, camera);
      sceneRef.current!.animFrameId = requestAnimationFrame(animate);
    };

    animate();

    // Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      const { width: newW, height: newH } = entries[0].contentRect;
      if (newW > 0 && newH > 0) {
        camera.aspect = newW / newH;
        camera.updateProjectionMatrix();
        renderer.setSize(newW, newH);
      }
    });
    resizeObserver.observe(container);

    return () => {
      canvas.removeEventListener('click', handleCanvasClick);
      resizeObserver.disconnect();
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animFrameId);
        controls.dispose();
        renderer.dispose();
      }
    };
  }, [viewMode, telemetry, getThemeColor, coords, colorTheme, getTerrainProfileAt]);

  // Dynamically update Three.js terrain mesh vertices & colors when sliders change
  useEffect(() => {
    if (!sceneRef.current || viewMode !== 'three' || !coords) return;
    const { terrainGeom } = sceneRef.current;
    if (!terrainGeom) return;

    const {
      minX,
      maxX,
      minY,
      maxY,
      scaleFactor,
      minElev,
      elevSpan,
      minM,
      moistureSpan,
      toSceneY
    } = coords;

    const posAttr = terrainGeom.attributes.position;
    const colorAttr = terrainGeom.attributes.color;
    const newColors: number[] = [];

    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const pz = posAttr.getZ(i);
      const realX = px / scaleFactor + (minX + maxX) / 2;
      const realY = pz / scaleFactor + (minY + maxY) / 2;

      const profile = getTerrainProfileAt(realX, realY);
      const py = toSceneY(profile.elev);
      posAttr.setY(i, py);

      const normM = (profile.moisture - minM) / moistureSpan;
      const normE = (profile.elev - minElev) / elevSpan;
      const c = getThemeColor(colorTheme, normM, normE);
      newColors.push(c.r, c.g, c.b);
    }

    posAttr.needsUpdate = true;
    if (colorAttr) {
      (colorAttr as any).copyArray(new Float32Array(newColors));
      colorAttr.needsUpdate = true;
    }
    terrainGeom.computeVertexNormals();
  }, [coords, colorTheme, viewMode, getTerrainProfileAt, getThemeColor]);

  // Update Rover Position & Rotation when playbackIndex changes
  useEffect(() => {
    if (!sceneRef.current || !telemetry || telemetry.length === 0 || !coords) return;

    const { roverGroup, roverWheels, controls, camera } = sceneRef.current;
    const { toSceneX, toSceneZ, toSceneY } = coords;

    const currIdx = Math.floor(playbackIndex);
    const nextIdx = Math.min(currIdx + 1, telemetry.length - 1);
    const alpha = playbackIndex - currIdx;

    const p0 = telemetry[currIdx];
    const p1 = telemetry[nextIdx];

    const realCurX = p0.synX * (1 - alpha) + p1.synX * alpha;
    const realCurY = p0.synY * (1 - alpha) + p1.synY * alpha;
    const curX = toSceneX(realCurX);
    const curZ = toSceneZ(realCurY);
    const profAtRover = getTerrainProfileAt(realCurX, realCurY);
    const curY = toSceneY(profAtRover.elev);

    roverGroup.position.set(curX, curY, curZ);

    // Orientation: combine heading (yaw) + pitch + roll from telemetry
    const headingRad = THREE.MathUtils.degToRad(-p0.absHead + 90); // Align 0 deg heading with forward
    const pitchRad = THREE.MathUtils.degToRad(p0.pitch || 0);
    const rollRad = THREE.MathUtils.degToRad(p0.roll || 0);

    roverGroup.rotation.set(pitchRad, headingRad, rollRad, 'YXZ');

    // Spin wheels along wheel axle
    roverWheels.forEach((w) => {
      w.rotation.z += 0.2 * playbackSpeed;
    });

    // Chase Cam Mode: smoothly follow behind the rover
    if (cameraPreset === 'chase') {
      const offset = new THREE.Vector3(-18, 12, 0).applyEuler(new THREE.Euler(0, headingRad, 0));
      camera.position.lerp(new THREE.Vector3(curX + offset.x, curY + offset.y, curZ + offset.z), 0.1);
      controls.target.lerp(new THREE.Vector3(curX, curY + 2, curZ), 0.1);
    }
  }, [playbackIndex, telemetry, coords, cameraPreset, playbackSpeed, getTerrainProfileAt]);

  // Handle Camera Presets
  const setPresetView = (preset: CameraPreset) => {
    setCameraPreset(preset);
    if (!sceneRef.current) return;
    const { camera, controls } = sceneRef.current;

    if (preset === 'top') {
      camera.position.set(0, 160, 0.1);
      controls.target.set(0, 0, 0);
    } else if (preset === 'orbit') {
      camera.position.set(110, 85, 125);
      controls.target.set(0, 5, 0);
    } else if (preset === 'side') {
      camera.position.set(150, 15, 0);
      controls.target.set(0, 0, 0);
    }
    controls.update();
  };

  // Toggle Visibility of Layers
  useEffect(() => {
    if (!sceneRef.current) return;
    const { waterMarkersGroup, waypointsGroup, gpsTrailGroup, roverGroup, pathLine, terrainMesh } = sceneRef.current;
    if (waterMarkersGroup) waterMarkersGroup.visible = showWaterMarkers;
    if (waypointsGroup) waypointsGroup.visible = showWaypoints;
    if (gpsTrailGroup) gpsTrailGroup.visible = showGPSTrail;
    if (roverGroup) roverGroup.visible = showRover;
    if (pathLine) (pathLine as any).visible = showPathLine;
    if (terrainMesh) (terrainMesh.material as THREE.MeshStandardMaterial).wireframe = showWireframe;
  }, [showWaterMarkers, showWaypoints, showGPSTrail, showRover, showPathLine, showWireframe]);

  // Take Snapshot Screenshot
  const takeSnapshot = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `rover-mission-3d-${Date.now()}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  // -------------------------------------------------------------
  // PLOTLY SCIENTIFIC 3D SURFACE & TRAJECTORY DATA
  // -------------------------------------------------------------
  const plotlyData = useMemo(() => {
    if (viewMode !== 'plotly' || !telemetry || telemetry.length === 0) return [];

    const xs = telemetry.map((t) => t.synX);
    const ys = telemetry.map((t) => t.synY);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Build dense 48x48 continuous sampling grid
    const gridRes = 48;
    const gridX: number[] = [];
    const gridY: number[] = [];

    for (let i = 0; i < gridRes; i++) {
      gridX.push(minX + (i / (gridRes - 1)) * (maxX - minX));
      gridY.push(minY + (i / (gridRes - 1)) * (maxY - minY));
    }

    const zGrid: number[][] = [];
    const mGrid: number[][] = [];

    for (let j = 0; j < gridRes; j++) {
      const zRow: number[] = [];
      const mRow: number[] = [];
      const curY = gridY[j];
      for (let i = 0; i < gridRes; i++) {
        const curX = gridX[i];
        const pt = getTerrainProfileAt(curX, curY);
        zRow.push(Number(pt.elev.toFixed(2)));
        mRow.push(Math.round(pt.moisture));
      }
      zGrid.push(zRow);
      mGrid.push(mRow);
    }

    const plotlyColorScale =
      colorTheme === 'moisture'
        ? 'YlGnBu'
        : colorTheme === 'elevation'
        ? 'Earth'
        : colorTheme === 'thermal'
        ? 'Hot'
        : 'Viridis';

    const traces: any[] = [
      {
        type: 'surface',
        name: 'Terrain Topography',
        x: gridX,
        y: gridY,
        z: zGrid,
        surfacecolor: colorTheme === 'moisture' ? mGrid : zGrid,
        colorscale: plotlyColorScale,
        opacity: 0.95,
        contours: {
          z: {
            show: true,
            usecolormap: true,
            highlightcolor: '#38bdf8',
            project: { z: false }
          }
        },
        lighting: {
          ambient: 0.7,
          diffuse: 0.8,
          roughness: 0.5,
          specular: 0.15
        },
        colorbar: {
          title: { text: colorTheme === 'moisture' ? 'Moisture' : 'Elevation (m)' },
          len: 0.6,
          thickness: 14,
          tickfont: { color: '#cbd5e1' }
        },
        hoverinfo: 'x+y+z'
      }
    ];

    if (showPlotlyPath) {
      traces.push({
        type: 'scatter3d',
        mode: 'lines+markers',
        name: 'Mission Path',
        x: telemetry.map((t) => t.synX),
        y: telemetry.map((t) => t.synY),
        z: telemetry.map((t) => (t.elev !== undefined ? t.elev : 2.5) + 0.04),
        line: { color: '#38bdf8', width: 4 },
        marker: {
          size: 3,
          color: '#0284c7'
        },
        hoverinfo: 'name'
      });
    }

    return traces;
  }, [
    viewMode,
    telemetry,
    colorTheme,
    showPlotlyPath,
    getTerrainProfileAt
  ]);

  if (!telemetry || telemetry.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 min-h-[450px]">
        <Compass className="w-12 h-12 text-blue-400 animate-pulse mb-3" />
        <p className="text-lg font-medium text-white">No Telemetry Available</p>
        <p className="text-sm text-slate-500 mt-1">Upload a CSV or load a demo mission to inspect in 3D.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 font-sans flex flex-col transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''
      }`}
    >
      {/* 1. TOP DOCKED CONTROL TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 bg-slate-900/90 border-b border-slate-800/80">
        {/* Left: View Mode Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-950/80 rounded-xl border border-slate-800">
          <button
            onClick={() => setViewMode('three')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'three'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-cyan-300" />
            <span>3D Rover Simulation</span>
          </button>
          <button
            onClick={() => setViewMode('plotly')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'plotly'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-cyan-300" />
            <span>Plotly Scientific Surface</span>
          </button>
        </div>

        {/* Right: Camera Presets & Utilities */}
        <div className="flex items-center gap-2">
          {viewMode === 'three' ? (
            /* Camera Presets */
            <div className="flex items-center gap-1 p-1 bg-slate-950/80 rounded-xl border border-slate-800">
              <button
                onClick={() => setPresetView('orbit')}
                title="Free 3D Orbit Camera"
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  cameraPreset === 'orbit' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                Orbit
              </button>
              <button
                onClick={() => setPresetView('top')}
                title="Top-Down Orthogonal View"
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  cameraPreset === 'top' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                Top-Down
              </button>
              <button
                onClick={() => setPresetView('chase')}
                title="Chase Camera (Follow Rover)"
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  cameraPreset === 'chase' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                Chase Cam
              </button>
              <button
                onClick={() => setPresetView('side')}
                title="Lateral Elevation Slope"
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  cameraPreset === 'side' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                Slope
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>Topographic Elevation Heatmap</span>
            </div>
          )}

          {/* Controls Menu Toggle */}
          <button
            onClick={() => setShowControlsMenu(!showControlsMenu)}
            className={`p-2 rounded-xl border text-xs transition-all flex items-center gap-1.5 ${
              showControlsMenu
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Display & Layer Settings"
          >
            <Sliders className="w-4 h-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          {/* Snapshot */}
          <button
            onClick={takeSnapshot}
            className="p-2 bg-slate-950/80 hover:bg-slate-800 rounded-xl border border-slate-800 text-slate-400 hover:text-white transition-all"
            title="Export High-Res PNG Snapshot"
          >
            <Camera className="w-4 h-4" />
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-2 bg-slate-950/80 hover:bg-slate-800 rounded-xl border border-slate-800 text-slate-400 hover:text-white transition-all"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2. MAIN 3D VIEWPORT CONTAINER */}
      <div
        ref={viewportRef}
        className={`relative w-full overflow-hidden bg-slate-950 ${
          isFullscreen ? 'flex-1 min-h-[350px]' : 'h-[460px] sm:h-[500px] lg:h-[540px]'
        }`}
      >
        {viewMode === 'three' ? (
          <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing outline-none" />
        ) : (
          <div className="w-full h-full p-2 bg-slate-950">
            <Plot
              data={plotlyData}
              layout={{
                autosize: true,
                scene: {
                  aspectmode: 'manual',
                  aspectratio: {
                    x: 1.2,
                    y: 1.0,
                    z: 0.45 * heightExaggeration
                  },
                  xaxis: {
                    title: { text: 'X (cm)', font: { color: '#94a3b8' } },
                    backgroundcolor: 'rgb(15, 23, 42)',
                    gridcolor: 'rgb(30, 41, 59)',
                    showbackground: true,
                    tickfont: { color: '#64748b' }
                  },
                  yaxis: {
                    title: { text: 'Y (cm)', font: { color: '#94a3b8' } },
                    backgroundcolor: 'rgb(15, 23, 42)',
                    gridcolor: 'rgb(30, 41, 59)',
                    showbackground: true,
                    tickfont: { color: '#64748b' }
                  },
                  zaxis: {
                    title: { text: 'Elevation (m)', font: { color: '#94a3b8' } },
                    backgroundcolor: 'rgb(15, 23, 42)',
                    gridcolor: 'rgb(30, 41, 59)',
                    showbackground: true,
                    tickfont: { color: '#64748b' }
                  },
                  camera: {
                    eye: { x: 1.4, y: -1.4, z: 0.9 }
                  }
                },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                margin: { l: 0, r: 0, b: 0, t: 25 },
                font: { color: '#e2e8f0', family: 'Inter' }
              }}
              config={{ responsive: true, displayModeBar: true }}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        )}

        {/* Floating Settings Popover */}
        {showControlsMenu && (
          <div className="absolute top-3 right-3 z-30 w-72 p-4 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl space-y-4 text-xs text-slate-300">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Display & Terrain Controls
              </span>
              <button onClick={() => setShowControlsMenu(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Color Themes */}
            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">Color Palette</label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'elevation', label: 'Topography', icon: Mountain },
                  { id: 'moisture', label: 'Soil Moisture', icon: Droplets },
                  { id: 'thermal', label: 'Thermal', icon: Flame },
                  { id: 'cyber', label: 'Cyber Grid', icon: Grid }
                ].map((theme) => {
                  const Icon = theme.icon;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setColorTheme(theme.id as ColorTheme)}
                      className={`px-2.5 py-1.5 rounded-lg text-left transition-all flex items-center gap-1.5 ${
                        colorTheme === theme.id
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-semibold'
                          : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Icon className="w-3 h-3 text-cyan-400" />
                      <span>{theme.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vertical Relief (Height Exaggeration) */}
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Vertical Relief (Height Scale)</span>
                <span className="text-cyan-400 font-semibold">{heightExaggeration.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={heightExaggeration}
                onChange={(e) => setHeightExaggeration(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between gap-1 mt-1 text-[10px] text-slate-500">
                <button onClick={() => setHeightExaggeration(0.5)} className="hover:text-slate-300">Subtle (0.5x)</button>
                <button onClick={() => setHeightExaggeration(1.2)} className="hover:text-slate-300">Natural (1.2x)</button>
                <button onClick={() => setHeightExaggeration(2.0)} className="hover:text-slate-300">Bold (2.0x)</button>
              </div>
            </div>

            {/* Layer Toggles */}
            <div className="space-y-2 pt-1 border-t border-slate-800">
              {viewMode === 'three' ? (
                <>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5"><Bot className="w-3.5 h-3.5 text-amber-400" /> Rover Model</span>
                    <input
                      type="checkbox"
                      checked={showRover}
                      onChange={(e) => setShowRover(e.target.checked)}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" /> Watered Points</span>
                    <input
                      type="checkbox"
                      checked={showWaterMarkers}
                      onChange={(e) => setShowWaterMarkers(e.target.checked)}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-blue-400" /> Trajectory Tube</span>
                    <input
                      type="checkbox"
                      checked={showPathLine}
                      onChange={(e) => setShowPathLine(e.target.checked)}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5 text-emerald-400" /> Waypoint Nodes</span>
                    <input
                      type="checkbox"
                      checked={showWaypoints}
                      onChange={(e) => setShowWaypoints(e.target.checked)}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-slate-400" /> Wireframe Contours</span>
                    <input
                      type="checkbox"
                      checked={showWireframe}
                      onChange={(e) => setShowWireframe(e.target.checked)}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-indigo-400" /> GNSS Trail</span>
                    <input
                      type="checkbox"
                      checked={showGPSTrail}
                      onChange={(e) => setShowGPSTrail(e.target.checked)}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </label>
                </>
              ) : (
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-1.5"><Route className="w-3.5 h-3.5 text-cyan-400" /> Rover Mission Path</span>
                  <input
                    type="checkbox"
                    checked={showPlotlyPath}
                    onChange={(e) => setShowPlotlyPath(e.target.checked)}
                    className="rounded accent-cyan-500 cursor-pointer"
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {/* Inspected Waypoint Drawer */}
        {selectedPoint && viewMode === 'three' && (
          <div className="absolute top-3 left-3 z-30 p-3.5 bg-slate-900/95 backdrop-blur-xl border border-cyan-500/50 rounded-2xl shadow-2xl text-white max-w-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-2">
              <span className="font-bold text-xs text-cyan-400 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5" /> Inspected Waypoint
              </span>
              <button onClick={() => setSelectedPoint(null)} className="text-slate-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Position:</span>
                <span className="font-mono text-white">Row {selectedPoint.row} • Drop {selectedPoint.drop}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Coordinates:</span>
                <span className="font-mono text-slate-200">X:{selectedPoint.synX}cm, Y:{selectedPoint.synY}cm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Moisture:</span>
                <span className="font-mono text-emerald-400 font-semibold">{selectedPoint.moisture}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Watered:</span>
                <span className="font-mono text-cyan-300 font-semibold">{selectedPoint.watered ? 'Dispensed' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Elevation:</span>
                <span className="font-mono text-white">{selectedPoint.elev !== undefined ? `${selectedPoint.elev.toFixed(2)} m` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Attitude:</span>
                <span className="font-mono text-slate-300">P: {selectedPoint.pitch.toFixed(1)}°, R: {selectedPoint.roll.toFixed(1)}°</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. DOCKED BOTTOM CONTROL DECK (Integrated, No Over-floating!) */}
      {viewMode === 'three' && (
        <div className="flex flex-col bg-slate-900 border-t border-slate-800">
          {/* 3A. PLAYBACK TIMELINE CONTROL STRIP */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-2.5 bg-slate-900/95 border-b border-slate-800/80">
            {/* Transport controls */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-white shadow-md shadow-blue-500/20 transition-all active:scale-95"
                title={isPlaying ? 'Pause Simulation' : 'Play Mission Simulation'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
              </button>

              <button
                onClick={() => {
                  setPlaybackIndex(0);
                  setIsPlaying(false);
                }}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all"
                title="Reset to Beginning"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => setPlaybackIndex((prev) => Math.max(0, prev - 1))}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all"
                title="Previous Waypoint"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                onClick={() => setPlaybackIndex((prev) => Math.min(telemetry.length - 1, prev + 1))}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all"
                title="Next Waypoint"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Speed Multiplier */}
              <div className="flex items-center bg-slate-950 rounded-xl p-0.5 border border-slate-800 ml-1">
                {[1, 2, 5].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                      playbackSpeed === spd ? 'bg-cyan-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline Scrubber */}
            <div className="flex-1 w-full max-w-xl flex items-center gap-3">
              <span className="text-xs font-mono text-cyan-400 font-semibold min-w-[70px]">
                #{Math.floor(playbackIndex) + 1} / {telemetry.length}
              </span>
              <input
                type="range"
                min="0"
                max={telemetry.length - 1}
                step="0.1"
                value={playbackIndex}
                onChange={(e) => {
                  setPlaybackIndex(parseFloat(e.target.value));
                  setIsPlaying(false);
                }}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Loop Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsLooping(!isLooping)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                  isLooping ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                }`}
                title="Toggle Loop Playback"
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>Loop</span>
              </button>
            </div>
          </div>

          {/* 3B. LIVE ROVER TELEMETRY DOCKED MONITOR */}
          {currentPoint && (
            <div className="p-3 bg-slate-950/90">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {/* 1. Waypoint & Row */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Waypoint</div>
                  <div className="text-sm font-bold text-white mt-0.5 font-mono">
                    Row {currentPoint.row} • Drop {currentPoint.drop}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                    X:{currentPoint.synX}cm Y:{currentPoint.synY}cm
                  </div>
                </div>

                {/* 2. Soil Moisture */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
                    <span>Moisture</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        currentPoint.moisture < 400
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : currentPoint.moisture < 650
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      }`}
                    >
                      {currentPoint.moisture < 400 ? 'Dry' : currentPoint.moisture < 650 ? 'Optimal' : 'Wet'}
                    </span>
                  </div>
                  <div className="text-base font-extrabold text-white mt-0.5 font-mono">
                    {currentPoint.moisture}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Capacitive Raw</div>
                </div>

                {/* 3. Surface Elevation */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Elevation</div>
                  <div className="text-base font-extrabold text-white mt-0.5 font-mono">
                    {currentPoint.elev !== undefined ? `${currentPoint.elev.toFixed(2)} m` : '0.00 m'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Barometric Ground</div>
                </div>

                {/* 4. Attitude (Pitch/Roll) */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Attitude</div>
                  <div className="text-xs font-mono font-semibold text-cyan-300 mt-1">
                    P: {currentPoint.pitch.toFixed(1)}° • R: {currentPoint.roll.toFixed(1)}°
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">6-Axis IMU</div>
                </div>

                {/* 5. Heading */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                    <Compass className="w-3 h-3 text-cyan-400" />
                    <span>Heading</span>
                  </div>
                  <div className="text-base font-extrabold text-cyan-300 mt-0.5 font-mono">
                    {currentPoint.absHead.toFixed(1)}°
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Absolute Gyro</div>
                </div>

                {/* 6. GNSS Satellites & Water status */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
                    <span>Status</span>
                    {currentPoint.watered === 1 ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        Dispensed
                      </span>
                    ) : (
                      <span className="text-[9px] text-slate-500">Standby</span>
                    )}
                  </div>
                  <div className="text-xs font-mono font-semibold text-emerald-400 mt-1 flex items-center gap-1">
                    <Satellite className="w-3.5 h-3.5" />
                    <span>{currentPoint.sats} Sats</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {typeof currentPoint.gpsLat === 'number' ? '3D GNSS Fix' : 'Dead Reckoning'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

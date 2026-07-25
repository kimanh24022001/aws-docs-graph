"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  Suspense,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useQuery } from "@tanstack/react-query";
import { fetchClusters, fetchGraphOverview } from "@/lib/api";
import { categoryFor, categoryColor } from "@/lib/categories";
import type { GalaxyCluster, GraphNode } from "@/lib/types";
import { EvidencePanel } from "@/components/EvidencePanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type View = { level: "categories" } | { level: "category"; category: string };

interface PlanetData {
  id: string;
  label: string;
  nodeCount: number;
  color: string;
  position: [number, number, number];
  size: number;
}

interface EdgeData {
  source: string;
  target: string;
  relType: string;
  weight: number;
}

// ── Planet sphere ──────────────────────────────────────────────────────────────

function Planet({
  data,
  onClick,
}: {
  data: PlanetData;
  onClick: (id: string, label: string) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.3;
    }
  });

  const color = new THREE.Color(data.color);

  return (
    <group position={data.position}>
      <mesh
        ref={meshRef}
        onClick={() => onClick(data.id, data.label)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        scale={hovered ? 1.15 : 1}
      >
        <sphereGeometry args={[data.size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 1.2 : 0.6}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>
      {/* Glow ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[data.size * 1.3, data.size * 1.5, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Label */}
      <Html distanceFactor={20} center>
        <div
          style={{
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            background: "rgba(0,0,0,0.6)",
            padding: "2px 6px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            userSelect: "none",
            textShadow: `0 0 8px ${data.color}`,
          }}
        >
          {data.label}
          <span style={{ color: "#aaa", fontWeight: 400, marginLeft: 4 }}>
            {data.nodeCount}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── Edge line between two planets ─────────────────────────────────────────────

function PlanetEdge({
  start,
  end,
  color,
  onClick,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  onClick?: () => void;
}) {
  const points = useMemo(
    () => [new THREE.Vector3(...start), new THREE.Vector3(...end)],
    [start, end],
  );
  const lineColor = new THREE.Color(color);
  // Midpoint for an invisible click-target mesh
  const mid = useMemo(
    () =>
      new THREE.Vector3(
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
        (start[2] + end[2]) / 2,
      ),
    [start, end],
  );

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(points.flatMap((p) => [p.x, p.y, p.z])), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={lineColor}
          transparent
          opacity={0.4}
          linewidth={1}
        />
      </line>
      {/* Invisible sphere at midpoint for pointer events */}
      {onClick && (
        <mesh position={[mid.x, mid.y, mid.z]} onClick={onClick}>
          <sphereGeometry args={[1.2, 6, 6]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
}

// ── Camera auto-orbit ──────────────────────────────────────────────────────────

function CameraOrbit() {
  const { camera } = useThree();
  const angle = useRef(0);

  useFrame((_, delta) => {
    angle.current += delta * 0.05;
    camera.position.x = Math.cos(angle.current) * 60;
    camera.position.z = Math.sin(angle.current) * 60;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

// ── REL type colors ────────────────────────────────────────────────────────────

const REL_COLORS: Record<string, string> = {
  INTEGRATES_WITH: "#4fc3f7",
  TRIGGERS: "#ef5350",
  TRIGGERED_BY: "#ff9800",
  PROCESSES: "#66bb6a",
  STORES_IN: "#ffd54f",
  AUTH_VIA: "#ce93d8",
};

// ── Level 0: Galaxy scene ──────────────────────────────────────────────────────

function GalaxyScene({
  planets,
  edges,
  onPlanetClick,
  onLinkClick,
}: {
  planets: PlanetData[];
  edges: EdgeData[];
  onPlanetClick: (id: string, label: string) => void;
  onLinkClick?: (link: {
    source: string;
    target: string;
    label: string;
  }) => void;
}) {
  const posMap = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    planets.forEach((p) => m.set(p.id, p.position));
    return m;
  }, [planets]);

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 0, 0]} intensity={2} color="#ffffff" />
      <Stars
        radius={200}
        depth={80}
        count={5000}
        factor={6}
        saturation={1}
        fade
        speed={0.5}
      />

      {/* Edges */}
      {edges.map((e, i) => {
        const src = posMap.get(e.source);
        const tgt = posMap.get(e.target);
        if (!src || !tgt) return null;
        return (
          <PlanetEdge
            key={i}
            start={src}
            end={tgt}
            color={REL_COLORS[e.relType] ?? "#334"}
            onClick={
              onLinkClick
                ? () =>
                    onLinkClick({
                      source: e.source,
                      target: e.target,
                      label: e.relType,
                    })
                : undefined
            }
          />
        );
      })}

      {/* Planets */}
      {planets.map((p) => (
        <Planet key={p.id} data={p} onClick={onPlanetClick} />
      ))}

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.1}
          luminanceSmoothing={0.9}
          intensity={1.2}
          height={300}
        />
      </EffectComposer>

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        autoRotate
        autoRotateSpeed={0.4}
      />
    </>
  );
}

// ── Level 1: Doc nodes scene ───────────────────────────────────────────────────

function DocNode({
  node,
  position,
}: {
  node: GraphNode;
  position: THREE.Vector3;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const color = new THREE.Color(categoryColor(categoryFor(node.service)));

  useFrame((_, delta) => {
    if (meshRef.current && hovered) {
      meshRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[0.25, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.8 : 0.3}
          roughness={0.5}
        />
      </mesh>
      {hovered && (
        <Html distanceFactor={15} center>
          <div
            style={{
              color: "#fff",
              fontSize: 10,
              background: "rgba(0,0,0,0.8)",
              padding: "2px 6px",
              borderRadius: 3,
              whiteSpace: "nowrap",
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {node.title ?? node.url}
          </div>
        </Html>
      )}
    </group>
  );
}

function DocScene({ nodes }: { nodes: GraphNode[] }) {
  const positions = useMemo(() => {
    return nodes.map((_, i) => {
      const phi = Math.acos(-1 + (2 * i) / nodes.length);
      const theta = Math.sqrt(nodes.length * Math.PI) * phi;
      const r = 20 + Math.random() * 15;
      return new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
    });
  }, [nodes]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 0, 0]} intensity={1.5} />
      <Stars
        radius={150}
        depth={60}
        count={3000}
        factor={5}
        saturation={1}
        fade
        speed={0.3}
      />
      {nodes.map((node, i) => (
        <DocNode key={node.id} node={node} position={positions[i]} />
      ))}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.1}
          luminanceSmoothing={0.9}
          intensity={0.8}
          height={300}
        />
      </EffectComposer>
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        autoRotate
        autoRotateSpeed={0.3}
      />
    </>
  );
}

// ── Arrange planets in a circle ────────────────────────────────────────────────

function buildPlanetData(clusters: GalaxyCluster[]): PlanetData[] {
  const cats = clusters.filter((c) => c.label !== "Other");
  const count = cats.length;
  const radius = 28;
  return cats.map((c, i) => {
    const angle = (i / count) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = (Math.random() - 0.5) * 8;
    const size = Math.max(1.5, Math.log(c.nodeCount) * 0.8);
    return {
      id: c.id,
      label: c.label,
      nodeCount: c.nodeCount,
      color: categoryColor(c.label),
      position: [x, y, z],
      size,
    };
  });
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function GalaxyPage() {
  const [view, setView] = useState<View>({ level: "categories" });
  const [evidenceEdge, setEvidenceEdge] = useState<{
    src: string;
    tgt: string;
    relType: string;
    color: string;
  } | null>(null);

  const clustersQ = useQuery({
    queryKey: ["galaxy", "clusters"],
    queryFn: fetchClusters,
    staleTime: 60 * 60 * 1000,
  });

  const overviewQ = useQuery({
    queryKey: ["graph", "overview"],
    queryFn: fetchGraphOverview,
    enabled: view.level === "category",
    staleTime: 24 * 60 * 60 * 1000,
  });

  const planets = useMemo(
    () => buildPlanetData(clustersQ.data?.clusters ?? []),
    [clustersQ.data],
  );

  const edges: EdgeData[] = useMemo(
    () => (clustersQ.data as { edges?: EdgeData[] })?.edges ?? [],
    [clustersQ.data],
  );

  const catNodes = useMemo(() => {
    if (view.level !== "category") return [];
    return (overviewQ.data?.nodes ?? []).filter(
      (n) => categoryFor(n.service) === view.category,
    );
  }, [view, overviewQ.data]);

  const handlePlanetClick = useCallback((id: string, label: string) => {
    setView({ level: "category", category: label });
  }, []);

  const handleLinkClick = useCallback(
    (link: { source: string; target: string; label: string }) => {
      const l = link as { source: string; target: string; label: string };
      setEvidenceEdge({
        src: l.source,
        tgt: l.target,
        relType: l.label ?? "INTEGRATES_WITH",
        color: REL_COLORS[l.label] ?? "#4fc3f7",
      });
    },
    [],
  );

  const catColor =
    view.level === "category" ? categoryColor(view.category) : "#fff";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#08080b",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "16px 24px",
          background:
            "linear-gradient(180deg, rgba(8,8,11,0.9) 0%, transparent 100%)",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 12,
          pointerEvents: "none",
        }}
      >
        {view.level === "category" && (
          <button
            onClick={() => setView({ level: "categories" })}
            style={{
              padding: "5px 14px",
              background: "rgba(255,255,255,0.08)",
              border: `1px solid ${catColor}55`,
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              color: "#ccc",
              pointerEvents: "all",
            }}
          >
            ← Galaxy
          </button>
        )}
        <h1
          style={{
            fontSize: 18,
            margin: 0,
            color: view.level === "category" ? catColor : "#e0e0ff",
            fontWeight: 700,
            textShadow: `0 0 20px ${view.level === "category" ? catColor : "#8080ff"}`,
          }}
        >
          {view.level === "categories" ? "🌌 AWS Galaxy" : `✦ ${view.category}`}
        </h1>
        <span style={{ color: "#555", fontSize: 12 }}>
          {view.level === "categories"
            ? `${planets.length} categories`
            : `${catNodes.length} documents`}
        </span>
      </div>

      {/* 3D Canvas */}
      <Canvas camera={{ position: [0, 20, 60], fov: 45 }} frameloop="always">
        <color attach="background" args={["#08080b"]} />
        <Suspense fallback={null}>
          {view.level === "categories" ? (
            <GalaxyScene
              planets={planets}
              edges={edges}
              onPlanetClick={handlePlanetClick}
              onLinkClick={handleLinkClick}
            />
          ) : (
            <DocScene nodes={catNodes} />
          )}
        </Suspense>
      </Canvas>

      {evidenceEdge && (
        <EvidencePanel
          src={evidenceEdge.src}
          tgt={evidenceEdge.tgt}
          relType={evidenceEdge.relType}
          color={evidenceEdge.color}
          onClose={() => setEvidenceEdge(null)}
        />
      )}
    </div>
  );
}

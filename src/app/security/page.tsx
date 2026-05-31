"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ThreatNode, GatewayNode } from "@/components/nodes/ThreatNode";

// Define initial nodes representing the attack surface graph
const initialNodes = [
  {
    id: "gateway",
    type: "gateway",
    position: { x: 500, y: 300 },
    data: { label: "Gateway" },
  },
  {
    id: "user-data",
    type: "threat",
    position: { x: 100, y: 100 },
    data: { type: "sensitive", icon: "database", label: "User Data", status: "Exposed Port" },
  },
  {
    id: "auth-api",
    type: "threat",
    position: { x: 300, y: 200 },
    data: { type: "entry", icon: "api", label: "Auth API", status: "2 Alerts" },
  },
  {
    id: "web-frontend",
    type: "threat",
    position: { x: 800, y: 150 },
    data: { type: "standard", icon: "web", label: "Web Frontend", status: "Secure" },
  },
  {
    id: "legacy-db",
    type: "threat",
    position: { x: 850, y: 350 },
    data: { type: "sensitive", icon: "dns", label: "Legacy DB", status: "Critical" },
  },
  {
    id: "cloud-storage",
    type: "threat",
    position: { x: 350, y: 450 },
    data: { type: "standard", icon: "cloud", label: "Cloud Storage", status: "Scanning..." },
  },
  {
    id: "payment-sys",
    type: "threat",
    position: { x: 1000, y: 500 },
    data: { type: "sensitive", icon: "storage", label: "Payment Sys", status: "CVE-2023-XYZ" },
  },
  {
    id: "internal-tool",
    type: "threat",
    position: { x: 1100, y: 250 },
    data: { type: "standard", icon: "settings_applications", label: "Internal Tool" },
  },
];

// Define edges connecting the nodes
const initialEdges = [
  {
    id: "e-userdata-auth",
    source: "user-data",
    target: "auth-api",
    animated: true,
    style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "4" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
  },
  {
    id: "e-auth-gateway",
    source: "auth-api",
    target: "gateway",
    animated: true,
    style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "4" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
  },
  {
    id: "e-gateway-web",
    source: "gateway",
    target: "web-frontend",
    style: { stroke: "#a08e7a", strokeWidth: 1, opacity: 0.3 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#a08e7a" },
  },
  {
    id: "e-gateway-legacy",
    source: "gateway",
    target: "legacy-db",
    animated: true,
    style: { stroke: "#ef4444", strokeWidth: 3 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#ef4444" },
  },
  {
    id: "e-gateway-cloud",
    source: "gateway",
    target: "cloud-storage",
    style: { stroke: "#a08e7a", strokeWidth: 1, opacity: 0.3 },
  },
  {
    id: "e-legacy-payment",
    source: "legacy-db",
    target: "payment-sys",
    animated: true,
    style: { stroke: "#ef4444", strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#ef4444" },
  },
  {
    id: "e-legacy-internal",
    source: "legacy-db",
    target: "internal-tool",
    style: { stroke: "#ef4444", strokeWidth: 1, strokeDasharray: "2" },
  },
];

export default function SecurityPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isClient, setIsClient] = useState(false);

  // Custom node types mapping
  const nodeTypes = useMemo(() => ({ threat: ThreatNode, gateway: GatewayNode }), []);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return null;

  return (
    <div style={{ margin: 0, padding: 0, height: "100vh", backgroundColor: "#091421", color: "#d9e3f6", fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
        
        {/* Minimal Header */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #212b39", backgroundColor: "#050f1c", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button onClick={() => window.history.back()} style={{ background: "none", border: "none", color: "#d9e3f6", cursor: "pointer", display: "flex" }}>
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <div style={{ width: "1px", height: "24px", backgroundColor: "#534434" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#ffc174" }}>
              <span className="material-symbols-outlined">radar</span>
              <h2 style={{ margin: 0, fontSize: "24px", fontWeight: 600, color: "#d9e3f6" }}>Attack Surface Analyzer</h2>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ padding: "4px 12px", backgroundColor: "#212b39", color: "#d8c3ad", fontSize: "12px", borderRadius: "9999px", border: "1px solid #2b3544", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#ffc174" }} />
              Live Scan Active
            </span>
          </div>
        </header>

        {/* Main Canvas Area */}
        <main style={{ flex: 1, position: "relative" }}>
          
          {/* Overlay Graph Title */}
          <div style={{ position: "absolute", top: "24px", left: "24px", zIndex: 10, pointerEvents: "none" }}>
            <div style={{ backgroundColor: "rgba(9, 20, 33, 0.8)", backdropFilter: "blur(4px)", padding: "16px", borderRadius: "8px", border: "1px solid #2b3544", pointerEvents: "auto" }}>
              <h2 style={{ margin: 0, fontSize: "32px", color: "#d9e3f6", fontFamily: "'Inter', sans-serif" }}>Attack Vector Graph</h2>
              <p style={{ margin: "4px 0 0", fontSize: "16px", color: "#d8c3ad", fontFamily: "'Inter', sans-serif" }}>Visualizing potential attack vectors and vulnerabilities from Internet entry.</p>
            </div>
          </div>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            proOptions={{ hideAttribution: true }} // Hides the tiny reactflow watermark
          >
            <Background color="#2b3544" gap={20} size={1} />
            <Controls style={{ backgroundColor: "#212b39", borderColor: "#2b3544", fill: "#d9e3f6" }} />
            <MiniMap 
              nodeColor={(n) => {
                if (n.type === 'gateway') return '#ffc174';
                if (n.data?.type === 'sensitive') return '#ffb4ab';
                return '#a08e7a';
              }}
              style={{ backgroundColor: '#121c2a', maskColor: 'rgba(9, 20, 33, 0.7)' }}
            />
          </ReactFlow>

          {/* Overlay Legend */}
          <div style={{ position: "absolute", bottom: "24px", left: "24px", zIndex: 10, pointerEvents: "none", width: "calc(100% - 48px)", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: "16px", backgroundColor: "rgba(22, 32, 46, 0.9)", backdropFilter: "blur(4px)", padding: "8px 16px", borderRadius: "8px", border: "1px solid #2b3544", pointerEvents: "auto" }}>
              {[
                { color: "#ffc174", label: "Entry Point" },
                { color: "#f59e0b", label: "Service Node" },
                { color: "#ffb4ab", label: "Critical Data Store" },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: color }} />
                  <span style={{ fontSize: "12px", color: "#d8c3ad", fontFamily: "'Inter', sans-serif" }}>{label}</span>
                </div>
              ))}
              <div style={{ width: "1px", height: "16px", backgroundColor: "#534434" }} />
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "24px", height: "2px", background: "linear-gradient(to right, #ffc174, #ffb4ab)" }} />
                <span style={{ fontSize: "12px", color: "#d8c3ad", fontFamily: "'Inter', sans-serif" }}>Active Threat Path</span>
              </div>
            </div>

            <button style={{ pointerEvents: "auto", backgroundColor: "#ffc174", color: "#472a00", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", fontFamily: "'Inter', sans-serif", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>security_update_warning</span>
              Generate Remediation Plan
            </button>
          </div>

        </main>
    </div>
  );
}

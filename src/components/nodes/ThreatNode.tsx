"use client";

import { Handle, Position } from "@xyflow/react";

export function ThreatNode({ data }: { data: any }) {
  // Styles based on node type
  let borderStyle = "1px solid #a08e7a"; // node-standard
  let glowStyle = "none";
  let iconColor = "#a08e7a";

  if (data.type === "sensitive") {
    borderStyle = "2px solid #ffb4ab"; // error color
    glowStyle = "0 0 15px rgba(255, 180, 171, 0.2)";
    iconColor = "#ffb4ab";
  } else if (data.type === "entry") {
    borderStyle = "2px solid #ffc174"; // primary color
    iconColor = "#ffc174";
  }

  return (
    <div
      style={{
        backgroundColor: "#212b39", // surface-container-high
        border: borderStyle,
        borderRadius: "8px",
        padding: "12px",
        width: "140px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: glowStyle,
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#a08e7a", width: "8px", height: "8px", border: "none" }}
      />
      
      <div
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          backgroundColor: data.type === "sensitive" ? "rgba(255, 180, 171, 0.1)" : "rgba(255, 193, 116, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "8px",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ color: iconColor, fontSize: "20px" }}
        >
          {data.icon}
        </span>
      </div>
      
      <span
        style={{
          color: "#d9e3f6",
          fontSize: "14px",
          fontFamily: "'Inter', sans-serif",
          fontWeight: data.type === "sensitive" ? 600 : 400,
          textAlign: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          width: "100%",
        }}
      >
        {data.label}
      </span>
      
      {data.status && (
        <span
          style={{
            color: data.type === "sensitive" ? "#ffb4ab" : "#ffc174",
            fontSize: "12px",
            fontFamily: "'Inter', sans-serif",
            marginTop: "4px",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: data.type === "sensitive" ? "rgba(255, 180, 171, 0.1)" : "transparent",
            padding: data.type === "sensitive" ? "2px 6px" : "0",
            borderRadius: "4px",
          }}
        >
          {data.type === "sensitive" && (
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>warning</span>
          )}
          {data.status}
        </span>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#a08e7a", width: "8px", height: "8px", border: "none" }}
      />
    </div>
  );
}

export function GatewayNode({ data }: { data: any }) {
  return (
    <div
      style={{
        backgroundColor: "#212b39",
        border: "2px solid #ffc174",
        borderRadius: "50%",
        width: "96px",
        height: "96px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#ffc174", width: "8px", height: "8px", border: "none" }}
      />
      <span
        className="material-symbols-outlined"
        style={{ color: "#ffc174", fontSize: "30px", marginBottom: "4px" }}
      >
        language
      </span>
      <span
        style={{
          color: "#d9e3f6",
          fontSize: "12px",
          fontFamily: "'Inter', sans-serif",
          fontWeight: 600,
        }}
      >
        Gateway
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#ffc174", width: "8px", height: "8px", border: "none" }}
      />
    </div>
  );
}

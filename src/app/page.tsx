"use client";
import { useEffect, useRef } from "react";
export default function LandingPage() {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const fit = () => { if (ref.current) ref.current.style.height = `${window.innerHeight}px`; };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <>
      <style>{`html,body,#__next{margin:0;padding:0;height:100%;overflow:hidden}`}</style>
      <iframe ref={ref} src="/landing.html" title="RepoLense" style={{ width:"100%", height:"100vh", border:"none", display:"block" }} />
    </>
  );
}

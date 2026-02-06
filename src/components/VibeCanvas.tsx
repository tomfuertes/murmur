import { useRef, useEffect } from "react";
import type { VibeState, MusicalKey, MusicalMode } from "../types";
import { vertexSource, fragmentSource } from "../shaders/vibe";
import {
  createShaderProgram,
  createFullscreenQuad,
  createPingPongFBOs,
  resizePingPongFBOs,
  deletePingPongFBOs,
  type PingPongFBOs,
} from "../shaders/webgl";

// Key -> hue (0-1)
const KEY_HUE: Record<MusicalKey, number> = {
  C: 0.6,
  D: 0.08,
  E: 0.15,
  F: 0.3,
  G: 0.05,
  A: 0.75,
  B: 0.9,
};

// Mode -> { spread, saturation }
const MODE_STYLE: Record<MusicalMode, { spread: number; saturation: number }> = {
  major: { spread: 0.15, saturation: 0.7 },
  minor: { spread: 0.08, saturation: 0.5 },
  dorian: { spread: 0.12, saturation: 0.6 },
  mixolydian: { spread: 0.18, saturation: 0.65 },
};

/** Map a VibeState to the uniform target values the shader expects. */
function vibeToUniforms(state: VibeState) {
  const ms = MODE_STYLE[state.mode];
  return {
    u_speed: state.tempo / 60, // faster tempo = faster visuals, centered at 1.0 for 60 BPM
    u_hue_base: KEY_HUE[state.key],
    u_hue_spread: ms.spread,
    u_saturation: ms.saturation,
    u_blur: state.reverbMix,
    u_echo_intensity: state.delayMix, // full range for zoom-feedback trails
    u_detail: 1.5 + state.filterCutoff / 8000 * 1.5, // filter cutoff drives detail (1.5-3 octaves)
    u_warp_strength: 0.2 + state.density * 1.0, // density drives warping intensity
    u_brightness: 0.3 + state.brightness * 0.7,
    u_layer_mask: 7.0, // all 3 layers on
    u_seed: state.seed % 1000,
  };
}

type UniformValues = ReturnType<typeof vibeToUniforms>;
const UNIFORM_KEYS = [
  "u_speed",
  "u_hue_base",
  "u_hue_spread",
  "u_saturation",
  "u_blur",
  "u_echo_intensity",
  "u_detail",
  "u_warp_strength",
  "u_brightness",
  "u_layer_mask",
  "u_seed",
] as const;

const LERP_DURATION = 3.0; // seconds to transition uniforms

/** Cubic ease-out: 1 - (1-t)^3 */
function easeOut(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

export function VibeCanvas({ vibeState }: { vibeState: VibeState | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation>>({});
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const ppRef = useRef<PingPongFBOs | null>(null);
  const ppIndexRef = useRef(0);
  const rafRef = useRef(0);
  const startTimeRef = useRef(0);

  // Lerp state
  const currentRef = useRef<UniformValues | null>(null);
  const targetRef = useRef<UniformValues | null>(null);
  const lerpStartRef = useRef<UniformValues | null>(null);
  const lerpTimeRef = useRef(0);

  // Update targets when vibeState changes
  useEffect(() => {
    if (!vibeState) return;
    const newTarget = vibeToUniforms(vibeState);
    // If no current values yet, snap immediately
    if (!currentRef.current) {
      currentRef.current = { ...newTarget };
      targetRef.current = newTarget;
      lerpStartRef.current = { ...newTarget };
      lerpTimeRef.current = 0;
    } else {
      lerpStartRef.current = { ...currentRef.current };
      targetRef.current = newTarget;
      lerpTimeRef.current = performance.now() / 1000;
    }
  }, [vibeState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
    if (!gl) return; // graceful degradation

    glRef.current = gl;

    // Compile shaders
    let shaderResult: ReturnType<typeof createShaderProgram>;
    try {
      shaderResult = createShaderProgram(gl, vertexSource, fragmentSource);
    } catch (e) {
      console.error("Shader compilation failed:", e);
      return;
    }
    programRef.current = shaderResult.program;
    uniformsRef.current = shaderResult.uniforms;

    // Fullscreen quad VAO
    vaoRef.current = createFullscreenQuad(gl);

    // Size canvas — use low DPR since the shader is behind glassmorphism
    const dpr = Math.min(window.devicePixelRatio, 1);
    const resize = () => {
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        if (ppRef.current) {
          resizePingPongFBOs(gl, ppRef.current, w, h);
        } else {
          ppRef.current = createPingPongFBOs(gl, w, h);
        }
      }
    };
    resize();
    window.addEventListener("resize", resize);

    startTimeRef.current = performance.now() / 1000;

    // Animation loop
    let paused = false;
    const onVisibility = () => {
      paused = document.visibilityState === "hidden";
    };
    document.addEventListener("visibilitychange", onVisibility);

    let lastFrame = 0;
    const FRAME_INTERVAL = 1 / 30; // cap at 30fps — ambient visuals don't need more

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      if (paused || !currentRef.current || !targetRef.current || !lerpStartRef.current) return;

      const now = performance.now() / 1000;

      // Throttle to 30fps
      if (now - lastFrame < FRAME_INTERVAL) return;
      lastFrame = now;

      // Lerp uniforms
      const elapsed = lerpTimeRef.current > 0 ? now - lerpTimeRef.current : LERP_DURATION;
      const t = Math.min(elapsed / LERP_DURATION, 1);
      const e = easeOut(t);
      for (const key of UNIFORM_KEYS) {
        currentRef.current[key] = lerpStartRef.current[key] + (targetRef.current[key] - lerpStartRef.current[key]) * e;
      }

      const u = uniformsRef.current;
      const pp = ppRef.current;
      if (!pp || !programRef.current) return;
      const readIdx = ppIndexRef.current;
      const writeIdx = 1 - readIdx;

      gl.useProgram(programRef.current);
      gl.bindVertexArray(vaoRef.current);

      // Set time + resolution uniforms
      if (u.u_time) gl.uniform1f(u.u_time, now - startTimeRef.current);
      if (u.u_resolution) gl.uniform2f(u.u_resolution, canvas.width, canvas.height);

      // Set lerped uniforms
      for (const key of UNIFORM_KEYS) {
        const loc = u[key];
        if (loc) gl.uniform1f(loc, currentRef.current[key]);
      }

      // Bind the previous frame's texture as echo input
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pp.textures[readIdx]);
      if (u.u_echo_tex) gl.uniform1i(u.u_echo_tex, 0);

      // Render to the write FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, pp.fbos[writeIdx]);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Render to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Swap ping-pong
      ppIndexRef.current = writeIdx;
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      if (ppRef.current) deletePingPongFBOs(gl, ppRef.current);
      if (vaoRef.current) gl.deleteVertexArray(vaoRef.current);
      if (programRef.current) gl.deleteProgram(programRef.current);
      glRef.current = null;
      ppRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="vibe-canvas fixed inset-0 w-full h-full"
    />
  );
}

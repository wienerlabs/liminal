/**
 * LIMINAL — ASCIIText
 *
 * 3D-warped text rendered as live ASCII via Three.js + a CPU-side
 * pixel→glyph mapper. Adapted from the JuanFuentes CodePen pattern,
 * retuned for LIMINAL:
 *   - Pastel pink → sky → mint → yellow gradient (replaces the
 *     coral/orange/yellow source) on the rendered ASCII characters
 *   - Uses our font stack (ABC Favorit Mono) instead of importing
 *     IBM Plex Mono from Google Fonts
 *   - Same wave + mouse-tilt interactions as the source
 *   - Disposes the WebGL context on unmount; safe to use inside a
 *     short-lived overlay
 *
 * Used as the centrepiece of the execution-complete flourish — sits
 * inside CompletionFlourish for a 3-second appearance after DONE.
 *
 * Math.map polyfill is scoped to this module to avoid mutating the
 * global Math object (the source CodePen extended Math.prototype,
 * which leaks into the rest of the app).
 */

import { useEffect, useRef, type FC } from "react";
import * as THREE from "three";

const vertexShader = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uEnableWaves;

void main() {
    vUv = uv;
    float time = uTime * 5.0;
    float waveFactor = uEnableWaves;

    vec3 transformed = position;
    transformed.x += sin(time + position.y) * 0.5 * waveFactor;
    transformed.y += cos(time + position.z) * 0.15 * waveFactor;
    transformed.z += sin(time + position.x) * waveFactor;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform sampler2D uTexture;

void main() {
    float time = uTime;
    vec2 pos = vUv;

    float r = texture2D(uTexture, pos + cos(time * 2.0 - time + pos.x) * 0.01).r;
    float g = texture2D(uTexture, pos + tan(time * 0.5 + pos.x - time) * 0.01).g;
    float b = texture2D(uTexture, pos - cos(time * 2.0 + time + pos.y) * 0.01).b;
    float a = texture2D(uTexture, pos).a;
    gl_FragColor = vec4(r, g, b, a);
}
`;

// Local map utility — kept out of Math.prototype to avoid leaking into
// every consumer of `Math`.
function mapRange(
  n: number,
  start: number,
  stop: number,
  start2: number,
  stop2: number,
): number {
  return ((n - start) / (stop - start)) * (stop2 - start2) + start2;
}

const PX_RATIO =
  typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

// ---------------------------------------------------------------------------
// AsciiFilter — projects the rendered THREE canvas into a glyph grid
// ---------------------------------------------------------------------------

interface AsciiFilterOptions {
  fontSize?: number;
  fontFamily?: string;
  charset?: string;
  invert?: boolean;
}

class AsciiFilter {
  renderer: THREE.WebGLRenderer;
  domElement: HTMLDivElement;
  pre: HTMLPreElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  deg: number;
  invert: boolean;
  fontSize: number;
  fontFamily: string;
  charset: string;
  width: number = 0;
  height: number = 0;
  cols: number = 0;
  rows: number = 0;
  center: { x: number; y: number } = { x: 0, y: 0 };
  mouse: { x: number; y: number } = { x: 0, y: 0 };

  constructor(renderer: THREE.WebGLRenderer, opts: AsciiFilterOptions = {}) {
    this.renderer = renderer;
    this.domElement = document.createElement("div");
    this.domElement.style.position = "absolute";
    this.domElement.style.top = "0";
    this.domElement.style.left = "0";
    this.domElement.style.width = "100%";
    this.domElement.style.height = "100%";

    this.pre = document.createElement("pre");
    this.domElement.appendChild(this.pre);

    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    this.domElement.appendChild(this.canvas);

    this.deg = 0;
    this.invert = opts.invert ?? true;
    this.fontSize = opts.fontSize ?? 12;
    this.fontFamily = opts.fontFamily ?? "var(--font-mono), 'Courier New', monospace";
    this.charset =
      opts.charset ??
      ' .\'`^",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

    this.context.imageSmoothingEnabled = false;
    this.onMouseMove = this.onMouseMove.bind(this);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.reset();
    this.center = { x: width / 2, y: height / 2 };
    this.mouse = { x: this.center.x, y: this.center.y };
  }

  reset(): void {
    this.context.font = `${this.fontSize}px ${this.fontFamily}`;
    const charWidth = this.context.measureText("A").width;

    this.cols = Math.floor(
      this.width / (this.fontSize * (charWidth / this.fontSize)),
    );
    this.rows = Math.floor(this.height / this.fontSize);

    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.pre.style.fontFamily = this.fontFamily;
    this.pre.style.fontSize = `${this.fontSize}px`;
    this.pre.style.margin = "0";
    this.pre.style.padding = "0";
    this.pre.style.lineHeight = "1em";
    this.pre.style.position = "absolute";
    this.pre.style.left = "0";
    this.pre.style.top = "0";
    this.pre.style.zIndex = "9";
    this.pre.style.backgroundAttachment = "fixed";
    this.pre.style.mixBlendMode = "difference";
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.renderer.render(scene, camera);

    const w = this.canvas.width;
    const h = this.canvas.height;
    this.context.clearRect(0, 0, w, h);
    if (w && h) {
      this.context.drawImage(this.renderer.domElement, 0, 0, w, h);
    }
    this.asciify(this.context, w, h);
    this.hue();
  }

  onMouseMove(e: MouseEvent): void {
    this.mouse = { x: e.clientX * PX_RATIO, y: e.clientY * PX_RATIO };
  }

  get dx(): number {
    return this.mouse.x - this.center.x;
  }

  get dy(): number {
    return this.mouse.y - this.center.y;
  }

  hue(): void {
    const deg = (Math.atan2(this.dy, this.dx) * 180) / Math.PI;
    this.deg += (deg - this.deg) * 0.075;
    this.domElement.style.filter = `hue-rotate(${this.deg.toFixed(1)}deg)`;
  }

  asciify(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!w || !h) return;
    const imgData = ctx.getImageData(0, 0, w, h).data;
    let str = "";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = x * 4 + y * 4 * w;
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const a = imgData[i + 3];

        if (a === 0) {
          str += " ";
          continue;
        }

        const gray = (0.3 * r + 0.6 * g + 0.1 * b) / 255;
        let idx = Math.floor((1 - gray) * (this.charset.length - 1));
        if (this.invert) idx = this.charset.length - idx - 1;
        str += this.charset[idx];
      }
      str += "\n";
    }
    this.pre.innerHTML = str;
  }

  dispose(): void {
    document.removeEventListener("mousemove", this.onMouseMove);
  }
}

// ---------------------------------------------------------------------------
// CanvasTxt — rasterises the source text once so the THREE plane has a
// texture to bend.
// ---------------------------------------------------------------------------

interface CanvasTxtOptions {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}

class CanvasTxt {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  txt: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  font: string;

  constructor(txt: string, opts: CanvasTxtOptions = {}) {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    this.txt = txt;
    this.fontSize = opts.fontSize ?? 200;
    this.fontFamily = opts.fontFamily ?? "Arial";
    this.color = opts.color ?? "#fdf9f3";

    this.font = `600 ${this.fontSize}px ${this.fontFamily}`;
  }

  resize(): void {
    this.context.font = this.font;
    const metrics = this.context.measureText(this.txt);

    const textWidth = Math.ceil(metrics.width) + 20;
    const textHeight =
      Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 20;

    this.canvas.width = textWidth;
    this.canvas.height = textHeight;
  }

  render(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.fillStyle = this.color;
    this.context.font = this.font;

    const metrics = this.context.measureText(this.txt);
    const yPos = 10 + metrics.actualBoundingBoxAscent;
    this.context.fillText(this.txt, 10, yPos);
  }

  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }
  get texture(): HTMLCanvasElement {
    return this.canvas;
  }
}

// ---------------------------------------------------------------------------
// CanvAscii — orchestrator that owns the THREE scene + the AsciiFilter
// ---------------------------------------------------------------------------

interface CanvAsciiOpts {
  text: string;
  asciiFontSize: number;
  textFontSize: number;
  textColor: string;
  planeBaseHeight: number;
  enableWaves: boolean;
}

class CanvAscii {
  textString: string;
  asciiFontSize: number;
  textFontSize: number;
  textColor: string;
  planeBaseHeight: number;
  container: HTMLDivElement;
  width: number;
  height: number;
  enableWaves: boolean;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  mouse: { x: number; y: number };
  textCanvas?: CanvasTxt;
  texture?: THREE.CanvasTexture;
  geometry?: THREE.PlaneGeometry;
  material?: THREE.ShaderMaterial;
  mesh?: THREE.Mesh;
  renderer?: THREE.WebGLRenderer;
  filter?: AsciiFilter;
  center?: { x: number; y: number };
  animationFrameId?: number;

  constructor(
    opts: CanvAsciiOpts,
    containerElem: HTMLDivElement,
    width: number,
    height: number,
  ) {
    this.textString = opts.text;
    this.asciiFontSize = opts.asciiFontSize;
    this.textFontSize = opts.textFontSize;
    this.textColor = opts.textColor;
    this.planeBaseHeight = opts.planeBaseHeight;
    this.container = containerElem;
    this.width = width;
    this.height = height;
    this.enableWaves = opts.enableWaves;

    this.camera = new THREE.PerspectiveCamera(
      45,
      this.width / this.height,
      1,
      1000,
    );
    this.camera.position.z = 30;

    this.scene = new THREE.Scene();
    this.mouse = { x: this.width / 2, y: this.height / 2 };
    this.onMouseMove = this.onMouseMove.bind(this);
  }

  async init(): Promise<void> {
    // ABC Favorit Mono is self-hosted via design-system.css's @font-face.
    // Wait for it to be ready so the rasterised text uses our font, not
    // the OS fallback.
    try {
      await document.fonts.ready;
    } catch {
      /* ignore — fall back to whatever the browser has */
    }
    this.setMesh();
    this.setRenderer();
  }

  setMesh(): void {
    this.textCanvas = new CanvasTxt(this.textString, {
      fontSize: this.textFontSize,
      fontFamily: "ABC Favorit Mono, monospace",
      color: this.textColor,
    });
    this.textCanvas.resize();
    this.textCanvas.render();

    this.texture = new THREE.CanvasTexture(this.textCanvas.texture);
    this.texture.minFilter = THREE.NearestFilter;

    const textAspect = this.textCanvas.width / this.textCanvas.height;
    const baseH = this.planeBaseHeight;
    const planeW = baseH * textAspect;
    const planeH = baseH;

    this.geometry = new THREE.PlaneGeometry(planeW, planeH, 36, 36);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uTexture: { value: this.texture },
        uEnableWaves: { value: this.enableWaves ? 1.0 : 0.0 },
      },
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);
  }

  setRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);

    this.filter = new AsciiFilter(this.renderer, {
      fontFamily: "ABC Favorit Mono, monospace",
      fontSize: this.asciiFontSize,
      invert: true,
    });

    this.container.appendChild(this.filter.domElement);
    this.setSize(this.width, this.height);

    this.container.addEventListener("mousemove", this.onMouseMove);
    this.container.addEventListener("touchmove", this.onMouseMove);
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.filter?.setSize(w, h);
    this.center = { x: w / 2, y: h / 2 };
  }

  load(): void {
    this.animate();
  }

  onMouseMove(evt: MouseEvent | TouchEvent): void {
    const e = (evt as TouchEvent).touches?.[0]
      ? (evt as TouchEvent).touches[0]
      : (evt as MouseEvent);
    const bounds = this.container.getBoundingClientRect();
    const x = (e as MouseEvent).clientX - bounds.left;
    const y = (e as MouseEvent).clientY - bounds.top;
    this.mouse = { x, y };
  }

  animate(): void {
    const animateFrame = () => {
      this.animationFrameId = requestAnimationFrame(animateFrame);
      this.render();
    };
    animateFrame();
  }

  render(): void {
    const time = new Date().getTime() * 0.001;

    this.textCanvas?.render();
    if (this.texture) this.texture.needsUpdate = true;

    if (this.mesh && this.material) {
      (this.material.uniforms.uTime as { value: number }).value = Math.sin(time);
    }

    this.updateRotation();
    if (this.filter) {
      this.filter.render(this.scene, this.camera);
    }
  }

  updateRotation(): void {
    if (!this.mesh) return;
    const x = mapRange(this.mouse.y, 0, this.height, 0.5, -0.5);
    const y = mapRange(this.mouse.x, 0, this.width, -0.5, 0.5);
    this.mesh.rotation.x += (x - this.mesh.rotation.x) * 0.05;
    this.mesh.rotation.y += (y - this.mesh.rotation.y) * 0.05;
  }

  clear(): void {
    this.scene.traverse((obj) => {
      const o = obj as THREE.Mesh;
      if ((obj as THREE.Mesh).isMesh && typeof o.material === "object" && o.material !== null) {
        const mat = o.material as THREE.ShaderMaterial;
        for (const key of Object.keys(mat)) {
          const matProp = (mat as unknown as Record<string, unknown>)[key];
          if (
            matProp !== null &&
            typeof matProp === "object" &&
            "dispose" in (matProp as object) &&
            typeof (matProp as { dispose?: unknown }).dispose === "function"
          ) {
            (matProp as { dispose: () => void }).dispose();
          }
        }
        mat.dispose();
        o.geometry.dispose();
      }
    });
    this.scene.clear();
  }

  dispose(): void {
    if (this.animationFrameId != null) cancelAnimationFrame(this.animationFrameId);
    if (this.filter) {
      this.filter.dispose();
      if (this.filter.domElement.parentNode) {
        this.container.removeChild(this.filter.domElement);
      }
    }
    this.container.removeEventListener("mousemove", this.onMouseMove);
    this.container.removeEventListener("touchmove", this.onMouseMove);
    this.clear();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
  }
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export type ASCIITextProps = {
  text?: string;
  asciiFontSize?: number;
  textFontSize?: number;
  /** Source canvas text colour. Anything bright reads cleanly through
   * the ASCII grid; we default to ivory so the gradient overlay below
   * has the most range. */
  textColor?: string;
  planeBaseHeight?: number;
  enableWaves?: boolean;
};

export const ASCIIText: FC<ASCIITextProps> = ({
  text = "CAPTURED",
  asciiFontSize = 8,
  textFontSize = 200,
  textColor = "#fdf9f3",
  planeBaseHeight = 8,
  enableWaves = true,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const asciiRef = useRef<CanvAscii | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    let ro: ResizeObserver | null = null;

    const createAndInit = async (
      el: HTMLDivElement,
      w: number,
      h: number,
    ): Promise<CanvAscii> => {
      const instance = new CanvAscii(
        {
          text,
          asciiFontSize,
          textFontSize,
          textColor,
          planeBaseHeight,
          enableWaves,
        },
        el,
        w,
        h,
      );
      await instance.init();
      return instance;
    };

    const setup = async (): Promise<void> => {
      const { width, height } = container.getBoundingClientRect();

      if (width === 0 || height === 0) {
        observer = new IntersectionObserver(
          async ([entry]) => {
            if (cancelled) return;
            if (
              entry.isIntersecting &&
              entry.boundingClientRect.width > 0 &&
              entry.boundingClientRect.height > 0
            ) {
              const w = entry.boundingClientRect.width;
              const h = entry.boundingClientRect.height;
              observer?.disconnect();
              observer = null;
              if (!cancelled) {
                asciiRef.current = await createAndInit(container, w, h);
                if (!cancelled && asciiRef.current) asciiRef.current.load();
              }
            }
          },
          { threshold: 0.1 },
        );
        observer.observe(container);
        return;
      }

      asciiRef.current = await createAndInit(container, width, height);
      if (!cancelled && asciiRef.current) {
        asciiRef.current.load();
        ro = new ResizeObserver((entries) => {
          if (!entries[0] || !asciiRef.current) return;
          const w = entries[0].contentRect.width;
          const h = entries[0].contentRect.height;
          if (w > 0 && h > 0) asciiRef.current.setSize(w, h);
        });
        ro.observe(container);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      if (ro) ro.disconnect();
      if (asciiRef.current) {
        asciiRef.current.dispose();
        asciiRef.current = null;
      }
    };
  }, [
    text,
    asciiFontSize,
    textFontSize,
    textColor,
    planeBaseHeight,
    enableWaves,
  ]);

  return (
    <div
      ref={containerRef}
      className="liminal-ascii-text"
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
      }}
    >
      {/* Inline scoped styles — gradient uses LIMINAL palette tokens
          (pink → sky → mint → yellow). The mix-blend-mode: difference
          comes from the source pattern; lets the ASCII glyphs read
          across light and dark backdrops. */}
      <style>{`
        .liminal-ascii-text canvas {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          image-rendering: pixelated;
        }
        .liminal-ascii-text pre {
          margin: 0;
          user-select: none;
          padding: 0;
          line-height: 1em;
          text-align: left;
          position: absolute;
          left: 0;
          top: 0;
          background-image: radial-gradient(
            circle,
            #f9b2d7 0%,
            #cfecf3 40%,
            #daf9de 70%,
            #f6ffdc 100%
          );
          background-attachment: fixed;
          -webkit-text-fill-color: transparent;
          -webkit-background-clip: text;
          background-clip: text;
          z-index: 9;
          mix-blend-mode: difference;
        }
        :root[data-theme="dark"] .liminal-ascii-text pre {
          background-image: radial-gradient(
            circle,
            #f48cc4 0%,
            #cfecf3 35%,
            #daf9de 70%,
            #f6ffdc 100%
          );
          mix-blend-mode: screen;
        }
      `}</style>
    </div>
  );
};

export default ASCIIText;

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { VisualizerPalette } from '@shared/types'
import { useApp } from '../context'
import { Cover } from './common'

/** Frequency bands the visuals read, low to high. */
export const BINS = 48

/** Edge → middle → centre colours of each palette. */
export const PALETTES: Record<VisualizerPalette, [string, string, string]> = {
  sunset: ['#8957e5', '#db61a2', '#f85149'],
  purple: ['#6e40c9', '#a371f7', '#d2a8ff'],
  red: ['#b62324', '#f85149', '#ff9492'],
  green: ['#1a7f37', '#3fb950', '#7ee787']
}

/**
 * One shared analyser for every visual. It listens to what the PC plays
 * (system audio loopback — only analysed, never recorded) and falls back to a
 * calm synthetic pulse when capture isn't available (browser demo).
 */
class Analyser {
  readonly bins = new Float32Array(BINS)
  /** Smoothed bass energy, 0..1 */
  level = 0
  private users = 0
  private ctx: AudioContext | null = null
  private node: AnalyserNode | null = null
  private stream: MediaStream | null = null
  private raw = new Uint8Array(128)
  private starting = false
  private failedAt = 0
  private stopTimer: ReturnType<typeof setTimeout> | undefined
  private readonly subs = new Set<(a: Analyser) => void>()
  private raf = 0

  acquire(capture: boolean): () => void {
    this.users++
    clearTimeout(this.stopTimer)
    if (capture) void this.start()
    return () => {
      this.users--
      if (this.users <= 0) this.stopTimer = setTimeout(() => this.stop(), 4000)
    }
  }

  /** One animation loop for all visuals: update the spectrum, then let each draw. */
  subscribe(draw: (a: Analyser) => void): () => void {
    this.subs.add(draw)
    if (!this.raf) this.raf = requestAnimationFrame(this.loop)
    return () => {
      this.subs.delete(draw)
      if (!this.subs.size) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
      }
    }
  }

  private readonly loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    this.update(performance.now())
    for (const draw of this.subs) draw(this)
  }

  private async start(): Promise<void> {
    if (this.node || this.starting || Date.now() - this.failedAt < 30_000) return
    this.starting = true
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: { max: 16 }, height: { max: 16 }, frameRate: { max: 1 } }
      })
      for (const v of stream.getVideoTracks()) v.enabled = false
      if (!stream.getAudioTracks().length) {
        for (const t of stream.getTracks()) t.stop()
        throw new Error('no system audio')
      }
      const ctx = new AudioContext()
      const node = ctx.createAnalyser()
      node.fftSize = 256
      node.smoothingTimeConstant = 0.72
      ctx.createMediaStreamSource(stream).connect(node)
      this.ctx = ctx
      this.node = node
      this.stream = stream
      this.raw = new Uint8Array(node.frequencyBinCount)
      if (this.users <= 0) this.stop()
    } catch {
      this.failedAt = Date.now()
    } finally {
      this.starting = false
    }
  }

  private stop(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.node = null
    this.stream = null
  }

  private update(now: number): void {
    if (this.node) {
      this.node.getByteFrequencyData(this.raw)
      const n = this.raw.length * 0.85 // the top of the spectrum is mostly empty
      for (let i = 0; i < BINS; i++) {
        const a = Math.floor(n * Math.pow(i / BINS, 1.7))
        const b = Math.max(a + 1, Math.floor(n * Math.pow((i + 1) / BINS, 1.7)))
        let max = 0
        for (let j = a; j < b; j++) max = Math.max(max, this.raw[j])
        this.bins[i] = max / 255
      }
    } else {
      const beat = Math.pow(1 - (now % 520) / 520, 3)
      for (let i = 0; i < BINS; i++) {
        const fall = 1 - (i / BINS) * 0.6
        const wave = 0.45 + 0.25 * Math.sin(now / 380 + i * 0.55) * Math.sin(now / 910 + i * 0.21)
        const target = Math.max(0, wave * fall + beat * 0.35 * (1 - i / BINS))
        this.bins[i] += (target - this.bins[i]) * 0.2
      }
    }
    let bass = 0
    for (let i = 0; i < 6; i++) bass += this.bins[i]
    this.level += (bass / 6 - this.level) * 0.35
  }
}

export const analyser = new Analyser()

/** Runs `draw` every frame while `active` (music playing and the visualizer on). */
export function useVisualizer(active: boolean, draw: (a: Analyser) => void): void {
  const { meta } = useApp()
  const drawRef = useRef(draw)
  drawRef.current = draw
  const capture = !meta.demo
  useEffect(() => {
    if (!active) return
    const release = analyser.acquire(capture)
    const unsubscribe = analyser.subscribe((a) => drawRef.current(a))
    return () => {
      unsubscribe()
      release()
    }
  }, [active, capture])
}

/** The colours chosen in Settings → Music, kept in a ref for the drawing callbacks. */
function usePalette(): { colors: [string, string, string]; ref: { current: [string, string, string] } } {
  const { settings } = useApp()
  const colors = PALETTES[settings.visualizerPalette] ?? PALETTES.sunset
  const ref = useRef(colors)
  ref.current = colors
  return { colors, ref }
}

function fitCanvas(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number; dpr: number } | null {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(c.clientWidth * dpr)
  const h = Math.round(c.clientHeight * dpr)
  if (!w || !h) return null
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const g = c.getContext('2d')
  return g ? { g, w, h, dpr } : null
}

function clearCanvas(c: HTMLCanvasElement | null): void {
  c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
}

/** Band for the i-th of n bars laid out symmetrically: bass in the middle, highs at both edges. */
function centredBand(i: number, n: number): number {
  const half = (n - 1) / 2
  const k = Math.abs(i - half) / Math.max(1, half) // 0 in the centre → 1 at the edges
  return Math.min(BINS - 1, Math.floor(k * BINS * 0.92))
}

/** Four bars growing from their middle — the "now playing" icon in the header. */
export function Equalizer({ active }: { active: boolean }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)
  const { colors } = usePalette()
  const bands = [9, 1, 3, 14]
  useVisualizer(active, (a) => {
    Array.from(ref.current?.children ?? []).forEach((bar, i) => {
      ;(bar as HTMLElement).style.transform = `scaleY(${(0.2 + a.bins[bands[i]] * 0.8).toFixed(3)})`
    })
  })
  useEffect(() => {
    if (active) return
    for (const bar of Array.from(ref.current?.children ?? [])) (bar as HTMLElement).style.transform = 'scaleY(0.3)'
  }, [active])
  const barColors = [colors[0], colors[2], colors[2], colors[0]]
  return (
    <span ref={ref} className="eq" aria-hidden="true">
      {barColors.map((c, i) => (
        <span key={i} style={{ background: `linear-gradient(${colors[1]}, ${c})` }} />
      ))}
    </span>
  )
}

/** A symmetric spectrum: bars grow up and down from the middle line, bass in the centre. */
export function Spectrum({ active, bars = 32, className }: { active: boolean; bars?: number; className?: string }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const palette = usePalette().ref
  useEffect(() => {
    if (!active) clearCanvas(ref.current)
  }, [active])
  useVisualizer(active, (a) => {
    const fit = ref.current && fitCanvas(ref.current)
    if (!fit) return
    const { g, w, h, dpr } = fit
    const [edge, mid, centre] = palette.current
    g.clearRect(0, 0, w, h)
    const grad = g.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, edge)
    grad.addColorStop(0.25, mid)
    grad.addColorStop(0.5, centre)
    grad.addColorStop(0.75, mid)
    grad.addColorStop(1, edge)
    g.fillStyle = grad
    const gap = Math.max(1, 2 * dpr)
    const bw = (w - gap * (bars - 1)) / bars
    const cy = h / 2
    for (let i = 0; i < bars; i++) {
      const v = a.bins[centredBand(i, bars)]
      const bh = Math.max(2 * dpr, v * h)
      g.globalAlpha = 0.35 + v * 0.65
      g.beginPath()
      g.roundRect(i * (bw + gap), cy - bh / 2, bw, bh, Math.min(bw / 2, 3 * dpr))
      g.fill()
    }
    g.globalAlpha = 1
  })
  return <canvas ref={ref} className={className} aria-hidden="true" />
}

/** Makes its content breathe with the bass: a slight scale and a coloured glow. */
export function PulseArt({ active, children, className }: { active: boolean; children: ReactNode; className?: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const { colors } = usePalette()
  useVisualizer(active, (a) => ref.current?.style.setProperty('--pulse', a.level.toFixed(3)))
  useEffect(() => {
    if (!active) ref.current?.style.setProperty('--pulse', '0')
  }, [active])
  return (
    <div
      ref={ref}
      className={`pulse-art${className ? ` ${className}` : ''}`}
      style={{ '--viz-a': colors[1], '--viz-b': colors[0] } as CSSProperties}
    >
      {children}
    </div>
  )
}

/** Rays of the spectrum around a round cover — the big visual on the Music tab. */
export function RadialVisualizer({ active, cover, title, size = 200 }: { active: boolean; cover: string | null; title: string; size?: number }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const palette = usePalette().ref
  useEffect(() => {
    if (!active) clearCanvas(ref.current)
  }, [active])
  useVisualizer(active, (a) => {
    const fit = ref.current && fitCanvas(ref.current)
    if (!fit) return
    const { g, w, h, dpr } = fit
    const [edge, mid, centre] = palette.current
    g.clearRect(0, 0, w, h)
    const cx = w / 2
    const cy = h / 2
    const r0 = Math.min(w, h) * 0.34
    const maxLen = Math.min(w, h) * 0.15
    const rays = 72
    const grad = g.createConicGradient(-Math.PI / 2, cx, cy)
    grad.addColorStop(0, centre)
    grad.addColorStop(0.25, mid)
    grad.addColorStop(0.5, edge)
    grad.addColorStop(0.75, mid)
    grad.addColorStop(1, centre)
    g.strokeStyle = grad
    g.lineCap = 'round'
    g.lineWidth = Math.max(2, ((2 * Math.PI * r0) / rays) * 0.42)
    for (let i = 0; i < rays; i++) {
      // mirrored left/right so the picture stays symmetric
      const k = i < rays / 2 ? i : rays - 1 - i
      const v = a.bins[Math.min(BINS - 1, Math.floor((k * BINS) / (rays / 2)))]
      const angle = (i / rays) * Math.PI * 2 - Math.PI / 2
      const len = 3 * dpr + v * maxLen
      g.globalAlpha = 0.35 + v * 0.65
      g.beginPath()
      g.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0)
      g.lineTo(cx + Math.cos(angle) * (r0 + len), cy + Math.sin(angle) * (r0 + len))
      g.stroke()
    }
    g.globalAlpha = 0.25 + a.level * 0.6
    g.lineWidth = 2 * dpr
    g.beginPath()
    g.arc(cx, cy, r0 - 5 * dpr, 0, Math.PI * 2)
    g.stroke()
    g.globalAlpha = 1
  })
  const art = Math.round(size * 0.6)
  return (
    <div className="radial-viz" style={{ width: size, height: size }}>
      <canvas ref={ref} aria-hidden="true" />
      <PulseArt active={active} className="radial-art">
        <Cover src={cover} title={title} width={art} height={art} />
      </PulseArt>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { VOICE_ORB_FRAGMENT_SHADER, VOICE_ORB_VERTEX_SHADER } from './voice-orb-shader'

type VoiceOrbProps = {
  /** Pixel size of the square orb. */
  size: number
  /** Returns the current mic level, 0..1. Polled once per frame so the orb
   *  reacts to speech without re-rendering React at frame rate. */
  getLevel: () => number
  className?: string
}

const BASE_ROTATION_SPEED = 0.3
const MAX_ROTATION_SPEED = 1.2
const MAX_HOVER_INTENSITY = 0.8

// Asymmetric smoothing, the way an audio meter behaves: rise quickly enough to
// feel responsive to a syllable, fall slowly so pauses between words glide
// instead of snapping back. Seconds to close ~63% of the gap.
const LEVEL_ATTACK_SECONDS = 0.06
const LEVEL_RELEASE_SECONDS = 0.4

// Idle "breath": with no voice the shader's displacement drops to zero and the
// ring goes glassy and inert. Keep a small floor that swells and settles on a
// slow cycle, well under speech level, so silence reads as alive rather than
// frozen. Period ~10s — slow enough that it's felt more than seen.
const IDLE_HOVER_MIN = 0.06
const IDLE_HOVER_MAX = 0.2
const IDLE_BREATH_RATE = 0.0006

/** Frame-rate independent approach toward `target`. */
function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Voice orb shader failed to compile:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function linkProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VOICE_ORB_VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, VOICE_ORB_FRAGMENT_SHADER)
  if (!vertex || !fragment) {
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Voice orb program failed to link:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

export function VoiceOrb({ size, getLevel, className }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const getLevelRef = useRef(getLevel)
  getLevelRef.current = getLevel

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    // The shader outputs premultiplied color (rgb * a), so the context and the
    // blend func must both be premultiplied — straight-alpha blending would
    // multiply a second time and flatten the orb's glow.
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true
    })
    if (!gl) {
      return
    }

    const program = linkProgram(gl)
    if (!program) {
      return
    }

    // Single oversized triangle covering the viewport — cheaper than a quad and
    // avoids the diagonal seam two triangles produce.
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const positionLocation = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    gl.useProgram(program)
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const uniforms = {
      iTime: gl.getUniformLocation(program, 'iTime'),
      iResolution: gl.getUniformLocation(program, 'iResolution'),
      hue: gl.getUniformLocation(program, 'hue'),
      hover: gl.getUniformLocation(program, 'hover'),
      rot: gl.getUniformLocation(program, 'rot'),
      hoverIntensity: gl.getUniformLocation(program, 'hoverIntensity')
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform3f(uniforms.iResolution, canvas.width, canvas.height, 1)
    gl.uniform1f(uniforms.hue, 0)

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    let frame = 0
    let lastTime = 0
    let rotation = 0
    let smoothedLevel = 0

    const draw = (time: number) => {
      // Clamp dt: a backgrounded tab can hand back a multi-second gap, which
      // would snap the smoothing and jump the rotation.
      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) * 0.001, 0.1)
      lastTime = time

      const rawLevel = Math.max(0, Math.min(1, getLevelRef.current()))
      smoothedLevel = approach(
        smoothedLevel,
        rawLevel,
        dt,
        rawLevel > smoothedLevel ? LEVEL_ATTACK_SECONDS : LEVEL_RELEASE_SECONDS
      )

      // Always rotating. Gating rotation on a level threshold made the orb
      // freeze dead in the pauses between words.
      rotation += dt * (BASE_ROTATION_SPEED + smoothedLevel * MAX_ROTATION_SPEED * 2)

      // Speech overrides the breath rather than adding to it, so the idle floor
      // can never inflate how loud you look.
      const breath = 0.5 + 0.5 * Math.sin(time * IDLE_BREATH_RATE)
      const idleFloor = IDLE_HOVER_MIN + (IDLE_HOVER_MAX - IDLE_HOVER_MIN) * breath
      const activity = Math.max(smoothedLevel, idleFloor)

      gl.uniform1f(uniforms.iTime, time * 0.001)
      gl.uniform1f(uniforms.rot, rotation)
      gl.uniform1f(uniforms.hover, Math.min(activity * 2, 1))
      gl.uniform1f(
        uniforms.hoverIntensity,
        Math.min(activity * MAX_HOVER_INTENSITY * 0.8, MAX_HOVER_INTENSITY)
      )
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (!reducedMotion) {
        frame = requestAnimationFrame(draw)
      }
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size }}
    />
  )
}

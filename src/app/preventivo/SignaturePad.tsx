'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

export type SignaturePadHandle = {
  clear: () => void
  isEmpty: () => boolean
  toDataUrl: () => string | null
}

type SignaturePadProps = {
  onChange?: (hasInk: boolean) => void
  disabled?: boolean
}

/**
 * Riquadro per firmare col dito o col mouse. Pointer events (tocco, penna e
 * mouse con lo stesso codice) e `touch-action: none` perche' su tablet il
 * trascinamento non scorra la pagina invece di disegnare.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { onChange, disabled = false },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const inkRef = useRef(0)
  const [hasInk, setHasInk] = useState(false)

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Risoluzione interna legata al display, ma al massimo 2x: il PNG deve restare leggero.
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = 2.4
    context.strokeStyle = '#0f172a'
    inkRef.current = 0
    setHasInk(false)
    onChange?.(false)
  }, [onChange])

  useEffect(() => {
    setupCanvas()
  }, [setupCanvas])

  useImperativeHandle(
    ref,
    () => ({
      clear: setupCanvas,
      isEmpty: () => inkRef.current < 12,
      toDataUrl: () => (canvasRef.current && inkRef.current >= 12 ? canvasRef.current.toDataURL('image/png') : null),
    }),
    [setupCanvas]
  )

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    last.current = point(event)
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return
    const context = canvasRef.current?.getContext('2d')
    const from = last.current
    if (!context || !from) return
    const to = point(event)
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
    last.current = to
    inkRef.current += Math.hypot(to.x - from.x, to.y - from.y)
    if (!hasInk && inkRef.current >= 12) {
      setHasInk(true)
      onChange?.(true)
    }
  }

  function onPointerUp() {
    drawing.current = false
    last.current = null
  }

  return (
    <div className={`signature-pad${disabled ? ' is-disabled' : ''}`}>
      <canvas
        ref={canvasRef}
        className="signature-pad-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        aria-label="Riquadro firma"
        role="img"
      />
      {!hasInk && <span className="signature-pad-hint">Firma qui</span>}
      <button type="button" className="signature-pad-clear" onClick={setupCanvas} disabled={disabled || !hasInk}>
        Cancella
      </button>
    </div>
  )
})

'use client'

import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  onHide: () => void
}

export function Toast({ message, onHide }: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (message) {
      setVisible(true)
      const timer = setTimeout(() => {
        setVisible(false)
        setTimeout(onHide, 300)
      }, 2800)
      return () => clearTimeout(timer)
    }
  }, [message, onHide])

  if (!message) return null

  return (
    <div className={`toast ${visible ? 'show' : ''}`}>
      ✓ {message}
    </div>
  )
}

// Global toast manager hook
import { useCallback, useRef } from 'react'

export function useToast() {
  const [message, setMessage] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setMessage(msg)
    timerRef.current = setTimeout(() => setMessage(''), 3500)
  }, [])

  const hideToast = useCallback(() => setMessage(''), [])

  return { message, showToast, hideToast }
}

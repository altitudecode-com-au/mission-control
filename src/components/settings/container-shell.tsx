'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Container Shell — an embedded interactive terminal for the Mission Control container.
 * Uses the existing PTY WebSocket at /ws/pty with kind=shell.
 * Useful for running agent auth commands (claude login, codex auth, kiro-cli login).
 */
export function ContainerShell() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<any>(null)
  const [open, setOpen] = useState(false)
  const [connected, setConnected] = useState(false)

  const sessionId = useRef(`shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).current

  const connect = useCallback(async () => {
    if (!containerRef.current) return

    // Load xterm.js dynamically
    const [xtermModule, fitModule, webLinksModule] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-web-links'),
    ])

    const Terminal = xtermModule.Terminal
    const FitAddon = fitModule.FitAddon
    const WebLinksAddon = webLinksModule.WebLinksAddon

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term
    fitAddonRef.current = fitAddon

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/pty?session=${encodeURIComponent(sessionId)}&kind=shell&mode=interactive`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      // Send initial resize
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'output') {
          term.write(msg.data)
        } else if (msg.type === 'exit') {
          term.write('\r\n\x1b[90m[shell exited]\x1b[0m\r\n')
          setConnected(false)
        }
      } catch {
        // Binary or non-JSON data — write raw
        term.write(event.data)
      }
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onerror = () => {
      term.write('\r\n\x1b[31m[connection error]\x1b[0m\r\n')
      setConnected(false)
    }

    // Forward terminal input to WebSocket
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      ws.close()
      term.dispose()
    }
  }, [sessionId])

  useEffect(() => {
    if (open) {
      const cleanup = connect()
      return () => { cleanup?.then(fn => fn?.()) }
    } else {
      // Cleanup on close
      wsRef.current?.close()
      termRef.current?.dispose()
      termRef.current = null
      wsRef.current = null
      setConnected(false)
    }
  }, [open, connect])

  if (!open) {
    return (
      <div className="p-4 border border-border/30 rounded-lg bg-secondary/10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Container Shell</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Open an interactive terminal to run auth commands (claude login, codex auth, kiro-cli login)
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Open Terminal
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/20 border-b border-border/20">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-muted-foreground">Container Shell</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-6 px-2 text-xs">
          Close
        </Button>
      </div>
      <div
        ref={containerRef}
        className="h-[300px] bg-[#0d1117]"
        style={{ padding: '4px' }}
      />
    </div>
  )
}

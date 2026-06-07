#!/usr/bin/env node

/**
 * WebSocket-enabled wrapper for Next.js standalone server.
 *
 * Next.js standalone mode's server.js doesn't support WebSocket upgrades.
 * This wrapper monkey-patches http.createServer to intercept upgrade requests
 * for /ws/pty and route them to a PTY WebSocket handler using node-pty + ws.
 */

const http = require('http')
const path = require('path')

// Monkey-patch http.createServer to capture the server instance
const originalCreateServer = http.createServer
let patchApplied = false

http.createServer = function (...args) {
  const server = originalCreateServer.apply(this, args)

  if (!patchApplied) {
    patchApplied = true
    let wss = null
    let pty = null

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

      if (url.pathname !== '/ws/pty') {
        socket.destroy()
        return
      }

      // Validate query params
      const sessionId = url.searchParams.get('session') || ''
      const kind = url.searchParams.get('kind') || ''
      const mode = url.searchParams.get('mode') || ''

      if (!sessionId || !['claude-code', 'codex-cli', 'shell'].includes(kind)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }

      // Authenticate via session cookie
      const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
        const [k, ...v] = c.trim().split('=')
        if (k) acc[k] = v.join('=')
        return acc
      }, {})
      const hasSession = cookies['mc-session'] || cookies['mission-control-session']
      if (!hasSession) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      // Lazy-init WebSocket server
      if (!wss) {
        try {
          const WebSocket = require('ws')
          wss = new WebSocket.Server({ noServer: true })

          wss.on('connection', (ws, upgradeReq) => {
            const connUrl = new URL(upgradeReq.url || '/', `http://${upgradeReq.headers.host || 'localhost'}`)
            const connKind = connUrl.searchParams.get('kind') || 'shell'

            // Spawn PTY
            try {
              const nodePty = require('node-pty')
              const spawn = nodePty.spawn || nodePty.default?.spawn
              if (!spawn) throw new Error('node-pty spawn not available')

              const shell = connKind === 'shell'
                ? (process.env.SHELL || '/bin/sh')
                : 'tmux'
              const shellArgs = connKind === 'shell' ? [] : ['attach-session', '-t', connUrl.searchParams.get('session')]

              const ptyProcess = spawn(shell, shellArgs, {
                name: 'xterm-256color',
                cols: 120,
                rows: 30,
                cwd: process.env.HOME || '/app',
                env: { ...process.env, TERM: 'xterm-256color' },
              })

              ptyProcess.onData((data) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'output', data }))
                }
              })

              ptyProcess.onExit(({ exitCode }) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'exit', code: exitCode }))
                  ws.close()
                }
              })

              ws.on('message', (raw) => {
                try {
                  const msg = JSON.parse(raw.toString())
                  if (msg.type === 'input' && msg.data) {
                    ptyProcess.write(msg.data)
                  } else if (msg.type === 'resize' && msg.cols && msg.rows) {
                    ptyProcess.resize(msg.cols, msg.rows)
                  }
                } catch {
                  // ignore malformed messages
                }
              })

              ws.on('close', () => {
                try { ptyProcess.kill() } catch {}
              })

              console.log(`[ws-server] PTY session started: kind=${connKind}, shell=${shell}`)
            } catch (err) {
              console.error('[ws-server] Failed to spawn PTY:', err.message)
              ws.send(JSON.stringify({ type: 'output', data: `\r\nError: ${err.message}\r\n` }))
              ws.close()
            }
          })
        } catch (err) {
          console.error('[ws-server] Failed to init WebSocket server:', err.message)
          socket.destroy()
          return
        }
      }

      // Upgrade the connection
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    })

    console.log('[ws-server] WebSocket upgrade handler registered for /ws/pty')
  }

  return server
}

// Now load and run the Next.js standalone server
require('./server.js')

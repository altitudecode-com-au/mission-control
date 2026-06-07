import { existsSync } from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { detectAllRuntimes, detectRuntime, startInstall, getInstallJob, getActiveJobs, generateDockerSidecar, detectBinaryPath } from '@/lib/agent-runtimes'
import type { RuntimeId, DeploymentMode } from '@/lib/agent-runtimes'
import { clearHermesDetectionCache } from '@/lib/hermes-sessions'
import { logAuditEvent } from '@/lib/db'
import { logger } from '@/lib/logger'

const VALID_RUNTIMES = new Set<RuntimeId>(['openclaw', 'hermes', 'claude', 'codex', 'opencode', 'kiro'])
const VALID_MODES = new Set<DeploymentMode>(['local', 'docker'])

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Clear caches so freshly-installed runtimes are detected immediately
  clearHermesDetectionCache()
  const runtimes = detectAllRuntimes()
  const activeJobs = getActiveJobs()
  const isDocker = existsSync('/.dockerenv')

  return NextResponse.json({ runtimes, activeJobs, isDocker })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action } = body

  if (action === 'install') {
    const runtime = body.runtime as RuntimeId
    const mode = (body.mode || 'local') as DeploymentMode
    if (!runtime || !VALID_RUNTIMES.has(runtime)) {
      return NextResponse.json({ error: 'Invalid runtime. Use: openclaw, hermes, claude, codex, opencode, kiro' }, { status: 400 })
    }
    if (!VALID_MODES.has(mode)) {
      return NextResponse.json({ error: 'Invalid mode. Use: local, docker' }, { status: 400 })
    }

    logger.info({ runtime, mode, actor: auth.user.username }, 'Starting agent runtime install')
    logAuditEvent({
      action: 'agent_runtime.install',
      actor: auth.user.username,
      detail: JSON.stringify({ runtime, mode }),
    })

    const job = startInstall(runtime, mode)
    return NextResponse.json({ jobId: job.id, job })
  }

  if (action === 'job-status') {
    const { jobId } = body
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })
    const job = getInstallJob(jobId)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json({ job })
  }

  if (action === 'docker-compose') {
    const runtime = body.runtime as RuntimeId
    if (!runtime || !VALID_RUNTIMES.has(runtime)) {
      return NextResponse.json({ error: 'Invalid runtime' }, { status: 400 })
    }
    return NextResponse.json({ yaml: generateDockerSidecar(runtime) })
  }

  if (action === 'detect') {
    const runtime = body.runtime as RuntimeId
    if (!runtime || !VALID_RUNTIMES.has(runtime)) {
      return NextResponse.json({ error: 'Invalid runtime' }, { status: 400 })
    }
    const status = detectRuntime(runtime)
    return NextResponse.json({ status })
  }

  if (action === 'login') {
    const runtime = body.runtime as RuntimeId
    if (runtime !== 'claude' && runtime !== 'codex' && runtime !== 'kiro') {
      return NextResponse.json({ error: 'Login action only supported for claude, codex, and kiro' }, { status: 400 })
    }

    const loginCommands: Record<string, { bin: string; args: string[]; stdin?: string }> = {
      claude: { bin: 'claude', args: [], stdin: '/login\n' },
      codex: { bin: 'codex', args: ['auth'] },
      kiro: { bin: 'kiro-cli', args: ['login'] },
    }

    const { bin: binName, args, stdin: stdinData } = loginCommands[runtime]
    const bin = detectBinaryPath(binName)
    if (!bin) {
      return NextResponse.json({ error: `${binName} binary not found` }, { status: 404 })
    }

    try {
      const { spawn } = require('node:child_process')

      // Spawn the login process asynchronously — it will stay alive waiting for OAuth
      const child = spawn(bin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', DISPLAY: '', BROWSER: 'echo', TERM: 'dumb' },
        detached: true,
      })

      // Send stdin command if needed (e.g. /login for claude REPL)
      if (stdinData) {
        child.stdin?.write(stdinData)
      }

      // Collect output for up to 10s to capture the device URL
      let output = ''
      const outputPromise = new Promise<string>((resolve) => {
        const timeout = setTimeout(() => resolve(output), 10_000)

        const onData = (chunk: Buffer) => {
          output += chunk.toString()
          // If we see a URL, resolve early — no need to wait full 10s
          if (output.match(/https:\/\/[^\s]+/)) {
            clearTimeout(timeout)
            resolve(output)
          }
        }

        child.stdout?.on('data', onData)
        child.stderr?.on('data', onData)
        child.on('close', () => { clearTimeout(timeout); resolve(output) })
      })

      // Don't hold up the parent process
      child.unref()

      const collectedOutput = await outputPromise

      // Extract the device code URL from output
      const urlMatch = collectedOutput.match(/https:\/\/[^\s]+/)
      const url = urlMatch ? urlMatch[0] : null

      return NextResponse.json({
        success: !!url,
        output: collectedOutput,
        deviceUrl: url,
        message: url
          ? 'Open the link to authenticate. The login process is running in the background and will complete once you authorize.'
          : 'Login process started but no device URL was found. Try running the command manually via SSH/SSM.',
      })
    } catch (err: any) {
      logger.error({ err, runtime }, 'Runtime login command failed')
      return NextResponse.json({ error: err?.message || 'Login command failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

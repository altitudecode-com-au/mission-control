import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { getDatabase } from '@/lib/db'

function verifySignature(secret: string, rawBody: string, sigHeader: string | null): boolean {
  if (!sigHeader) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const sig     = request.headers.get('x-hub-signature-256')
  const event   = request.headers.get('x-github-event')

  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!secret) {
    console.error('GITHUB_APP_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  if (!verifySignature(secret, rawBody, sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Only act on issue events
  if (event !== 'issues') {
    return NextResponse.json({ ok: true, skipped: 'not an issue event' })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action, issue, repository } = payload

  // Only act on open/labelled/reopened issues that have the agent-pickup label
  if (!['opened', 'labeled', 'reopened'].includes(action)) {
    return NextResponse.json({ ok: true, skipped: `action=${action}` })
  }

  const labels: string[] = (issue.labels ?? []).map((l: any) => l.name)
  if (!labels.includes('agent-pickup')) {
    return NextResponse.json({ ok: true, skipped: 'no agent-pickup label' })
  }

  // Write a task into Mission Control's existing tasks table
  const db = getDatabase()

  // Check if a task for this issue already exists (avoid duplicates on re-label)
  const existing = db.prepare(`
    SELECT id FROM tasks
    WHERE JSON_EXTRACT(metadata, '$.github_issue_number') = ?
    AND   JSON_EXTRACT(metadata, '$.github_repo') = ?
    LIMIT 1
  `).get(issue.number, repository.full_name)

  if (existing) {
    return NextResponse.json({ ok: true, skipped: 'task already exists' })
  }

  const now = Math.floor(Date.now() / 1000)
  const metadata = JSON.stringify({
    github_repo:         repository.full_name,
    github_issue_number: issue.number,
    github_issue_url:    issue.html_url,
    github_state:        issue.state,
    github_synced_at:    new Date().toISOString(),
    agent:               'kiro',
  })

  db.prepare(`
    INSERT INTO tasks (title, description, status, priority, created_at, updated_at, metadata)
    VALUES (?, ?, 'pending', 'medium', ?, ?, ?)
  `).run(
    issue.title,
    issue.body ?? '',
    now,
    now,
    metadata
  )

  // Dispatch to Kiro if API key is available
  const kiroKey = process.env.KIRO_API_KEY
  if (kiroKey) {
    try {
      await fetch('https://api.kiro.aws/v1/tasks', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${kiroKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          title:       issue.title,
          description: issue.body ?? '',
          context: {
            source:       'github-issue',
            repo:         repository.full_name,
            issue_number: issue.number,
            issue_url:    issue.html_url,
          },
        }),
      })
    } catch (err) {
      // Don't fail the webhook if Kiro is unreachable — task is already saved
      console.error('Kiro dispatch failed:', err)
    }
  }

  return NextResponse.json({ ok: true, queued: true })
}
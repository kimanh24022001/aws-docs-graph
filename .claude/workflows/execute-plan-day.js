export const meta = {
  name: 'execute-plan-day',
  description: 'Execute one day of the aws-docs-graph implementation plan with parallel tasks where possible',
  whenToUse: 'Run with args: { day: "day3", planFile: "docs/superpowers/plans/2026-06-12-week1-day3-terraform.md", parallelTasks: ["Task 1", "Task 2"] }',
  phases: [
    { title: 'Parse', detail: 'Read plan file and extract tasks' },
    { title: 'Execute', detail: 'Run independent tasks in parallel, sequential tasks in order' },
    { title: 'Review', detail: 'Spec compliance + code quality review per task' },
    { title: 'Verify', detail: 'Run gate checks for the day' },
    { title: 'Summary', detail: 'List all commits and files changed today' },
  ],
}

// ─── Args shape ───────────────────────────────────────────────────────────────
// args.day         — label e.g. "Day 3"
// args.planFile    — path to the plan markdown file
// args.parallelTasks — optional array of task names that can run in parallel
//                     e.g. ["Task 1: ECR module", "Task 2: Lambda module"]
//                     tasks NOT listed here run sequentially
// args.skipTasks   — optional array of task names to skip (e.g. manual steps)
// ─────────────────────────────────────────────────────────────────────────────

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name:        { type: 'string' },
          description: { type: 'string' },
          steps:       { type: 'array', items: { type: 'string' } },
          isManual:    { type: 'boolean' },
        },
        required: ['name', 'description', 'steps', 'isManual'],
      },
    },
    gateChecks: { type: 'array', items: { type: 'string' } },
  },
  required: ['tasks', 'gateChecks'],
}

const IMPL_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status:       { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    summary:      { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    concerns:     { type: 'string' },
  },
  required: ['status', 'summary', 'filesChanged'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    compliant: { type: 'boolean' },
    issues:    { type: 'array', items: { type: 'string' } },
  },
  required: ['compliant', 'issues'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    results: { type: 'array', items: { type: 'object', properties: { check: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } }, required: ['check', 'passed', 'detail'] } },
  },
  required: ['passed', 'results'],
}

// ── Phase 1: Parse plan ───────────────────────────────────────────────────────
phase('Parse')

const planFile    = args.planFile
const dayLabel    = args.day || 'Day'
const parallelSet = new Set(args.parallelTasks || [])
const skipSet     = new Set(args.skipTasks || [])

log(`Parsing plan: ${planFile}`)

const parsed = await agent(
  `Read the implementation plan at ${planFile} and extract all tasks.
   For each task return: name (e.g. "Task 1: Docker Compose"), description (1-2 sentences),
   steps (array of step descriptions), and isManual (true if the task requires browser/console
   actions that cannot be automated).
   Also extract the gate checks listed at the end of the plan.
   Working directory: /Users/I753472/Documents/development/aws-docs-graph`,
  { label: 'parse-plan', schema: TASK_SCHEMA }
)

const allTasks    = parsed.tasks.filter(t => !skipSet.has(t.name))
const manualTasks = allTasks.filter(t => t.isManual)
const autoTasks   = allTasks.filter(t => !t.isManual)

if (manualTasks.length > 0) {
  log(`⚠️  Skipping ${manualTasks.length} manual task(s): ${manualTasks.map(t => t.name).join(', ')}`)
}

log(`Found ${autoTasks.length} automated tasks, ${parsed.gateChecks.length} gate checks`)

// ── Phase 2: Execute ──────────────────────────────────────────────────────────
phase('Execute')

// Split into parallel bucket and sequential list
const parallelBucket = autoTasks.filter(t => parallelSet.has(t.name))
const sequentialList = autoTasks.filter(t => !parallelSet.has(t.name))

const implementTask = async (task) => {
  log(`▶ Implementing: ${task.name}`)

  const result = await agent(
    `You are implementing ${task.name} for the aws-docs-graph project.

## Task
${task.description}

## Steps
${task.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Context
- Working directory: /Users/I753472/Documents/development/aws-docs-graph
- This is part of ${dayLabel} of the implementation plan at ${planFile}
- Follow TDD where applicable: write failing test → implement → verify pass → commit
- Use exact file paths from the plan
- Commit your work when done

## Report back with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Summary of what was implemented
- Files changed
- Any concerns`,
    { label: `impl:${task.name}`, schema: IMPL_RESULT_SCHEMA }
  )

  return { task, result }
}

// Run parallel tasks concurrently
let parallelResults = []
if (parallelBucket.length > 0) {
  log(`Running ${parallelBucket.length} tasks in parallel: ${parallelBucket.map(t => t.name).join(', ')}`)
  parallelResults = await parallel(parallelBucket.map(t => () => implementTask(t)))
}

// Run sequential tasks one by one
const sequentialResults = []
for (const task of sequentialList) {
  const r = await implementTask(task)
  sequentialResults.push(r)
}

const allResults = [...parallelResults, ...sequentialResults].filter(Boolean)

// ── Phase 3: Review ───────────────────────────────────────────────────────────
phase('Review')

const reviewedResults = await pipeline(
  allResults,
  // Spec compliance review
  async ({ task, result }) => {
    if (result.status === 'BLOCKED' || result.status === 'NEEDS_CONTEXT') {
      log(`⛔ Skipping review for blocked task: ${task.name}`)
      return { task, result, specReview: { compliant: false, issues: [`Task ${result.status}`] } }
    }

    log(`🔍 Spec review: ${task.name}`)
    const specReview = await agent(
      `Review whether the implementation of "${task.name}" matches its specification.

## Specification
${task.description}

Steps that were required:
${task.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## What was implemented
${result.summary}
Files changed: ${result.filesChanged.join(', ')}

## Your job
Read the actual files and verify the implementation matches the spec.
Return compliant: true only if everything was built correctly.
List any missing, extra, or misimplemented items as issues.
Working directory: /Users/I753472/Documents/development/aws-docs-graph`,
      { label: `spec-review:${task.name}`, schema: REVIEW_SCHEMA }
    )
    return { task, result, specReview }
  },
  // Code quality review (only if spec compliant)
  async ({ task, result, specReview }) => {
    if (!specReview.compliant) {
      log(`❌ Spec issues in ${task.name}: ${specReview.issues.join('; ')}`)
      return { task, result, specReview, qualityApproved: false }
    }

    log(`✨ Quality review: ${task.name}`)
    const qualityResult = await agent(
      `Review code quality for the implementation of "${task.name}" in the aws-docs-graph project.

Files changed: ${result.filesChanged.join(', ')}

Check:
- Each file has one clear responsibility
- Code is clean and follows existing patterns
- No unnecessary complexity (YAGNI)
- Tests verify behaviour (not just mock behaviour)
- No secrets or sensitive data in files

Working directory: /Users/I753472/Documents/development/aws-docs-graph

Return compliant: true if quality is acceptable. List any Critical/Important issues.`,
      { label: `quality:${task.name}`, schema: REVIEW_SCHEMA }
    )
    return { task, result, specReview, qualityApproved: qualityResult.compliant, qualityIssues: qualityResult.issues }
  }
)

// ── Phase 4: Verify gate ──────────────────────────────────────────────────────
phase('Verify')

log(`Running ${dayLabel} gate checks...`)

const gateResult = await agent(
  `Run the gate checks for ${dayLabel} of the aws-docs-graph implementation plan.

Gate checks to verify:
${parsed.gateChecks.map((c, i) => `${i + 1}. ${c}`).join('\n')}

For each check, actually run the necessary commands or read files to confirm it passes.
Working directory: /Users/I753472/Documents/development/aws-docs-graph`,
  { label: 'gate-check', schema: GATE_SCHEMA }
)

// ── Phase 5: Changed files ────────────────────────────────────────────────────
phase('Summary')

const GIT_SCHEMA = {
  type: 'object',
  properties: {
    commits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sha:     { type: 'string' },
          message: { type: 'string' },
          files:   { type: 'array', items: { type: 'string' } },
        },
        required: ['sha', 'message', 'files'],
      },
    },
    totalFilesChanged: { type: 'number' },
  },
  required: ['commits', 'totalFilesChanged'],
}

const gitSummary = await agent(
  `Run git log to find all commits made today for the aws-docs-graph project,
   and for each commit list the files changed.

   Commands to run:
   1. git log --oneline --since="$(date +%Y-%m-%d) 00:00" to get today's commits
   2. For each commit SHA: git show --stat --name-only <sha> to get files changed

   Working directory: /Users/I753472/Documents/development/aws-docs-graph

   Return each commit with its sha (short), message, and list of files changed.`,
  { label: 'git-summary', schema: GIT_SCHEMA }
)

// ── Summary ───────────────────────────────────────────────────────────────────
const blocked   = reviewedResults.filter(r => r.result.status === 'BLOCKED' || r.result.status === 'NEEDS_CONTEXT')
const specFails = reviewedResults.filter(r => !r.specReview?.compliant)
const qualFails = reviewedResults.filter(r => r.specReview?.compliant && !r.qualityApproved)
const passed    = reviewedResults.filter(r => r.specReview?.compliant && r.qualityApproved)

log(`\n━━━ ${dayLabel} Summary ━━━`)
log(`✅ Tasks passed:  ${passed.length}/${autoTasks.length}`)
log(`❌ Spec issues:   ${specFails.length}`)
log(`⚠️  Quality flags: ${qualFails.length}`)
log(`⛔ Blocked:       ${blocked.length}`)
log(`🚪 Gate: ${gateResult.passed ? '✅ PASSED' : '❌ FAILED'}`)
log(`📁 Files changed: ${gitSummary.totalFilesChanged} across ${gitSummary.commits.length} commits`)
gitSummary.commits.forEach(c => {
  log(`   ${c.sha} ${c.message}`)
  c.files.forEach(f => log(`     · ${f}`))
})

return {
  day: dayLabel,
  tasksTotal:    autoTasks.length,
  tasksPassed:   passed.length,
  specFails:     specFails.map(r => ({ task: r.task.name, issues: r.specReview.issues })),
  qualityFails:  qualFails.map(r => ({ task: r.task.name, issues: r.qualityIssues })),
  blocked:       blocked.map(r => ({ task: r.task.name, status: r.result.status })),
  gateResults:   gateResult.results,
  gatePassed:    gateResult.passed,
  commits:       gitSummary.commits,
  filesChanged:  gitSummary.totalFilesChanged,
}

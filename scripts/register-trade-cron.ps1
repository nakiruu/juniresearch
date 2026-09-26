<#
  register-trade-cron.ps1 — Windows Task Scheduler registration for the Phase-2 trade:cron job
  (spec §2). Run this once (elevated) from the repo root to install/update the scheduled task:

      powershell -ExecutionPolicy Bypass -File scripts\register-trade-cron.ps1

  The job runs `npm run trade:cron` once each morning at cronTimeET (default 09:45 ET — set the
  task/box timezone to America/New_York, or adjust -At below to the equivalent local time). The
  job self-guards: trade:cron checks the Alpaca clock first and exits 0 immediately (status
  "closed") on a non-trading day/weekend/holiday, so it is safe to trigger it daily rather than
  maintaining a separate market-holiday calendar in the scheduler itself.

  Re-running this script updates the existing task in place (-Force) rather than erroring if
  "juni-trade-cron" is already registered.
#>

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction Stop }
$npmCmd = $npmCommand.Source

$action  = New-ScheduledTaskAction -Execute $npmCmd -Argument "run trade:cron" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At 9:45AM   # ET; set the box/task timezone to America/New_York
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
  -TaskName "juni-trade-cron" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Phase-2 event-driven paper rebalance (reconcile -> plan -> execute), spec 2026-09-25-trade-layer-phase2-design.md §2-3. Self-guards: exits 0 immediately when the Alpaca clock says the market is closed." `
  -Force

Write-Host "Registered/updated scheduled task 'juni-trade-cron' -> npm run trade:cron (daily 09:45, working dir $repoRoot)."
Write-Host "Verify with: Get-ScheduledTask -TaskName juni-trade-cron | Get-ScheduledTaskInfo"

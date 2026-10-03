<#
  register-trade-cron.ps1 — Windows Task Scheduler registration for the Phase-2 trade:cron job
  (spec §2). Run this once (elevated) from the repo root to install/update the scheduled task:

      powershell -ExecutionPolicy Bypass -File scripts\register-trade-cron.ps1

  LEGACY: the deployed app runs the trade job itself: the in-app scheduler, armed by
  TRADE_SCHEDULER_ENABLED=1 in .env.local for the Docker `trader` service (see README "Scheduling").
  Use this only on a box without that scheduler, and never run both: each would place the day's orders.

  The job runs `npm run trade:cron` at each cronTimesET slot in lib/trade/config.ts — by default once
  each trading afternoon at 15:10 ET, one late-day decision on live prices (set the task/box timezone
  to America/New_York, or adjust -At below to the equivalent local time). Re-run this script after
  changing cronTimesET. The job self-guards: trade:cron checks the broker clock first and exits 0
  immediately (status "closed") on a non-trading day/weekend/holiday — and on an early-close day
  (13:00 ET), when the market is already shut at 15:10, so nothing trades that day — so it is safe to
  trigger it daily rather than maintaining a separate market-holiday calendar in the scheduler itself.
  Nothing is submitted after submitCutoffET (15:50 ET), however late a run starts.

  Re-running this script updates the existing task in place (-Force) rather than erroring if
  "juni-trade-cron" is already registered.
#>

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
# The fire times are cronTimesET from lib/trade/config.ts — one source of truth, never a second literal here.
$cfgMatch = Select-String -Path (Join-Path $repoRoot "lib\trade\config.ts") -Pattern 'cronTimesET: \[([^\]]*)\]' | Select-Object -First 1
if (-not $cfgMatch) { throw "could not read cronTimesET from lib/trade/config.ts" }
$cronTimesET = [regex]::Matches($cfgMatch.Matches[0].Groups[1].Value, '\d{2}:\d{2}') | ForEach-Object { $_.Value }
if (-not $cronTimesET) { throw "cronTimesET in lib/trade/config.ts holds no HH:MM slots" }
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction Stop }
$npmCmd = $npmCommand.Source

$action  = New-ScheduledTaskAction -Execute $npmCmd -Argument "run trade:cron" -WorkingDirectory $repoRoot
# One daily trigger per slot (ET; set the box/task timezone to America/New_York).
$trigger = @($cronTimesET | ForEach-Object { New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($_, "HH:mm", $null)) })
# No -StartWhenAvailable: a missed trigger is SKIPPED, never fired late at a worse time of day (trade:cron
# also refuses a run that starts after cronTimeET + maxLateMin as "late").
$settings = New-ScheduledTaskSettingsSet -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
  -TaskName "juni-trade-cron" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Phase-2 event-driven paper rebalance (reconcile -> plan -> execute), spec 2026-09-25-trade-layer-phase2-design.md §2-3. Self-guards: exits 0 immediately when the Alpaca clock says the market is closed." `
  -Force

Write-Host "Registered/updated scheduled task 'juni-trade-cron' -> npm run trade:cron (daily $($cronTimesET -join ', '), working dir $repoRoot)."
Write-Host "Verify with: Get-ScheduledTask -TaskName juni-trade-cron | Get-ScheduledTaskInfo"

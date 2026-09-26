#!/usr/bin/env bash
# register-trade-cron.sh — Linux scheduler registration for the Phase-2 trade:cron job (the
# systemd/cron counterpart of register-trade-cron.ps1). Run once to install a daily 09:45 ET job
# that runs `npm run trade:cron`.
#
#   ./scripts/register-trade-cron.sh            # install a systemd --user timer (preferred)
#   ./scripts/register-trade-cron.sh --cron     # install a crontab entry instead
#   ./scripts/register-trade-cron.sh --remove   # uninstall (systemd + crontab)
#
# The broker is chosen by BROKER in .env.local (alpaca-paper default | schwab LIVE), NOT by this
# script — keeping "BROKER=schwab is the deliberate live opt-in" intact, exactly like the Windows job.
# trade:cron self-guards: it checks the broker market clock first and exits 0 on a closed
# day/weekend/holiday, so it is safe to fire every weekday without a holiday calendar here.
# Kill switch: set TRADE_DISABLED=1 in .env.local.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NPM="$(command -v npm || true)"
NODEBIN="$([ -n "$NPM" ] && dirname "$NPM" || echo /usr/bin)"
UNIT="juni-trade-cron"
# The fire time is cronTimeET from lib/trade/config.ts — one source of truth, never a second literal here.
CRON_TIME_ET="$(grep -oE 'cronTimeET: "[0-9]{2}:[0-9]{2}"' "$REPO/lib/trade/config.ts" | grep -oE '[0-9]{2}:[0-9]{2}' | head -1)"
[ -n "$CRON_TIME_ET" ] || { echo "error: could not read cronTimeET from lib/trade/config.ts" >&2; exit 1; }
HH="${CRON_TIME_ET%%:*}"; MM="${CRON_TIME_ET##*:}"
CAL="Mon..Fri *-*-* ${CRON_TIME_ET}:00 America/New_York"   # systemd >= 252 honors the timezone suffix
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

die(){ echo "error: $*" >&2; exit 1; }
[ -n "$NPM" ] || die "npm not found on PATH"

mode="${1:-systemd}"

case "$mode" in
  --remove)
    systemctl --user disable --now "${UNIT}.timer" 2>/dev/null || true
    rm -f "$USER_UNIT_DIR/${UNIT}.service" "$USER_UNIT_DIR/${UNIT}.timer"
    systemctl --user daemon-reload 2>/dev/null || true
    ( crontab -l 2>/dev/null | grep -v "# ${UNIT}$" | crontab - ) 2>/dev/null || true
    echo "Removed ${UNIT} (systemd unit files + crontab entry)."
    ;;

  --cron)
    LINE="$((10#$MM)) $((10#$HH)) * * 1-5 cd $REPO && PATH=$NODEBIN:\$PATH $NPM run trade:cron >> $REPO/data/trade/cron.log 2>&1 # ${UNIT}"
    ( crontab -l 2>/dev/null | grep -v "# ${UNIT}$"; echo "$LINE" ) | crontab -
    echo "Installed crontab entry:"
    echo "  $LINE"
    echo
    echo "NOTE: cron fires in the box's LOCAL timezone. For a ${CRON_TIME_ET} ET fire, set the box timezone to"
    echo "America/New_York (timedatectl set-timezone America/New_York), or prefer the systemd timer"
    echo "(run without --cron), which pins ET regardless of the box timezone."
    ;;

  systemd)
    command -v systemctl >/dev/null || die "systemctl not found; re-run with --cron for a crontab entry"
    if ! systemd-analyze calendar "$CAL" >/dev/null 2>&1; then
      echo "warning: this systemd does not accept the timezone suffix in OnCalendar (needs v252+)." >&2
      echo "         Falling back to a bare ${CRON_TIME_ET} schedule — set the box timezone to America/New_York" >&2
      echo "         (timedatectl set-timezone America/New_York) so it fires at ${CRON_TIME_ET} ET." >&2
      CAL="Mon..Fri *-*-* ${CRON_TIME_ET}:00"
    fi
    mkdir -p "$USER_UNIT_DIR"
    cat > "$USER_UNIT_DIR/${UNIT}.service" <<EOF
[Unit]
Description=Juniper Phase-2 trade:cron (broker from .env.local: alpaca-paper | schwab)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO
# systemd --user services get a stripped PATH; npm shells out to node, so put the node bin dir on PATH.
Environment=PATH=$NODEBIN:/usr/local/bin:/usr/bin:/bin
ExecStart=$NPM run trade:cron
# Output also lands in data/trade/cron.log and (if configured) Discord; journald captures stdout/stderr.
EOF
    cat > "$USER_UNIT_DIR/${UNIT}.timer" <<EOF
[Unit]
Description=Run Juniper trade:cron each trading morning (${CRON_TIME_ET} ET)

[Timer]
OnCalendar=$CAL
# Persistent=false mirrors the Windows job: a missed ${CRON_TIME_ET} is SKIPPED, never run late at a worse
# intraday time (trade:cron would refuse it as "late" past cronTimeET + maxLateMin anyway). The clock
# guard blocks after-hours trading; TRADE_DISABLED=1 is the kill switch.
Persistent=false

[Install]
WantedBy=timers.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now "${UNIT}.timer"
    echo "Installed systemd --user timer '${UNIT}.timer' → npm run trade:cron in $REPO (schedule: $CAL)."
    echo "  Next runs:  systemctl --user list-timers ${UNIT}.timer"
    echo "  Logs:       journalctl --user -u ${UNIT}.service -n 50 --no-pager"
    echo "  Keep running after logout (headless server):  sudo loginctl enable-linger $USER"
    echo
    echo "Broker is chosen by BROKER in .env.local (alpaca-paper default | schwab LIVE)."
    ;;

  *) die "unknown option: $mode (use: no arg for systemd | --cron | --remove)" ;;
esac

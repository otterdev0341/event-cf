#!/usr/bin/env bash
set -euo pipefail
# Jenkins home and the Docker data root share the host's root filesystem.
# / is the same backing filesystem inside this controller (verified at setup).
for mount in "$PWD" /var/jenkins_home /; do
  [[ -d "$mount" ]] || continue
  df -B1 "$mount"
  df -i "$mount"
  [[ "${1:-}" != --report-only ]] || continue
  read -r available total < <(df -B1 --output=avail,size "$mount" | tail -1)
  read -r free_inodes total_inodes < <(df --output=iavail,itotal "$mount" | tail -1)
  if (( available < 21474836480 || available * 100 / total < 10 ||
        free_inodes * 100 / total_inodes < 10 )); then
    echo "Capacity gate failed on $mount: require 20 GiB, 10% free bytes and 10% free inodes. Reclaim owned disposable resources before retrying." >&2
    exit 1
  fi
done

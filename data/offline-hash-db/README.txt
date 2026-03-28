# CyberTip Triage — Offline Hash Database Directory
# Place CSV exports from law enforcement hash databases here.
# Required files:
#   ncmec_hashes.csv           — NCMEC known CSAM hash database
#   projectvic_hashes.csv      — Project VIC hash series
#   iwf_hashes.csv             — IWF Contraband Filter hashes
#   interpol_icse_hashes.csv   — Interpol ICSE database export
#   tor_exit_nodes.txt         — Tor exit node IP list (one per line)
#   known_vpns.txt             — Known VPN exit IPs (one per line)
#   crypto_blocklist.txt       — Crypto wallet addresses on LE watchlists
#
# Obtain exports from:
#   NCMEC:        Your NCMEC CyberTipline LE liaison
#   Project VIC:  projectvic.org (LE vetting required)
#   IWF:          iwf.org.uk LE liaison
#   Interpol:     Via your NCB / INTERPOL liaison
#
# Format: CSV with header row skipped if it starts with 'hash'
#   ncmec_hashes.csv:       sha256hash,series_name,victim_identified,victim_country,ncmec_category
#   projectvic_hashes.csv:  sha256hash,series_name,victim_country,series_id
#   iwf_hashes.csv:         sha256hash,iwf_category
#   interpol_icse_hashes.csv: sha256hash,interpol_case_ref,victim_country
#
# After updating CSV files, reload without restart:
#   kill -HUP $(cat cybertip.pid)   # or: docker compose kill -s HUP app


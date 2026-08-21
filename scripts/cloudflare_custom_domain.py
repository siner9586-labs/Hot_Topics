#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.cloudflare.com/client/v4"
HOSTNAME = "hots.ccwu.cc"
ZONE_NAME = "ccwu.cc"
SERVICE = "hot-topics-web"
BACKUP = Path("/tmp/hots-dns-backup.json")

TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
if not TOKEN or not ACCOUNT_ID:
    raise SystemExit("Cloudflare credentials are required")


def request(method: str, path: str, payload=None):
    body = None
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode()
    req = urllib.request.Request(API + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Cloudflare API {method} {path} failed: HTTP {exc.code}: {detail[:800]}") from exc
    if not data.get("success", False):
        raise RuntimeError(f"Cloudflare API {method} {path} failed: {data.get('errors')}")
    return data.get("result")


def current_worker_domain():
    q = urllib.parse.urlencode({"hostname": HOSTNAME})
    domains = request("GET", f"/accounts/{ACCOUNT_ID}/workers/domains?{q}") or []
    return next((d for d in domains if d.get("hostname") == HOSTNAME), None)


def zone_id():
    q = urllib.parse.urlencode({"name": ZONE_NAME, "status": "active", "account.id": ACCOUNT_ID})
    zones = request("GET", f"/zones?{q}") or []
    if len(zones) != 1:
        raise RuntimeError(f"Expected exactly one active Cloudflare zone named {ZONE_NAME}; found {len(zones)}")
    return zones[0]["id"]


def prepare():
    attached = current_worker_domain()
    if attached:
        if attached.get("service") != SERVICE:
            raise RuntimeError(f"{HOSTNAME} is already attached to a different Worker service")
        print(f"Custom domain already attached to {SERVICE}; no DNS cleanup required.")
        return

    zid = zone_id()
    q = urllib.parse.urlencode({"name": HOSTNAME, "per_page": 100})
    records = request("GET", f"/zones/{zid}/dns_records?{q}") or []
    blockers = [r for r in records if r.get("type") in {"A", "AAAA", "CNAME"}]
    unsafe = [r for r in records if r.get("type") in {"NS"}]
    if unsafe:
        raise RuntimeError(f"Refusing to alter delegated hostname {HOSTNAME}; NS record exists")

    backup = []
    for r in blockers:
        backup.append({
            "type": r.get("type"),
            "name": r.get("name"),
            "content": r.get("content"),
            "ttl": r.get("ttl", 1),
            "proxied": r.get("proxied"),
            "comment": r.get("comment"),
        })
    BACKUP.write_text(json.dumps({"zone_id": zid, "records": backup}), encoding="utf-8")

    if not blockers:
        print("No conflicting A/AAAA/CNAME DNS record found; Wrangler can create the Custom Domain directly.")
        return

    for r in blockers:
        request("DELETE", f"/zones/{zid}/dns_records/{r['id']}")
        print(f"Removed conflicting DNS record for {HOSTNAME}: type={r.get('type')}, proxied={r.get('proxied')}")


def verify():
    attached = current_worker_domain()
    if not attached:
        raise RuntimeError(f"Custom domain {HOSTNAME} is not attached to any Worker")
    if attached.get("service") != SERVICE:
        raise RuntimeError(f"Custom domain {HOSTNAME} is attached to unexpected Worker {attached.get('service')}")
    print(f"Verified Cloudflare Custom Domain: {HOSTNAME} -> {SERVICE}")


def restore():
    if not BACKUP.exists():
        print("No DNS backup exists; nothing to restore.")
        return
    data = json.loads(BACKUP.read_text(encoding="utf-8"))
    zid = data["zone_id"]
    for r in data.get("records", []):
        payload = {k: v for k, v in r.items() if v is not None}
        request("POST", f"/zones/{zid}/dns_records", payload)
        print(f"Restored DNS record for {HOSTNAME}: type={r.get('type')}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if mode == "prepare":
        prepare()
    elif mode == "verify":
        verify()
    elif mode == "restore":
        restore()
    else:
        raise SystemExit(f"Unknown mode: {mode}")

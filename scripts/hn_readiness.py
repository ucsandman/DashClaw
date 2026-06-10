#!/usr/bin/env python3
"""Fail-closed launch readiness audit for the GroundLock Show HN post."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html.parser
import json
import ipaddress
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse, urlunparse


ROOT = Path(__file__).resolve().parents[1]
CLI_PATH = ROOT / "packages" / "cli" / "dist" / "cli.js"
DEFAULT_DRAFT_PATH = ROOT / "docs" / "show-hn-draft.md"
DEFAULT_REPO = "ucsandman/groundlock-receipts"
RESERVED_HOSTS = {
    "example.com",
    "example.net",
    "example.org",
    "localhost",
}
RESERVED_SUFFIXES = (
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".invalid",
    ".localhost",
    ".test",
)
OG_IMAGE_PATH = "/groundlock-receipt-desk.png"
SITE_TITLE = "GroundLock Receipts"
DNS_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
CHUNK_DATA_RE = re.compile(r"^[A-Za-z0-9_-]+$")
MAX_WEB_VERIFY_BYTES = 256 * 1024
MAX_FETCH_TIMEOUT_MS = 30_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
STATUS_VALUES = {"active", "revoked", "retracted", "compromised"}
LAUNCH_KIT_ARTIFACTS = {
    "dnsFixture": "dns-fixture.json",
    "dnsZone": "dns-zone.txt",
    "webEnv": "web.env",
    "statusRecords": "status-records.json",
    "launchSummary": "launch-summary.json",
    "hnReadiness": "hn-readiness.ps1",
    "runbook": "runbook.md",
    "checksums": "checksums.txt",
}
LAUNCH_KIT_EVIDENCE_ARTIFACT = "hn-readiness-evidence.json"
LAUNCH_KIT_ALLOWED_EXTRA_FILES = {LAUNCH_KIT_EVIDENCE_ARTIFACT}
LAUNCH_KIT_CHECKSUMMED_ARTIFACTS = {
    key: LAUNCH_KIT_ARTIFACTS[key]
    for key in (
        "dnsFixture",
        "dnsZone",
        "webEnv",
        "statusRecords",
        "hnReadiness",
        "runbook",
    )
}
PRIVATE_KEY_MARKERS = (
    "privateKeyJwk",
    "BEGIN PRIVATE KEY",
    "BEGIN RSA PRIVATE KEY",
    "BEGIN EC PRIVATE KEY",
)
PRIVATE_JWK_KTY_VALUES = {"OKP", "RSA", "EC"}
PRIVATE_JWK_TEXT_RE = re.compile(
    r'(?=.*"kty"\s*:\s*"(?:OKP|RSA|EC)")(?=.*"d"\s*:)', re.DOTALL
)


def load_security_header_contract() -> tuple[dict[str, list[str]], list[str]]:
    path = ROOT / "apps" / "web" / "lib" / "security-header-contract.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    required = data.get("requiredHeaderValues")
    forbidden = data.get("forbiddenCspValues")
    if not isinstance(required, dict) or not isinstance(forbidden, list):
        raise ValueError("security header contract is malformed")
    for name, values in required.items():
        if not isinstance(name, str) or not isinstance(values, list):
            raise ValueError("security header contract has malformed header values")
        if not all(isinstance(value, str) and value for value in values):
            raise ValueError("security header contract has malformed header values")
    if not all(isinstance(value, str) and value for value in forbidden):
        raise ValueError("security header contract has malformed forbidden values")
    return (
        {name: values for name, values in required.items()},
        forbidden,
    )


SECURITY_HEADER_REQUIREMENTS, FORBIDDEN_CSP_VALUES = load_security_header_contract()


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str
    evidence: dict[str, object] | None = None


@dataclass(frozen=True)
class FixtureManifest:
    receipt_hash: str
    payload_hash: str
    signer_domain: str
    kid: str
    chunk_count: int


@dataclass(frozen=True)
class FixtureReceiptMetadata:
    verdict: str
    issued_at: str
    content_class: str


class MetadataExtractor(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.canonical: str | None = None
        self.meta: dict[str, str] = {}
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(  # noqa: vulture
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.lower() == "title":
            self._in_title = True
            return
        values = {key.lower(): value for key, value in attrs if value is not None}
        if tag.lower() == "link" and "canonical" in values.get("rel", "").lower():
            self.canonical = values.get("href")
            return
        if tag.lower() != "meta":
            return
        content = values.get("content")
        key = values.get("property") or values.get("name")
        if key and content:
            self.meta[key.lower()] = content

    def handle_data(self, data: str) -> None:  # noqa: vulture
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag: str) -> None:  # noqa: vulture
        if tag.lower() == "title":
            self._in_title = False

    @property
    def title(self) -> str:
        return " ".join(part.strip() for part in self._title_parts if part.strip())


def check_show_hn_draft(path: Path = DEFAULT_DRAFT_PATH) -> CheckResult:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return CheckResult("show-hn-draft", False, f"could not read {path}: {exc}")

    if "LOCAL_DEMO_ONLY" in text:
        return CheckResult(
            "show-hn-draft", False, "draft still contains LOCAL_DEMO_ONLY"
        )
    return CheckResult("show-hn-draft", True, "draft no longer marked LOCAL_DEMO_ONLY")


def validate_health_body(
    body: str, health_url: str | None = None, status_base_url: str | None = None
) -> CheckResult:
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        return CheckResult("health", False, f"invalid JSON: {exc}")

    if not isinstance(data, dict):
        return CheckResult("health", False, "health response is not a JSON object")
    if data.get("service") != "groundlock-web":
        return CheckResult(
            "health", False, "health response service is not groundlock-web"
        )
    if data.get("ok") is not True:
        return CheckResult("health", False, "health response ok is not true")
    if data.get("mode") != "live":
        return CheckResult(
            "health", False, "health response must be live mode for HN launch"
        )

    checks = data.get("checks")
    if not isinstance(checks, dict):
        return CheckResult("health", False, "health response checks is not an object")
    required = [
        "signerDomainConfigured",
        "siteUrlConfigured",
        "dohEndpointConfigured",
        "statusBaseUrlConfigured",
    ]
    missing = [name for name in required if checks.get(name) is not True]
    if missing:
        return CheckResult(
            "health", False, f"missing live health checks: {', '.join(missing)}"
        )
    if (
        uses_same_origin_status(health_url, status_base_url)
        and checks.get("statusRecordsConfigured") is not True
    ):
        return CheckResult(
            "health",
            False,
            "missing live health checks: statusRecordsConfigured",
        )

    return CheckResult("health", True, "deployed verifier reports live mode ready")


def health_endpoint(url: str) -> str:
    clean = url.strip().rstrip("/")
    if clean.endswith("/api/health"):
        return clean
    return f"{clean}/api/health"


def homepage_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.path.rstrip("/") == "/api/health":
        parsed = parsed._replace(path="/", params="", query="", fragment="")
        return urlunparse(parsed)
    clean = url.strip().rstrip("/")
    return f"{clean}/"


def verify_endpoint(url: str) -> str:
    return f"{homepage_url(url).rstrip('/')}/api/verify"


def share_image_url(url: str) -> str:
    return f"{homepage_url(url).rstrip('/')}{OG_IMAGE_PATH}"


def robots_endpoint(url: str) -> str:
    return f"{homepage_url(url).rstrip('/')}/robots.txt"


def sitemap_endpoint(url: str) -> str:
    return f"{homepage_url(url).rstrip('/')}/sitemap.xml"


def uses_same_origin_status(
    health_url: str | None, status_base_url: str | None
) -> bool:
    if health_url is None or status_base_url is None:
        return False
    health_origin = url_origin(homepage_url(health_url))
    status_origin = url_origin(status_base_url)
    return health_origin is not None and health_origin == status_origin


def url_origin(value: str) -> str | None:
    parsed = urlparse(value.strip())
    if not parsed.scheme or not parsed.netloc:
        return None
    return urlunparse(parsed._replace(path="", params="", query="", fragment=""))


def check_launch_targets(args: argparse.Namespace) -> CheckResult:
    failures = []
    failures.extend(validate_public_health_url(args.health_url))
    failures.extend(validate_public_https_url("status-base-url", args.status_base_url))
    if args.doh_endpoint:
        failures.extend(validate_public_https_url("doh-endpoint", args.doh_endpoint))
    else:
        failures.append("doh-endpoint is required for HN launch")
    failures.extend(validate_public_domain("domain", args.domain, allow_ip=False))

    if failures:
        return CheckResult("launch-targets", False, "; ".join(failures))
    return CheckResult(
        "launch-targets", True, "launch URLs and signer domain are public HTTPS"
    )


def validate_public_health_url(value: str) -> list[str]:
    failures = validate_public_https_url("health-url", value)
    parsed = urlparse(value.strip())
    path = parsed.path.rstrip("/")
    if path not in ("", "/api/health"):
        failures.append("health-url path must be / or /api/health")
    return failures


def validate_public_https_url(label: str, value: str) -> list[str]:
    parsed = urlparse(value.strip())
    failures = []
    if parsed.scheme != "https":
        failures.append(f"{label} must use https")
    if parsed.username or parsed.password:
        failures.append(f"{label} must not include username or password")
    if parsed.query or parsed.fragment:
        failures.append(f"{label} must not include query or fragment")
    try:
        port = parsed.port
    except ValueError:
        failures.append(f"{label} must not include an invalid port")
        port = None
    if port is not None and port != 443:
        failures.append(f"{label} must not include a non-default port")
    if not parsed.hostname:
        failures.append(f"{label} must include a hostname")
        return failures
    failures.extend(validate_public_domain(label, parsed.hostname, allow_ip=False))
    return failures


def validate_public_domain(
    label: str, value: str, *, allow_ip: bool = True
) -> list[str]:
    host = value.strip().rstrip(".").lower()
    if not host:
        return [f"{label} is empty"]
    if "://" in host:
        return [f"{label} must be a domain, not a URL"]
    if host in RESERVED_HOSTS or host.endswith(RESERVED_SUFFIXES):
        return [f"{label} uses a reserved placeholder host: {value}"]
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if "." not in host:
            return [f"{label} must be a public DNS name"]
        invalid_dns = len(host) > 253 or any(
            not DNS_LABEL_RE.match(part) for part in host.split(".")
        )
        if invalid_dns:
            return [f"{label} must be a valid public DNS name"]
        return []
    if not allow_ip:
        return [f"{label} must be a DNS name, not an IP address: {value}"]
    if not ip.is_global:
        return [f"{label} must not use a private or local IP address: {value}"]
    return []


def check_health_url(
    url: str, status_base_url: str | None = None, timeout: float = 10.0
) -> CheckResult:
    endpoint = health_endpoint(url)
    request = urllib.request.Request(
        endpoint, headers={"User-Agent": "groundlock-hn-readiness/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(256_000).decode("utf-8", errors="replace")
            if response.status != 200:
                return CheckResult(
                    "health", False, f"{endpoint} returned HTTP {response.status}"
                )
            header_failures = validate_response_headers(
                response.headers, "health", require_no_store=True
            )
            if header_failures:
                return CheckResult("health", False, "; ".join(header_failures))
    except Exception as exc:
        return CheckResult("health", False, f"{endpoint} failed: {exc}")

    return validate_health_body(body, health_url=url, status_base_url=status_base_url)


def extract_metadata(html: str) -> MetadataExtractor:
    extractor = MetadataExtractor()
    extractor.feed(html)
    return extractor


def normalize_root_url(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value.strip())
    if parsed.path in ("", "/") and not parsed.params and not parsed.query:
        return urlunparse(parsed._replace(path="/", params="", query="", fragment=""))
    return value.strip()


def validate_homepage_metadata(html: str, expected_home_url: str) -> CheckResult:
    expected_home = homepage_url(expected_home_url)
    expected_origin = urlparse(expected_home)._replace(
        path="", params="", query="", fragment=""
    )
    origin = urlunparse(expected_origin)
    metadata = extract_metadata(html)
    failures = []

    if normalize_root_url(metadata.canonical) != expected_home:
        failures.append(
            f"canonical href is {metadata.canonical!r}, expected {expected_home}"
        )
    if normalize_root_url(metadata.meta.get("og:url")) != expected_home:
        failures.append(
            f"og:url is {metadata.meta.get('og:url')!r}, expected {expected_home}"
        )
    expected_image = f"{origin}{OG_IMAGE_PATH}"
    if metadata.meta.get("og:image") != expected_image:
        failures.append(
            f"og:image is {metadata.meta.get('og:image')!r}, expected {expected_image}"
        )
    if metadata.meta.get("twitter:image") != expected_image:
        failures.append(
            "twitter:image is "
            f"{metadata.meta.get('twitter:image')!r}, expected {expected_image}"
        )
    if SITE_TITLE not in metadata.title:
        failures.append(
            f"title is {metadata.title!r}, expected it to contain {SITE_TITLE!r}"
        )

    if failures:
        return CheckResult("metadata", False, "; ".join(failures))
    return CheckResult("metadata", True, "homepage metadata matches launch URL")


def check_homepage_metadata(url: str, timeout: float = 10.0) -> CheckResult:
    endpoint = homepage_url(url)
    request = urllib.request.Request(
        endpoint, headers={"User-Agent": "groundlock-hn-readiness/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(512_000).decode("utf-8", errors="replace")
            if response.status != 200:
                return CheckResult(
                    "metadata", False, f"{endpoint} returned HTTP {response.status}"
                )
    except Exception as exc:
        return CheckResult("metadata", False, f"{endpoint} failed: {exc}")

    return validate_homepage_metadata(body, endpoint)


def check_share_image(url: str, timeout: float = 10.0) -> CheckResult:
    endpoint = share_image_url(url)
    request = urllib.request.Request(
        endpoint, headers={"User-Agent": "groundlock-hn-readiness/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(16)
            if response.status != 200:
                return CheckResult(
                    "share-image", False, f"{endpoint} returned HTTP {response.status}"
                )
            header_failures = validate_response_headers(response.headers, "share-image")
            if header_failures:
                return CheckResult("share-image", False, "; ".join(header_failures))
            content_type = header_value(response.headers, "Content-Type") or ""
            if not content_type.lower().startswith("image/png"):
                return CheckResult(
                    "share-image",
                    False,
                    f"{endpoint} Content-Type is {content_type!r}, expected image/png",
                )
            if not body.startswith(b"\x89PNG\r\n\x1a\n"):
                return CheckResult(
                    "share-image", False, f"{endpoint} did not return a PNG body"
                )
    except Exception as exc:
        return CheckResult("share-image", False, f"{endpoint} failed: {exc}")

    return CheckResult(
        "share-image",
        True,
        "deployed share image is reachable, hardened, and serves PNG bytes",
    )


def validate_public_discovery_files(
    robots_text: str, sitemap_text: str, expected_home_url: str
) -> CheckResult:
    expected_home = homepage_url(expected_home_url)
    expected_origin = url_origin(expected_home)
    if expected_origin is None:
        return CheckResult("discovery", False, "expected homepage URL is malformed")
    failures = []
    expected_sitemap = f"{expected_origin}/sitemap.xml"
    robots_lines = {
        line.strip().lower()
        for line in robots_text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    required_robots_lines = {
        "user-agent: *",
        "allow: /",
        "disallow: /api/",
        "disallow: /groundlock/status/",
        f"sitemap: {expected_sitemap}".lower(),
    }
    for line in sorted(required_robots_lines):
        if line not in robots_lines:
            failures.append(f"robots.txt missing {line}")

    try:
        sitemap = ET.fromstring(sitemap_text)
    except ET.ParseError as exc:
        return CheckResult("discovery", False, f"sitemap.xml is invalid XML: {exc}")

    locs = [
        str(element.text or "").strip()
        for element in sitemap.iter()
        if element.tag == "loc" or element.tag.endswith("}loc")
    ]
    required_locs = {expected_home, f"{expected_origin}/threat-model"}
    missing_locs = required_locs.difference(locs)
    for loc in sorted(missing_locs):
        failures.append(f"sitemap.xml missing {loc}")
    for loc in locs:
        if url_origin(loc) != expected_origin:
            failures.append(f"sitemap.xml loc is outside launch origin: {loc!r}")
            continue
        path = urlparse(loc).path
        if path.startswith("/api/") or path.startswith("/groundlock/status/"):
            failures.append(f"sitemap.xml exposes non-public path: {loc!r}")

    if failures:
        return CheckResult("discovery", False, "; ".join(failures))
    return CheckResult(
        "discovery",
        True,
        "robots.txt and sitemap.xml match the public launch origin",
    )


def check_public_discovery_files(url: str, timeout: float = 10.0) -> CheckResult:
    bodies: dict[str, str] = {}
    endpoints = {
        "robots.txt": robots_endpoint(url),
        "sitemap.xml": sitemap_endpoint(url),
    }
    for label, endpoint in endpoints.items():
        request = urllib.request.Request(
            endpoint, headers={"User-Agent": "groundlock-hn-readiness/1"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read(512_000).decode("utf-8", errors="replace")
                if response.status != 200:
                    return CheckResult(
                        "discovery",
                        False,
                        f"{endpoint} returned HTTP {response.status}",
                    )
                header_failures = validate_response_headers(response.headers, label)
                if header_failures:
                    return CheckResult("discovery", False, "; ".join(header_failures))
                bodies[label] = body
        except Exception as exc:
            return CheckResult("discovery", False, f"{endpoint} failed: {exc}")

    return validate_public_discovery_files(
        bodies["robots.txt"], bodies["sitemap.xml"], url
    )


def header_value(headers: object, name: str) -> str | None:
    if hasattr(headers, "get"):
        value = headers.get(name)  # type: ignore[attr-defined]
        if value is not None:
            return str(value)
    if isinstance(headers, dict):
        for key, value in headers.items():
            if isinstance(key, str) and key.lower() == name.lower():
                return str(value)
    return None


def validate_response_headers(
    headers: object, label: str, *, require_no_store: bool = False
) -> list[str]:
    failures = []
    for header_name, expected_values in SECURITY_HEADER_REQUIREMENTS.items():
        value = header_value(headers, header_name)
        if value is None:
            failures.append(f"{label} missing {header_name}")
            continue
        for expected in expected_values:
            if expected not in value:
                failures.append(f"{label} {header_name} missing {expected}")

    csp = header_value(headers, "Content-Security-Policy") or ""
    for forbidden in FORBIDDEN_CSP_VALUES:
        if forbidden in csp:
            failures.append(f"{label} Content-Security-Policy contains {forbidden}")

    if require_no_store:
        cache_control = header_value(headers, "Cache-Control") or ""
        if "no-store" not in cache_control.lower():
            failures.append(f"{label} missing Cache-Control: no-store")

    return failures


def check_security_headers(url: str, timeout: float = 10.0) -> CheckResult:
    failures = []
    endpoints = [
        ("homepage", homepage_url(url), False),
        ("health", health_endpoint(url), True),
    ]
    for label, endpoint, require_no_store in endpoints:
        request = urllib.request.Request(
            endpoint, headers={"User-Agent": "groundlock-hn-readiness/1"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    failures.append(f"{label} returned HTTP {response.status}")
                    continue
                failures.extend(
                    validate_response_headers(
                        response.headers, label, require_no_store=require_no_store
                    )
                )
        except Exception as exc:
            failures.append(f"{endpoint} failed: {exc}")

    if failures:
        return CheckResult("security-headers", False, "; ".join(failures))
    return CheckResult(
        "security-headers",
        True,
        "deployed homepage and health security headers are production-ready",
    )


def status_endpoint_url(status_base_url: str, kind: str, lookup: str) -> str:
    clean = status_base_url.strip().rstrip("/")
    return f"{clean}/{kind}?{urlencode({'lookup': lookup})}"


def status_endpoint_expectations(
    fixture_status_records: list[dict[str, object]],
) -> tuple[list[tuple[str, str, dict[str, object]]], list[str]]:
    expectations: dict[str, tuple[str, str, dict[str, object]]] = {}
    failures: list[str] = []
    for record in fixture_status_records:
        if not isinstance(record, dict):
            failures.append("DNS fixture status record is not a JSON object")
            continue
        kind = record.get("kind")
        if kind not in {"key", "claim"}:
            failures.append(f"DNS fixture status record has unsupported kind {kind!r}")
            continue
        if kind in expectations:
            failures.append(f"DNS fixture has multiple {kind} status records")
            continue
        subject = record.get("subject")
        if not isinstance(subject, dict):
            failures.append(f"DNS fixture {kind} status record subject is missing")
            continue
        if kind == "key":
            signer_domain = subject.get("signerDomain")
            kid = subject.get("kid")
            if not isinstance(signer_domain, str) or not isinstance(kid, str):
                failures.append(
                    "DNS fixture key status record subject is missing signerDomain or kid"
                )
                continue
            lookup = f"key:{signer_domain}:{kid}"
        else:
            receipt_hash = subject.get("receiptHash")
            if not isinstance(receipt_hash, str):
                failures.append(
                    "DNS fixture claim status record subject is missing receiptHash"
                )
                continue
            lookup = f"claim:{receipt_hash}"
        expectations[kind] = (kind, lookup, record)

    for kind in ("key", "claim"):
        if kind not in expectations:
            failures.append(f"DNS fixture is missing a {kind} status record")

    ordered = [expectations[kind] for kind in ("key", "claim") if kind in expectations]
    return ordered, failures


def check_status_endpoints(
    status_base_url: str,
    fixture_status_records: list[dict[str, object]],
    timeout: float = 10.0,
) -> CheckResult:
    expectations, failures = status_endpoint_expectations(fixture_status_records)

    for kind, lookup, expected_record in expectations:
        endpoint = status_endpoint_url(status_base_url, kind, lookup)
        request = urllib.request.Request(
            endpoint,
            headers={
                "Accept": "application/json",
                "User-Agent": "groundlock-hn-readiness/1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read(256_000).decode("utf-8", errors="replace")
                if response.status != 200:
                    failures.append(
                        f"{kind} status endpoint returned HTTP {response.status}"
                    )
                    continue
                cache_control = header_value(response.headers, "Cache-Control") or ""
                if "no-store" not in cache_control.lower():
                    failures.append(
                        f"{kind} status endpoint missing Cache-Control: no-store"
                    )
        except Exception as exc:
            failures.append(f"{endpoint} failed: {exc}")
            continue

        try:
            body_json = json.loads(body)
        except json.JSONDecodeError as exc:
            failures.append(f"{kind} status endpoint returned invalid JSON: {exc}")
            continue
        if not isinstance(body_json, dict):
            failures.append(f"{kind} status endpoint response is not a JSON object")
            continue
        if canonical_json(body_json) != canonical_json(expected_record):
            failures.append(
                f"{kind} status endpoint response does not match DNS fixture"
            )

    if failures:
        return CheckResult("status-endpoints", False, "; ".join(failures))
    return CheckResult(
        "status-endpoints",
        True,
        "key and claim status endpoints match DNS fixture and use no-store",
    )


def build_web_verify_body(file_or_hash: str) -> dict[str, str]:
    if file_or_hash.startswith("sha256:"):
        return {"hash": file_or_hash}
    path = Path(file_or_hash)
    data = path.read_bytes()
    if len(data) > MAX_WEB_VERIFY_BYTES:
        raise ValueError("web_verify_input_too_large")
    return {"fileText": data.decode("utf-8")}


def validate_web_verify_body(
    body: str,
    expected_domain: str,
    expected_content_hash: str,
    expected_receipt_hash: str,
) -> CheckResult:
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        return CheckResult("web-verify", False, f"invalid JSON: {exc}")

    if not isinstance(data, dict):
        return CheckResult("web-verify", False, "verify response is not a JSON object")
    state = data.get("state")
    code = data.get("code")
    if state != "PASS" or code != "verified":
        return CheckResult(
            "web-verify",
            False,
            f"deployed /api/verify returned state={state} code={code}",
        )
    summary = data.get("receiptSummary")
    if not isinstance(summary, dict):
        return CheckResult(
            "web-verify", False, "deployed /api/verify did not return receiptSummary"
        )
    failures = []
    signer_domain = summary.get("signerDomain")
    if not isinstance(signer_domain, str) or normalize_domain(
        signer_domain
    ) != normalize_domain(expected_domain):
        failures.append("receiptSummary signerDomain does not match launch domain")
    if summary.get("contentHash") != expected_content_hash:
        failures.append("receiptSummary contentHash does not match demo hash")
    if summary.get("verdict") != "pass":
        failures.append("receiptSummary verdict is not pass")
    receipt_hash = summary.get("receiptHash")
    if not isinstance(receipt_hash, str) or not receipt_hash.startswith("sha256:"):
        failures.append("receiptSummary receiptHash is missing")
    elif receipt_hash != expected_receipt_hash:
        failures.append("receiptSummary receiptHash does not match DNS fixture receipt")
    if failures:
        return CheckResult("web-verify", False, "; ".join(failures))
    return CheckResult(
        "web-verify",
        True,
        "deployed /api/verify returned PASS for launch domain and DNS fixture receipt",
    )


def check_web_verify(
    url: str,
    file_or_hash: str,
    domain: str,
    expected_receipt_hash: str,
    timeout: float = 10.0,
) -> CheckResult:
    endpoint = verify_endpoint(url)
    try:
        payload = json.dumps(build_web_verify_body(file_or_hash)).encode("utf-8")
        expected_content_hash = content_hash_for_input(file_or_hash)
    except Exception as exc:
        return CheckResult("web-verify", False, f"could not build request body: {exc}")

    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "groundlock-hn-readiness/1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(256_000).decode("utf-8", errors="replace")
            if response.status != 200:
                return CheckResult(
                    "web-verify", False, f"{endpoint} returned HTTP {response.status}"
                )
            header_failures = validate_response_headers(
                response.headers, "verify", require_no_store=True
            )
            if header_failures:
                return CheckResult("web-verify", False, "; ".join(header_failures))
    except Exception as exc:
        return CheckResult("web-verify", False, f"{endpoint} failed: {exc}")

    return validate_web_verify_body(
        body, domain, expected_content_hash, expected_receipt_hash
    )


def check_dns_fixture(path: str, domain: str, file_or_hash: str) -> CheckResult:
    try:
        content_hash = content_hash_for_input(file_or_hash)
    except Exception as exc:
        return CheckResult("dns-fixture", False, f"could not compute demo hash: {exc}")

    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        return CheckResult("dns-fixture", False, f"could not read {path}: {exc}")
    except json.JSONDecodeError as exc:
        return CheckResult("dns-fixture", False, f"invalid JSON: {exc}")

    if not isinstance(data, dict):
        return CheckResult("dns-fixture", False, "fixture is not a JSON object")

    expected_domain = normalize_domain(domain)
    failures = []
    fixture_domain = data.get("domain")
    if not isinstance(fixture_domain, str):
        failures.append("fixture domain is missing")
    elif normalize_domain(fixture_domain) != expected_domain:
        failures.append(
            f"fixture domain {fixture_domain!r} does not match launch domain {domain!r}"
        )

    txt = data.get("txt")
    if not isinstance(txt, dict) or not txt:
        failures.append("fixture txt records are missing")
        manifest = None
    else:
        txt_failures, manifest = validate_fixture_txt_records(
            txt, expected_domain, content_hash
        )
        failures.extend(txt_failures)

    status = data.get("status")
    if not isinstance(status, dict):
        failures.append("fixture status records are missing")
    else:
        key = status.get("key")
        claim = status.get("claim")
        if not isinstance(key, dict) or key.get("kind") != "key":
            failures.append("fixture key status record is missing")
        else:
            key_shape_failures = validate_status_record_shape(key, "key")
            if key_shape_failures:
                failures.extend(key_shape_failures)
            elif manifest is not None:
                failures.extend(validate_key_status_record(key, manifest))
        if not isinstance(claim, dict) or claim.get("kind") != "claim":
            failures.append("fixture claim status record is missing")
        else:
            claim_shape_failures = validate_status_record_shape(claim, "claim")
            if claim_shape_failures:
                failures.extend(claim_shape_failures)
            elif manifest is not None:
                failures.extend(validate_claim_status_record(claim, manifest))

    if failures:
        return CheckResult("dns-fixture", False, "; ".join(failures))
    return CheckResult(
        "dns-fixture", True, "fixture domain, TXT records, and statuses match launch"
    )


def parse_launch_kit_checksums(text: str) -> tuple[dict[str, str], list[str]]:
    entries: dict[str, str] = {}
    failures = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split()
        if len(parts) != 2:
            failures.append(
                f"checksums.txt line {line_number} must be '<sha256> <artifact>'"
            )
            continue
        digest, artifact_name = parts
        if not digest.startswith("sha256:"):
            failures.append(f"checksums.txt line {line_number} digest is not sha256")
        if artifact_name in entries:
            failures.append(f"checksums.txt repeats artifact {artifact_name!r}")
        entries[artifact_name] = digest
    return entries, failures


def check_launch_kit(path: str, args: argparse.Namespace) -> CheckResult:
    root = Path(path)
    if not root.is_dir():
        return CheckResult("launch-kit", False, f"{path} is not a directory")

    summary_path = root / LAUNCH_KIT_ARTIFACTS["launchSummary"]
    checksums_path = root / LAUNCH_KIT_ARTIFACTS["checksums"]
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except OSError as exc:
        return CheckResult("launch-kit", False, f"could not read {summary_path}: {exc}")
    except json.JSONDecodeError as exc:
        return CheckResult("launch-kit", False, f"invalid launch summary JSON: {exc}")
    if not isinstance(summary, dict):
        return CheckResult("launch-kit", False, "launch summary is not a JSON object")

    failures = []
    if summary.get("schema") != "groundlock-launch-kit/v1":
        failures.append("launch summary schema is not groundlock-launch-kit/v1")

    expected_site_url = url_origin(args.health_url)
    if summary.get("siteUrl") != expected_site_url:
        failures.append("launch summary siteUrl does not match health-url origin")
    if summary.get("healthUrl") != expected_site_url:
        failures.append("launch summary healthUrl does not match health-url origin")
    if summary.get("statusBaseUrl") != args.status_base_url:
        failures.append("launch summary statusBaseUrl does not match readiness input")
    if summary.get("dohEndpoint") != args.doh_endpoint:
        failures.append("launch summary dohEndpoint does not match readiness input")
    summary_fetch_timeout_ms = summary.get("fetchTimeoutMs")
    if not isinstance(summary_fetch_timeout_ms, int) or isinstance(
        summary_fetch_timeout_ms, bool
    ):
        failures.append("launch summary fetchTimeoutMs is missing")
        summary_fetch_timeout_ms = None
    elif (
        summary_fetch_timeout_ms < 1 or summary_fetch_timeout_ms > MAX_FETCH_TIMEOUT_MS
    ):
        failures.append(
            f"launch summary fetchTimeoutMs must be between 1 and {MAX_FETCH_TIMEOUT_MS} ms"
        )
    summary_rate_limit_max = summary.get("rateLimitMax")
    if not isinstance(summary_rate_limit_max, int) or isinstance(
        summary_rate_limit_max, bool
    ):
        failures.append("launch summary rateLimitMax is missing")
        summary_rate_limit_max = None
    elif summary_rate_limit_max < 1 or summary_rate_limit_max > MAX_SAFE_INTEGER:
        failures.append("launch summary rateLimitMax must be a positive safe integer")

    summary_rate_limit_window_ms = summary.get("rateLimitWindowMs")
    if not isinstance(summary_rate_limit_window_ms, int) or isinstance(
        summary_rate_limit_window_ms, bool
    ):
        failures.append("launch summary rateLimitWindowMs is missing")
        summary_rate_limit_window_ms = None
    elif (
        summary_rate_limit_window_ms < 1
        or summary_rate_limit_window_ms > MAX_SAFE_INTEGER
    ):
        failures.append(
            "launch summary rateLimitWindowMs must be a positive safe integer"
        )
    summary_dns_ttl = summary.get("dnsTtl")
    if not isinstance(summary_dns_ttl, int) or isinstance(summary_dns_ttl, bool):
        failures.append("launch summary dnsTtl is missing")
        summary_dns_ttl = None
    elif summary_dns_ttl < 1 or summary_dns_ttl > MAX_SAFE_INTEGER:
        failures.append("launch summary dnsTtl must be a positive safe integer")

    summary_domain = summary.get("domain")
    if not isinstance(summary_domain, str):
        failures.append("launch summary domain is missing")
    elif normalize_domain(summary_domain) != normalize_domain(args.domain):
        failures.append("launch summary domain does not match readiness input")

    if summary.get("receiptVerdict") != "pass":
        failures.append("launch summary receiptVerdict is not pass")
    try:
        expected_content_hash = content_hash_for_input(args.file_or_hash)
    except Exception as exc:
        failures.append(f"could not compute readiness input hash: {exc}")
        expected_content_hash = None
    if expected_content_hash and summary.get("contentHash") != expected_content_hash:
        failures.append("launch summary contentHash does not match readiness input")

    try:
        fixture_manifest = fixture_manifest_for_input(
            args.dns_fixture, args.domain, args.file_or_hash
        )
    except Exception as exc:
        failures.append(f"could not read DNS fixture manifest for launch kit: {exc}")
        fixture_manifest = None
    if fixture_manifest is not None:
        if summary.get("receiptHash") != fixture_manifest.receipt_hash:
            failures.append("launch summary receiptHash does not match DNS fixture")
        if summary.get("signerKeyId") != fixture_manifest.kid:
            failures.append("launch summary signerKeyId does not match DNS fixture")
    fixture_receipt_metadata = fixture_receipt_metadata_for_launch_kit(
        args.dns_fixture, args.domain, args.file_or_hash
    )
    if isinstance(fixture_receipt_metadata, str):
        failures.append(fixture_receipt_metadata)
    else:
        if summary.get("receiptVerdict") != fixture_receipt_metadata.verdict:
            failures.append("launch summary receiptVerdict does not match DNS fixture")
        if summary.get("receiptIssuedAt") != fixture_receipt_metadata.issued_at:
            failures.append("launch summary receiptIssuedAt does not match DNS fixture")
        if summary.get("contentClass") != fixture_receipt_metadata.content_class:
            failures.append("launch summary contentClass does not match DNS fixture")
        if fixture_receipt_metadata.verdict != "pass":
            failures.append("DNS fixture cached receipt verdict is not pass")

    fixture_status_records = fixture_status_records_for_launch_kit(args.dns_fixture)
    if isinstance(fixture_status_records, str):
        failures.append(fixture_status_records)
        fixture_status_records = None
    elif summary.get("statusRecordCount") != len(fixture_status_records):
        failures.append("launch summary statusRecordCount does not match DNS fixture")
    fixture_txt_records = fixture_txt_records_for_launch_kit(args.dns_fixture)
    if isinstance(fixture_txt_records, str):
        failures.append(fixture_txt_records)
        fixture_txt_records = None
    else:
        summary_dns_txt_count = summary.get("dnsTxtRecordCount")
        if not isinstance(summary_dns_txt_count, int) or isinstance(
            summary_dns_txt_count, bool
        ):
            failures.append("launch summary dnsTxtRecordCount is missing")
        elif summary_dns_txt_count != len(fixture_txt_records):
            failures.append(
                "launch summary dnsTxtRecordCount does not match DNS fixture"
            )

    artifacts = summary.get("artifacts")
    if not isinstance(artifacts, dict):
        failures.append("launch summary artifacts is missing")
        artifacts = {}
    artifact_sha256 = summary.get("artifactSha256")
    if not isinstance(artifact_sha256, dict):
        failures.append("launch summary artifactSha256 is missing")
        artifact_sha256 = {}

    for key, artifact_name in LAUNCH_KIT_ARTIFACTS.items():
        if artifacts.get(key) != artifact_name:
            failures.append(
                f"launch summary artifact {key} is {artifacts.get(key)!r}, expected {artifact_name!r}"
            )

    try:
        checksum_entries, checksum_failures = parse_launch_kit_checksums(
            checksums_path.read_text(encoding="utf-8")
        )
    except OSError as exc:
        failures.append(f"could not read {checksums_path}: {exc}")
        checksum_entries, checksum_failures = {}, []
    failures.extend(checksum_failures)

    expected_checksum_names = set(LAUNCH_KIT_CHECKSUMMED_ARTIFACTS.values())
    actual_checksum_names = set(checksum_entries)
    missing_checksums = sorted(expected_checksum_names - actual_checksum_names)
    if missing_checksums:
        failures.append(f"checksums.txt is missing {', '.join(missing_checksums)}")
    extra_checksums = sorted(actual_checksum_names - expected_checksum_names)
    if extra_checksums:
        failures.append(
            f"checksums.txt includes unexpected artifacts: {', '.join(extra_checksums)}"
        )

    for key, artifact_name in LAUNCH_KIT_CHECKSUMMED_ARTIFACTS.items():
        artifact_path = root / artifact_name
        if not artifact_path.is_file():
            failures.append(f"launch kit artifact is missing: {artifact_name}")
            continue
        actual_digest = file_sha256(artifact_path)
        if artifact_sha256.get(key) != actual_digest:
            failures.append(f"artifactSha256.{key} does not match {artifact_name}")
        if checksum_entries.get(artifact_name) != actual_digest:
            failures.append(f"checksums.txt digest does not match {artifact_name}")
    failures.extend(scan_launch_kit_public_artifacts(root))

    kit_fixture_path = root / LAUNCH_KIT_ARTIFACTS["dnsFixture"]
    try:
        if file_sha256(kit_fixture_path) != file_sha256(Path(args.dns_fixture)):
            failures.append(
                "launch kit dns-fixture.json does not match readiness fixture"
            )
    except OSError as exc:
        failures.append(f"could not compare readiness fixture with launch kit: {exc}")

    if fixture_status_records is not None:
        status_records_result = validate_launch_kit_status_records(
            root / LAUNCH_KIT_ARTIFACTS["statusRecords"], fixture_status_records
        )
        if status_records_result:
            failures.append(status_records_result)
        web_env_result = validate_launch_kit_web_env(
            root / LAUNCH_KIT_ARTIFACTS["webEnv"],
            args,
            fixture_status_records,
            expected_site_url,
            summary_fetch_timeout_ms,
            summary_rate_limit_max,
            summary_rate_limit_window_ms,
        )
        if web_env_result:
            failures.append(web_env_result)
    if fixture_txt_records is not None:
        dns_zone_result = validate_launch_kit_dns_zone(
            root / LAUNCH_KIT_ARTIFACTS["dnsZone"],
            fixture_txt_records,
            summary_dns_ttl,
        )
        if dns_zone_result:
            failures.append(dns_zone_result)
    hn_readiness_result = validate_launch_kit_hn_readiness(
        root / LAUNCH_KIT_ARTIFACTS["hnReadiness"],
        args,
        expected_site_url,
    )
    if hn_readiness_result:
        failures.append(hn_readiness_result)
    runbook_result = validate_launch_kit_runbook(
        root / LAUNCH_KIT_ARTIFACTS["runbook"],
        args,
        expected_site_url,
    )
    if runbook_result:
        failures.append(runbook_result)

    if failures:
        return CheckResult("launch-kit", False, "; ".join(failures))
    return CheckResult(
        "launch-kit",
        True,
        "launch summary, fixture receipt metadata, DNS zone, web env, status records, HN wrapper, runbook, artifact hashes, checksum manifest, secret scan, and fixture copy match readiness inputs",
    )


def scan_launch_kit_public_artifacts(root: Path) -> list[str]:
    failures = []
    allowed_names = set(LAUNCH_KIT_ARTIFACTS.values()) | LAUNCH_KIT_ALLOWED_EXTRA_FILES
    try:
        entries = sorted(root.iterdir(), key=lambda path: path.name)
    except OSError as exc:
        return [f"could not list launch kit files: {exc}"]
    for artifact_path in entries:
        artifact_name = artifact_path.name
        if artifact_path.is_dir():
            failures.append(
                f"launch kit contains unexpected directory: {artifact_name}"
            )
            continue
        if not artifact_path.is_file():
            failures.append(
                f"launch kit contains unexpected non-file entry: {artifact_name}"
            )
            continue
        if artifact_name not in allowed_names:
            failures.append(f"launch kit contains unexpected file: {artifact_name}")
        try:
            text = artifact_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            failures.append(f"could not scan {artifact_name}: {exc}")
            continue
        failures.extend(private_key_failures(artifact_name, text))
    return failures


def private_key_failures(artifact_name: str, text: str) -> list[str]:
    failures = [
        f"{artifact_name} contains private key marker {marker!r}"
        for marker in PRIVATE_KEY_MARKERS
        if marker in text
    ]
    if text_contains_private_jwk(text):
        failures.append(f"{artifact_name} contains private JWK material")
    return failures


def text_contains_private_jwk(text: str) -> bool:
    if PRIVATE_JWK_TEXT_RE.search(text):
        return True
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return False
    return contains_private_jwk(parsed)


def contains_private_jwk(value: object) -> bool:
    if isinstance(value, dict):
        if (
            isinstance(value.get("d"), str)
            and isinstance(value.get("kty"), str)
            and value.get("kty") in PRIVATE_JWK_KTY_VALUES
        ):
            return True
        return any(contains_private_jwk(child) for child in value.values())
    if isinstance(value, list):
        return any(contains_private_jwk(child) for child in value)
    if isinstance(value, str):
        return text_contains_private_jwk(value)
    return False


def fixture_status_records_for_launch_kit(
    dns_fixture: str,
) -> list[dict[str, object]] | str:
    try:
        fixture = json.loads(Path(dns_fixture).read_text(encoding="utf-8"))
    except OSError as exc:
        return f"could not read DNS fixture status records for launch kit: {exc}"
    except json.JSONDecodeError as exc:
        return f"could not parse DNS fixture status records for launch kit: {exc}"
    if not isinstance(fixture, dict):
        return "DNS fixture is not an object while checking launch kit status records"
    status = fixture.get("status")
    if not isinstance(status, dict):
        return "DNS fixture status records are missing while checking launch kit"
    key = status.get("key")
    claim = status.get("claim")
    if not isinstance(key, dict) or not isinstance(claim, dict):
        return "DNS fixture key or claim status record is missing while checking launch kit"
    return [key, claim]


def validate_launch_kit_status_records(
    path: Path, fixture_status_records: list[dict[str, object]]
) -> str | None:
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return f"could not read {path}: {exc}"
    except json.JSONDecodeError as exc:
        return f"invalid status-records.json: {exc}"
    if not isinstance(records, list):
        return "status-records.json is not a JSON array"
    if not all(isinstance(record, dict) for record in records):
        return "status-records.json must contain only JSON objects"
    if canonical_json(records) != canonical_json(fixture_status_records):
        return "status-records.json does not match DNS fixture status records"
    return None


def validate_launch_kit_hn_readiness(
    path: Path, args: argparse.Namespace, expected_site_url: str | None
) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return f"could not read {path}: {exc}"

    repo = getattr(args, "repo", DEFAULT_REPO)
    branch = getattr(args, "branch", "main")
    show_hn_draft = getattr(args, "show_hn_draft", "docs/show-hn-draft.md")
    show_hn_draft_options = {show_hn_draft, "docs/show-hn-draft.md"}
    required_snippets = [
        "scripts\\hn_readiness.py",
        "Push-Location $RepoRoot",
        "Pop-Location",
        f'--health-url "{escape_ps(expected_site_url or args.health_url)}"',
        '--dns-fixture (Join-Path $KitDir "dns-fixture.json")',
        f'--file-or-hash "{escape_ps(args.file_or_hash)}"',
        f'--domain "{escape_ps(args.domain)}"',
        f'--status-base-url "{escape_ps(args.status_base_url)}"',
        f'--doh-endpoint "{escape_ps(args.doh_endpoint)}"',
        f'--repo "{escape_ps(repo)}"',
        f'--branch "{escape_ps(branch)}"',
        "--launch-kit $KitDir",
        '--evidence-out (Join-Path $KitDir "hn-readiness-evidence.json")',
    ]
    failures = [
        f"hn-readiness.ps1 is missing {snippet!r}"
        for snippet in required_snippets
        if snippet not in text
    ]
    if not any(
        f'--show-hn-draft "{escape_ps(candidate)}"' in text
        for candidate in show_hn_draft_options
    ):
        failures.append("hn-readiness.ps1 show-hn-draft argument does not match")
    if failures:
        return "; ".join(failures)
    return None


def validate_launch_kit_runbook(
    path: Path, args: argparse.Namespace, expected_site_url: str | None
) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return f"could not read {path}: {exc}"

    repo = getattr(args, "repo", DEFAULT_REPO)
    branch = getattr(args, "branch", "main")
    required_snippets = [
        "# GroundLock launch runbook",
        "`dns-fixture.json`",
        "`dns-zone.txt`",
        "`web.env`",
        "`status-records.json`",
        "`hn-readiness.ps1`",
        f'NEXT_PUBLIC_SITE_URL="{escape_ps(expected_site_url or args.health_url)}"',
        f"at `{args.status_base_url}`",
        f'groundlock warm-cache .\\dns-fixture.json --doh-endpoint "{escape_ps(args.doh_endpoint)}"',
        (
            f'groundlock check-live "{escape_ps(args.file_or_hash)}" '
            f'--domain "{escape_ps(args.domain)}" '
            f'--status-base-url "{escape_ps(args.status_base_url)}" '
            f'--doh-endpoint "{escape_ps(args.doh_endpoint)}"'
        ),
        ".\\hn-readiness.ps1",
        "checksums.txt",
        "launch-summary.json.artifactSha256",
        f"Repository: {repo}",
        f"Branch: {branch}",
    ]
    failures = [
        f"runbook.md is missing {snippet!r}"
        for snippet in required_snippets
        if snippet not in text
    ]
    if failures:
        return "; ".join(failures)
    return None


def escape_ps(value: str) -> str:
    return value.replace("`", "``").replace('"', '`"')


def parse_web_env(text: str) -> tuple[dict[str, str], list[str]]:
    entries: dict[str, str] = {}
    failures = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if "=" not in line:
            failures.append(f"web.env line {line_number} is missing '='")
            continue
        key, value = line.split("=", 1)
        if key != key.strip() or not key:
            failures.append(f"web.env line {line_number} has an invalid key")
            continue
        if not re.fullmatch(r"[A-Z0-9_]+", key):
            failures.append(f"web.env line {line_number} has unsupported key {key!r}")
            continue
        if key in entries:
            failures.append(f"web.env repeats key {key!r}")
        entries[key] = value
    return entries, failures


def validate_launch_kit_web_env(
    path: Path,
    args: argparse.Namespace,
    fixture_status_records: list[dict[str, object]],
    expected_site_url: str | None,
    expected_fetch_timeout_ms: int | None,
    expected_rate_limit_max: int | None,
    expected_rate_limit_window_ms: int | None,
) -> str | None:
    try:
        entries, failures = parse_web_env(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return f"could not read {path}: {exc}"
    if failures:
        return "; ".join(failures)

    required = {
        "GROUNDLOCK_SIGNER_DOMAIN",
        "NEXT_PUBLIC_SITE_URL",
        "GROUNDLOCK_DOH_ENDPOINT",
        "GROUNDLOCK_STATUS_BASE_URL",
        "GROUNDLOCK_FETCH_TIMEOUT_MS",
        "GROUNDLOCK_RATE_LIMIT_MAX",
        "GROUNDLOCK_RATE_LIMIT_WINDOW_MS",
        "GROUNDLOCK_STATUS_RECORDS_JSON",
    }
    missing = sorted(required - set(entries))
    if missing:
        return f"web.env is missing {', '.join(missing)}"

    web_env_failures = []
    signer_domain = entries["GROUNDLOCK_SIGNER_DOMAIN"]
    if normalize_domain(signer_domain) != normalize_domain(args.domain):
        web_env_failures.append("web.env signer domain does not match readiness input")
    if entries["NEXT_PUBLIC_SITE_URL"] != expected_site_url:
        web_env_failures.append("web.env site URL does not match health-url origin")
    if entries["GROUNDLOCK_DOH_ENDPOINT"] != args.doh_endpoint:
        web_env_failures.append("web.env DoH endpoint does not match readiness input")
    if entries["GROUNDLOCK_STATUS_BASE_URL"] != args.status_base_url:
        web_env_failures.append(
            "web.env status base URL does not match readiness input"
        )
    timeout_raw = entries["GROUNDLOCK_FETCH_TIMEOUT_MS"]
    try:
        timeout_ms = int(timeout_raw)
    except ValueError:
        web_env_failures.append("web.env fetch timeout is not an integer")
    else:
        if timeout_ms < 1 or timeout_ms > MAX_FETCH_TIMEOUT_MS:
            web_env_failures.append(
                f"web.env fetch timeout must be between 1 and {MAX_FETCH_TIMEOUT_MS} ms"
            )
        elif (
            expected_fetch_timeout_ms is not None
            and timeout_ms != expected_fetch_timeout_ms
        ):
            web_env_failures.append(
                "web.env fetch timeout does not match launch summary"
            )
    rate_limit_max = parse_positive_safe_int(entries["GROUNDLOCK_RATE_LIMIT_MAX"])
    if rate_limit_max is None:
        web_env_failures.append(
            "web.env rate limit max must be a positive safe integer"
        )
    elif (
        expected_rate_limit_max is not None
        and rate_limit_max != expected_rate_limit_max
    ):
        web_env_failures.append("web.env rate limit max does not match launch summary")
    rate_limit_window_ms = parse_positive_safe_int(
        entries["GROUNDLOCK_RATE_LIMIT_WINDOW_MS"]
    )
    if rate_limit_window_ms is None:
        web_env_failures.append(
            "web.env rate limit window must be a positive safe integer"
        )
    elif (
        expected_rate_limit_window_ms is not None
        and rate_limit_window_ms != expected_rate_limit_window_ms
    ):
        web_env_failures.append(
            "web.env rate limit window does not match launch summary"
        )
    try:
        bundled_status_records = json.loads(entries["GROUNDLOCK_STATUS_RECORDS_JSON"])
    except json.JSONDecodeError as exc:
        web_env_failures.append(f"web.env status records JSON is invalid: {exc}")
    else:
        if canonical_json(bundled_status_records) != canonical_json(
            fixture_status_records
        ):
            web_env_failures.append(
                "web.env status records JSON does not match DNS fixture status records"
            )

    if web_env_failures:
        return "; ".join(web_env_failures)
    return None


def parse_positive_safe_int(value: str) -> int | None:
    try:
        parsed = int(value)
    except ValueError:
        return None
    if str(parsed) != value.strip():
        return None
    if parsed < 1 or parsed > MAX_SAFE_INTEGER:
        return None
    return parsed


def fixture_txt_records_for_launch_kit(dns_fixture: str) -> dict[str, list[str]] | str:
    try:
        fixture = json.loads(Path(dns_fixture).read_text(encoding="utf-8"))
    except OSError as exc:
        return f"could not read DNS fixture TXT records for launch kit: {exc}"
    except json.JSONDecodeError as exc:
        return f"could not parse DNS fixture TXT records for launch kit: {exc}"
    if not isinstance(fixture, dict):
        return "DNS fixture is not an object while checking launch kit DNS zone"
    txt = fixture.get("txt")
    if not isinstance(txt, dict):
        return "DNS fixture TXT records are missing while checking launch kit DNS zone"
    normalized, failures = normalize_fixture_txt_records(txt)
    if failures:
        return "; ".join(failures)
    return normalized


def validate_launch_kit_dns_zone(
    path: Path,
    fixture_txt_records: dict[str, list[str]],
    expected_ttl: int | None,
) -> str | None:
    try:
        zone_records, zone_ttls, failures = parse_dns_zone_txt_records(
            path.read_text(encoding="utf-8")
        )
    except OSError as exc:
        return f"could not read {path}: {exc}"
    if failures:
        return "; ".join(failures)
    if expected_ttl is not None:
        mismatched_ttl_names = sorted(
            name for name, ttls in zone_ttls.items() if ttls != {expected_ttl}
        )
        if mismatched_ttl_names:
            return (
                "dns-zone.txt TTLs do not match launch summary for "
                f"{', '.join(mismatched_ttl_names)}"
            )
    if sorted(zone_records) != sorted(fixture_txt_records):
        return "dns-zone.txt record names do not match DNS fixture TXT records"
    for name, values in fixture_txt_records.items():
        if sorted(zone_records.get(name, [])) != sorted(values):
            return (
                f"dns-zone.txt values do not match DNS fixture TXT records for {name}"
            )
    return None


def parse_dns_zone_txt_records(
    text: str,
) -> tuple[dict[str, list[str]], dict[str, set[int]], list[str]]:
    records: dict[str, list[str]] = {}
    ttls: dict[str, set[int]] = {}
    failures = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith(";") or stripped.startswith("#"):
            continue
        match = re.fullmatch(r"(\S+)\s+(\d+)\s+IN\s+TXT\s+(.+)", stripped, re.I)
        if not match:
            failures.append(f"dns-zone.txt line {line_number} is not a TXT record")
            continue
        name, ttl_raw, rdata = match.groups()
        if int(ttl_raw) <= 0:
            failures.append(f"dns-zone.txt line {line_number} has invalid TTL")
            continue
        ttl = int(ttl_raw)
        value, rdata_error = parse_zone_txt_rdata(rdata)
        if rdata_error:
            failures.append(f"dns-zone.txt line {line_number} {rdata_error}")
            continue
        normalized_name = normalize_domain(name)
        records.setdefault(normalized_name, []).append(value)
        ttls.setdefault(normalized_name, set()).add(ttl)
    return records, ttls, failures


def parse_zone_txt_rdata(value: str) -> tuple[str, str | None]:
    segments = []
    index = 0
    while index < len(value):
        while index < len(value) and value[index].isspace():
            index += 1
        if index >= len(value):
            break
        if value[index] != '"':
            return "", "TXT value must use quoted strings"
        index += 1
        chars = []
        while index < len(value):
            char = value[index]
            if char == "\\":
                index += 1
                if index >= len(value):
                    return "", "TXT value has trailing escape"
                chars.append(value[index])
                index += 1
                continue
            if char == '"':
                index += 1
                break
            chars.append(char)
            index += 1
        else:
            return "", "TXT value has unterminated quote"
        segments.append("".join(chars))
    if not segments:
        return "", "TXT value is missing"
    return "".join(segments), None


def validate_fixture_txt_records(
    txt: dict[object, object], expected_domain: str, content_hash: str
) -> tuple[list[str], FixtureManifest | None]:
    failures = []
    normalized, normalized_failures = normalize_fixture_txt_records(txt)
    failures.extend(normalized_failures)

    identity_name = f"_truename.{expected_domain}"
    identity_values = normalized.get(identity_name)
    identity_kid = None
    if identity_values is None:
        failures.append(f"fixture identity TXT record is missing: {identity_name}")
    else:
        identity_kid = parse_fixture_identity_kid(identity_values)
        if identity_kid is None:
            failures.append(
                f"fixture identity TXT record is malformed or ambiguous: {identity_name}"
            )

    manifest_suffix = f"._groundlock.{expected_domain}"
    expected_manifest_name = f"gl-{cache_label(content_hash)}{manifest_suffix}"
    manifest_values = normalized.get(expected_manifest_name, [])
    manifest, manifest_error = parse_fixture_manifest(manifest_values)
    if manifest_error == "missing":
        failures.append(
            f"fixture cache manifest TXT record for demo hash is missing: {expected_manifest_name}"
        )
    elif manifest_error == "malformed":
        failures.append(
            f"fixture cache manifest TXT record is malformed: {expected_manifest_name}"
        )
    elif manifest_error == "ambiguous":
        failures.append(
            f"fixture cache manifest TXT record is ambiguous: {expected_manifest_name}"
        )

    if manifest is not None:
        if manifest.signer_domain != expected_domain:
            failures.append(
                "fixture cache manifest signer domain does not match launch domain"
            )
        if identity_kid is not None and identity_kid != manifest.kid:
            failures.append(
                "fixture identity TXT record does not match cache manifest key"
            )
        chunk_failures, payload = validate_manifest_chunks(
            normalized, expected_manifest_name, manifest.chunk_count
        )
        failures.extend(chunk_failures)
        if payload is not None and digest_utf8(payload) != manifest.payload_hash:
            failures.append(
                "fixture DNS cache payload hash does not match cache manifest"
            )
        elif payload is not None:
            failures.extend(
                validate_cached_receipt_payload(payload, content_hash, manifest)
            )

    return failures, manifest


def fixture_manifest_for_input(
    path: str, domain: str, file_or_hash: str
) -> FixtureManifest:
    content_hash = content_hash_for_input(file_or_hash)
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("fixture is not a JSON object")
    txt = data.get("txt")
    if not isinstance(txt, dict) or not txt:
        raise ValueError("fixture txt records are missing")
    normalized, failures = normalize_fixture_txt_records(txt)
    if failures:
        raise ValueError("; ".join(failures))

    expected_domain = normalize_domain(domain)
    expected_manifest_name = (
        f"gl-{cache_label(content_hash)}._groundlock.{expected_domain}"
    )
    manifest, manifest_error = parse_fixture_manifest(
        normalized.get(expected_manifest_name, [])
    )
    if manifest is None:
        detail = manifest_error or "missing"
        raise ValueError(
            f"fixture cache manifest TXT record for demo hash is {detail}: "
            f"{expected_manifest_name}"
        )
    return manifest


def fixture_receipt_metadata_for_launch_kit(
    path: str, domain: str, file_or_hash: str
) -> FixtureReceiptMetadata | str:
    try:
        content_hash = content_hash_for_input(file_or_hash)
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        return f"could not read DNS fixture receipt metadata for launch kit: {exc}"
    except json.JSONDecodeError as exc:
        return f"could not parse DNS fixture receipt metadata for launch kit: {exc}"
    except Exception as exc:
        return f"could not compute DNS fixture receipt metadata for launch kit: {exc}"
    if not isinstance(data, dict):
        return "DNS fixture is not an object while checking launch kit receipt metadata"
    txt = data.get("txt")
    if not isinstance(txt, dict) or not txt:
        return "DNS fixture TXT records are missing while checking launch kit receipt metadata"
    normalized, failures = normalize_fixture_txt_records(txt)
    if failures:
        return "; ".join(failures)

    expected_domain = normalize_domain(domain)
    expected_manifest_name = (
        f"gl-{cache_label(content_hash)}._groundlock.{expected_domain}"
    )
    manifest, manifest_error = parse_fixture_manifest(
        normalized.get(expected_manifest_name, [])
    )
    if manifest is None:
        detail = manifest_error or "missing"
        return (
            "could not read cached receipt metadata because fixture cache manifest "
            f"TXT record for demo hash is {detail}: {expected_manifest_name}"
        )
    chunk_failures, payload = validate_manifest_chunks(
        normalized, expected_manifest_name, manifest.chunk_count
    )
    if chunk_failures:
        return "; ".join(chunk_failures)
    if payload is None:
        return "fixture DNS cache payload is missing while checking launch kit receipt metadata"
    if digest_utf8(payload) != manifest.payload_hash:
        return "fixture DNS cache payload hash does not match cache manifest"

    receipt = parse_base64url_json_object(payload)
    if receipt is None:
        return "fixture DNS cache payload is malformed receipt JSON"
    payload_failures = validate_cached_receipt_payload(payload, content_hash, manifest)
    if payload_failures:
        return "; ".join(payload_failures)
    verdict = receipt.get("verdict")
    issued_at = receipt.get("issuedAt")
    content_class = receipt.get("contentClass")
    if (
        not isinstance(verdict, str)
        or not isinstance(issued_at, str)
        or not isinstance(content_class, str)
    ):
        return "fixture cached receipt metadata is malformed"
    return FixtureReceiptMetadata(
        verdict=verdict,
        issued_at=issued_at,
        content_class=content_class,
    )


def normalize_fixture_txt_records(
    txt: dict[object, object],
) -> tuple[dict[str, list[str]], list[str]]:
    failures = []
    normalized: dict[str, list[str]] = {}
    for name, values in txt.items():
        if (
            not isinstance(name, str)
            or not isinstance(values, list)
            or not all(isinstance(value, str) for value in values)
        ):
            failures.append("fixture TXT answers must map names to string arrays")
            break
        normalized[normalize_domain(name)] = values
    return normalized, failures


def parse_fixture_manifest(
    values: list[str],
) -> tuple[FixtureManifest | None, str | None]:
    if not values:
        return None, "missing"
    parsed = set()
    malformed = False
    for value in values:
        manifest = parse_fixture_manifest_record(value)
        if manifest is None:
            malformed = True
            continue
        parsed.add(manifest)
    if len(parsed) == 1:
        return next(iter(parsed)), None
    if not parsed and malformed:
        return None, "malformed"
    return None, "ambiguous"


def parse_fixture_manifest_record(value: str) -> FixtureManifest | None:
    if not value.startswith("gdm1 "):
        return None
    parts = parse_kv_record(value, "gdm1")
    receipt_hash = parts.get("rh")
    payload_hash = parts.get("ph")
    chunk_count_raw = parts.get("n")
    key = parts.get("key")
    if (
        not receipt_hash
        or not payload_hash
        or not chunk_count_raw
        or not key
        or "#" not in key
    ):
        return None
    try:
        chunk_count = int(chunk_count_raw)
    except ValueError:
        return None
    if chunk_count <= 0:
        return None
    signer_domain, kid = key.split("#", 1)
    if not signer_domain or not kid:
        return None
    return FixtureManifest(
        receipt_hash=ensure_sha256(receipt_hash),
        payload_hash=ensure_sha256(payload_hash),
        signer_domain=normalize_domain(signer_domain),
        kid=kid,
        chunk_count=chunk_count,
    )


def parse_fixture_identity_kid(values: list[str]) -> str | None:
    identities = set()
    for value in values:
        if not value.startswith("glt1 "):
            continue
        parts = parse_kv_record(value, "glt1")
        kid = parts.get("kid")
        alg = parts.get("alg")
        jwk = parts.get("jwk")
        if not kid or alg != "EdDSA" or not jwk:
            continue
        public_key = parse_base64url_json_object(jwk)
        if public_key is None:
            continue
        identities.add((kid, canonical_json(public_key)))
    if len(identities) != 1:
        return None
    return next(iter(identities))[0]


def parse_base64url_json_object(value: str) -> dict[str, object] | None:
    try:
        padding = "=" * (-len(value) % 4)
        raw = base64.b64decode(f"{value}{padding}", altchars=b"-_", validate=True)
        parsed = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def canonical_json(value: object) -> str:
    return serialize_json(value)


def serialize_json(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, str):
        return json.dumps(unicodedata.normalize("NFC", value), ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        if (
            not isinstance(value, bool)
            and value == value
            and value not in {float("inf"), float("-inf")}
        ):
            return json.dumps(value, separators=(",", ":"))
        return "null"
    if isinstance(value, list):
        return "[" + ",".join(serialize_json(item) for item in value) + "]"
    if isinstance(value, dict):
        items = []
        for key in sorted(value):
            if not isinstance(key, str):
                continue
            items.append(
                json.dumps(unicodedata.normalize("NFC", key), ensure_ascii=False)
                + ":"
                + serialize_json(value[key])
            )
        return "{" + ",".join(items) + "}"
    return "null"


def validate_manifest_chunks(
    txt: dict[str, list[str]], manifest_name: str, chunk_count: int
) -> tuple[list[str], str | None]:
    failures = []
    chunks: list[str] = []
    for index in range(chunk_count):
        chunk_name = f"c{index}.{manifest_name}"
        values = txt.get(chunk_name)
        if not values:
            failures.append(f"fixture cache chunk TXT record is missing: {chunk_name}")
            continue
        error, data = validate_fixture_chunk(values, index)
        if error == "malformed":
            failures.append(
                f"fixture cache chunk TXT record is malformed: {chunk_name}"
            )
        elif error == "ambiguous":
            failures.append(
                f"fixture cache chunk TXT record is ambiguous: {chunk_name}"
            )
        elif data is not None:
            chunks.append(data)
    return failures, "".join(chunks) if not failures else None


def validate_fixture_chunk(
    values: list[str], expected_index: int
) -> tuple[str | None, str | None]:
    data_values = set()
    malformed = False
    for value in values:
        data = parse_fixture_chunk_data(value, expected_index)
        if data is None:
            malformed = True
            continue
        data_values.add(data)
    if len(data_values) == 1:
        return None, next(iter(data_values))
    if not data_values and malformed:
        return "malformed", None
    return "ambiguous", None


def parse_fixture_chunk_data(value: str, expected_index: int) -> str | None:
    if not value.startswith("gdc1 "):
        return None
    parts = parse_kv_record(value, "gdc1")
    index_raw = parts.get("i")
    data = parts.get("d")
    if not index_raw or not data:
        return None
    try:
        index = int(index_raw)
    except ValueError:
        return None
    if index != expected_index or not CHUNK_DATA_RE.match(data):
        return None
    return data


def validate_cached_receipt_payload(
    payload: str, content_hash: str, manifest: FixtureManifest
) -> list[str]:
    receipt = parse_base64url_json_object(payload)
    if receipt is None:
        return ["fixture DNS cache payload is malformed receipt JSON"]
    signer_domain = receipt.get("signerDomain")
    signer_key_id = receipt.get("signerKeyId")
    candidate_hash = receipt.get("candidateHash")
    content_hashes = receipt.get("contentHashes")
    if (
        not isinstance(signer_domain, str)
        or not isinstance(signer_key_id, str)
        or not isinstance(candidate_hash, str)
        or not isinstance(content_hashes, list)
    ):
        return ["fixture cached receipt is malformed"]

    failures = []
    if (
        normalize_domain(signer_domain) != manifest.signer_domain
        or signer_key_id != manifest.kid
    ):
        failures.append("fixture cached receipt signer does not match cache manifest")
    if candidate_hash != content_hash:
        failures.append("fixture cached receipt candidateHash does not match demo hash")
    if not has_candidate_content_hash(content_hashes, content_hash):
        failures.append("fixture cached receipt does not describe demo hash")
    if not has_candidate_content_hash(content_hashes, candidate_hash):
        failures.append(
            "fixture cached receipt contentHashes do not include candidateHash"
        )
    if receipt_status_hash(receipt) != manifest.receipt_hash:
        failures.append(
            "fixture cached receipt body hash does not match cache manifest"
        )
    return failures


def has_candidate_content_hash(values: list[object], content_hash: str) -> bool:
    for value in values:
        if not isinstance(value, dict):
            continue
        if value.get("role") == "candidate" and value.get("value") == content_hash:
            return True
    return False


def receipt_status_hash(receipt: dict[str, object]) -> str:
    body = {key: value for key, value in receipt.items() if key != "signature"}
    return digest_utf8(canonical_json(body))


def parse_kv_record(value: str, prefix: str) -> dict[str, str]:
    tokens = value.split()
    if not tokens or tokens[0] != prefix:
        return {}
    pairs = {}
    for token in tokens[1:]:
        if "=" not in token:
            continue
        key, item = token.split("=", 1)
        pairs[key] = item
    return pairs


def validate_key_status_record(
    record: dict[object, object], manifest: FixtureManifest
) -> list[str]:
    failures = []
    subject = record.get("subject")
    if not isinstance(subject, dict):
        return ["fixture key status subject is missing"]
    signer_domain = subject.get("signerDomain")
    kid = subject.get("kid")
    if (
        not isinstance(signer_domain, str)
        or normalize_domain(signer_domain) != manifest.signer_domain
        or kid != manifest.kid
    ):
        failures.append("fixture key status does not match cache manifest key")
    if record.get("status") != "active":
        failures.append("fixture key status is not active")
    return failures


def validate_status_record_shape(
    record: dict[object, object], expected_kind: str
) -> list[str]:
    if (
        record.get("version") != "groundlock-status/v1"
        or record.get("kind") != expected_kind
        or not isinstance(record.get("issuedAt"), str)
        or not record.get("issuedAt")
        or record.get("status") not in STATUS_VALUES
        or ("reason" in record and not isinstance(record.get("reason"), str))
    ):
        return [f"fixture {expected_kind} status record is malformed"]
    return []


def validate_claim_status_record(
    record: dict[object, object], manifest: FixtureManifest
) -> list[str]:
    failures = []
    subject = record.get("subject")
    if not isinstance(subject, dict):
        return ["fixture claim status subject is missing"]
    receipt_hash = subject.get("receiptHash")
    if (
        not isinstance(receipt_hash, str)
        or ensure_sha256(receipt_hash) != manifest.receipt_hash
    ):
        failures.append("fixture claim status does not match cache manifest receipt")
    if record.get("status") != "active":
        failures.append("fixture claim status is not active")
    return failures


def normalize_domain(value: str) -> str:
    return value.strip().rstrip(".").lower()


def ensure_sha256(value: str) -> str:
    return value if value.startswith("sha256:") else f"sha256:{value}"


def content_hash_for_input(file_or_hash: str) -> str:
    if file_or_hash.startswith("sha256:"):
        if len(file_or_hash) <= len("sha256:"):
            raise ValueError("empty_sha256_hash")
        return file_or_hash
    data = Path(file_or_hash).read_bytes()
    if len(data) > MAX_WEB_VERIFY_BYTES:
        raise ValueError("web_verify_input_too_large")
    return digest_text(data.decode("utf-8"))


def digest_text(value: str) -> str:
    canonical = canonicalize_text(value)
    return digest_utf8(canonical)


def digest_utf8(value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    encoded = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f"sha256:{encoded}"


def canonicalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    replacements = {
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2015": "-",
        "\u2010": "-",
        "\u2011": "-",
        "\u2212": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\u2026": "...",
        "\u00a0": " ",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    return normalized


def cache_label(value: str) -> str:
    hash_value = value[len("sha256:") :] if value.startswith("sha256:") else value
    return re.sub(r"[^a-z0-9-]", "-", hash_value.lower().replace("_", "-"))


def build_check_live_argv(
    file_or_hash: str,
    domain: str,
    status_base_url: str,
    doh_endpoint: str | None = None,
) -> list[str]:
    argv = [
        "node",
        str(CLI_PATH),
        "check-live",
        file_or_hash,
        "--domain",
        domain,
        "--status-base-url",
        status_base_url,
    ]
    if doh_endpoint:
        argv.extend(["--doh-endpoint", doh_endpoint])
    return argv


def build_warm_cache_argv(
    dns_fixture: str, doh_endpoint: str | None = None
) -> list[str]:
    argv = ["node", str(CLI_PATH), "warm-cache", dns_fixture]
    if doh_endpoint:
        argv.extend(["--doh-endpoint", doh_endpoint])
    return argv


def check_warm_cache(dns_fixture: str, doh_endpoint: str | None = None) -> CheckResult:
    if not CLI_PATH.is_file():
        return CheckResult(
            "warm-cache", False, f"missing built CLI at {CLI_PATH}; run npm run build"
        )

    argv = build_warm_cache_argv(dns_fixture, doh_endpoint)
    proc = subprocess.run(argv, cwd=str(ROOT), capture_output=True, text=True)
    output = "\n".join(
        part for part in [proc.stdout.strip(), proc.stderr.strip()] if part
    )
    if proc.returncode != 0:
        return CheckResult(
            "warm-cache", False, output or f"warm-cache exited {proc.returncode}"
        )
    if not proc.stdout.lstrip().startswith("PASS "):
        return CheckResult(
            "warm-cache", False, output or "warm-cache did not report PASS"
        )
    return CheckResult("warm-cache", True, proc.stdout.strip())


def check_live_receipt(
    file_or_hash: str,
    domain: str,
    status_base_url: str,
    doh_endpoint: str | None = None,
) -> CheckResult:
    if not CLI_PATH.is_file():
        return CheckResult(
            "check-live", False, f"missing built CLI at {CLI_PATH}; run npm run build"
        )

    argv = build_check_live_argv(file_or_hash, domain, status_base_url, doh_endpoint)
    proc = subprocess.run(argv, cwd=str(ROOT), capture_output=True, text=True)
    output = "\n".join(
        part for part in [proc.stdout.strip(), proc.stderr.strip()] if part
    )
    if proc.returncode != 0:
        return CheckResult(
            "check-live", False, output or f"check-live exited {proc.returncode}"
        )
    if not proc.stdout.lstrip().startswith("PASS "):
        return CheckResult(
            "check-live", False, output or "check-live did not report PASS"
        )
    return CheckResult("check-live", True, proc.stdout.strip())


def check_git_clean() -> CheckResult:
    proc = subprocess.run(
        ["git", "status", "--short"], cwd=str(ROOT), capture_output=True, text=True
    )
    if proc.returncode != 0:
        return CheckResult("git", False, proc.stderr.strip() or "git status failed")
    if proc.stdout.strip():
        return CheckResult("git", False, "worktree is not clean")
    return CheckResult("git", True, "worktree clean")


def current_git_head() -> str | None:
    proc = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(ROOT), capture_output=True, text=True
    )
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None


def validate_ci_runs(runs: object, expected_head_sha: str | None) -> CheckResult:
    if not isinstance(runs, list) or not runs:
        return CheckResult("ci", False, "no CI runs found")

    run = runs[0]
    if not isinstance(run, dict):
        return CheckResult("ci", False, "CI run data is malformed")
    status = run.get("status")
    conclusion = run.get("conclusion")
    head_sha = run.get("headSha")
    evidence = {
        key: run[key]
        for key in (
            "databaseId",
            "number",
            "url",
            "workflowName",
            "headSha",
            "status",
            "conclusion",
        )
        if key in run and run[key] is not None
    }
    if expected_head_sha and head_sha != expected_head_sha:
        return CheckResult(
            "ci",
            False,
            f"latest CI headSha={head_sha} does not match current HEAD={expected_head_sha}",
            evidence,
        )
    if status != "completed" or conclusion != "success":
        return CheckResult(
            "ci",
            False,
            f"latest CI is status={status} conclusion={conclusion}",
            evidence,
        )
    return CheckResult(
        "ci", True, f"latest CI run {run.get('databaseId')} succeeded", evidence
    )


def check_ci(repo: str, branch: str) -> CheckResult:
    if shutil.which("gh") is None:
        return CheckResult("ci", False, "GitHub CLI gh is required to verify CI status")

    expected_head_sha = current_git_head()
    if expected_head_sha is None:
        return CheckResult("ci", False, "could not read current git HEAD")

    proc = subprocess.run(
        [
            "gh",
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            "CI",
            "--branch",
            branch,
            "--limit",
            "1",
            "--json",
            "status,conclusion,headSha,databaseId,number,url,workflowName",
        ],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return CheckResult("ci", False, proc.stderr.strip() or "gh run list failed")

    try:
        runs = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return CheckResult("ci", False, f"could not parse gh output: {exc}")
    return validate_ci_runs(runs, expected_head_sha)


def utc_timestamp() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).digest()
    encoded = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f"sha256:{encoded}"


def evidence_status_endpoints(args: argparse.Namespace) -> dict[str, object]:
    fixture_status_records = fixture_status_records_for_launch_kit(args.dns_fixture)
    if isinstance(fixture_status_records, str):
        return {"error": fixture_status_records}
    expectations, failures = status_endpoint_expectations(fixture_status_records)
    if failures:
        return {"error": "; ".join(failures)}
    return {
        kind: {
            "lookup": lookup,
            "url": status_endpoint_url(args.status_base_url, kind, lookup),
            "recordSha256": digest_utf8(canonical_json(record)),
        }
        for kind, lookup, record in expectations
    }


def evidence_inputs(args: argparse.Namespace) -> dict[str, object]:
    inputs: dict[str, object] = {
        "healthUrl": args.health_url,
        "homepageUrl": homepage_url(args.health_url),
        "verifyEndpoint": verify_endpoint(args.health_url),
        "shareImageUrl": share_image_url(args.health_url),
        "robotsEndpoint": robots_endpoint(args.health_url),
        "sitemapEndpoint": sitemap_endpoint(args.health_url),
        "dnsFixture": args.dns_fixture,
        "fileOrHash": args.file_or_hash,
        "domain": args.domain,
        "statusBaseUrl": args.status_base_url,
        "statusEndpoints": evidence_status_endpoints(args),
        "dohEndpoint": args.doh_endpoint,
        "repo": args.repo,
        "branch": args.branch,
        "showHnDraft": args.show_hn_draft,
    }
    launch_kit = getattr(args, "launch_kit", None)
    if launch_kit:
        inputs["launchKit"] = launch_kit
    return inputs


def result_evidence(result: CheckResult) -> dict[str, object]:
    evidence: dict[str, object] = {
        "name": result.name,
        "ok": result.ok,
        "detail": result.detail,
    }
    if result.evidence is not None:
        evidence["evidence"] = result.evidence
    return evidence


def build_evidence_report(
    args: argparse.Namespace, results: list[CheckResult]
) -> dict[str, object]:
    contract_path = ROOT / "apps" / "web" / "lib" / "security-header-contract.json"
    return {
        "schema": "groundlock-hn-readiness-evidence/v1",
        "generatedAt": utc_timestamp(),
        "ok": all(result.ok for result in results),
        "gitHead": current_git_head(),
        "securityHeaderContract": {
            "path": str(contract_path.relative_to(ROOT)),
            "sha256": file_sha256(contract_path),
        },
        "inputs": evidence_inputs(args),
        "checks": [result_evidence(result) for result in results],
    }


def write_evidence_report(
    path: str, args: argparse.Namespace, results: list[CheckResult]
) -> CheckResult:
    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        report = build_evidence_report(args, results)
        target.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    except Exception as exc:
        return CheckResult("evidence", False, f"could not write evidence report: {exc}")
    return CheckResult("evidence", True, f"wrote readiness evidence to {path}")


def check_evidence_target(path: str, launch_kit: str | None = None) -> CheckResult:
    target = Path(path)
    if target.exists() and target.is_dir():
        return CheckResult("evidence-target", False, "evidence-out is a directory")

    if launch_kit:
        launch_root = Path(launch_kit).resolve()
        resolved_target = target.resolve()
        allowed_target = (launch_root / LAUNCH_KIT_EVIDENCE_ARTIFACT).resolve()
        if (
            resolved_target.is_relative_to(launch_root)
            and resolved_target != allowed_target
        ):
            return CheckResult(
                "evidence-target",
                False,
                "evidence-out inside launch kit must be "
                "hn-readiness-evidence.json at the launch kit root",
            )

    return CheckResult("evidence-target", True, "evidence output target is valid")


def check_launch_kit_evidence_required(
    launch_kit: str | None, evidence_out: str | None
) -> CheckResult:
    if launch_kit and not evidence_out:
        return CheckResult(
            "evidence-target",
            False,
            "--evidence-out is required when --launch-kit is used",
        )
    return CheckResult(
        "evidence-target", True, "launch evidence output requirement is satisfied"
    )


def run_checks(args: argparse.Namespace) -> list[CheckResult]:
    preflight = [
        check_git_clean(),
        check_show_hn_draft(Path(args.show_hn_draft)),
        check_launch_targets(args),
        check_dns_fixture(args.dns_fixture, args.domain, args.file_or_hash),
    ]
    launch_kit = getattr(args, "launch_kit", None)
    if launch_kit:
        preflight.append(check_launch_kit(launch_kit, args))
    evidence_out = getattr(args, "evidence_out", None)
    preflight.append(check_launch_kit_evidence_required(launch_kit, evidence_out))
    if evidence_out:
        preflight.append(check_evidence_target(evidence_out, launch_kit))
    if any(not result.ok for result in preflight):
        return preflight

    try:
        fixture_manifest = fixture_manifest_for_input(
            args.dns_fixture, args.domain, args.file_or_hash
        )
    except Exception as exc:
        return [
            *preflight,
            CheckResult(
                "dns-fixture",
                False,
                f"could not read DNS fixture receipt after preflight: {exc}",
            ),
        ]
    fixture_status_records = fixture_status_records_for_launch_kit(args.dns_fixture)
    if isinstance(fixture_status_records, str):
        return [
            *preflight,
            CheckResult("status-endpoints", False, fixture_status_records),
        ]

    return [
        *preflight,
        check_ci(args.repo, args.branch),
        check_health_url(args.health_url, args.status_base_url),
        check_homepage_metadata(args.health_url),
        check_share_image(args.health_url),
        check_public_discovery_files(args.health_url),
        check_security_headers(args.health_url),
        check_status_endpoints(args.status_base_url, fixture_status_records),
        check_warm_cache(args.dns_fixture, args.doh_endpoint),
        check_live_receipt(
            args.file_or_hash, args.domain, args.status_base_url, args.doh_endpoint
        ),
        check_web_verify(
            args.health_url,
            args.file_or_hash,
            args.domain,
            fixture_manifest.receipt_hash,
        ),
    ]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit external Show HN launch readiness evidence."
    )
    parser.add_argument(
        "--health-url",
        required=True,
        help="deployed verifier root URL or exact /api/health URL",
    )
    parser.add_argument(
        "--file-or-hash",
        required=True,
        help="public demo file path or sha256: hash for check-live",
    )
    parser.add_argument(
        "--dns-fixture",
        required=True,
        help="dns-fixture.json for warm-cache",
    )
    parser.add_argument("--domain", required=True, help="publisher signer domain")
    parser.add_argument(
        "--status-base-url", required=True, help="public status endpoint base URL"
    )
    parser.add_argument(
        "--doh-endpoint", required=True, help="DNS-over-HTTPS endpoint for launch"
    )
    parser.add_argument(
        "--repo", default=DEFAULT_REPO, help="GitHub repository for CI verification"
    )
    parser.add_argument(
        "--branch", default="main", help="GitHub branch for CI verification"
    )
    parser.add_argument(
        "--show-hn-draft", default=str(DEFAULT_DRAFT_PATH), help="Show HN draft path"
    )
    parser.add_argument(
        "--launch-kit",
        help="optional launch-kit directory whose summary, artifacts, and checksums must match the readiness inputs",
    )
    parser.add_argument(
        "--evidence-out",
        help="optional path for a machine-readable readiness evidence JSON report",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    results = run_checks(args)
    if args.evidence_out:
        results = [*results, write_evidence_report(args.evidence_out, args, results)]
    for result in results:
        state = "PASS" if result.ok else "FAIL"
        print(f"{state} {result.name}: {result.detail}")
    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())

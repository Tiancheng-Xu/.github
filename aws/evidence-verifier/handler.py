import hashlib
import ipaddress
import json
import re
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


MAX_BODY_BYTES = 1024 * 1024
TIMEOUT_SECONDS = 3
ALLOWED_EVENT_KEYS = {
    "projectId",
    "repository",
    "headSha",
    "deliveryStatus",
    "productionUrl",
    "evidenceUrl",
    "checks",
    "expectedMarkers",
    "verificationRunId",
    "budgetActualBefore",
}
ALLOWED_RESPONSE_HEADERS = ("content-type", "etag", "last-modified", "cache-control")
PROJECT_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REPOSITORY_PATTERN = re.compile(r"^Tiancheng-Xu/[A-Za-z0-9._-]+$")
SHA_PATTERN = re.compile(r"^[a-f0-9]{40}$")


class VerificationError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def captured_at():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_url(value):
    if not isinstance(value, str):
        raise VerificationError("url-not-allowed")
    try:
        parsed = urlsplit(value)
        hostname = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError as error:
        raise VerificationError("url-not-allowed") from error
    allowed_host = (
        hostname == "baby2b.online"
        or hostname.endswith(".baby2b.online")
        or hostname == "api.github.com"
        or hostname == "github.com"
    )
    try:
        ipaddress.ip_address(hostname)
        is_ip_literal = True
    except ValueError:
        is_ip_literal = False
    if (
        parsed.scheme != "https"
        or not allowed_host
        or is_ip_literal
        or hostname == "localhost"
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise VerificationError("url-not-allowed")
    return value


def fetch_bounded(url, expected_content_types, opener=None):
    validate_url(url)
    client = opener or build_opener(NoRedirectHandler())
    request = Request(
        url,
        headers={
            "Accept": ", ".join(expected_content_types),
            "User-Agent": "Tiancheng-Xu-Portfolio-Evidence-Verifier/1.0",
        },
        method="GET",
    )
    started = time.monotonic()
    try:
        with client.open(request, timeout=TIMEOUT_SECONDS) as response:
            status = int(response.status)
            if status != 200:
                raise VerificationError("http-status-not-200")
            content_type = response.headers.get("content-type", "")
            media_type = content_type.split(";", 1)[0].strip().lower()
            if not any(media_type == allowed or media_type.startswith(f"{allowed}+") for allowed in expected_content_types):
                raise VerificationError("content-type-not-allowed")
            body = response.read(MAX_BODY_BYTES + 1)
            if len(body) > MAX_BODY_BYTES:
                raise VerificationError("response-too-large")
            headers = {
                name: response.headers[name]
                for name in ALLOWED_RESPONSE_HEADERS
                if response.headers.get(name) is not None
            }
    except HTTPError as error:
        if 300 <= error.code < 400:
            raise VerificationError("redirect-forbidden") from error
        raise VerificationError("http-status-not-200") from error
    except (TimeoutError, URLError) as error:
        raise VerificationError("network-unavailable") from error
    return {
        "status": status,
        "contentType": media_type,
        "body": body,
        "bodySha256": hashlib.sha256(body).hexdigest(),
        "headers": headers,
        "durationMs": max(0, round((time.monotonic() - started) * 1000)),
    }


def validate_event(event):
    if not isinstance(event, dict) or set(event) != ALLOWED_EVENT_KEYS:
        raise VerificationError("invalid-event-contract")
    if not PROJECT_ID_PATTERN.fullmatch(event["projectId"]):
        raise VerificationError("invalid-project-id")
    if not REPOSITORY_PATTERN.fullmatch(event["repository"]):
        raise VerificationError("invalid-repository")
    if not SHA_PATTERN.fullmatch(event["headSha"]):
        raise VerificationError("invalid-head-sha")
    if not isinstance(event["verificationRunId"], str) or not event["verificationRunId"].isdigit():
        raise VerificationError("invalid-run-id")
    if not isinstance(event["budgetActualBefore"], (int, float)) or event["budgetActualBefore"] < 0:
        raise VerificationError("invalid-budget-value")
    validate_url(event["evidenceUrl"])
    if event["productionUrl"] is not None:
        validate_url(event["productionUrl"])
    if not isinstance(event["expectedMarkers"], dict):
        raise VerificationError("invalid-markers")


def endpoint_evidence(url, fetched, markers):
    text = fetched["body"].decode("utf-8", errors="replace")
    missing = [marker for marker in markers if marker not in text]
    if missing:
        raise VerificationError("semantic-marker-missing")
    return {
        "status": "verified",
        "url": url,
        "httpStatus": fetched["status"],
        "contentType": fetched["contentType"],
        "bodySha256": fetched["bodySha256"],
        "durationMs": fetched["durationMs"],
        "markersMatched": len(markers),
        "headers": fetched["headers"],
    }


def verify_project(event, request_id, fetcher=fetch_bounded):
    validate_event(event)
    owner, repository_name = event["repository"].split("/", 1)
    commit_url = (
        f"https://api.github.com/repos/{quote(owner, safe='')}/{quote(repository_name, safe='')}"
        f"/commits/{event['headSha']}"
    )
    commit_fetch = fetcher(commit_url, ("application/json",))
    try:
        commit_payload = json.loads(commit_fetch["body"].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError("commit-response-invalid") from error
    if not isinstance(commit_payload, dict) or commit_payload.get("sha") != event["headSha"]:
        raise VerificationError("commit-sha-mismatch")

    evidence_fetch = fetcher(event["evidenceUrl"], ("text/html", "application/json"))
    evidence_result = endpoint_evidence(
        event["evidenceUrl"],
        evidence_fetch,
        event["expectedMarkers"]["evidence"],
    )

    limitations = []
    if event["productionUrl"] is None:
        production_result = {"status": "not-deployed"}
        production_binding = "not-deployed"
        limitations.append("No independent production URL is declared.")
    else:
        production_fetch = fetcher(event["productionUrl"], ("text/html", "application/json"))
        production_result = endpoint_evidence(
            event["productionUrl"],
            production_fetch,
            event["expectedMarkers"]["production"],
        )
        if event["headSha"].encode() in production_fetch["body"]:
            production_binding = "embedded-sha"
        else:
            production_binding = "repository-and-url"
            limitations.append("Production content does not expose the verified commit SHA.")

    return {
        "schemaVersion": "portfolio-aws-verifier-evidence/v1",
        "projectId": event["projectId"],
        "repository": event["repository"],
        "headSha": event["headSha"],
        "verificationRunId": event["verificationRunId"],
        "awsRequestId": request_id,
        "status": "verified",
        "provenance": "aws-verifier",
        "deliveryStatus": event["deliveryStatus"],
        "productionBinding": production_binding,
        "budgetActualBefore": event["budgetActualBefore"],
        "repositoryCommit": {
            "status": "verified",
            "url": commit_url,
            "sha": commit_payload["sha"],
            "bodySha256": commit_fetch["bodySha256"],
            "durationMs": commit_fetch["durationMs"],
        },
        "production": production_result,
        "evidence": evidence_result,
        "capturedAt": captured_at(),
        "limitations": limitations,
    }


def lambda_handler(event, context):
    request_id = getattr(context, "aws_request_id", "unavailable")
    try:
        return verify_project(event, request_id)
    except VerificationError as error:
        project_id = event.get("projectId") if isinstance(event, dict) else None
        if not isinstance(project_id, str) or not PROJECT_ID_PATTERN.fullmatch(project_id):
            project_id = "unavailable"
        return {
            "schemaVersion": "portfolio-aws-verifier-evidence/v1",
            "projectId": project_id,
            "awsRequestId": request_id,
            "status": "failed",
            "provenance": "aws-verifier",
            "error": error.code,
            "capturedAt": captured_at(),
        }

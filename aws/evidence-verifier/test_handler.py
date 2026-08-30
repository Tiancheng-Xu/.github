import hashlib
import importlib.util
import json
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("handler.py")
SPEC = importlib.util.spec_from_file_location("evidence_verifier_handler", MODULE_PATH)
handler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(handler)

SHA = "a" * 40


def project(**overrides):
    value = {
        "projectId": "sample-project",
        "repository": "Tiancheng-Xu/sample-project",
        "headSha": SHA,
        "deliveryStatus": "completed",
        "productionUrl": "https://sample-project.baby2b.online/",
        "evidenceUrl": "https://sample-project.baby2b.online/evidence/",
        "checks": ["repository-commit", "production-page", "evidence-page"],
        "expectedMarkers": {
            "production": ["Sample Project"],
            "evidence": ["工作证明"],
        },
        "verificationRunId": "123456",
        "budgetActualBefore": 27.345,
    }
    value.update(overrides)
    return value


class FakeResponse:
    def __init__(self, body, content_type="text/html; charset=utf-8", status=200):
        self.body = body
        self.status = status
        self.headers = {"content-type": content_type, "etag": '"fixture"'}
        self.offset = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size=-1):
        if size < 0:
            size = len(self.body) - self.offset
        chunk = self.body[self.offset:self.offset + size]
        self.offset += len(chunk)
        return chunk


class FakeOpener:
    def __init__(self, response):
        self.response = response
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return self.response


class Context:
    aws_request_id = "aws-request-123"


def contains_key(value, target):
    if isinstance(value, dict):
        return target in value or any(contains_key(entry, target) for entry in value.values())
    if isinstance(value, list):
        return any(contains_key(entry, target) for entry in value)
    return False


class VerifierTests(unittest.TestCase):
    def test_url_validation_allows_only_public_https_delivery_hosts(self):
        handler.validate_url("https://baby2b.online/evidence/sample/")
        handler.validate_url("https://sample.baby2b.online/")
        handler.validate_url(f"https://api.github.com/repos/Tiancheng-Xu/sample/commits/{SHA}")
        for url in [
            "http://baby2b.online/",
            "https://example.com/",
            "https://127.0.0.1/",
            "https://localhost/",
            "https://sample.baby2b.online:8443/",
            "https://user:pass@baby2b.online/",
        ]:
            with self.subTest(url=url), self.assertRaises(handler.VerificationError):
                handler.validate_url(url)

    def test_fetch_is_bounded_and_hashes_without_returning_headers_outside_allowlist(self):
        body = "Sample Project".encode()
        opener = FakeOpener(FakeResponse(body))
        result = handler.fetch_bounded(
            "https://sample.baby2b.online/",
            ("text/html",),
            opener=opener,
        )
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["bodySha256"], hashlib.sha256(body).hexdigest())
        self.assertEqual(result["headers"], {"content-type": "text/html; charset=utf-8", "etag": '"fixture"'})
        self.assertEqual(result["body"], body)
        self.assertEqual(opener.requests[0][1], 3)

    def test_fetch_rejects_a_response_larger_than_one_mebibyte(self):
        opener = FakeOpener(FakeResponse(b"x" * (handler.MAX_BODY_BYTES + 1)))
        with self.assertRaisesRegex(handler.VerificationError, "response-too-large"):
            handler.fetch_bounded("https://sample.baby2b.online/", ("text/html",), opener=opener)

    def test_verifies_commit_production_and_evidence_without_exposing_body(self):
        def fetcher(url, _content_types):
            if url.startswith("https://api.github.com/"):
                body = json.dumps({"sha": SHA}).encode()
                return {"status": 200, "contentType": "application/json", "body": body, "bodySha256": hashlib.sha256(body).hexdigest(), "headers": {}, "durationMs": 4}
            body = (f"Sample Project {SHA}" if url.endswith("/") and not url.endswith("evidence/") else "工作证明").encode()
            return {"status": 200, "contentType": "text/html", "body": body, "bodySha256": hashlib.sha256(body).hexdigest(), "headers": {}, "durationMs": 7}

        result = handler.verify_project(project(), "aws-request-123", fetcher=fetcher)
        self.assertEqual(result["schemaVersion"], "portfolio-aws-verifier-evidence/v1")
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["awsRequestId"], "aws-request-123")
        self.assertEqual(result["productionBinding"], "embedded-sha")
        self.assertEqual(result["budgetActualBefore"], 27.345)
        self.assertEqual(result["production"]["markersMatched"], 1)
        self.assertFalse(contains_key(result, "body"))

    def test_preserves_not_deployed_without_weakening_repository_or_evidence_checks(self):
        value = project(
            productionUrl=None,
            checks=["repository-commit", "evidence-page"],
            expectedMarkers={"production": [], "evidence": ["工作证明"]},
        )

        def fetcher(url, _content_types):
            body = (json.dumps({"sha": SHA}) if "api.github.com" in url else "工作证明").encode()
            content_type = "application/json" if "api.github.com" in url else "text/html"
            return {"status": 200, "contentType": content_type, "body": body, "bodySha256": hashlib.sha256(body).hexdigest(), "headers": {}, "durationMs": 3}

        result = handler.verify_project(value, "aws-request-123", fetcher=fetcher)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["production"], {"status": "not-deployed"})
        self.assertEqual(result["productionBinding"], "not-deployed")

    def test_lambda_handler_fails_closed_and_never_echoes_credentials(self):
        value = project(apiToken="do-not-return-this")
        result = handler.lambda_handler(value, Context())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["schemaVersion"], "portfolio-aws-verifier-evidence/v1")
        self.assertNotIn("do-not-return-this", json.dumps(result))
        self.assertNotIn("apiToken", json.dumps(result))


if __name__ == "__main__":
    unittest.main()

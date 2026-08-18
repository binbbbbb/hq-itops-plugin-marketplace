#!/usr/bin/env python3
"""Acquire Coremail WebAdmin cookies through the site's browser login flow.

The helper accepts one JSON object on stdin and returns one JSON object on
stdout. Credentials and cookies are never accepted as command-line arguments,
so they do not appear in the process list.
"""

from __future__ import annotations

import json
import sys
from urllib.parse import urlparse


COOKIE_NAMES = ("JSESSIONID", "Coremail", "Coremail.sid")
ALLOWED_HOST = "157.255.37.89"


class AuthenticationFlowError(RuntimeError):
    """A safe, machine-readable failure from the browser login flow."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _read_request() -> dict[str, object]:
    try:
        request = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError) as exc:
        raise RuntimeError("Invalid authentication request") from exc
    if not isinstance(request, dict):
        raise RuntimeError("Authentication request must be a JSON object")
    return request


def _required_text(
    request: dict[str, object], name: str, *, preserve_whitespace: bool = False
) -> str:
    value = request.get(name)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"Missing required setting: {name}")
    return value if preserve_whitespace else value.strip()


def get_coremail_cookies(request: dict[str, object]) -> tuple[dict[str, str], str]:
    """Let Coremail perform its own login, then read HttpOnly cookies."""
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise AuthenticationFlowError(
            "PLAYWRIGHT_IMPORT_FAILED",
            "Python Playwright is not available",
        ) from exc

    try:
        login_url = _required_text(request, "loginUrl")
        username = _required_text(request, "username")
        # Passwords are opaque values. Trimming them changes valid credentials.
        password = _required_text(request, "password", preserve_whitespace=True)
        parsed_url = urlparse(login_url)
        if parsed_url.scheme != "https" or parsed_url.hostname != ALLOWED_HOST:
            raise RuntimeError("Coremail login URL is outside the allowed host")
    except Exception as exc:
        raise AuthenticationFlowError(
            "AUTH_INPUT_INVALID",
            "Coremail authentication input is invalid",
        ) from exc

    timeout_ms = int(request.get("timeoutMs", 30_000))
    post_login_wait_ms = int(request.get("postLoginWaitMs", 1_000))
    headless = bool(request.get("headless", True))
    browser_channel = request.get("browserChannel", "chrome")

    with sync_playwright() as playwright:
        launch_options: dict[str, object] = {"headless": headless}
        if browser_channel:
            launch_options["channel"] = str(browser_channel)
        try:
            browser = playwright.chromium.launch(**launch_options)
        except Exception as exc:
            raise AuthenticationFlowError(
                "BROWSER_START_FAILED",
                "Cannot start the configured Chromium browser",
            ) from exc

        try:
            try:
                context = browser.new_context(ignore_https_errors=True)
                page = context.new_page()
                page.goto(login_url, wait_until="domcontentloaded", timeout=timeout_ms)
            except Exception as exc:
                raise AuthenticationFlowError(
                    "LOGIN_PAGE_LOAD_FAILED",
                    "Cannot load the Coremail login page",
                ) from exc

            try:
                page.locator('input[name="uid"]').fill(username)
                page.locator('input[type="password"]').fill(password)
                page.locator('input[name="submit"]').click()
            except Exception as exc:
                raise AuthenticationFlowError(
                    "LOGIN_FORM_FAILED",
                    "Cannot fill or submit the Coremail login form",
                ) from exc

            try:
                page.wait_for_url(
                    "**/welcome/index.jsp",
                    wait_until="domcontentloaded",
                    timeout=timeout_ms,
                )
            except PlaywrightTimeoutError as exc:
                error_locator = page.locator(".errMsg")
                error_present = bool(
                    error_locator.count() and error_locator.inner_text().strip()
                )
                code = "LOGIN_REJECTED" if error_present else "LOGIN_REDIRECT_TIMEOUT"
                raise AuthenticationFlowError(
                    code,
                    "Coremail login did not reach WebAdmin",
                ) from exc

            page.wait_for_timeout(post_login_wait_ms)
            try:
                cookie_map = {
                    item["name"]: item["value"]
                    for item in context.cookies()
                    if item.get("name") in COOKIE_NAMES and item.get("value")
                }
            except Exception as exc:
                raise AuthenticationFlowError(
                    "SESSION_READ_FAILED",
                    "Cannot read the Coremail browser session",
                ) from exc
            missing = [name for name in COOKIE_NAMES if name not in cookie_map]
            if missing:
                raise AuthenticationFlowError(
                    "SESSION_NOT_ISSUED",
                    "Coremail login succeeded but required session data was not issued",
                )
            return cookie_map, page.url
        finally:
            browser.close()


def main() -> int:
    try:
        cookies, final_url = get_coremail_cookies(_read_request())
        cookie_header = "; ".join(f"{name}={cookies[name]}" for name in COOKIE_NAMES)
        json.dump({"cookie": cookie_header, "finalUrl": final_url}, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:
        diagnostic = {"code": getattr(exc, "code", "AUTH_HELPER_FAILED")}
        print(json.dumps(diagnostic), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

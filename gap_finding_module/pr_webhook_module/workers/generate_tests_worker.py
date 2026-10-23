"""
Nhánh A — Step A.1 + A.2: Generate E2E Playwright Tests from SRS

Flow:
    A.1  Gọi LLM để extract structured requirements từ srs_content
    A.2  Gọi LLM để generate Playwright test code từ requirements
    A.3  Lưu test files + tests_manifest.json

KEY PRINCIPLE:
    LLM chỉ nhận SRS content. Code diff KHÔNG được đưa vào prompt này.
    Expected values trong test đến từ SRS requirements, không từ implementation.
    → Test sẽ fail nếu code implement sai so với SRS (đây là điều mong muốn).

Output:
    generated_tests/test_pr_{id}.py     — Playwright test file
    generated_tests/tests_manifest.json — metadata per test case
"""

import json
import logging
import os
import textwrap
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env", override=False)

logger = logging.getLogger(__name__)

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

from pr_webhook_module.workers import llm_cost_tracker as _tracker


# =============================================================================
# Config
# =============================================================================

class GenerateTestsConfig:
    def __init__(self):
        self.llm_binding = os.getenv("LLM_BINDING", "gemini")          # "gemini" | "claude"
        self.llm_model   = os.getenv("LLM_MODEL", "gemini-2.0-flash")
        self.llm_host    = os.getenv("LLM_BINDING_HOST", "")
        self.llm_api_key = os.getenv("LLM_BINDING_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
        # Legacy fallback
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "")
        self.gemini_model   = self.llm_model

        self.output_dir = os.getenv("PR_LOG_OUTPUT_DIR", "./pr_logs")
        self.tests_dir = os.path.join(self.output_dir, "generated_tests")
        self.backend_base_url  = os.getenv("BACKEND_BASE_URL",  "http://localhost:8001")
        self.frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:4200")
        self.test_username = os.getenv("TEST_USERNAME", "")
        self.test_password = os.getenv("TEST_PASSWORD", "")
        self.request_timeout = float(os.getenv("LLM_TIMEOUT", "300"))

    def get_base_url(self, repo_type: str) -> str:
        return self.frontend_base_url if repo_type == "frontend" else self.backend_base_url

    def validate(self) -> list[str]:
        errors = []
        if not self.llm_api_key:
            errors.append("LLM_BINDING_API_KEY or GEMINI_API_KEY is required")
        return errors

    @property
    def generate_url(self) -> str:
        if self.llm_binding == "claude" and self.llm_host:
            return f"{self.llm_host.rstrip('/')}/v1/chat/completions"
        if self.llm_host:
            # Gemini proxy: Bearer auth, OpenAI request, Gemini response
            return f"{self.llm_host.rstrip('/')}/chat/completions"
        # Gemini native direct
        key = self.llm_api_key or self.gemini_api_key
        return f"{GEMINI_API_BASE}/{self.llm_model}:generateContent?key={key}"


# =============================================================================
# Data structures
# =============================================================================

@dataclass
class SRSRequirement:
    """Một requirement được extract từ SRS content."""
    id: str                   # ví dụ: UC-TM-064-AC-01
    srs_section: str          # ví dụ: UC-TM-064
    description: str          # mô tả requirement
    acceptance_criteria: str  # điều kiện pass/fail
    expected_behavior: str    # hành vi mong đợi (bao gồm edge cases)
    pre_conditions: str = ""  # điều kiện trước khi test


@dataclass
class GeneratedTestCase:
    """Một test case được generate từ requirement."""
    id: str                   # ví dụ: test_uc_tm_064_ac_01
    name: str                 # tên function
    srs_section: str
    requirement_id: str
    requirement_description: str
    assertion_logic: str      # mô tả assertion (để trace khi fail)
    tag_logic: str            # "PASS=matching | AssertionError=mismatch | 404/timeout=missing"
    code: str                 # Playwright test function code


@dataclass
class TestsManifest:
    """Metadata cho toàn bộ test suite được generate."""
    pr_id: int
    repo: str
    repo_type: str            # backend | frontend
    conversation_id: str
    srs_context_path: str
    test_file_path: str
    test_cases: list[GeneratedTestCase] = field(default_factory=list)
    total_requirements: int = 0
    generated_at: str = ""
    manifest_path: str = ""


# =============================================================================
# Step A.1 — Extract requirements từ SRS content
# =============================================================================

_EXTRACT_REQUIREMENTS_PROMPT = """\
Bạn là một QA Engineer. Nhiệm vụ của bạn là đọc tài liệu SRS và extract \
các requirements thành structured JSON để sinh test case.

=== TÀI LIỆU SRS ===
{srs_content}
=== HẾT SRS ===

Hãy extract TẤT CẢ requirements có thể test được từ tài liệu trên.
Với mỗi requirement, trả về JSON object với các field:

- id: mã requirement ngắn gọn, ví dụ "UC-TM-064-AC-01"
- srs_section: mã UC liên quan, ví dụ "UC-TM-064"
- description: mô tả ngắn requirement (1 câu)
- acceptance_criteria: điều kiện để requirement được coi là đạt (cụ thể, có thể test)
- expected_behavior: hành vi mong đợi chi tiết, bao gồm cả trường hợp lỗi/edge case
- pre_conditions: điều kiện cần có trước khi test (nếu có)

Trả về JSON array, KHÔNG có markdown, KHÔNG có giải thích thêm.
Chỉ trả về JSON thuần.

Ví dụ format:
[
  {{
    "id": "UC-TM-064-AC-01",
    "srs_section": "UC-TM-064",
    "description": "User cannot take survey if class status is not IN_PROGRESS",
    "acceptance_criteria": "HTTP 400 or 403 when class.status != IN_PROGRESS",
    "expected_behavior": "System rejects survey submission with error message when class is PENDING or ENDED",
    "pre_conditions": "User is authenticated, survey exists in system"
  }}
]
"""

# =============================================================================
# Prompt cho Backend (Django REST API) — dùng httpx, không cần Playwright
# =============================================================================

_GENERATE_TESTS_PROMPT_BACKEND = """\
You are a QA Engineer writing pytest tests in Python for a Django REST API.

=== CONTEXT ===
Backend base URL: {base_url}
Pull Request: #{pr_id} — {pr_title}
Repo: {repo}
Auth: Django simplejwt — POST /api/auth/token/ → {{access, refresh}}
Test credentials: username="{test_username}" / password="{test_password}"

=== API ENDPOINTS (fetched from live Swagger schema — use ONLY these URLs) ===
{swagger_endpoints}
=== HẾT ENDPOINTS ===

RULE: Use ONLY the endpoints listed above. Do NOT invent or guess new URLs.
Only use pytest.skip("Endpoint not found in Swagger") if the main action endpoint itself is completely absent.

=== REQUIREMENTS CẦN TEST ===
{requirements_json}
=== HẾT REQUIREMENTS ===

=== NGUYÊN TẮC ANTI-BIAS ===
- URL và HTTP method: lấy từ Swagger section ở trên.
- Expected values (status codes, error messages, business logic): lấy từ REQUIREMENTS.
- KHÔNG copy expected values từ implementation. Test phải fail nếu app implement sai SRS.

=== CHIẾN LƯỢC TEST VỚI TEST DATABASE (QUAN TRỌNG) ===
Backend đang chạy với DATABASE TEST — bản sao đầy đủ của production data.
DB có đủ data với nhiều trạng thái khác nhau (INPROGRESS, DRAFT, COMPLETED, v.v.).

QUY TẮC QUAN TRỌNG VỀ ERROR KEY:
- Backend này trả error dưới key "error", KHÔNG phải "detail"
- Luôn dùng: r.json().get("error", r.json().get("detail", r.text))

CÁCH TÌM DATA THEO TRẠNG THÁI (dùng GET /api/course-classes/ nếu có trong Swagger):
```python
def get_survey_in_class_status(api_client: httpx.Client, status: str):
    # Bước 1: lấy class có đúng status
    r = api_client.get("/api/course-classes/", params={{"status": status}})
    assert r.status_code == 200, f"[missing] course-classes list failed: {{r.status_code}}"
    classes = r.json().get("results", r.json()) if isinstance(r.json(), dict) else r.json()
    if not classes:
        pytest.skip(f"No CourseClass with status={{status}} in test DB")
    class_id = classes[0]["id"]

    # Bước 2: lấy survey trong class đó
    r = api_client.get("/api/course-classes/activities/surveys/", params={{"course_class": class_id}})
    assert r.status_code == 200, f"[missing] surveys list failed: {{r.status_code}}"
    surveys = r.json().get("results", r.json()) if isinstance(r.json(), dict) else r.json()
    if not surveys:
        pytest.skip(f"No survey in {{status}} class (id={{class_id}})")
    return surveys[0]["id"], class_id  # trả cả class_id để dùng làm ?course_class= param
```

Dùng pattern trên cho mỗi test case cần class status khác nhau:
- test reject DRAFT → `survey_id, class_id = get_survey_in_class_status(api_client, "DRAFT")`
- test reject COMPLETED → `survey_id, class_id = get_survey_in_class_status(api_client, "COMPLETED")`
- test allow INPROGRESS → `survey_id, class_id = get_survey_in_class_status(api_client, "INPROGRESS")`

QUAN TRỌNG: endpoint take_survey yêu cầu param `course_class`. Luôn gọi như sau:
```python
survey_id, class_id = get_survey_in_class_status(api_client, "INPROGRESS")
r = api_client.get(
    f"/api/course-classes/activities/surveys/{{survey_id}}/take_survey/",
    params={{"course_class": class_id}},
)
```

ƯU TIÊN THEO THỨ TỰ:
1. NẾU có endpoint tạo data (POST) trong Swagger → dùng CRUD setup/teardown với try/finally cleanup
2. NẾU không có → FILTER data có sẵn theo status (dùng pattern trên)
3. CHỈ pytest.skip() khi THỰC SỰ không thể test qua REST API:
   - Background job / cron task không có endpoint trigger
   - KHÔNG skip chỉ vì "không biết trạng thái" — hãy filter theo status

=== FRAMEWORK: httpx + pytest ===
Dùng `httpx.Client` — KHÔNG dùng Playwright hay requests.

Fixture bắt buộc (PHẢI dùng chính xác pattern này):
```python
import pytest
import httpx
import os

@pytest.fixture(scope="session")
def api_client() -> httpx.Client:
    base_url = os.environ.get("BACKEND_BASE_URL", "{base_url}")
    username = os.environ.get("TEST_USERNAME", "{test_username}")
    password = os.environ.get("TEST_PASSWORD", "{test_password}")

    r = httpx.post(
        f"{{base_url}}/api/auth/token/",
        json={{"username": username, "password": password}},
        timeout=30,
    )
    assert r.status_code == 200, f"[missing] Login failed: {{r.status_code}} — {{r.text}}"
    token = r.json()["access"]

    client = httpx.Client(
        base_url=base_url,
        headers={{"Authorization": f"Bearer {{token}}"}},
        timeout=30,
    )
    yield client
    client.close()
```

Rules:
- KHÔNG hardcode IDs. Query list endpoint trước để tìm ID.
- Handle paginated response: if isinstance(data, dict) and "results" in data: data = data["results"]
- Dùng httpx.Client methods: .get(), .post(), .put(), .patch(), .delete()
- assert r.status_code == X, không dùng r.raise_for_status() trong test logic
- ƯU TIÊN adaptive test hơn pytest.skip — skip chỉ khi endpoint KHÔNG tồn tại trong swagger

Trả về JSON (KHÔNG có markdown):
{{
  "imports": "import pytest\\nimport httpx\\nimport os",
  "fixtures": "...(fixture code)...",
  "test_cases": [
    {{
      "id": "test_uc_tm_064_req_01",
      "name": "test_take_survey_validation_messages",
      "srs_section": "UC-TM-064",
      "requirement_id": "UC-TM-064-REQ-01",
      "requirement_description": "...",
      "assertion_logic": "...",
      "tag_logic": "PASS=matching | AssertionError=mismatch | ConnectError/timeout/404=missing",
      "code": "def test_xxx(api_client: httpx.Client):\\n    ..."
    }}
  ]
}}
"""


# =============================================================================
# Prompt cho Frontend (Angular) — dùng Playwright Page
# =============================================================================

_GENERATE_TESTS_PROMPT_FRONTEND = """\
You are a QA Engineer writing Playwright tests in Python for an Angular frontend.

=== CONTEXT ===
Frontend base URL (injected via pytest --base-url): {base_url}
Pull Request: #{pr_id} — {pr_title}
Repo: {repo}
Test credentials: username="{test_username}" / password="{test_password}"

=== REQUIREMENTS CẦN TEST ===
{requirements_json}
=== HẾT REQUIREMENTS ===

=== NGUYÊN TẮC ANTI-BIAS ===
- Expected UI behavior (text, navigation, visibility): lấy từ REQUIREMENTS.
- KHÔNG assume về implementation. Test phải fail nếu UI không đúng SRS.

=== FRAMEWORK: Playwright + pytest ===
Dùng `playwright.sync_api.Page` để điều khiển browser.

Fixture bắt buộc:
```python
import pytest
import os
from playwright.sync_api import Browser, Page

@pytest.fixture(scope="session")
def logged_in_page(browser: Browser, base_url: str) -> Page:
    # IMPORTANT: use `browser` (session-scoped), NOT `page` (function-scoped).
    # Using `page` here causes pytest ScopeMismatch error.
    username = os.environ.get("TEST_USERNAME", "{test_username}")
    password = os.environ.get("TEST_PASSWORD", "{test_password}")
    context = browser.new_context(base_url=base_url)
    page = context.new_page()
    page.goto("/login")
    # Try multiple common selectors for username/email field
    for sel in ["input[name='username']", "input[type='email']", "input[name='email']", "input[placeholder*='username' i]", "input[placeholder*='email' i]"]:
        if page.locator(sel).count() > 0:
            page.fill(sel, username)
            break
    for sel in ["input[name='password']", "input[type='password']"]:
        if page.locator(sel).count() > 0:
            page.fill(sel, password)
            break
    page.click("button[type='submit']")
    # Wait for SPA router to navigate away from /login — do NOT use wait_for_load_state("networkidle")
    # because networkidle fires before Angular router finishes navigation, leaving the page still on /login.
    page.wait_for_url(lambda url: "/login" not in url, timeout=20000)
    assert "/login" not in page.url, f"[missing] Login failed — still on login page: {{page.url}}"
    yield page
    context.close()
```

Test function pattern:
```python
def test_xxx(logged_in_page: Page):
    \"\"\"
    SRS_SECTION: UC-FE-001
    REQUIREMENT_ID: UC-FE-001-REQ-01
    DESCRIPTION: ...
    ASSERTION_LOGIC: ...
    TAG_LOGIC: PASS=matching | AssertionError=mismatch | TimeoutError/404=missing
    \"\"\"
    logged_in_page.goto("/feature-url")
    logged_in_page.wait_for_selector(".element", timeout=5000)
    assert logged_in_page.is_visible(".element"), "[mismatch] Expected element visible per SRS"
```

Rules:
- Dùng `page.goto()`, `page.fill()`, `page.click()`, `page.wait_for_selector()`
- KHÔNG dùng `expect()` — dùng `page.is_visible()`, `page.inner_text()`, `page.locator()`
- Luôn wait trước khi assert: `page.wait_for_selector()` hoặc `page.wait_for_url()`
- KHÔNG hardcode credentials trong code
- Regex trong Python PHẢI dùng raw string: `re.compile(r"pattern")`, KHÔNG dùng `re.compile(".*" + "/foo")` (SyntaxWarning)
- assert với message PHẢI trên MỘT dòng: `assert condition, "message"` — KHÔNG ngắt dòng sau dấu phẩy

Trả về JSON (KHÔNG có markdown):
{{
  "imports": "import pytest\\nimport os\\nfrom playwright.sync_api import Browser, Page",
  "fixtures": "...(fixture code)...",
  "test_cases": [
    {{
      "id": "test_uc_fe_001_req_01",
      "name": "test_feature_visible_after_login",
      "srs_section": "UC-FE-001",
      "requirement_id": "UC-FE-001-REQ-01",
      "requirement_description": "...",
      "assertion_logic": "...",
      "tag_logic": "PASS=matching | AssertionError=mismatch | TimeoutError/404=missing",
      "code": "def test_xxx(logged_in_page: Page):\\n    ..."
    }}
  ]
}}
"""


SRS_MAX_CHARS = 20_000   # Giới hạn SRS input để tránh prompt quá dài (tăng từ 10k → 20k)


async def call_gemini(prompt: str, config: GenerateTestsConfig, stage: str = "") -> str:
    """Gọi LLM API (Gemini native hoặc OpenAI-compatible) và trả về text response.
    Tự động retry với backoff khi gặp 429 (rate limit).
    Ghi lại token usage + cost estimate qua llm_cost_tracker.
    """
    import asyncio as _asyncio

    max_retries = 6
    backoff = 10  # seconds

    for attempt in range(max_retries):
        try:
            logger.info(f"[LLM] Calling: {config.generate_url[:80]} | binding={config.llm_binding} | host={'yes' if config.llm_host else 'no'} | attempt={attempt+1}/{max_retries}")
            if config.llm_binding == "claude" and config.llm_host:
                # OpenAI-compatible proxy, returns OpenAI format
                payload = {
                    "model": config.llm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 32768,
                }
                headers = {"Authorization": f"Bearer {config.llm_api_key}"}
                async with httpx.AsyncClient(timeout=config.request_timeout) as client:
                    response = await client.post(config.generate_url, json=payload, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    text = data["choices"][0]["message"]["content"]
                    _tracker.record_usage(stage, config.llm_model, data, "claude", len(prompt), len(text))
                    return text
            elif config.llm_host:
                # Gemini proxy: OpenAI request + Bearer auth, returns Gemini format
                # max_tokens cần đủ lớn vì Gemini 2.5-flash dùng thinking tokens ẩn
                payload = {
                    "model": config.llm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 32768,
                }
                headers = {"Authorization": f"Bearer {config.llm_api_key}"}
                async with httpx.AsyncClient(timeout=config.request_timeout) as client:
                    response = await client.post(config.generate_url, json=payload, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    _tracker.record_usage(stage, config.llm_model, data, "gemini", len(prompt), len(text))
                    return text
            else:
                # Gemini native direct
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.2,
                        "maxOutputTokens": 32768,
                    },
                }
                async with httpx.AsyncClient(timeout=config.request_timeout) as client:
                    response = await client.post(config.generate_url, json=payload)
                    response.raise_for_status()
                    data = response.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    _tracker.record_usage(stage, config.llm_model, data, "gemini", len(prompt), len(text))
                    return text
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (429, 504, 502, 503) and attempt < max_retries - 1:
                wait = backoff * (2 ** attempt)  # 10, 20, 40, 80, 160s
                logger.warning(f"[LLM] {e.response.status_code} — waiting {wait}s before retry (attempt {attempt+1}/{max_retries})")
                await _asyncio.sleep(wait)
                continue
            raise


def _escape_control_chars_in_strings(text: str) -> str:
    """Escape literal control characters (newline, tab, etc.) inside JSON string values."""
    result = []
    in_string = False
    escape_next = False
    _escape_map = {'\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f'}
    for ch in text:
        if escape_next:
            result.append(ch)
            escape_next = False
        elif ch == '\\' and in_string:
            result.append(ch)
            escape_next = True
        elif ch == '"':
            result.append(ch)
            in_string = not in_string
        elif in_string and ord(ch) < 0x20:
            result.append(_escape_map.get(ch, f'\\u{ord(ch):04x}'))
        else:
            result.append(ch)
    return ''.join(result)


def _parse_json_response(raw: str) -> Any:
    """
    Parse JSON từ LLM response.
    LLM đôi khi wrap JSON trong markdown code block — strip trước khi parse.
    LLM cũng hay sinh invalid escape sequences hoặc literal control characters trong Python code.
    """
    import re
    text = raw.strip()
    # Strip ```json ... ``` hoặc ``` ... ```
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fix 1: unescaped triple-quotes (Python docstrings inside JSON strings)
        fixed = text.replace('"""', '\\"\\"\\"')
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            pass
        # Fix 2: invalid escape sequences (\H, \d, ...) not valid in JSON
        fixed2 = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', fixed)
        try:
            return json.loads(fixed2)
        except json.JSONDecodeError:
            pass
        # Fix 3: literal control characters inside JSON string values
        fixed3 = _escape_control_chars_in_strings(fixed2)
        return json.loads(fixed3)


async def extract_requirements(
    srs_content: str,
    config: GenerateTestsConfig,
) -> list[SRSRequirement]:
    """
    Step A.1: Gọi LLM để extract structured requirements từ SRS content.
    Input: raw SRS text
    Output: list of SRSRequirement
    """
    logger.info("[A.1] Extracting requirements from SRS content...")
    if len(srs_content) > SRS_MAX_CHARS:
        logger.warning(f"[A.1] SRS truncated {len(srs_content)} -> {SRS_MAX_CHARS} chars")
        srs_content = srs_content[:SRS_MAX_CHARS] + "\n... [truncated]"
    prompt = _EXTRACT_REQUIREMENTS_PROMPT.format(srs_content=srs_content)
    raw = await call_gemini(prompt, config, stage="A.1")

    try:
        items = _parse_json_response(raw)
    except json.JSONDecodeError as e:
        logger.error(f"[A.1] Failed to parse requirements JSON: {e}\nRaw: {raw[:500]}")
        raise

    requirements = [
        SRSRequirement(
            id=item.get("id", f"REQ-{i+1:03d}"),
            srs_section=item.get("srs_section", ""),
            description=item.get("description", ""),
            acceptance_criteria=item.get("acceptance_criteria", ""),
            expected_behavior=item.get("expected_behavior", ""),
            pre_conditions=item.get("pre_conditions", ""),
        )
        for i, item in enumerate(items)
    ]
    logger.info(f"[A.1] Extracted {len(requirements)} requirements")
    for r in requirements:
        logger.info(f"  [{r.id}] {r.srs_section} — {r.description[:80]}")
    return requirements


# =============================================================================
# Step A.2 — Generate Playwright test code từ requirements
# =============================================================================

async def generate_playwright_tests(
    requirements: list[SRSRequirement],
    srs_context: dict,
    config: GenerateTestsConfig,
    base_url: str = "",
    swagger_endpoints_text: str = "",
) -> tuple[str, list[GeneratedTestCase]]:
    """
    Step A.2: Gọi LLM để generate Playwright test code.
    Input: list requirements (SRS-derived, no code)
    Output: (full test file content, list of GeneratedTestCase metadata)
    """
    logger.info(f"[A.2] Calling LLM to generate tests for {len(requirements)} requirements (this may take 30-60s)...")

    requirements_json = json.dumps(
        [asdict(r) for r in requirements],
        ensure_ascii=False,
        indent=2,
    )

    repo_type = srs_context.get("repo_type", "backend")
    common_args = dict(
        base_url=base_url,
        pr_id=srs_context.get("pr_id", 0),
        pr_title=srs_context.get("title", ""),
        repo=srs_context.get("repo", ""),
        test_username=config.test_username or "admin",
        test_password=config.test_password or "admin123",
        requirements_json=requirements_json,
    )

    if repo_type == "frontend":
        prompt = _GENERATE_TESTS_PROMPT_FRONTEND.format(**common_args)
    else:
        prompt = _GENERATE_TESTS_PROMPT_BACKEND.format(
            **common_args,
            swagger_endpoints=swagger_endpoints_text or "(Swagger schema not available — infer endpoints from SRS context)",
        )

    raw = await call_gemini(prompt, config, stage="A.2")

    try:
        data = _parse_json_response(raw)
    except json.JSONDecodeError as e:
        logger.error(f"[A.2] Failed to parse test generation JSON: {e}\nRaw: {raw[:500]}")
        raise

    imports: str = data.get("imports", "import pytest\nimport os\nfrom playwright.sync_api import Browser, Page")
    fixtures: str = data.get("fixtures", "")
    raw_cases: list[dict] = data.get("test_cases", [])

    # Build GeneratedTestCase list
    test_cases = [
        GeneratedTestCase(
            id=tc.get("id", f"test_{i+1:03d}"),
            name=tc.get("name", f"test_case_{i+1}"),
            srs_section=tc.get("srs_section", ""),
            requirement_id=tc.get("requirement_id", ""),
            requirement_description=tc.get("requirement_description", ""),
            assertion_logic=tc.get("assertion_logic", ""),
            tag_logic=tc.get("tag_logic", "PASS=matching | AssertionError=mismatch | error=missing"),
            code=tc.get("code", ""),
        )
        for i, tc in enumerate(raw_cases)
    ]

    # Assemble full test file
    pr_id = srs_context.get("pr_id", 0)
    repo = srs_context.get("repo", "")
    header = textwrap.dedent(f"""\
        # =============================================================================
        # Generated E2E Tests — PR #{pr_id} — {repo}
        # Generated at: {datetime.now(timezone.utc).isoformat()}
        #
        # SOURCE: SRS requirements only (no code changes used in generation)
        # TAG LOGIC:
        #   test PASS        → matching   (app behavior matches SRS)
        #   AssertionError   → mismatch   (app returns different value than SRS expects)
        #   404/timeout/conn → missing    (feature not yet implemented)
        # =============================================================================
        """)

    test_functions = "\n\n".join(tc.code for tc in test_cases)
    full_file = f"{header}\n{imports}\n\n{fixtures}\n\n{test_functions}\n"
    full_file = _validate_and_fix_syntax(full_file)

    logger.info(f"[A.2] Generated {len(test_cases)} test cases")
    for tc in test_cases:
        logger.info(f"  [{tc.requirement_id}] {tc.name}")
    return full_file, test_cases


# =============================================================================
# Step A.2b — Syntax validation + auto-fix
# =============================================================================

def _validate_and_fix_syntax(code: str) -> str:
    """
    Validate Python syntax của generated test file và cố fix các lỗi phổ biến do LLM sinh ra.

    Lỗi phổ biến nhất:
        assert condition,          ← trailing comma
            "message"              ← Python hiểu là tuple → SyntaxError

    Fix: gộp 2 dòng thành 1 dòng:  assert condition, "message"
    """
    import ast
    import re

    try:
        ast.parse(code)
        return code  # No syntax errors
    except SyntaxError as e:
        logger.warning(f"[A.2] Syntax error in generated code (line {e.lineno}): {e.msg}")

    # Fix 1: assert <condition>,\n    "<message>"  →  assert <condition>, "<message>"
    fixed = re.sub(
        r'([ \t]*assert [^\n]+),\n[ \t]+((?:f?"|f?\')[^\n]+)',
        r'\1, \2',
        code,
    )
    try:
        ast.parse(fixed)
        logger.info("[A.2] Syntax auto-fixed: assert trailing comma + continuation line")
        return fixed
    except SyntaxError:
        pass

    # Fix 2: invalid escape sequences  \d \/ \s etc. inside regular strings
    # Convert non-raw strings containing regex-like patterns to raw strings
    fixed2 = re.sub(r'(?<!\\)\\(?![nrtbf\'"\\0-7xuUN\n])', r'\\\\', fixed)
    try:
        ast.parse(fixed2)
        logger.info("[A.2] Syntax auto-fixed: invalid escape sequences")
        return fixed2
    except SyntaxError as e2:
        logger.error(
            f"[A.2] Cannot auto-fix syntax error: {e2.msg} (line {e2.lineno}). "
            "Tests will fail at collection — check generated file manually."
        )
        return code  # Return original so the error is visible in pytest output


def _fix_escape_warnings(code: str) -> str:
    r"""
    Fix SyntaxWarning: invalid escape sequence in non-raw strings.
    Convert regex literals like ".*\\/foo\\/\\d+" -> r".*/foo/\d+"
    by replacing non-raw strings that contain regex-like invalid escapes with raw strings.
    """
    import re as _re
    # \/ is always invalid in Python strings — replace with /
    return _re.sub(r'(?<!r)"([^"]*\\/)([^"]*)"', lambda m: f'r"{ (m.group(1) + m.group(2)).replace(chr(92) + "/", "/") }"', code)


# =============================================================================
# Step A.3 — Save outputs
# =============================================================================

def save_test_file(
    file_content: str,
    pr_id: int,
    repo: str,
    tests_dir: str,
) -> str:
    """Ghi test code ra temp file (sẽ bị xóa sau khi pytest chạy xong)."""
    import tempfile
    Path(tests_dir).mkdir(parents=True, exist_ok=True)
    safe_repo = repo.replace("/", "_").replace(" ", "-")
    fd, filepath = tempfile.mkstemp(suffix=".py", prefix=f"test_pr_{pr_id}_{safe_repo}_", dir=tests_dir)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(file_content)
    logger.info(f"[A.3] Temp test file created -> {filepath}")
    return filepath


def save_tests_manifest(manifest: TestsManifest, tests_dir: str) -> str:
    """Lưu tests_manifest.json với metadata per test case."""
    safe_repo = manifest.repo.replace("/", "_").replace(" ", "-")
    filename = f"tests_manifest_pr_{manifest.pr_id}_{safe_repo}.json"
    filepath = os.path.join(tests_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(asdict(manifest), f, ensure_ascii=False, indent=2)
    logger.info(f"[A.3] Tests manifest saved -> {filepath}")
    return filepath


# =============================================================================
# Main async function
# =============================================================================

async def generate_tests_for_pr(
    srs_context: dict,
    pr_context: dict,
    config: GenerateTestsConfig,
) -> TestsManifest:
    """Chạy toàn bộ Nhánh A: extract requirements → generate tests → save."""
    pr_id: int = srs_context.get("pr_id", 0)
    repo: str = srs_context.get("repo", "")
    repo_type: str = pr_context.get("repo_type", "unknown")

    # Enrich srs_context với repo_type và title từ pr_context
    srs_context_enriched = {
        **srs_context,
        "repo_type": repo_type,
        "title": pr_context.get("title", ""),
    }

    base_url = config.get_base_url(repo_type)
    logger.info(f"[Branch A] Generating tests for PR #{pr_id} [{repo_type}] from {repo} → {base_url}")

    # Phase 2.5 — Resolve endpoints từ Swagger (backend only)
    swagger_endpoints_text = ""
    if repo_type == "backend":
        from pr_webhook_module.workers.swagger_resolver import (
            resolve_endpoints_for_pr,
            endpoints_to_prompt_section,
        )
        endpoints = await resolve_endpoints_for_pr(pr_context, base_url)
        swagger_endpoints_text = endpoints_to_prompt_section(endpoints)
        logger.info(f"[Phase 2.5] Resolved {len(endpoints)} endpoints from Swagger")

    # A.1 — Extract requirements
    # Dùng narrow_response (Turn 2 — chi tiết acceptance criteria) thay vì srs_content
    # vì srs_content = Turn1(overview 4k chars) + Turn2(requirements 21k chars),
    # dùng narrow_response trực tiếp giúp A.1 thấy thêm ~4,400 chars requirements thực sự
    # thay vì bị cắt sớm bởi SRS_MAX_CHARS=20,000
    srs_content: str = srs_context.get("narrow_response") or srs_context.get("srs_content", "")
    if not srs_content:
        raise ValueError("srs_context missing 'narrow_response' or 'srs_content' field")

    requirements = await extract_requirements(srs_content, config)
    if not requirements:
        logger.warning(
            "[Branch A] No requirements extracted from SRS — SRS may not be indexed in LightRAG. "
            "Skipping A.2 test generation to avoid LLM hallucination."
        )
        # Return empty manifest — verdict engine sẽ ghi 0 tests, không waste LLM call
        return TestsManifest(
            pr_id=pr_id, repo=repo, repo_type=repo_type,
            conversation_id=srs_context.get("conversation_id", ""),
            srs_context_path=srs_context.get("srs_context_path", ""),
            test_file_path="", test_cases=[],
            total_requirements=0,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    # Chờ LLM server cool down trước khi gửi request tiếp theo
    import asyncio as _asyncio
    logger.info("[Branch A] Waiting 5s before A.2 LLM call...")
    await _asyncio.sleep(5)

    # A.2 — Generate tests
    test_file_content, test_cases = await generate_playwright_tests(
        requirements, srs_context_enriched, config,
        base_url=base_url,
        swagger_endpoints_text=swagger_endpoints_text,
    )

    # A.3 — Save
    Path(config.tests_dir).mkdir(parents=True, exist_ok=True)
    test_file_path = save_test_file(test_file_content, pr_id, repo, config.tests_dir)

    manifest = TestsManifest(
        pr_id=pr_id,
        repo=repo,
        repo_type=repo_type,
        conversation_id=srs_context.get("conversation_id", ""),
        srs_context_path=srs_context.get("srs_context_path", ""),
        test_file_path=test_file_path,
        test_cases=test_cases,
        total_requirements=len(requirements),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    manifest.manifest_path = save_tests_manifest(manifest, config.tests_dir)

    return manifest


# =============================================================================
# I/O helpers
# =============================================================================

def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# Celery task
# =============================================================================

from celery import shared_task


@shared_task(
    bind=True,
    name="pr_webhook_module.workers.generate_tests_worker.generate_tests",
    max_retries=2,
    default_retry_delay=30,
)
def generate_tests(self, srs_query_result: dict[str, Any]) -> dict[str, Any]:
    """
    Celery task Nhánh A: generate E2E tests từ SRS requirements.

    Args:
        srs_query_result: return value của query_srs task
                          cần có: srs_context_path, context_json

    Returns:
        dict với test_file_path, manifest_path, total_test_cases
    """
    import asyncio

    srs_context_path: str = srs_query_result.get("srs_context_path", "")
    context_json_path: str = srs_query_result.get("context_json", "")

    if not srs_context_path:
        raise ValueError("srs_query_result thiếu 'srs_context_path'")
    if not context_json_path:
        raise ValueError("srs_query_result thiếu 'context_json'")

    logger.info(f"[Branch A] Starting test generation. Task ID: {self.request.id}")

    cfg = GenerateTestsConfig()
    errors = cfg.validate()
    if errors:
        raise ValueError(f"Config errors: {errors}")

    try:
        srs_context = load_json(srs_context_path)
        pr_context = load_json(context_json_path)
        manifest = asyncio.run(generate_tests_for_pr(srs_context, pr_context, cfg))

        result = {
            **srs_query_result,
            "test_file_path": manifest.test_file_path,
            "manifest_path": manifest.manifest_path,
            "total_test_cases": len(manifest.test_cases),
            "repo_type": manifest.repo_type,
        }


        return result
    except Exception as e:
        logger.error(f"[Branch A] Task failed: {e}")
        raise self.retry(exc=e)

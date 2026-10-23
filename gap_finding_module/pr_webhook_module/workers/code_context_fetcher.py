"""
Config-Based Code Context Fetcher

Reads .lightrag-config.yml from the target repo to understand the project's
layer structure, then fetches the relevant source files to provide richer
context for LLM-based PR evaluation.

Config file format (.lightrag-config.yml in repo root):

    architecture: three-layer   # display name only

    layers:
      primary:        # business logic — always fetch when in diff
        - src/services/
        - src/domain/
      secondary:      # supporting layer — fetch when primary not in diff
        - src/controllers/
        - src/repositories/
      ui:             # frontend/UI — always fetch when in diff
        - src/components/
        - src/pages/
        - frontend/src/

Import Discovery:
    When secondary files are in the diff, their import statements are parsed
    to find which primary-layer files they depend on. Those files are fetched
    and added to primary_files so the LLM sees the actual business logic
    being called, not just the controller/repository layer.

    Supported languages: Python, JavaScript/TypeScript
"""

import asyncio
import base64
import logging
import posixpath
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

CONFIG_FILE_PATH = ".lightrag-config.yml"


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class LayerConfig:
    primary: list[str]        # Path prefixes for business logic
    secondary: list[str]      # Path prefixes for supporting layers
    ui: list[str]             # Path prefixes for UI/frontend
    architecture_name: str = "unknown"


@dataclass
class LayerFile:
    path: str
    layer: str                # "primary", "secondary", "ui", "other"
    content: Optional[str] = None


@dataclass
class CodeContext:
    architecture_name: str
    primary_files: list[LayerFile]                         # Business logic files
    ui_files: list[LayerFile]                              # UI / frontend files
    other_files: list[LayerFile]                           # Changed files not matching any layer
    fetch_errors: list[str]
    config_found: bool
    secondary_files: list[LayerFile] = field(default_factory=list)  # Supporting files (controllers, routes, …)


# ---------------------------------------------------------------------------
# Config Fetching
# ---------------------------------------------------------------------------

async def fetch_lightrag_config(
    owner: str,
    repo: str,
    branch: str,
    github_token: str,
    github_api_url: str,
) -> Optional[LayerConfig]:
    """
    Fetch and parse .lightrag-config.yml from the root of the target repo.
    Returns None if the file does not exist or cannot be parsed.
    """
    try:
        import yaml
    except ImportError:
        logger.warning("PyYAML not installed — cannot parse .lightrag-config.yml. "
                       "Install it with: pip install pyyaml")
        return None

    url = f"{github_api_url}/repos/{owner}/{repo}/contents/{CONFIG_FILE_PATH}"
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params={"ref": branch}, headers=headers)
            if response.status_code == 404:
                logger.info(f"No {CONFIG_FILE_PATH} found in {owner}/{repo}@{branch}")
                return None
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        logger.warning(f"Failed to fetch {CONFIG_FILE_PATH}: {e}")
        return None

    try:
        content_b64 = data.get("content", "")
        raw_content = base64.b64decode(content_b64).decode("utf-8")
        parsed = yaml.safe_load(raw_content)

        if not isinstance(parsed, dict):
            logger.warning(f"{CONFIG_FILE_PATH} is not a valid YAML mapping")
            return None

        layers = parsed.get("layers", {})
        return LayerConfig(
            primary=layers.get("primary", []),
            secondary=layers.get("secondary", []),
            ui=layers.get("ui", []),
            architecture_name=parsed.get("architecture", "unknown"),
        )
    except Exception as e:
        logger.warning(f"Failed to parse {CONFIG_FILE_PATH}: {e}")
        return None


# ---------------------------------------------------------------------------
# File Classification
# ---------------------------------------------------------------------------

def _matches_any(path: str, prefixes: list[str]) -> bool:
    return any(path.startswith(p) for p in prefixes)


def classify_files(
    changed_files: list[dict],
    layer_config: LayerConfig,
) -> tuple[list[LayerFile], list[LayerFile], list[LayerFile], list[LayerFile]]:
    """
    Classify changed files into (primary_files, secondary_files, ui_files, other_files).

    Secondary promotion (secondary → primary when primary absent) is handled
    in fetch_code_context() after import discovery runs.
    """
    primary: list[LayerFile] = []
    secondary: list[LayerFile] = []
    ui_files: list[LayerFile] = []
    other: list[LayerFile] = []

    for f in changed_files:
        path = f.get("filename", "")
        if _matches_any(path, layer_config.primary):
            primary.append(LayerFile(path=path, layer="primary"))
        elif _matches_any(path, layer_config.secondary):
            secondary.append(LayerFile(path=path, layer="secondary"))
        elif _matches_any(path, layer_config.ui):
            ui_files.append(LayerFile(path=path, layer="ui"))
        else:
            other.append(LayerFile(path=path, layer="other"))

    return primary, secondary, ui_files, other


# ---------------------------------------------------------------------------
# Import Parsing
# ---------------------------------------------------------------------------

def _parse_python_imports(content: str) -> list[str]:
    """
    Extract absolute module paths from Python import statements.
    Returns candidate file paths (dot-notation converted to slash-notation).

    Handles:
        from x.y.z import Something  →  x/y/z.py, x/y/z/__init__.py
        import x.y.z                 →  x/y/z.py, x/y/z/__init__.py

    Skips relative imports (from . import x, from ..y import z).
    """
    candidates = []

    # from x.y.z import Something
    for m in re.finditer(r"^from\s+([\w.]+)\s+import", content, re.MULTILINE):
        module = m.group(1)
        if module.startswith("."):
            continue  # relative import — skip
        base = module.replace(".", "/")
        candidates.append(f"{base}.py")
        candidates.append(f"{base}/__init__.py")

    # import x.y.z
    for m in re.finditer(r"^import\s+([\w.]+)", content, re.MULTILINE):
        module = m.group(1)
        base = module.replace(".", "/")
        candidates.append(f"{base}.py")
        candidates.append(f"{base}/__init__.py")

    return candidates


def _parse_js_ts_imports(file_path: str, content: str) -> list[str]:
    """
    Extract relative import paths from JS/TS source files and resolve them
    to candidate file paths relative to the repo root.

    Handles:
        import X from './path'           → resolved with extensions
        import { X } from '../path'
        export { X } from './path'
        const X = require('./path')

    Skips bare module imports (node_modules).
    """
    candidates = []
    base_dir = posixpath.dirname(file_path.replace("\\", "/"))

    raw_paths: list[str] = []

    # import ... from './path'
    for m in re.finditer(r"""import\b.*?\bfrom\s+['"]([^'"]+)['"]""", content, re.DOTALL):
        raw_paths.append(m.group(1))

    # export ... from './path'
    for m in re.finditer(r"""export\b.*?\bfrom\s+['"]([^'"]+)['"]""", content, re.DOTALL):
        raw_paths.append(m.group(1))

    # require('./path')
    for m in re.finditer(r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)""", content):
        raw_paths.append(m.group(1))

    for raw in raw_paths:
        if not raw.startswith("."):
            continue  # skip node_modules

        resolved = posixpath.normpath(posixpath.join(base_dir, raw))

        # If already has an extension, use as-is
        if any(resolved.endswith(ext) for ext in (".ts", ".tsx", ".js", ".jsx", ".mjs")):
            candidates.append(resolved)
        else:
            for ext in (".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"):
                candidates.append(resolved + ext)

    return candidates


def _parse_imports(file_path: str, content: str) -> list[str]:
    """Dispatch import parsing by file extension."""
    if file_path.endswith(".py"):
        return _parse_python_imports(content)
    if file_path.endswith((".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs")):
        return _parse_js_ts_imports(file_path, content)
    return []


def _resolve_to_primary_path(candidate: str, primary_prefixes: list[str]) -> str | None:
    """
    Resolve an import-derived candidate path to an actual repo path that falls
    within a primary-layer prefix.

    Tries two strategies:
    1. Direct — candidate already starts with a primary prefix (e.g. the import
       already has the full path like 'src/services/auth.py')
    2. Root-relative — Python imports omit the package root directory.
       e.g. import 'from services.auth import X' gives candidate 'services/auth.py'
       but the actual file is 'src/services/auth.py' when 'src/' is the package root.
       We detect this by checking if any trailing segment of the prefix matches
       the start of the candidate, then prepend the missing root.

    Returns the resolved repo-relative path, or None if no prefix matches.
    """
    for prefix in primary_prefixes:
        # Strategy 1: direct match
        if candidate.startswith(prefix):
            return candidate

        # Strategy 2: root-relative match
        # For prefix "src/services/", try suffixes "services/" then ""
        # and check if candidate starts with that suffix
        prefix_parts = prefix.rstrip("/").split("/")
        for i in range(1, len(prefix_parts)):
            suffix = "/".join(prefix_parts[i:]) + "/"
            if candidate.startswith(suffix):
                root = "/".join(prefix_parts[:i]) + "/"
                return root + candidate

    return None


def _discover_primary_from_imports(
    secondary_files: list[LayerFile],
    primary_prefixes: list[str],
) -> list[LayerFile]:
    """
    Parse import statements in secondary files (content must already be fetched)
    and return LayerFile objects for any imported paths matching primary prefixes.

    Example (Python, package root is src/):
        AuthController.py imports 'from services.auth_service import AuthService'
        → candidate: 'services/auth_service.py'
        → resolves to: 'src/services/auth_service.py'  (matches prefix 'src/services/')
        → returns LayerFile(path='src/services/auth_service.py', layer='primary')
    """
    discovered: dict[str, LayerFile] = {}

    for sec_file in secondary_files:
        if not sec_file.content:
            continue

        for candidate_path in _parse_imports(sec_file.path, sec_file.content):
            resolved = _resolve_to_primary_path(candidate_path, primary_prefixes)
            if resolved and resolved not in discovered:
                logger.debug(
                    f"Import discovery: {resolved} "
                    f"(imported by {sec_file.path})"
                )
                discovered[resolved] = LayerFile(path=resolved, layer="primary")

    return list(discovered.values())


# ---------------------------------------------------------------------------
# Navigation Path Extraction
# ---------------------------------------------------------------------------

def extract_navigation_paths(code_context: "CodeContext") -> list[str]:
    """
    Extract HTTP route patterns and page navigation paths from fetched code files.

    Scans primary, ui, and other files for:
    - Express.js: router.get('/path', ...) → "GET /path"
    - React Router: <Route path="/path"> → "PAGE /path"

    Returns deduplicated list like ["GET /items", "POST /items/:id", "PAGE /items/edit"].
    Pure parsing — no LLM, never raises.
    """
    express_re = re.compile(
        r'\b(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*[\'"]([^\'"]+)[\'"]',
        re.IGNORECASE,
    )
    react_route_re = re.compile(
        r'path\s*=\s*[\'"]([^\'"]+)[\'"]',
        re.IGNORECASE,
    )

    results: list[str] = []
    seen: set[str] = set()

    all_files = (
        code_context.primary_files
        + code_context.secondary_files
        + code_context.ui_files
        + code_context.other_files
    )

    for lf in all_files:
        if not lf.content:
            continue

        for m in express_re.finditer(lf.content):
            entry = f"{m.group(1).upper()} {m.group(2)}"
            if entry not in seen:
                seen.add(entry)
                results.append(entry)

        if lf.layer in ("ui", "other") or lf.path.endswith((".jsx", ".tsx")):
            for m in react_route_re.finditer(lf.content):
                path = m.group(1)
                if path.startswith("/"):
                    entry = f"PAGE {path}"
                    if entry not in seen:
                        seen.add(entry)
                        results.append(entry)

    return results


# ---------------------------------------------------------------------------
# Code Context Log
# ---------------------------------------------------------------------------

def save_code_context_to_file(
    code_context: CodeContext,
    pr_number: int,
    repo: str,
    nav_paths: list[str],
    output_dir: str = "./code_context_logs",
) -> Optional[str]:
    """
    Write the full code context (all fetched files and their content) to a
    human-readable log file for debugging and audit purposes.

    Filename: {output_dir}/{safe_repo}_PR{pr_number}_{timestamp}.txt
    e.g.:     ./code_context_logs/org_myrepo_PR24_20260309_153012.txt

    Returns the absolute path of the written file, or None on error.
    Never raises.
    """
    try:
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        safe_repo = repo.replace("/", "_").replace(" ", "-")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{safe_repo}_PR{pr_number}_{ts}.txt"
        file_path = Path(output_dir) / filename

        lines: list[str] = []

        def section(title: str) -> None:
            lines.append("")
            lines.append("=" * 70)
            lines.append(title)
            lines.append("=" * 70)

        def file_block(lf: LayerFile, note: str = "") -> None:
            label = f"--- [{lf.layer.upper()}] {lf.path}{note} ---"
            lines.append(label)
            if lf.content:
                lines.append(lf.content)
            else:
                lines.append("(content not available)")
            lines.append("")

        # Header
        lines.append(f"CODE CONTEXT LOG")
        lines.append(f"PR:            #{pr_number} — {repo}")
        lines.append(f"Architecture:  {code_context.architecture_name}")
        lines.append(f"Config found:  {code_context.config_found}")
        lines.append(f"Timestamp:     {datetime.now().isoformat(timespec='seconds')}")
        lines.append(f"Files summary: "
                     f"primary={len(code_context.primary_files)}, "
                     f"secondary={len(code_context.secondary_files)}, "
                     f"ui={len(code_context.ui_files)}, "
                     f"other={len(code_context.other_files)}")

        # Navigation paths
        section(f"NAVIGATION PATHS ({len(nav_paths)})")
        if nav_paths:
            for p in nav_paths:
                lines.append(f"  {p}")
        else:
            lines.append("  (none detected)")

        # Fetch errors
        if code_context.fetch_errors:
            section(f"FETCH ERRORS ({len(code_context.fetch_errors)})")
            for err in code_context.fetch_errors:
                lines.append(f"  ! {err}")

        # Primary files
        section(f"PRIMARY FILES ({len(code_context.primary_files)}) — business logic")
        for lf in code_context.primary_files:
            file_block(lf)

        # Secondary files
        section(f"SECONDARY FILES ({len(code_context.secondary_files)}) — controllers / routes / middleware")
        for lf in code_context.secondary_files:
            file_block(lf)

        # UI files
        section(f"UI FILES ({len(code_context.ui_files)})")
        for lf in code_context.ui_files:
            file_block(lf)

        # Other files
        section(f"OTHER FILES ({len(code_context.other_files)})")
        for lf in code_context.other_files:
            file_block(lf)

        file_path.write_text("\n".join(lines), encoding="utf-8")
        logger.info(f"Code context log saved to {file_path.resolve()}")
        return str(file_path.resolve())

    except Exception as e:
        logger.warning(f"Failed to save code context log: {e}")
        return None


# ---------------------------------------------------------------------------
# File Content Fetching
# ---------------------------------------------------------------------------

async def fetch_file_content(
    owner: str,
    repo: str,
    file_path: str,
    branch: str,
    github_token: str,
    github_api_url: str,
) -> Optional[str]:
    """
    Fetch the full content of a single file from GitHub Contents API.
    Returns None on 404 or any network error.
    """
    url = f"{github_api_url}/repos/{owner}/{repo}/contents/{file_path}"
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params={"ref": branch}, headers=headers)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()

        content_b64 = data.get("content", "")
        return base64.b64decode(content_b64).decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"Failed to fetch {file_path}: {e}")
        return None


async def _fetch_and_populate(
    layer_file: LayerFile,
    owner: str,
    repo: str,
    branch: str,
    github_token: str,
    github_api_url: str,
    max_file_chars: int,
    fetch_errors: list[str],
) -> None:
    """Fetch content for a LayerFile in-place, truncating if necessary."""
    content = await fetch_file_content(
        owner, repo, layer_file.path, branch, github_token, github_api_url
    )
    if content is None:
        fetch_errors.append(f"Could not fetch: {layer_file.path}")
        return
    if len(content) > max_file_chars:
        content = content[:max_file_chars] + "\n[... file truncated ...]"
    layer_file.content = content


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

async def fetch_code_context(
    owner: str,
    repo: str,
    pr_number: int,
    branch: str,
    changed_files: list[dict],
    github_token: str,
    github_api_url: str,
    max_file_chars: int = 8000,
) -> CodeContext:
    """
    Full pipeline:
    1. Fetch .lightrag-config.yml → LayerConfig
    2. If no config → return CodeContext with all files as other_files
    3. Classify changed files into primary / secondary / ui / other
    4. If secondary files exist:
       a. Fetch their content (needed for import parsing)
       b. Parse imports → find primary-layer files they depend on
       c. Add discovered primary files (deduped)
    5. If primary still empty after discovery → promote secondary to primary
    6. Fetch content of primary (undiscovered) + ui files concurrently
       (secondary files already fetched in step 4 — skip to avoid double fetch)
    7. Return populated CodeContext

    Never raises — errors are collected in CodeContext.fetch_errors.
    """
    fetch_errors: list[str] = []

    # Step 1: Fetch config
    layer_config = await fetch_lightrag_config(
        owner, repo, branch, github_token, github_api_url
    )

    if layer_config is None:
        other_files = [
            LayerFile(path=f.get("filename", ""), layer="other")
            for f in changed_files
        ]
        return CodeContext(
            architecture_name="unknown",
            primary_files=[],
            ui_files=[],
            other_files=other_files,
            fetch_errors=[],
            config_found=False,
        )

    # Step 2: Classify (4 buckets, no promotion yet)
    primary_files, secondary_files, ui_files, other_files = classify_files(
        changed_files, layer_config
    )

    # Step 3: Import discovery via secondary files
    if secondary_files:
        # Fetch secondary file content — needed for import parsing
        # and also used directly if they end up promoted to primary
        await asyncio.gather(*[
            _fetch_and_populate(
                f, owner, repo, branch, github_token, github_api_url,
                max_file_chars, fetch_errors,
            )
            for f in secondary_files
        ])

        # Parse imports to find primary-layer dependencies
        discovered = _discover_primary_from_imports(secondary_files, layer_config.primary)

        # Merge discovered files — skip paths already in primary (from diff)
        existing_paths = {f.path for f in primary_files}
        added = 0
        for f in discovered:
            if f.path not in existing_paths:
                primary_files.append(f)
                existing_paths.add(f.path)
                added += 1

        if added:
            logger.info(
                f"Import discovery added {added} primary file(s) "
                f"from {len(secondary_files)} secondary file(s)"
            )

    # Step 4: Promote secondary → primary if primary still empty after discovery
    promoted = False
    if not primary_files and secondary_files:
        logger.info(
            "No primary files found (direct or via imports) — "
            "promoting secondary files to primary context"
        )
        for f in secondary_files:
            f.layer = "primary"
        primary_files = secondary_files
        promoted = True

    # Step 5: Fetch content for primary + ui files not yet fetched
    # (secondary files were already fetched above — avoid double fetch)
    already_fetched = {f.path for f in secondary_files}
    files_to_fetch = [
        f for f in (primary_files + ui_files)
        if f.path not in already_fetched
    ]
    if files_to_fetch:
        await asyncio.gather(*[
            _fetch_and_populate(
                f, owner, repo, branch, github_token, github_api_url,
                max_file_chars, fetch_errors,
            )
            for f in files_to_fetch
        ])

    # Secondary files are stored in CodeContext for navigation path extraction
    # (routes, middleware, etc. — often live in secondary layer).
    # If promoted to primary they are already in primary_files, so no duplication.
    context_secondary = [] if promoted else secondary_files

    logger.info(
        f"Code context fetched — architecture: {layer_config.architecture_name}, "
        f"primary: {len(primary_files)}, secondary: {len(context_secondary)}, "
        f"ui: {len(ui_files)}, other: {len(other_files)}, errors: {len(fetch_errors)}"
    )

    return CodeContext(
        architecture_name=layer_config.architecture_name,
        primary_files=primary_files,
        secondary_files=context_secondary,
        ui_files=ui_files,
        other_files=other_files,
        fetch_errors=fetch_errors,
        config_found=True,
    )

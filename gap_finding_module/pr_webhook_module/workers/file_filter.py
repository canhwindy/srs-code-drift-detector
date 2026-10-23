"""
File Filter — analysis-layer utility for PR workers.

pr_worker collects ALL changed files faithfully (audit trail).
This module filters to business-logic-relevant files before building LLM prompts.

Design principle:
    Filtering is an analysis concern, not a collection concern.
    All workers that send file lists to an LLM should call filter_relevant_files()
    rather than slicing raw changed_files directly.
"""

import fnmatch
import logging

logger = logging.getLogger(__name__)


# =============================================================================
# Deny patterns
# =============================================================================

# Lock & dependency manifests — track dependencies, not business logic
_LOCK_PATTERNS: frozenset[str] = frozenset([
    "*.lock",
    "package-lock.json",
    "yarn.lock",
    "poetry.lock",
    "composer.lock",
    "Pipfile.lock",
    "Gemfile.lock",
    "*.lockb",              # Bun lockfile
])

# Generated / minified / compiled — not hand-written
_GENERATED_PATTERNS: frozenset[str] = frozenset([
    "*.min.js",
    "*.min.css",
    "*_pb2.py",             # Protobuf Python generated
    "*_pb2_grpc.py",
    "*.pb.go",              # Protobuf Go generated
    "*.generated.*",
    "*.g.dart",             # Dart generated
    "*.freezed.dart",
])

# Build output paths — artifacts, not source
_BUILD_PATH_PATTERNS: frozenset[str] = frozenset([
    "dist/*",
    "build/*",
    ".next/*",
    "__pycache__/*",
    "*.pyc",
    "node_modules/*",
    ".nuxt/*",
    "coverage/*",
    ".angular/*",
    "out/*",
    "target/*",             # Java/Rust build output
    ".gradle/*",
])

# Pure documentation & developer config — no effect on runtime behavior
_CONFIG_DOC_PATTERNS: frozenset[str] = frozenset([
    "*.md",
    "*.rst",
    "CHANGELOG",
    "CONTRIBUTING",
    "LICENSE",
    "AUTHORS",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".prettierrc",
    ".prettierrc.*",
    ".eslintrc",
    ".eslintrc.*",
    ".stylelintrc",
    ".stylelintrc.*",
    ".babelrc",
    ".babelrc.*",
    "*.env.example",
    "*.env.sample",
    ".vscode/*",
    ".idea/*",
    "*.suo",
    "*.user",
])

# Binary assets — unreadable by LLM, no business logic
_BINARY_PATTERNS: frozenset[str] = frozenset([
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.svg",
    "*.ico",
    "*.webp",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.otf",
    "*.pdf",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.bz2",
    "*.7z",
    "*.mp4",
    "*.mp3",
    "*.wav",
])

_ALL_DENY_PATTERNS: frozenset[str] = (
    _LOCK_PATTERNS
    | _GENERATED_PATTERNS
    | _BUILD_PATH_PATTERNS
    | _CONFIG_DOC_PATTERNS
    | _BINARY_PATTERNS
)


# =============================================================================
# Internal helpers
# =============================================================================

def _normalize(path: str) -> str:
    return path.replace("\\", "/")


def _basename(normalized_path: str) -> str:
    return normalized_path.split("/")[-1]


def _matches_deny(normalized_path: str) -> bool:
    """True if the file path matches any deny pattern (full path OR basename)."""
    base = _basename(normalized_path)
    return any(
        fnmatch.fnmatch(normalized_path, p) or fnmatch.fnmatch(base, p)
        for p in _ALL_DENY_PATTERNS
    )


def _is_migration(normalized_path: str) -> bool:
    parts = normalized_path.split("/")
    return "migrations" in parts or "migration" in parts


def _is_test_file(normalized_path: str) -> bool:
    base = _basename(normalized_path)
    return (
        base.startswith("test_")
        or base.endswith("_test.py")
        or base.endswith(".spec.ts")
        or base.endswith(".test.ts")
        or base.endswith(".spec.js")
        or base.endswith(".test.js")
        or base.endswith("_spec.rb")
        or base.endswith("_test.go")
    )


# =============================================================================
# Public API
# =============================================================================

def filter_relevant_files(
    changed_files: list[dict],
    include_migrations: bool = True,
    include_tests: bool = True,
) -> list[dict]:
    """
    Return the subset of changed_files that contains business-logic-relevant code.

    Removes:
    - Lock files (package-lock.json, yarn.lock, *.lock, …)
    - Generated / minified files (*_pb2.py, *.min.js, …)
    - Build output directories (dist/, build/, __pycache__/, …)
    - Pure documentation (*.md, *.rst, LICENSE, CHANGELOG, …)
    - Developer tooling config (.gitignore, .prettierrc, .editorconfig, …)
    - Binary assets (images, fonts, archives)
    - Files with zero line changes (rename-only, permission changes)

    Args:
        changed_files:      Raw list of file dicts from pr_context.json.
                            Each dict has at minimum: filename, additions, deletions.
        include_migrations: Keep Django / Alembic migration files (default True).
                            Set False when you want pure business-logic views only.
        include_tests:      Keep test files *.spec.ts, test_*.py (default True).
                            GAP analysis benefits from knowing what was tested.

    Returns:
        Filtered list in original order.
    """
    relevant: list[dict] = []

    for f in changed_files:
        filename: str = f.get("filename", "")
        norm = _normalize(filename)

        # 1. Significance: skip files with no actual line changes
        if f.get("additions", 0) + f.get("deletions", 0) == 0:
            logger.debug("[file_filter] skip (no changes): %s", filename)
            continue

        # 2. Denylist patterns
        if _matches_deny(norm):
            logger.debug("[file_filter] skip (denylist): %s", filename)
            continue

        # 3. Optional: migrations
        if not include_migrations and _is_migration(norm):
            logger.debug("[file_filter] skip (migration): %s", filename)
            continue

        # 4. Optional: test files
        if not include_tests and _is_test_file(norm):
            logger.debug("[file_filter] skip (test): %s", filename)
            continue

        relevant.append(f)

    return relevant


def get_filter_summary(all_files: list[dict], relevant_files: list[dict]) -> str:
    """
    One-line human-readable summary of what was filtered.
    Intended for info-level logging, not for LLM prompts.

    Example:
        "Filtered 3/8 file(s): package-lock.json, README.md, logo.png"
    """
    n_all = len(all_files)
    n_rel = len(relevant_files)
    n_removed = n_all - n_rel

    if n_removed == 0:
        return f"All {n_all} file(s) passed filter (no noise removed)."

    relevant_names: set[str] = {f.get("filename", "") for f in relevant_files}
    removed_names = [
        f.get("filename", "?")
        for f in all_files
        if f.get("filename", "") not in relevant_names
    ]

    sample = ", ".join(removed_names[:5])
    tail = f" (+{len(removed_names) - 5} more)" if len(removed_names) > 5 else ""
    return f"Filtered {n_removed}/{n_all} file(s) as non-relevant: {sample}{tail}"

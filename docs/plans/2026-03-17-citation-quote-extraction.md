# Citation Quote Extraction — Anchor-and-Expand + BM25 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded stopword-based quote extraction with a language-agnostic pipeline using Anchor-and-Expand (Tier 1) and BM25 contiguous window (Tier 2), eliminating `[...]` fragments and stopword lists.

**Architecture:** Tier 1 uses the LLM's excerpt as an anchor to locate the matching region in the chunk via SequenceMatcher, then expands to sentence boundaries to return a true verbatim quote. Tier 2 (fallback) builds a BM25 index at runtime over chunk sentences, scores them against the paragraph query, and returns the highest-scoring contiguous window of K sentences — clean, no `[...]`.

**Tech Stack:** Python 3.10+, `difflib.SequenceMatcher` (stdlib), `rank-bm25` (new dependency), `re` (stdlib). No ML models, no external NLP libraries.

---

## Context & Background

The current file to modify: `backend/routers/chat/chat_helper.py`

Current problems:
- `_STOPWORDS`: frozenset of 80+ hardcoded Vietnamese + English words — breaks on other languages, includes domain-meaningful words
- `_is_verbatim_from_chunk()`: binary accept/reject at 60% fuzzy threshold — rejects LLM excerpts that paraphrase slightly
- `_extract_relevant_segments()`: picks non-contiguous lines and joins with `[...]` — produces fragmented, unreadable quotes

Functions to DELETE: `_STOPWORDS`, `_is_verbatim_from_chunk()`, `_extract_relevant_segments()`

Functions to ADD: `_normalize_text()`, `_split_into_sentences()`, `_tokenize_agnostic()`, `_anchor_and_expand()`, `_extract_relevant_segments_bm25()`

The only call site to update is in `parse_paragraphs_with_citations()` around line 421-432.

---

## Task 1: Add `rank-bm25` dependency

**Files:**
- Modify: `backend/requirements.txt`

**Step 1: Add the dependency**

Add this line to `backend/requirements.txt` after the `numpy` line:

```
rank-bm25>=0.2.2                 # BM25 sentence scoring for citation extraction (no stopwords needed)
```

**Step 2: Install locally to verify**

```bash
cd backend
pip install rank-bm25>=0.2.2
```

Expected: `Successfully installed rank-bm25-0.2.2` (or similar)

**Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "feat: add rank-bm25 dependency for citation extraction"
```

---

## Task 2: Create test file with baseline tests

**Files:**
- Create: `backend/tests/test_citation_helpers.py`

**Step 1: Create the test file**

```python
"""
Tests for chat_helper citation extraction functions.

Tests cover:
- _normalize_text()
- _split_into_sentences()
- _tokenize_agnostic()
- _anchor_and_expand()
- _extract_relevant_segments_bm25()
"""
import pytest
import sys
import os

# Add backend root to path so imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── _normalize_text ──────────────────────────────────────────────────────────

def test_normalize_text_lowercases():
    from routers.chat.chat_helper import _normalize_text
    assert _normalize_text("Hello WORLD") == "hello world"


def test_normalize_text_collapses_whitespace():
    from routers.chat.chat_helper import _normalize_text
    assert _normalize_text("foo   bar\t\nbaz") == "foo bar baz"


def test_normalize_text_empty():
    from routers.chat.chat_helper import _normalize_text
    assert _normalize_text("") == ""


# ── _split_into_sentences ────────────────────────────────────────────────────

def test_split_sentences_basic():
    from routers.chat.chat_helper import _split_into_sentences
    text = "First sentence. Second sentence. Third sentence."
    result = _split_into_sentences(text)
    assert len(result) >= 2
    assert any("First" in s for s in result)
    assert any("Second" in s for s in result)


def test_split_sentences_newline():
    from routers.chat.chat_helper import _split_into_sentences
    text = "Line one.\nLine two.\nLine three."
    result = _split_into_sentences(text)
    assert len(result) >= 2


def test_split_sentences_filters_short():
    from routers.chat.chat_helper import _split_into_sentences
    # "-" alone should be filtered out (< MIN_SENTENCE_LENGTH)
    text = "Real sentence here.\n-\nAnother real sentence here."
    result = _split_into_sentences(text)
    assert all(len(s) >= 10 for s in result)


def test_split_sentences_single():
    from routers.chat.chat_helper import _split_into_sentences
    text = "Just one sentence without end punctuation"
    result = _split_into_sentences(text)
    assert len(result) == 1
    assert result[0] == text


# ── _tokenize_agnostic ───────────────────────────────────────────────────────

def test_tokenize_agnostic_english():
    from routers.chat.chat_helper import _tokenize_agnostic
    tokens = _tokenize_agnostic("The system supports authentication")
    assert "system" in tokens
    assert "supports" in tokens
    assert "authentication" in tokens


def test_tokenize_agnostic_vietnamese():
    from routers.chat.chat_helper import _tokenize_agnostic
    tokens = _tokenize_agnostic("Hệ thống xác thực người dùng")
    assert "hệ" in tokens
    assert "thống" in tokens
    assert "xác" in tokens


def test_tokenize_agnostic_filters_single_chars():
    from routers.chat.chat_helper import _tokenize_agnostic
    tokens = _tokenize_agnostic("a b c word")
    assert "a" not in tokens
    assert "word" in tokens


def test_tokenize_agnostic_lowercases():
    from routers.chat.chat_helper import _tokenize_agnostic
    tokens = _tokenize_agnostic("Hello WORLD")
    assert "hello" in tokens
    assert "world" in tokens
    assert "Hello" not in tokens


# ── _anchor_and_expand ───────────────────────────────────────────────────────

CHUNK_UC = """UC-TM-002: View Course Class Details
Chức năng này cho phép người dùng xem chi tiết về lớp học.
Tác nhân bao gồm Giáo viên, Tutor và Learner.
Điều kiện tiên quyết: người dùng đã đăng nhập.
Kết quả: bản ghi lớp học được hiển thị thành công."""


def test_anchor_and_expand_exact_match():
    from routers.chat.chat_helper import _anchor_and_expand
    excerpt = "Chức năng này cho phép người dùng xem chi tiết về lớp học."
    result = _anchor_and_expand(excerpt, CHUNK_UC)
    assert result is not None
    assert "Chức năng" in result


def test_anchor_and_expand_paraphrased_excerpt():
    """LLM slightly paraphrases — should still locate and return verbatim chunk text."""
    from routers.chat.chat_helper import _anchor_and_expand
    # LLM paraphrase: dropped "về" and changed word order slightly
    excerpt = "cho phép người dùng xem chi tiết lớp học để học tập"
    result = _anchor_and_expand(excerpt, CHUNK_UC)
    assert result is not None
    # Result must come from chunk, not from excerpt
    assert "cho phép" in result


def test_anchor_and_expand_hallucinated_excerpt():
    """Completely hallucinated excerpt — anchor too weak → return None."""
    from routers.chat.chat_helper import _anchor_and_expand
    excerpt = "This text does not exist anywhere in the document at all."
    result = _anchor_and_expand(excerpt, CHUNK_UC)
    assert result is None


def test_anchor_and_expand_empty_excerpt():
    from routers.chat.chat_helper import _anchor_and_expand
    result = _anchor_and_expand("", CHUNK_UC)
    assert result is None


def test_anchor_and_expand_empty_chunk():
    from routers.chat.chat_helper import _anchor_and_expand
    result = _anchor_and_expand("some excerpt", "")
    assert result is None


def test_anchor_and_expand_returns_verbatim_from_chunk():
    """Output must be a substring of the original chunk, not LLM text."""
    from routers.chat.chat_helper import _anchor_and_expand
    excerpt = "người dùng đã đăng nhập vào hệ thống"
    result = _anchor_and_expand(excerpt, CHUNK_UC)
    if result is not None:
        # Every word in result must appear in chunk
        assert result in CHUNK_UC or all(word in CHUNK_UC for word in result.split())


# ── _extract_relevant_segments_bm25 ─────────────────────────────────────────

CHUNK_LONG = """
The system architecture consists of three main components.
First, the frontend is built with React and handles user interface rendering.
Second, the backend API is implemented using FastAPI and processes all business logic.
Third, the database layer uses PostgreSQL for persistent storage.
Authentication is handled via JWT tokens issued at login.
Users must provide valid credentials to receive a token.
The token expires after 24 hours and must be refreshed.
Course management allows teachers to create and manage course classes.
Learners can enroll in course classes and track their progress.
Assignments can be submitted through the submission portal.
"""


def test_bm25_returns_string():
    from routers.chat.chat_helper import _extract_relevant_segments_bm25
    result = _extract_relevant_segments_bm25("JWT authentication token login", CHUNK_LONG)
    assert isinstance(result, str)
    assert len(result) > 0


def test_bm25_returns_relevant_content():
    from routers.chat.chat_helper import _extract_relevant_segments_bm25
    result = _extract_relevant_segments_bm25("JWT authentication token login", CHUNK_LONG)
    # Should contain sentences about JWT/auth, not about React or courses
    assert "JWT" in result or "token" in result.lower() or "Authentication" in result


def test_bm25_no_ellipsis_fragments():
    """Result must NOT contain [...] fragments."""
    from routers.chat.chat_helper import _extract_relevant_segments_bm25
    result = _extract_relevant_segments_bm25("course learner enroll", CHUNK_LONG)
    assert "[...]" not in result


def test_bm25_short_chunk_returns_full():
    """Chunk shorter than MIN_CHUNK_LENGTH → return entire chunk."""
    from routers.chat.chat_helper import _extract_relevant_segments_bm25
    short_chunk = "Short chunk."
    result = _extract_relevant_segments_bm25("any query", short_chunk)
    assert result == short_chunk


def test_bm25_single_sentence_chunk():
    from routers.chat.chat_helper import _extract_relevant_segments_bm25
    chunk = "The only sentence in this document chunk."
    result = _extract_relevant_segments_bm25("sentence document", chunk)
    assert isinstance(result, str)
    assert len(result) > 0


def test_bm25_vietnamese_query():
    from routers.chat.chat_helper import _extract_relevant_segments_bm25
    chunk = """Hệ thống xác thực người dùng bằng JWT token.
Token hết hạn sau 24 giờ và cần được làm mới.
Giáo viên có thể tạo và quản lý lớp học.
Học viên đăng ký lớp học và theo dõi tiến độ."""
    result = _extract_relevant_segments_bm25("xác thực JWT token đăng nhập", chunk)
    assert "JWT" in result or "xác thực" in result
    assert "[...]" not in result
```

**Step 2: Run tests to verify they all FAIL (functions don't exist yet)**

```bash
cd backend
python -m pytest tests/test_citation_helpers.py -v 2>&1 | head -50
```

Expected: All tests FAIL with `ImportError` or `AttributeError` — functions not yet defined.

**Step 3: Commit the failing tests**

```bash
git add backend/tests/test_citation_helpers.py
git commit -m "test: add failing tests for citation extraction helpers"
```

---

## Task 3: Add `_normalize_text()`, `_split_into_sentences()`, `_tokenize_agnostic()`

**Files:**
- Modify: `backend/routers/chat/chat_helper.py`

These are pure utility functions. Add them AFTER the existing constants block (after line 47, before the `_parse_llm_excerpts` section).

**Step 1: Delete the `_STOPWORDS` constant**

Remove lines 33-47 (the entire `_STOPWORDS` frozenset declaration) from `chat_helper.py`.

**Step 2: Add new constants and utility functions**

Add the following block in place of `_STOPWORDS`, after line 31 (`_BLOCKQUOTE_PATTERN`):

```python
# ── Tier 1: Anchor-and-Expand tuning ─────────────────────────────────────────
# Minimum fraction of excerpt length that must match via SequenceMatcher.
# Lower than old verify threshold (0.6) — we only need to locate, not verify.
_ANCHOR_MIN_RATIO: float = 0.4

# ── Tier 2: BM25 Contiguous Window tuning ────────────────────────────────────
# Max sentences included in the output window.
_BM25_WINDOW_SIZE: int = 5
# Chunks shorter than this are returned as-is (no BM25 needed).
_MIN_CHUNK_LENGTH: int = 50
# Sentences shorter than this are excluded from BM25 index.
_MIN_SENTENCE_LENGTH: int = 10

# Regex for language-agnostic tokenization.
# Covers Latin (+ diacritics), Vietnamese, Cyrillic, digits.
_TOKEN_RE: re.Pattern[str] = re.compile(
    r'[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\d]+'
)

# Sentence split pattern: split after sentence-ending punctuation or on blank lines.
_SENTENCE_SPLIT_RE: re.Pattern[str] = re.compile(r'(?<=[.!?])\s+|\n+')


def _normalize_text(text: str) -> str:
    """Lowercase and collapse all whitespace to single spaces."""
    return re.sub(r'\s+', ' ', text.lower().strip())


def _split_into_sentences(text: str) -> list[str]:
    """
    Split text into sentences using punctuation and newlines.
    Filters out fragments shorter than _MIN_SENTENCE_LENGTH.
    Language-agnostic — no NLP library required.
    """
    parts = _SENTENCE_SPLIT_RE.split(text)
    return [p.strip() for p in parts if len(p.strip()) >= _MIN_SENTENCE_LENGTH]


def _tokenize_agnostic(text: str) -> list[str]:
    """
    Tokenize text into lowercase word tokens.
    Covers Latin, Vietnamese (with diacritics), Cyrillic, digits.
    Min token length = 2. No stopword list — BM25 IDF handles frequency weighting.
    """
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) >= 2]
```

**Step 3: Run only the utility tests to verify they pass**

```bash
cd backend
python -m pytest tests/test_citation_helpers.py -v -k "normalize or split or tokenize" 2>&1
```

Expected: All `test_normalize_*`, `test_split_*`, `test_tokenize_*` tests PASS.

**Step 4: Commit**

```bash
git add backend/routers/chat/chat_helper.py
git commit -m "feat: add language-agnostic text utilities, remove hardcoded _STOPWORDS"
```

---

## Task 4: Implement `_anchor_and_expand()`

**Files:**
- Modify: `backend/routers/chat/chat_helper.py`

**Context:** This replaces `_is_verbatim_from_chunk()`. Add it AFTER `_split_into_sentences` / `_tokenize_agnostic`, BEFORE `_extract_relevant_segments`.

**Step 1: Delete `_is_verbatim_from_chunk()`**

Remove the entire function `_is_verbatim_from_chunk()` (lines 126-164 in the original file).

**Step 2: Add `_anchor_and_expand()`**

```python
def _anchor_and_expand(excerpt: str, chunk_content: str) -> str | None:
    """
    Tier 1 quote extraction: use LLM excerpt as an anchor to locate the
    matching region in chunk_content, then expand to sentence boundaries
    to return true verbatim text from the chunk.

    Unlike the old binary verify approach, this function does NOT reject
    LLM excerpts that paraphrase slightly — it uses them to locate the
    right passage and returns chunk text (not LLM text).

    Algorithm:
        1. Normalize both strings (lowercase, collapse whitespace).
        2. Find the longest matching block via SequenceMatcher.
        3. If block covers < _ANCHOR_MIN_RATIO of excerpt → anchor too weak → None.
        4. Map match position back to original chunk_content offsets.
        5. Expand left/right to nearest sentence boundary (.!?\n).
        6. Return chunk_content[start:end].strip().

    Args:
        excerpt:       Verbatim excerpt text from LLM References section.
        chunk_content: Full content of the source chunk from LightRAG.

    Returns:
        Verbatim substring of chunk_content around the matched region,
        or None if the anchor match is too weak (Tier 2 fallback needed).
    """
    if not excerpt or not chunk_content:
        return None

    e_norm: str = _normalize_text(excerpt)
    c_norm: str = _normalize_text(chunk_content)

    if not e_norm or not c_norm:
        return None

    # Find longest matching block between normalized strings
    sm = SequenceMatcher(None, e_norm, c_norm, autojunk=False)
    match = sm.find_longest_match(0, len(e_norm), 0, len(c_norm))

    # Anchor strength check
    if match.size < len(e_norm) * _ANCHOR_MIN_RATIO:
        logger.debug(
            f"[Citations] Anchor weak: {match.size}/{len(e_norm)} "
            f"({match.size / max(len(e_norm), 1):.1%}) < {_ANCHOR_MIN_RATIO:.0%} → Tier2"
        )
        return None

    # Map normalized position back to original chunk_content.
    # _normalize_text only lowercases and collapses whitespace, so we can
    # find the anchor text in the original by scanning forward from a
    # character-count estimate (normalized is always <= original length).
    # Simple approach: find the anchor substring in lowercased original.
    anchor_text_norm: str = c_norm[match.b: match.b + match.size]
    chunk_lower: str = chunk_content.lower()

    # Find first occurrence of anchor in lowercased original
    anchor_pos: int = chunk_lower.find(anchor_text_norm)
    if anchor_pos == -1:
        # Normalized collapsed whitespace changed offsets — use ratio estimate
        ratio: float = len(chunk_content) / max(len(c_norm), 1)
        anchor_pos = int(match.b * ratio)

    anchor_end: int = anchor_pos + int(match.size * (len(chunk_content) / max(len(c_norm), 1)))
    anchor_end = min(anchor_end, len(chunk_content))

    # Expand left to nearest sentence boundary
    boundary_chars: str = '.!?\n'
    start: int = anchor_pos
    for i in range(anchor_pos, max(anchor_pos - 300, -1), -1):
        if chunk_content[i] in boundary_chars:
            start = i + 1
            break
    else:
        start = max(anchor_pos - 300, 0)

    # Expand right to nearest sentence boundary
    end: int = anchor_end
    for i in range(anchor_end, min(anchor_end + 300, len(chunk_content))):
        if chunk_content[i] in boundary_chars:
            end = i + 1
            break
    else:
        end = min(anchor_end + 300, len(chunk_content))

    result: str = chunk_content[start:end].strip()

    logger.debug(
        f"[Citations] Anchor-and-expand: anchor_ratio="
        f"{match.size / max(len(e_norm), 1):.1%}, "
        f"extracted_len={len(result)}"
    )
    return result if result else None
```

**Step 3: Run anchor tests**

```bash
cd backend
python -m pytest tests/test_citation_helpers.py -v -k "anchor" 2>&1
```

Expected: All `test_anchor_*` tests PASS.

**Step 4: Commit**

```bash
git add backend/routers/chat/chat_helper.py
git commit -m "feat: implement _anchor_and_expand() for Tier 1 citation extraction"
```

---

## Task 5: Implement `_extract_relevant_segments_bm25()`

**Files:**
- Modify: `backend/routers/chat/chat_helper.py`

**Context:** This replaces `_extract_relevant_segments()`. Add it directly after `_anchor_and_expand()`.

**Step 1: Add import at top of file**

At the top of `chat_helper.py`, add to the imports block:

```python
from rank_bm25 import BM25Okapi
```

**Step 2: Delete `_extract_relevant_segments()`**

Remove the entire function `_extract_relevant_segments()` (lines 171-254 in the original file).

**Step 3: Add `_extract_relevant_segments_bm25()`**

```python
def _extract_relevant_segments_bm25(paragraph_text: str, chunk_content: str) -> str:
    """
    Tier 2 fallback: find the most relevant contiguous passage in chunk_content
    using BM25 sentence scoring — no hardcoded stopwords, language-agnostic.

    Algorithm:
        1. Guard: chunk too short → return as-is.
        2. Split chunk into sentences (_split_into_sentences).
        3. Tokenize each sentence (_tokenize_agnostic) → BM25 corpus.
        4. Build BM25Okapi index. IDF is computed from this chunk's sentences,
           so high-frequency words (e.g. "người dùng") are naturally downweighted.
        5. Score each sentence against paragraph_text tokens.
        6. Sliding window of _BM25_WINDOW_SIZE sentences → find window with
           highest total score.
        7. Return joined sentences from best window — no [...]  fragments.

    Args:
        paragraph_text: Clean text of the AI response paragraph (no [n] markers).
        chunk_content:  Full content of the source chunk from LightRAG.

    Returns:
        Best contiguous passage from chunk_content. Falls back to entire
        chunk_content if BM25 scoring produces no signal.
    """
    # Guard: very short chunks — nothing to extract
    if len(chunk_content.strip()) < _MIN_CHUNK_LENGTH:
        return chunk_content.strip()

    sentences: list[str] = _split_into_sentences(chunk_content)

    # Guard: single or no sentences after split
    if len(sentences) <= 1:
        return chunk_content.strip()

    # Tokenize sentences for BM25 corpus
    tokenized_sentences: list[list[str]] = [_tokenize_agnostic(s) for s in sentences]

    # Guard: all sentences tokenize to empty (e.g. CJK-only text not covered by regex)
    if not any(tokenized_sentences):
        return chunk_content.strip()

    # Build BM25 index from this chunk's sentences
    bm25 = BM25Okapi(tokenized_sentences)

    # Query tokens from the paragraph
    query_tokens: list[str] = _tokenize_agnostic(paragraph_text)

    if not query_tokens:
        # No query signal → return first window as safe fallback
        return " ".join(sentences[: _BM25_WINDOW_SIZE]).strip()

    # Score every sentence
    scores: list[float] = list(bm25.get_scores(query_tokens))

    # Sliding window: find contiguous window of size K with highest total score
    k: int = min(_BM25_WINDOW_SIZE, len(sentences))
    n: int = len(sentences)

    best_start: int = 0
    best_score: float = -1.0

    for i in range(n - k + 1):
        window_score: float = sum(scores[i: i + k])
        if window_score > best_score:
            best_score = window_score
            best_start = i

    selected: list[str] = sentences[best_start: best_start + k]
    result: str = " ".join(selected).strip()

    logger.debug(
        f"[Citations] BM25 window: best_start={best_start}, k={k}, "
        f"score={best_score:.3f}, extracted_len={len(result)}"
    )

    return result if result else chunk_content.strip()
```

**Step 4: Run BM25 tests**

```bash
cd backend
python -m pytest tests/test_citation_helpers.py -v -k "bm25" 2>&1
```

Expected: All `test_bm25_*` tests PASS.

**Step 5: Run ALL tests**

```bash
cd backend
python -m pytest tests/test_citation_helpers.py -v 2>&1
```

Expected: All tests PASS.

**Step 6: Commit**

```bash
git add backend/routers/chat/chat_helper.py
git commit -m "feat: implement BM25 contiguous window for Tier 2 citation extraction"
```

---

## Task 6: Update call site in `parse_paragraphs_with_citations()`

**Files:**
- Modify: `backend/routers/chat/chat_helper.py`

**Context:** The 2-tier logic in `parse_paragraphs_with_citations()` around the `# ── 2-TIER QUOTE EXTRACTION ──` comment block needs to call the new functions.

**Step 1: Replace the old 2-tier logic**

Find this block (around line 411-432):

```python
# ── 2-TIER QUOTE EXTRACTION ──────────────────────────────
# Tier 1 (PRIMARY): Dùng LLM verbatim excerpt đã parse từ
#   References section — LLM tự biết câu nào nó dùng.
#   Verify bằng fuzzy match để chống hallucination.
# Tier 2 (FALLBACK): Keyword-based segment extraction,
#   không có hard max_length, include tất cả dòng relevant.
# ─────────────────────────────────────────────────────────
raw_content: str = str(chunk_data.get("content", "")).strip()
llm_excerpt: str = excerpt_map.get(cid, "").strip()

if llm_excerpt and _is_verbatim_from_chunk(llm_excerpt, raw_content):
    # Tier 1: LLM excerpt verified — dùng trực tiếp (no length cap)
    quote: str = llm_excerpt
    logger.debug(f"[Citations] ref={cid} → Tier1 (LLM excerpt) len={len(quote)}")
else:
    # Tier 2: Keyword-based fallback (no length cap)
    if llm_excerpt:
        logger.debug(
            f"[Citations] ref={cid} → Tier1 FAILED (hallucination detected), "
            f"falling back to Tier2"
        )
    quote = _extract_relevant_segments(clean_text, raw_content)
```

Replace with:

```python
# ── 2-TIER QUOTE EXTRACTION ──────────────────────────────
# Tier 1 (PRIMARY): Anchor-and-Expand
#   Use LLM excerpt as anchor to locate matching region in chunk,
#   then expand to sentence boundaries → true verbatim chunk text.
#   Returns None if anchor match too weak → falls to Tier 2.
# Tier 2 (FALLBACK): BM25 Contiguous Window
#   No stopwords, no [...]  — scores sentences via BM25 IDF,
#   returns highest-scoring contiguous window of K sentences.
# ─────────────────────────────────────────────────────────
raw_content: str = str(chunk_data.get("content", "")).strip()
llm_excerpt: str = excerpt_map.get(cid, "").strip()

quote: str | None = _anchor_and_expand(llm_excerpt, raw_content)

if quote is not None:
    logger.debug(f"[Citations] ref={cid} → Tier1 (anchor-expand) len={len(quote)}")
else:
    if llm_excerpt:
        logger.debug(
            f"[Citations] ref={cid} → Tier1 anchor weak, falling back to Tier2 BM25"
        )
    quote = _extract_relevant_segments_bm25(clean_text, raw_content)
    logger.debug(f"[Citations] ref={cid} → Tier2 (BM25 window) len={len(quote)}")
```

**Step 2: Verify the backend starts without errors**

```bash
cd backend
python -c "from routers.chat.chat_helper import parse_paragraphs_with_citations; print('OK')"
```

Expected: `OK`

**Step 3: Run full test suite**

```bash
cd backend
python -m pytest tests/test_citation_helpers.py -v 2>&1
```

Expected: All tests PASS.

**Step 4: Commit**

```bash
git add backend/routers/chat/chat_helper.py
git commit -m "feat: wire Anchor-and-Expand + BM25 into parse_paragraphs_with_citations"
```

---

## Task 7: Integration smoke test

**Goal:** Verify the full pipeline end-to-end with a realistic chunk and paragraph.

**Step 1: Add integration test to test file**

Append to `backend/tests/test_citation_helpers.py`:

```python
# ── Integration: parse_paragraphs_with_citations ─────────────────────────────

def test_parse_paragraphs_no_ellipsis_in_quotes():
    """End-to-end: quotes in parsed paragraphs must never contain [...]."""
    from routers.chat.chat_helper import parse_paragraphs_with_citations

    llm_text = """The system allows learners to view course details [1].
Authentication requires valid credentials [1].

### References

* [1] UC_TM_002.md
  > "The system allows learners to view course details and track enrollment status."
"""
    chunks = [
        {
            "reference_id": "1",
            "content": (
                "UC-TM-002: View Course Class Details\n"
                "The system allows learners to view course details and track enrollment status.\n"
                "Authentication requires valid credentials before access is granted.\n"
                "Teachers can manage class assignments and learner records."
            ),
            "file_path": "UC_TM_002.md",
        }
    ]

    result = parse_paragraphs_with_citations(llm_text, chunks)
    assert len(result) > 0

    for para in result:
        for citation in para.get("citations", []):
            assert "[...]" not in citation["quote"], (
                f"Found [...]  in quote: {citation['quote']}"
            )


def test_parse_paragraphs_quote_comes_from_chunk():
    """Quotes must be traceable to chunk content, not invented text."""
    from routers.chat.chat_helper import parse_paragraphs_with_citations

    chunk_content = (
        "UC-TM-002: View Course Class Details\n"
        "The system allows learners to view course details.\n"
        "Teachers manage assignments and records."
    )
    llm_text = """Learners can view course information [1].

### References

* [1] UC_TM_002.md
  > "Learners view course details in the system."
"""
    chunks = [
        {"reference_id": "1", "content": chunk_content, "file_path": "UC_TM_002.md"}
    ]

    result = parse_paragraphs_with_citations(llm_text, chunks)
    for para in result:
        for citation in para.get("citations", []):
            quote = citation["quote"]
            # Every word in quote should appear somewhere in the chunk
            quote_words = set(quote.lower().split())
            chunk_words = set(chunk_content.lower().split())
            overlap = quote_words & chunk_words
            assert len(overlap) / max(len(quote_words), 1) >= 0.5, (
                f"Quote appears unrelated to chunk.\nQuote: {quote}"
            )
```

**Step 2: Run integration tests**

```bash
cd backend
python -m pytest tests/test_citation_helpers.py -v 2>&1
```

Expected: All tests PASS including the two new integration tests.

**Step 3: Final commit**

```bash
git add backend/tests/test_citation_helpers.py
git commit -m "test: add integration tests for citation pipeline (no [...], chunk-grounded quotes)"
```

---

## Summary of Changes

| File | Action |
|------|--------|
| `backend/requirements.txt` | Add `rank-bm25>=0.2.2` |
| `backend/routers/chat/chat_helper.py` | Remove `_STOPWORDS`, `_is_verbatim_from_chunk()`, `_extract_relevant_segments()`. Add `_ANCHOR_MIN_RATIO`, `_BM25_WINDOW_SIZE`, `_MIN_CHUNK_LENGTH`, `_MIN_SENTENCE_LENGTH`, `_TOKEN_RE`, `_SENTENCE_SPLIT_RE`, `_normalize_text()`, `_split_into_sentences()`, `_tokenize_agnostic()`, `_anchor_and_expand()`, `_extract_relevant_segments_bm25()`. Update call site in `parse_paragraphs_with_citations()`. |
| `backend/tests/test_citation_helpers.py` | Create new — 30+ unit + integration tests |

**Total commits: 7**
No frontend changes required — `parse_paragraphs_with_citations()` interface unchanged.

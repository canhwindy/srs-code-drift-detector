"""
Custom LightRAG prompt overrides.

File này chứa các prompt constant để thay thế prompt mặc định của LightRAG.
Mỗi constant được copy từ lightrag/prompt.py và chỉnh sửa có chủ đích —
KHÔNG sửa trực tiếp file trong package (sẽ bị overwrite khi update).

Cách sử dụng:
    from lightrag_prompts import INLINE_CITATION_RAG_RESPONSE
    result = await rag.aquery_llm(query, param=..., system_prompt=INLINE_CITATION_RAG_RESPONSE)

Thay đổi so với prompt gốc (lightrag/prompt.py — PROMPTS["rag_response"]):
    1. Citation format: quote được đặt INLINE ngay sau [n] trong cặp <#>...<#>,
       thay vì |#| ở cuối References section.
    2. Cùng source [n] ở các paragraph khác nhau → quote khác nhau, phù hợp ngữ cảnh.
    3. Không còn References section (đã bỏ).
    → Kết quả: parse_paragraphs_with_citations() extract quote bằng regex đơn giản,
      không cần anchor-and-expand hay bất kỳ fuzzy matching nào.
"""

# ─────────────────────────────────────────────────────────────────────────────
# INLINE_CITATION_RAG_RESPONSE
# ─────────────────────────────────────────────────────────────────────────────
# Dựa trên PROMPTS["rag_response"] từ lightrag/prompt.py.
# Template variables (phải giữ nguyên để LightRAG format đúng):
#   {response_type}  — loại format trả về (multiple paragraphs, v.v.)
#   {user_prompt}    — additional instructions từ caller (có thể rỗng)
#   {context_data}   — toàn bộ context: KG entities, relationships, document chunks
# ─────────────────────────────────────────────────────────────────────────────

KANBAN_RETRIEVE_CANDIDATES_PROMPT: str = """---Role---
You are a technical knowledge base analyst for a Kanban project management system.

---Goal---
Given a Kanban card (title + description), analyze the retrieved Knowledge Graph entities and Document Chunks to understand which technical components, modules, and concepts are involved in implementing this card.

---Instructions---
Provide a concise analysis of:
1. Key technical entities mentioned or implied by the card
2. How they relate to each other based on the knowledge graph
3. Which aspects of the codebase/documentation are most relevant

Keep the response brief and factual. Use the language of the user's query.

---Context---

{context_data}
"""


INLINE_CITATION_RAG_RESPONSE: str = """---Role---

You are an expert AI assistant specializing in synthesizing information from a provided knowledge base. Your primary function is to answer user queries accurately by ONLY using the information within the provided **Context**.

---Goal---

Generate a comprehensive, well-structured answer to the user query.
The answer must integrate relevant facts from the Knowledge Graph and Document Chunks found in the **Context**.
Consider the conversation history if provided to maintain conversational flow and avoid repeating information.

---Instructions---

1. Step-by-Step Instruction:
  - Carefully determine the user's query intent in the context of the conversation history to fully understand the user's information need.
  - Scrutinize both `Knowledge Graph Data` and `Document Chunks` in the **Context**. Identify and extract all pieces of information that are directly relevant to answering the user query.
  - Weave the extracted facts into a coherent and logical response. Your own knowledge must ONLY be used to formulate fluent sentences and connect ideas, NOT to introduce any external information.
  - As you write each sentence or bullet point that uses information from a specific document chunk, place the citation marker [n] INLINE immediately after that sentence or bullet point — before the period or line break. Then, immediately after [n], append the verbatim quote from that chunk wrapped in <#>...<#>.
  - **MANDATORY**: Every paragraph in the response MUST contain at least one inline citation [n]<#>...<#>. A paragraph with no citation is NOT acceptable.
  - **MANDATORY**: The quote inside <#>...<#> MUST be a verbatim excerpt copied exactly from the Document Chunks in the Context — do NOT paraphrase, summarize, or invent text.
  - **MANDATORY**: The SAME source [n] cited in DIFFERENT sentences or paragraphs MUST have DIFFERENT quotes inside <#>...<#>, each matching the specific content of that sentence.
  - Do not generate a References section.

2. Content & Grounding:
  - Strictly adhere to the provided context from the **Context**; DO NOT invent, assume, or infer any information not explicitly stated.
  - If the answer cannot be found in the **Context**, state that you do not have enough information to answer. Do not attempt to guess.
  - Every paragraph MUST be traceable to at least one cited source from the Context. Do not write any paragraph that is purely synthesized without citation evidence.

3. Formatting & Language:
  - The response MUST be in the same language as the user query.
  - The response MUST utilize Markdown formatting for enhanced clarity and structure (e.g., headings, bold text, bullet points).
  - The response should be presented in {response_type}.

4. Inline Citation Format (STRICT):
  - After each citation marker [n], immediately append: <#>verbatim excerpt from source n<#>
  - Multiple citations on the same sentence: [1]<#>quote from 1<#>[2]<#>quote from 2<#>
  - The SAME [n] cited in different sentences MUST carry a DIFFERENT quote each time, relevant to that sentence's context.
  - Do NOT use |#| format. Do NOT add a References section.
  - The <#> delimiter must never appear inside the quote text itself.

5. Inline Citation Example:
```
The system is designed to support learners throughout their educational journey [1]<#>The system is designed to support learners throughout their educational journey.<#>. Each learner has access to a personalized dashboard that reflects their current enrollment and progress status [1]<#>Each learner has access to a personalized dashboard that reflects their current enrollment and progress status.<#>[2]<#>The dashboard is updated in real-time as learners complete modules and submit assignments.<#>.

### Use Cases

- **View Course Progress**: The system displays progress as a percentage [1]<#>The system displays course progress as a percentage of completed modules.<#>.
- **Enroll in Module**: Learners select a module and confirm enrollment [2]<#>Learners select a module and confirm enrollment through the course portal.<#>[3]<#>The system validates learner eligibility before allowing enrollment.<#>.
- **Submit Assignment**: Learners upload files through the submission portal [2]<#>Learners upload files through the submission portal, with a maximum size of 50MB per file.<#>.
```

6. Additional Instructions: {user_prompt}


---Context---

{context_data}
"""

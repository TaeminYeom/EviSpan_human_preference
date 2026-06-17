# Qualitative Preference Evaluation Framework

This folder contains a small web app for a blind side-by-side human preference study between EviSpan and Remedy-R explanations.

## Research Question

For the same source, candidate translation, and reference, which model response gives a more useful and better grounded basis for assessing translation quality?

The primary judgment should focus on evidence usefulness, not on whether the numeric score alone is preferred.

## Study Unit

Each item shows:

- Source
- Candidate translation
- Reference
- Response A
- Response B

Response A and Response B are assigned by a deterministic counterbalance using participant ID, dataset ID, and case ID. The app stores the real model identity only in the export.

## Recommended Judgment Criteria

Ask annotators to prefer the response that better supports a translation quality decision. Useful signals:

- Correctly identifies the relevant error span or problematic expression.
- Gives a rationale grounded in the source, candidate translation, and reference.
- Avoids unsupported claims or hallucinated source meanings.
- Distinguishes major meaning errors from minor fluency or style issues.
- Is concise enough to help a human evaluator make a decision.
- Keeps its score or severity consistent with the stated evidence.

The app includes reason tags for common analysis categories:

- `evidence_location`
- `rationale_quality`
- `source_consistency`
- `reference_use`
- `less_overclaiming`

## Running Locally

From the repository root:

```powershell
python -m http.server 8765
```

Then open:

```text
http://localhost:8765/qual_eval/
```

The app loads the paired files under `data/`:

- `data/wmt22_en-de/0504_3.jsonl`
- `data/wmt22_en-de/remedy-r.jsonl`
- `data/wmt22_zh-en/0504_3.jsonl`
- `data/wmt22_zh-en/remedy-r.jsonl`

The Chinese-English files include malformed source fields in some lines. The app repairs those source fields at load time, then parses the rest of the record normally.

## Export Fields

CSV and JSON exports include:

- `participant_id`
- `dataset_id`
- `case_id`
- `seg_id`
- `lp`
- `system`
- `source`
- `translation`
- `reference`
- `response_a_model`
- `response_b_model`
- `preference_side`
- `preferred_model`
- `preferred_model_label`
- `reason_tags`
- `confidence`
- `notes`
- `updated_at`

For ties and `both_bad`, `preferred_model` is empty by design.

## Analysis Plan

Use preference rate as the main descriptive statistic:

```text
EviSpan preference rate = EviSpan wins / (EviSpan wins + Remedy-R wins)
```

Keep ties and both-poor decisions as separate categories. For inferential reporting, use a paired sign test or binomial test over non-tied items. If multiple annotators label the same cases, report agreement separately, for example raw agreement and Krippendorff alpha or Fleiss kappa after mapping judgments to EviSpan, Remedy-R, tie, and both poor.

The free-text notes and reason tags can be coded into recurring qualitative themes, especially:

- span grounding helps localize the error
- rationale is correct but too verbose
- rationale over-relies on an imperfect reference
- response misses a major error
- response penalizes a harmless paraphrase
- severity or score is inconsistent with the explanation

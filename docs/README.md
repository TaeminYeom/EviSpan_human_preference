# Qualitative Preference Evaluation Framework

This folder is the single source for the human preference study app and the GitHub Pages deployment.

## Research Questions

For the same source, candidate translation, and reference, annotators answer three questions:

1. **Correctness / Faithfulness:** Which feedback is more accurate and better supported by the source, translation, and reference? Consider whether it correctly identifies real errors, avoids unsupported or exaggerated claims, and does not miss important problems.
2. **Key issue identification:** Which feedback better identifies the main translation problems that most affect translation quality?
3. **Overall usefulness — primary outcome:** Overall, which feedback is more useful for understanding the translation quality?

All three questions use the same four choices: A is better, tie, B is better, or both poor. A case counts as complete only after all three questions are answered. The primary judgment is Q3 and should focus on evidence usefulness, not on whether the numeric score alone is preferred.

## Study Unit

Each item shows:

- Source
- Candidate translation
- Reference
- Response A
- Response B

Response A and Response B are assigned by a deterministic counterbalance using participant ID, dataset ID, and case ID. The app stores the real model identity only in the export.

To avoid presentation bias while keeping responses easy to scan, both model outputs use the same section component and identical typography. EviSpan fields and Remedy-R's numbered evaluation criteria are separated into labeled sections without model-specific visual emphasis.

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

## GitHub Pages

Configure GitHub Pages with:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

After deployment, the project site should be available at:

```text
https://taeminyeom.github.io/EviSpan_human_preference/
```

## Running Locally

From the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs
```

Then open:

```text
http://127.0.0.1:8765/
```

On Windows PowerShell, use `py -m http.server 8765 --bind 127.0.0.1 --directory docs` if `python3` is not available.

## Data Files

The app loads the paired files under `docs/data/`:

- `docs/data/wmt22_en-de/evispan.jsonl`
- `docs/data/wmt22_en-de/remedy-r.jsonl`
- `docs/data/wmt22_zh-en/evispan.jsonl`
- `docs/data/wmt22_zh-en/remedy-r.jsonl`
- `docs/data/wmt22_en-ko/evispan.jsonl`
- `docs/data/wmt22_en-ko/remedy-r.jsonl`
- `docs/data/wmt22_en-ru/evispan.jsonl`
- `docs/data/wmt22_en-ru/remedy-r.jsonl`

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
- `q1_correctness_side`
- `q1_correctness_model`
- `q1_correctness_model_label`
- `q2_key_issue_side`
- `q2_key_issue_model`
- `q2_key_issue_model_label`
- `q3_overall_side`
- `q3_overall_model`
- `q3_overall_model_label`
- `reason_tags`
- `confidence`
- `notes`
- `updated_at`

For ties and `both_bad`, the corresponding model and model-label fields are empty by design.

## Analysis Plan

Use the Q3 overall-usefulness preference rate as the main descriptive statistic:

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

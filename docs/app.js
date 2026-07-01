const DATASETS = [
  {
    id: "wmt22_en-de",
    label: "WMT22 English-German",
    evispanUrl: "./data/wmt22_en-de/evispan.jsonl",
    remedyUrl: "./data/wmt22_en-de/remedy-r.jsonl"
  },
  {
    id: "wmt22_zh-en",
    label: "WMT22 Chinese-English",
    evispanUrl: "./data/wmt22_zh-en/evispan.jsonl",
    remedyUrl: "./data/wmt22_zh-en/remedy-r.jsonl"
  },
  {
    id: "wmt22_en-ko",
    label: "WMT22 English-Korean",
    evispanUrl: "./data/wmt22_en-ko/evispan.jsonl",
    remedyUrl: "./data/wmt22_en-ko/remedy-r.jsonl"
  },
  {
    id: "wmt22_en-ru",
    label: "WMT22 English-Russian",
    evispanUrl: "./data/wmt22_en-ru/evispan.jsonl",
    remedyUrl: "./data/wmt22_en-ru/remedy-r.jsonl"
  }
];

const MODEL_LABELS = {
  evispan: "EviSpan",
  remedy: "Remedy-R"
};

const QUESTION_KEYS = ["q1_correctness", "q2_key_issue", "q3_overall"];
const REASON_TAGS = new Set([
  "main_issue",
  "evidence_location",
  "groundedness",
  "no_unsupported_claims",
  "other"
]);
const LEGACY_REASON_TAGS = {
  evidence_location: "evidence_location",
  rationale_quality: "groundedness",
  source_consistency: "groundedness",
  reference_use: "groundedness",
  less_overclaiming: "no_unsupported_claims"
};
const STORAGE_PREFIX = "mt-rationale-preference-v3";
const SESSION_KEY = `${STORAGE_PREFIX}:session`;
const META_KEY = `${STORAGE_PREFIX}:meta`;

const state = {
  datasetId: DATASETS[0].id,
  allCases: [],
  orderedCases: [],
  annotations: {},
  currentIndex: 0,
  loading: true
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  initControls();
  loadDataset();
});

function bindElements() {
  Object.assign(els, {
    datasetSelect: document.querySelector("#datasetSelect"),
    participantInput: document.querySelector("#participantInput"),
    orderSelect: document.querySelector("#orderSelect"),
    hideScoresInput: document.querySelector("#hideScoresInput"),
    datasetStatus: document.querySelector("#datasetStatus"),
    progressText: document.querySelector("#progressText"),
    caseTitle: document.querySelector("#caseTitle"),
    caseMeta: document.querySelector("#caseMeta"),
    sourceText: document.querySelector("#sourceText"),
    translationText: document.querySelector("#translationText"),
    referenceText: document.querySelector("#referenceText"),
    responseA: document.querySelector("#responseA"),
    responseB: document.querySelector("#responseB"),
    aSideLabel: document.querySelector("#aSideLabel"),
    bSideLabel: document.querySelector("#bSideLabel"),
    notesInput: document.querySelector("#notesInput"),
    prevBtn: document.querySelector("#prevBtn"),
    nextBtn: document.querySelector("#nextBtn"),
    exportCsvBtn: document.querySelector("#exportCsvBtn"),
    exportJsonBtn: document.querySelector("#exportJsonBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    preferenceButtons: Array.from(document.querySelectorAll(".preference-button")),
    reasonInputs: Array.from(document.querySelectorAll(".reason-row input[type='checkbox']"))
  });
}

function initControls() {
  const meta = loadMeta();

  for (const dataset of DATASETS) {
    const option = document.createElement("option");
    option.value = dataset.id;
    option.textContent = dataset.label;
    els.datasetSelect.append(option);
  }

  els.datasetSelect.value = meta.datasetId || state.datasetId;
  state.datasetId = els.datasetSelect.value;
  els.participantInput.value = meta.participantId || "";
  els.orderSelect.value = meta.order || "random";
  els.hideScoresInput.checked = meta.hideScores !== false;

  els.datasetSelect.addEventListener("change", () => {
    state.datasetId = els.datasetSelect.value;
    saveMeta();
    loadDataset();
  });

  let participantTimer = null;
  els.participantInput.addEventListener("input", () => {
    saveMeta();
    window.clearTimeout(participantTimer);
    participantTimer = window.setTimeout(() => {
      state.annotations = loadAnnotations();
      buildCaseOrder();
      state.currentIndex = 0;
      render();
    }, 350);
  });

  els.orderSelect.addEventListener("change", () => {
    saveMeta();
    buildCaseOrder();
    state.currentIndex = 0;
    render();
  });

  els.hideScoresInput.addEventListener("change", () => {
    saveMeta();
    renderResponses();
  });

  els.preferenceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPreference(button.dataset.question, button.dataset.preference);
    });
  });

  els.reasonInputs.forEach((input) => {
    input.addEventListener("change", () => {
      updateCurrentAnnotation({ reason_tags: getSelectedReasonTags() });
    });
  });

  els.notesInput.addEventListener("input", () => {
    updateCurrentAnnotation({ notes: els.notesInput.value });
  });

  els.prevBtn.addEventListener("click", () => moveCase(-1));
  els.nextBtn.addEventListener("click", () => moveCase(1));
  els.exportCsvBtn.addEventListener("click", exportCsv);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.resetBtn.addEventListener("click", resetCurrentAnnotations);

  document.addEventListener("keydown", handleKeyboard);
}

async function loadDataset() {
  const dataset = getDataset();
  state.loading = true;
  state.allCases = [];
  state.orderedCases = [];
  state.currentIndex = 0;
  renderLoading(`Loading ${dataset.label}...`);

  try {
    const [evispanRows, remedyRows] = await Promise.all([
      fetchJsonl(dataset.evispanUrl),
      fetchJsonl(dataset.remedyUrl)
    ]);

    state.allCases = mergeRows(dataset, evispanRows, remedyRows);
    state.annotations = loadAnnotations();
    state.loading = false;
    buildCaseOrder();
    render();
  } catch (error) {
    state.loading = false;
    renderLoadError(error);
  }
}

async function fetchJsonl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }
  const text = await response.text();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseJsonlLine(line, url, index + 1));
}

function parseJsonlLine(line, url, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (firstError) {
    const repaired = repairBrokenSourceField(line);
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch (secondError) {
        console.warn(`Repair failed for ${url}:${lineNumber}`, secondError);
      }
    }
    console.warn(`Parse failed for ${url}:${lineNumber}`, firstError);
    return parseKnownFields(line);
  }
}

function repairBrokenSourceField(line) {
  const nextKeys = ["hypothesis", "reference", "target_clean"];
  for (const nextKey of nextKeys) {
    const pattern = new RegExp(`"source"\\s*:\\s*"([\\s\\S]*?),\\s*"${nextKey}"\\s*:`);
    const match = line.match(pattern);
    if (!match) continue;

    let source = match[1];
    if (source.endsWith('"')) {
      source = source.slice(0, -1);
    }
    const replacement = `"source":${JSON.stringify(source)},"${nextKey}":`;
    return line.slice(0, match.index) + replacement + line.slice(match.index + match[0].length);
  }
  return "";
}

function parseKnownFields(line) {
  return {
    source: extractStringField(line, "source"),
    hypothesis: extractStringField(line, "hypothesis"),
    reference: extractStringField(line, "reference"),
    target_clean: extractStringField(line, "target_clean"),
    src_lang: extractStringField(line, "src_lang"),
    tgt_lang: extractStringField(line, "tgt_lang"),
    lp: extractStringField(line, "lp"),
    system: extractStringField(line, "system"),
    full_response: extractStringField(line, "full_response"),
    generated_score: extractNumberField(line, "generated_score"),
    quality_score: extractNumberField(line, "quality_score"),
    seg_id: extractNumberField(line, "seg_id"),
    answer: extractAnswerField(line)
  };
}

function extractStringField(line, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"|})`);
  const match = line.match(pattern);
  if (!match) return "";
  return safeJsonString(match[1]);
}

function extractNumberField(line, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const match = line.match(pattern);
  return match ? Number(match[1]) : "";
}

function extractAnswerField(line) {
  const marker = '"answer":';
  const start = line.indexOf(marker);
  const promptStart = line.indexOf(',"prompt"', start);
  if (start < 0 || promptStart < 0) return {};

  const json = line.slice(start + marker.length, promptStart);
  try {
    return JSON.parse(json);
  } catch (error) {
    return {};
  }
}

function safeJsonString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch (error) {
    return value;
  }
}

function mergeRows(dataset, evispanRows, remedyRows) {
  const caseIdCounts = new Map();

  return evispanRows
    .map((evispanRow, index) => {
      const segId = evispanRow.seg_id ?? remedyRows[index]?.seg_id ?? index + 1;
      const remedyRow = remedyRows[index] || {};
      const caseIdBase = `${dataset.id}:${segId}`;
      const occurrence = (caseIdCounts.get(caseIdBase) || 0) + 1;
      caseIdCounts.set(caseIdBase, occurrence);
      const caseId = occurrence === 1 ? caseIdBase : `${caseIdBase}:${occurrence}`;
      const translation = firstText(
        evispanRow.hypothesis,
        evispanRow.hypothesis_segment,
        remedyRow.target_clean,
        evispanRow.target_clean,
        remedyRow.hypothesis
      );

      return {
        id: caseId,
        dataset_id: dataset.id,
        dataset_label: dataset.label,
        seg_id: segId,
        original_index: index + 1,
        system: firstText(evispanRow.system, remedyRow.system),
        source: firstText(evispanRow.source, evispanRow.source_segment, remedyRow.source),
        translation,
        reference: firstText(evispanRow.reference, evispanRow.reference_segment, remedyRow.reference),
        lp: firstText(remedyRow.lp, makeLanguagePair(remedyRow, evispanRow)),
        src_lang: firstText(remedyRow.src_lang, evispanRow.src_lang),
        tgt_lang: firstText(remedyRow.tgt_lang, evispanRow.tgt_lang),
        outputs: {
          evispan: normalizeEvispan(evispanRow),
          remedy: normalizeRemedy(remedyRow)
        }
      };
    })
    .filter((item) => item.outputs.evispan && item.outputs.remedy);
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}

function makeLanguagePair(...rows) {
  for (const row of rows) {
    if (row?.src_lang && row?.tgt_lang) return `${row.src_lang}-${row.tgt_lang}`;
  }
  return "";
}

function normalizeEvispan(row) {
  const answer = row.answer || {};
  return {
    model: "evispan",
    kind: "evispan",
    annotated_translation: firstText(answer.annotated_translation, row.hypothesis, row.target_clean),
    errors: Array.isArray(answer.errors) ? answer.errors : [],
    rationale: firstText(answer.rationale, row.rationale),
    score: firstText(answer.score, row.score)
  };
}

function normalizeRemedy(row) {
  return {
    model: "remedy",
    kind: "remedy",
    full_response: firstText(row.full_response, row.response, row.answer),
    score: firstText(row.generated_score, row.quality_score, row.score)
  };
}

function buildCaseOrder() {
  let cases = state.allCases.slice();
  const seed = `${getParticipantKey()}|${state.datasetId}`;

  if (els.orderSelect.value === "random" || els.orderSelect.value === "unanswered") {
    cases = seededOrder(cases, seed);
  }

  if (els.orderSelect.value === "unanswered") {
    cases.sort((a, b) => Number(isComplete(a.id)) - Number(isComplete(b.id)));
  }

  state.orderedCases = cases;
}

function seededOrder(items, seed) {
  return items
    .map((item) => ({ item, rank: hashString(`${seed}|${item.id}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.item);
}

function getMapping(item) {
  const swap = hashString(`${getParticipantKey()}|${state.datasetId}|${item.id}|side`) % 2 === 1;
  return swap ? { A: "remedy", B: "evispan" } : { A: "evispan", B: "remedy" };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function renderLoading(message) {
  els.datasetStatus.textContent = message;
  els.progressText.textContent = "0 / 0";
  els.caseTitle.textContent = "Loading";
  els.caseMeta.replaceChildren();
  els.sourceText.textContent = "";
  els.translationText.textContent = "";
  els.referenceText.textContent = "";
  setEmptyResponse(els.responseA, "Loading response A");
  setEmptyResponse(els.responseB, "Loading response B");
}

function renderLoadError(error) {
  els.datasetStatus.textContent = error.message;
  els.caseTitle.textContent = "Dataset unavailable";
  els.caseMeta.replaceChildren();
  els.sourceText.textContent = "Run a local web server from the repository root with --directory docs, then open /.";
  els.translationText.textContent = "";
  els.referenceText.textContent = "";
  setEmptyResponse(els.responseA, "No response loaded");
  setEmptyResponse(els.responseB, "No response loaded");
}

function render() {
  if (state.loading) return;
  saveMeta();
  renderProgress();

  const item = getCurrentCase();
  if (!item) {
    els.datasetStatus.textContent = "No paired cases found.";
    els.caseTitle.textContent = "No case loaded";
    els.caseMeta.replaceChildren();
    els.sourceText.textContent = "";
    els.translationText.textContent = "";
    els.referenceText.textContent = "";
    setEmptyResponse(els.responseA, "No response loaded");
    setEmptyResponse(els.responseB, "No response loaded");
    renderDecision();
    return;
  }

  els.datasetStatus.textContent = `${getDataset().label}: ${state.allCases.length} paired cases`;
  els.caseTitle.textContent = `${state.currentIndex + 1} / ${state.orderedCases.length}`;
  renderCaseMeta(item);
  els.sourceText.textContent = item.source || "(empty)";
  els.translationText.textContent = item.translation || "(empty)";
  els.referenceText.textContent = item.reference || "(empty)";
  renderResponses();
  renderDecision();
}

function renderCaseMeta(item) {
  els.caseMeta.replaceChildren();
  const parts = [
    item.lp,
    item.system ? `MT: ${item.system}` : "",
    `seg_id: ${item.seg_id}`
  ].filter(Boolean);

  for (const part of parts) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = part;
    els.caseMeta.append(pill);
  }
}

function renderResponses() {
  const item = getCurrentCase();
  if (!item) return;

  const mapping = getMapping(item);
  renderOutput(els.responseA, item.outputs[mapping.A]);
  renderOutput(els.responseB, item.outputs[mapping.B]);
  els.aSideLabel.textContent = "Left";
  els.bSideLabel.textContent = "Right";
}

function renderOutput(container, output) {
  container.replaceChildren();
  if (!output) {
    setEmptyResponse(container, "Missing output");
    return;
  }

  const sections = output.kind === "evispan"
    ? makeEvispanSections(output)
    : makeRemedySections(output);
  renderResponseSections(container, sections);
}

function makeEvispanSections(output) {
  const errors = output.errors.length
    ? output.errors.map((error, index) => {
      const category = firstText(error.category, error.type, "unknown");
      const severity = firstText(error.severity, "unknown");
      return `v${index} | ${category} | ${severity}`;
    }).join("\n")
    : "No errors listed";

  const sections = [
    {
      title: "Annotated translation",
      text: output.annotated_translation || "No annotated translation"
    },
    { title: "Errors", text: errors },
    { title: "Rationale", text: output.rationale || "No rationale provided" }
  ];

  if (!els.hideScoresInput.checked && output.score !== "") {
    sections.push({ title: "Score", text: String(output.score) });
  }

  return sections;
}

function makeRemedySections(output) {
  const rawText = output.full_response || "No response provided";
  const text = els.hideScoresInput.checked ? redactScores(rawText) : rawText;
  const headingPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^:\n*]+?)\*{0,2}:\*{0,2}\s*(.*)$/gm;
  const matches = Array.from(text.matchAll(headingPattern));

  if (!matches.length) {
    return [{ title: "Response", text }];
  }

  const sections = [];
  const overview = text.slice(0, matches[0].index).trim();
  if (overview) {
    sections.push({ title: "Overview", text: overview });
  }

  let summary = "";
  matches.forEach((match, index) => {
    const contentStart = match.index + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? text.length;
    const trailingContent = text.slice(contentStart, contentEnd).trim();
    let content = [match[3].trim(), trailingContent].filter(Boolean).join("\n\n");

    if (index === matches.length - 1) {
      const summaryStart = content.indexOf("\n\n");
      if (summaryStart >= 0) {
        summary = content.slice(summaryStart).trim();
        content = content.slice(0, summaryStart).trim();
      }
    }

    sections.push({
      title: match[2].trim(),
      text: content || "No details provided"
    });
  });

  if (summary) {
    sections.push({
      title: "Summary",
      text: els.hideScoresInput.checked ? redactSummaryIntegers(summary) : summary
    });
  }

  return sections;
}

function renderResponseSections(container, sections) {
  sections.forEach(({ title, text }) => {
    const section = addResponseSection(container, title);
    const pre = document.createElement("pre");
    pre.textContent = text;
    section.append(pre);
  });
}

function addResponseSection(container, title) {
  const section = document.createElement("section");
  section.className = "response-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  container.append(section);
  return section;
}

function setEmptyResponse(container, text) {
  container.replaceChildren();
  appendEmpty(container, text);
}

function appendEmpty(container, text) {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = text;
  container.append(empty);
}

function redactScores(text) {
  return text
    .replace(/(\[\[\[score\]\]\]\s*)[-+]?\d+(?:\.\d+)?/gi, "$1[hidden]")
    .replace(/(Score:\s*)[-+]?\d+(?:\.\d+)?(?:\s*\(0-100\))?/gi, "$1[hidden]")
    .replace(/(final score(?: is|:)?\s*)[-+]?\d+(?:\.\d+)?/gi, "$1[hidden]")
    .replace(/(Overall score:\s*)[-+]?\d+(?:\.\d+)?/gi, "$1[hidden]");
}

function redactSummaryIntegers(text) {
  return text.replace(/(^|[^\d.])(100|[1-9]?\d)(?!\d|\.\d)/g, "$1[hidden]");
}

function renderDecision() {
  const item = getCurrentCase();
  const annotation = item ? state.annotations[item.id] : null;
  const tags = new Set(annotation?.reason_tags || []);

  els.preferenceButtons.forEach((button) => {
    const selected = annotation?.[`${button.dataset.question}_side`] || "";
    button.classList.toggle("active", button.dataset.preference === selected);
  });

  els.reasonInputs.forEach((input) => {
    input.checked = tags.has(input.value);
  });

  els.notesInput.value = annotation?.notes || "";
  els.prevBtn.disabled = state.currentIndex <= 0;
  els.nextBtn.disabled = state.currentIndex >= state.orderedCases.length - 1;
}

function renderProgress() {
  const total = state.allCases.length;
  const annotations = Object.values(state.annotations);
  const completed = annotations.filter(isCompleteAnnotation).length;

  els.progressText.textContent = `${completed} / ${total}`;
}

function setPreference(question, preference) {
  const item = getCurrentCase();
  if (!item || !QUESTION_KEYS.includes(question)) return;
  const mapping = getMapping(item);

  updateCurrentAnnotation({
    [`${question}_side`]: preference,
    response_a_model: mapping.A,
    response_b_model: mapping.B
  });
  renderDecision();
  renderProgress();
}

function updateCurrentAnnotation(patch) {
  const item = getCurrentCase();
  if (!item) return;
  const mapping = getMapping(item);
  const existing = state.annotations[item.id] || {};
  const annotation = {
    case_id: item.id,
    dataset_id: item.dataset_id,
    seg_id: item.seg_id,
    participant_id: getParticipantKey(),
    response_a_model: mapping.A,
    response_b_model: mapping.B,
    notes: "",
    reason_tags: [],
    ...existing,
    ...patch,
    updated_at: new Date().toISOString()
  };

  state.annotations[item.id] = annotation;
  saveAnnotations();
}

function getSelectedReasonTags() {
  return els.reasonInputs.filter((input) => input.checked).map((input) => input.value);
}

function moveCase(delta) {
  if (!state.orderedCases.length) return;
  state.currentIndex = Math.max(0, Math.min(state.orderedCases.length - 1, state.currentIndex + delta));
  render();
}

function handleKeyboard(event) {
  const tagName = event.target?.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return;

  if (event.key === "ArrowLeft") moveCase(-1);
  if (event.key === "ArrowRight") moveCase(1);
}

function exportCsv() {
  const rows = buildExportRows();
  const headers = getExportHeaders();
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\r\n");

  downloadText(csv, exportName("csv"), "text/csv;charset=utf-8");
}

function exportJson() {
  const payload = {
    study: "MT Evaluation Rationale Preference",
    exported_at: new Date().toISOString(),
    dataset_id: state.datasetId,
    dataset_label: getDataset().label,
    participant_id: getParticipantKey(),
    rows: buildExportRows()
  };
  downloadText(JSON.stringify(payload, null, 2), exportName("json"), "application/json;charset=utf-8");
}

function buildExportRows() {
  return state.allCases
    .map((item) => {
      const annotation = state.annotations[item.id];
      if (!annotation) return null;
      const mapping = getMapping(item);
      const q1Model = preferredModelFor(annotation.q1_correctness_side, mapping);
      const q2Model = preferredModelFor(annotation.q2_key_issue_side, mapping);
      const q3Model = preferredModelFor(annotation.q3_overall_side, mapping);

      return {
        participant_id: annotation.participant_id || getParticipantKey(),
        dataset_id: item.dataset_id,
        case_id: item.id,
        original_index: item.original_index,
        seg_id: item.seg_id,
        lp: item.lp,
        system: item.system,
        source: item.source,
        translation: item.translation,
        reference: item.reference,
        response_a_model: mapping.A,
        response_b_model: mapping.B,
        q1_correctness_side: annotation.q1_correctness_side || "",
        q1_correctness_model: q1Model,
        q1_correctness_model_label: q1Model ? MODEL_LABELS[q1Model] : "",
        q2_key_issue_side: annotation.q2_key_issue_side || "",
        q2_key_issue_model: q2Model,
        q2_key_issue_model_label: q2Model ? MODEL_LABELS[q2Model] : "",
        q3_overall_side: annotation.q3_overall_side || "",
        q3_overall_model: q3Model,
        q3_overall_model_label: q3Model ? MODEL_LABELS[q3Model] : "",
        reason_tags: (annotation.reason_tags || []).join("|"),
        notes: annotation.notes || "",
        updated_at: annotation.updated_at || ""
      };
    })
    .filter(Boolean);
}

function getExportHeaders() {
  return [
    "participant_id",
    "dataset_id",
    "case_id",
    "original_index",
    "seg_id",
    "lp",
    "system",
    "source",
    "translation",
    "reference",
    "response_a_model",
    "response_b_model",
    "q1_correctness_side",
    "q1_correctness_model",
    "q1_correctness_model_label",
    "q2_key_issue_side",
    "q2_key_issue_model",
    "q2_key_issue_model_label",
    "q3_overall_side",
    "q3_overall_model",
    "q3_overall_model_label",
    "reason_tags",
    "notes",
    "updated_at"
  ];
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function preferredModelFor(preference, mapping) {
  return preference === "A" || preference === "B" ? mapping[preference] : "";
}

function downloadText(text, fileName, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportName(extension) {
  const participant = getParticipantKey().replace(/[^a-z0-9_-]+/gi, "_");
  const stamp = new Date().toISOString().slice(0, 10);
  return `${state.datasetId}_${participant}_${stamp}.${extension}`;
}

function resetCurrentAnnotations() {
  const ok = window.confirm("Clear saved judgments for this dataset and participant?");
  if (!ok) return;
  state.annotations = {};
  localStorage.removeItem(annotationStorageKey());
  render();
}

function getCurrentCase() {
  return state.orderedCases[state.currentIndex] || null;
}

function isComplete(caseId) {
  return isCompleteAnnotation(state.annotations[caseId]);
}

function isCompleteAnnotation(annotation) {
  return Boolean(annotation && QUESTION_KEYS.every((question) => annotation[`${question}_side`]));
}

function getDataset() {
  return DATASETS.find((dataset) => dataset.id === state.datasetId) || DATASETS[0];
}

function getParticipantKey() {
  const value = els.participantInput?.value?.trim();
  return value || getSessionId();
}

function getSessionId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const value = crypto.randomUUID ? crypto.randomUUID() : `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(SESSION_KEY, value);
  return value;
}

function annotationStorageKey() {
  return `${STORAGE_PREFIX}:${state.datasetId}:${getParticipantKey()}`;
}

function loadAnnotations() {
  try {
    const annotations = JSON.parse(localStorage.getItem(annotationStorageKey()) || "{}");
    let migrated = false;

    for (const annotation of Object.values(annotations)) {
      if (!annotation || typeof annotation !== "object") continue;

      if (Object.hasOwn(annotation, "confidence")) {
        delete annotation.confidence;
        migrated = true;
      }

      if (Array.isArray(annotation.reason_tags)) {
        const normalizedTags = normalizeReasonTags(annotation.reason_tags);
        if (normalizedTags.join("|") !== annotation.reason_tags.join("|")) {
          annotation.reason_tags = normalizedTags;
          migrated = true;
        }
      }
    }

    if (migrated) {
      localStorage.setItem(annotationStorageKey(), JSON.stringify(annotations));
    }
    return annotations;
  } catch (error) {
    return {};
  }
}

function normalizeReasonTags(tags) {
  return [...new Set(
    tags
      .map((tag) => LEGACY_REASON_TAGS[tag] || tag)
      .filter((tag) => REASON_TAGS.has(tag))
  )];
}

function saveAnnotations() {
  localStorage.setItem(annotationStorageKey(), JSON.stringify(state.annotations));
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveMeta() {
  const meta = {
    datasetId: els.datasetSelect.value,
    participantId: els.participantInput.value.trim(),
    order: els.orderSelect.value,
    hideScores: els.hideScoresInput.checked
  };
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export const AI_ENGINEERING_REVIEW_PATH = "docs/evidence/ai-engineering-review.json";

const ROOT_DOC = /^(?:readme|changelog|contributing|license)(?:\.[a-z0-9_-]+)?$/i;
const PRODUCT_PATH =
  /(?:^|\/)(?:agents?|local-agent-runner|rag|retriever|reranker|model-router|model-routing|orchestrator)(?:[./_-]|$)/i;
const DEPENDENCY =
  /["'](?:@(?:langchain|mastra|langgraph)\/[^"']+|langchain|langgraph|mastra|ollama)["']/i;
const AI_IMPORT =
  /(?:from\s+|require\s*\(|import\s*\()\s*["'](?:@(?:langchain|mastra|langgraph)\/[^"']+|langchain|langgraph|mastra|ollama)/i;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function metricValue(value) {
  return (typeof value === "number" && Number.isFinite(value)) || nonEmptyString(value);
}

export function validateAiEngineeringReviewContract(contract) {
  const violations = [];
  const add = (code, field) => violations.push({ code, field });

  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return [{ code: "ai-engineering-review-schema-invalid" }];
  }
  if (contract.schemaVersion !== 1) add("ai-engineering-review-schema-invalid", "schemaVersion");
  if (contract.aiEngineering !== true) add("ai-engineering-review-field-invalid", "aiEngineering");

  if (!Array.isArray(contract.successCriteria) || contract.successCriteria.length === 0) {
    add("ai-engineering-review-field-missing", "successCriteria");
  } else if (
    contract.successCriteria.some(
      (item) =>
        !nonEmptyString(item?.id) ||
        !nonEmptyString(item?.metric) ||
        !metricValue(item?.threshold) ||
        !["deterministic", "llm-judge"].includes(item?.gateType) ||
        !nonEmptyString(item?.evidence),
    )
  ) {
    add("ai-engineering-review-field-invalid", "successCriteria");
  }

  if (!Array.isArray(contract.deterministicGates) || contract.deterministicGates.length === 0) {
    add("ai-engineering-review-field-missing", "deterministicGates");
  } else if (
    contract.deterministicGates.some(
      (item) => !nonEmptyString(item?.id) || !nonEmptyString(item?.check) || !nonEmptyString(item?.evidence),
    )
  ) {
    add("ai-engineering-review-field-invalid", "deterministicGates");
  }

  const judge = contract.llmJudge;
  if (!judge || typeof judge !== "object" || typeof judge.enabled !== "boolean") {
    add("ai-engineering-review-field-missing", "llmJudge");
  } else if (
    judge.canOverrideDeterministic !== false ||
    (judge.enabled &&
      (judge.independent !== true ||
        !Array.isArray(judge.dimensions) ||
        judge.dimensions.length === 0 ||
        !nonEmptyString(judge.rubric)))
  ) {
    add("ai-engineering-review-field-invalid", "llmJudge");
  }

  const rag = contract.rag;
  if (!rag || typeof rag !== "object" || typeof rag.enabled !== "boolean") {
    add("ai-engineering-review-field-missing", "rag");
  } else if (
    rag.enabled &&
    (rag.rerank !== true ||
      rag.citations !== true ||
      !["fail", "degrade", "request-context"].includes(rag.noHitBehavior))
  ) {
    add("ai-engineering-review-field-invalid", "rag");
  }

  const dag = contract.dag;
  if (!dag || typeof dag !== "object" || typeof dag.enabled !== "boolean") {
    add("ai-engineering-review-field-missing", "dag");
  } else if (
    dag.enabled &&
    (!Array.isArray(dag.failureRouting) || dag.failureRouting.length === 0 || typeof dag.humanApproval !== "boolean")
  ) {
    add("ai-engineering-review-field-invalid", "dag");
  }

  const serviceLevels = contract.serviceLevels;
  const serviceFields = ["qualityThreshold", "ttftMs", "p95LatencyMs", "costBudget", "reliabilityThreshold"];
  if (!serviceLevels || typeof serviceLevels !== "object") {
    add("ai-engineering-review-field-missing", "serviceLevels");
  } else if (serviceFields.some((field) => !metricValue(serviceLevels[field]))) {
    add("ai-engineering-review-field-invalid", "serviceLevels");
  }

  const feedback = contract.feedback;
  if (
    !feedback ||
    typeof feedback !== "object" ||
    ["clean", "deduplicate", "redact", "frozenEvaluationSet", "releaseRegressionGate"].some(
      (field) => feedback[field] !== true,
    )
  ) {
    add("ai-engineering-review-field-invalid", "feedback");
  }

  const statuses = new Set(["verified-local", "verified-production", "pending-external"]);
  if (!Array.isArray(contract.proof) || contract.proof.length === 0) {
    add("ai-engineering-review-field-missing", "proof");
  } else if (
    contract.proof.some(
      (item) =>
        !nonEmptyString(item?.kind) ||
        !nonEmptyString(item?.location) ||
        item.location.startsWith("/") ||
        item.location.includes("..") ||
        !nonEmptyString(item?.proves) ||
        !statuses.has(item?.status),
    )
  ) {
    add("ai-engineering-review-field-invalid", "proof");
  }
  return violations;
}

function hasTrigger({ paths, read, isExcluded, isNonProduct }) {
  for (const path of paths) {
    if (isExcluded(path) || ROOT_DOC.test(path) || isNonProduct(path)) continue;
    if (PRODUCT_PATH.test(path)) return true;
    if (!/(?:^|\/)(?:package\.json|[^/]+\.[cm]?[jt]sx?|[^/]+\.py)$/i.test(path)) continue;
    let content;
    try {
      content = read(path).toString("utf8");
    } catch {
      continue;
    }
    if (path.endsWith("package.json") && DEPENDENCY.test(content)) return true;
    if (!path.endsWith("package.json") && AI_IMPORT.test(content)) return true;
  }
  return false;
}

export function aiEngineeringReviewViolations({ paths, read, isExcluded, isNonProduct }) {
  const pathSet = new Set(paths);
  if (!pathSet.has(AI_ENGINEERING_REVIEW_PATH) && !hasTrigger({ paths, read, isExcluded, isNonProduct })) {
    return [];
  }
  if (!pathSet.has(AI_ENGINEERING_REVIEW_PATH)) {
    return [{ code: "ai-engineering-review-contract-missing", path: AI_ENGINEERING_REVIEW_PATH }];
  }
  let contract;
  try {
    contract = JSON.parse(read(AI_ENGINEERING_REVIEW_PATH).toString("utf8"));
  } catch {
    return [{ code: "ai-engineering-review-schema-invalid", path: AI_ENGINEERING_REVIEW_PATH }];
  }
  return validateAiEngineeringReviewContract(contract).map((violation) => ({
    ...violation,
    path: AI_ENGINEERING_REVIEW_PATH,
  }));
}

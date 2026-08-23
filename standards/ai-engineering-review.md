# AI Engineering review contract

AI、Agent、RAG、模型路由或多模态产品代码必须提交 `docs/evidence/ai-engineering-review.json`。中央 policy 验证可测成功标准、确定性 Gate、LLM judge 边界、RAG/DAG 失败行为、质量/延迟/成本/可靠性指标、反馈清洗和公开 Evidence。

确定性 Gate 失败不能被 LLM judge 覆盖。RAG 无可靠命中时必须失败、降级或请求上下文。反馈必须先清洗、去重、脱敏，再进入冻结评测集。

根目录 `README*`、`CHANGELOG*`、`LICENSE*`、`CONTRIBUTING*`，以及 `docs/architecture/**`、`docs/delivery/**`、`docs/evidence/**`、`docs/qa/**`、`docs/superpowers/**` 不作为 AI Gate 触发依据。该白名单不影响秘密、PII、公开内容、身份与仓库策略扫描。

合约最小字段：

```json
{
  "schemaVersion": 1,
  "aiEngineering": true,
  "successCriteria": [],
  "deterministicGates": [],
  "llmJudge": { "enabled": false, "canOverrideDeterministic": false },
  "rag": { "enabled": false },
  "dag": { "enabled": false },
  "serviceLevels": {},
  "feedback": {},
  "proof": []
}
```

每个数组和对象仍需满足中央 Schema；空值示例只展示字段结构，不是可通过的完整合约。

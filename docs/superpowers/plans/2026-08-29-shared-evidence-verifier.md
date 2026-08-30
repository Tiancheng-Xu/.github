# 共享 AWS Evidence Verifier 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个最小共享 Lambda 为六个作品集项目生成真实、脱敏、可审计的 AWS Verifier Evidence。

**Architecture:** 中央仓库固定 manifest 经过本地 Schema Gate 后，由 `main` workflow 使用 GitHub OIDC 调用非 VPC Lambda。Lambda 验证 GitHub commit、生产 URL 和 Evidence 语义，返回结构化结果；workflow 保存 7 日 Artifact，项目再按真实状态吸收结果。

**Tech Stack:** Node.js policy tests、Python 3.13 Lambda、AWS SAM/CloudFormation、GitHub Actions OIDC、CloudWatch Logs。

**Spec:** `docs/superpowers/specs/2026-08-29-shared-evidence-verifier-design.md`

## Global Constraints

- AWS Free 计划不得升级、转换、取消或关闭。
- 禁止 Root 部署；初次部署身份必须为 `course-platform-admin`。
- Budget Actual 达到 `$34` 或 Forecast 达到 `$40` 时停止。
- 不创建 VPC、NAT、RDS、ECS、ALB、API Gateway、S3 Bucket 或长期密钥。
- 只允许中央仓库 `main` 通过现有 GitHub OIDC 调用精确 Lambda。
- Agent Market 和 BabySteps 不在本次 AWS 调用矩阵中。
- `aws-verifier: verified` 不得冒充 `aws-runtime: verified-production`。

---

### Task 1: Manifest 与确定性 Policy

**Files:**
- Create: `config/portfolio-aws-verifier.json`
- Create: `scripts/evidence-verifier-policy.mjs`
- Create: `tests/evidence-verifier-policy.test.mjs`

**Interfaces:**
- Consumes: `portfolio-aws-verifier/v1` JSON。
- Produces: `verifyEvidenceVerifierManifest({ root, manifest }) -> { ok, violations, projects }`。

- [ ] **Step 1: 写失败测试**

覆盖六项目正例以及未知字段、重复 projectId、非 40 位 SHA、任意 URL、IP literal、非标准端口、缺 Evidence marker、敏感字段键。

- [ ] **Step 2: 验证 RED**

Run: `node --test tests/evidence-verifier-policy.test.mjs`

Expected: FAIL，原因是 policy 模块不存在。

- [ ] **Step 3: 最小实现**

实现严格 key allowlist、HTTPS/host/port 规则、项目数量和唯一性、marker 长度、`productionUrl: null` 状态合同及凭据形字段扫描。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test tests/evidence-verifier-policy.test.mjs`

Expected: PASS。

### Task 2: Lambda Verifier

**Files:**
- Create: `aws/evidence-verifier/handler.py`
- Create: `aws/evidence-verifier/test_handler.py`

**Interfaces:**
- Consumes: 单项目 JSON 合同与 Lambda context。
- Produces: `portfolio-aws-verifier-evidence/v1` JSON。
- Functions: `validate_url(url)`, `fetch_bounded(url, expected_content_types)`, `verify_project(event, request_id)`, `lambda_handler(event, context)`。

- [ ] **Step 1: 写失败测试**

使用本地 HTTP client fake，不发公网请求；覆盖 GitHub SHA 回显、marker、正文 SHA-256、无重定向、1 MiB 上限、超时、私网/IP/端口阻断、`productionUrl: null`、低信息错误和敏感字段不回显。

- [ ] **Step 2: 验证 RED**

Run: `python3 -m unittest aws/evidence-verifier/test_handler.py -v`

Expected: FAIL，原因是 handler 不存在。

- [ ] **Step 3: 最小实现**

仅使用 Python 标准库；固定 User-Agent；禁止自动重定向；GitHub commit 使用 `api.github.com/repos/<owner>/<repo>/commits/<sha>`；页面最多读取 1 MiB；结果只保留 allowlist 字段。

- [ ] **Step 4: 验证 GREEN**

Run: `python3 -m unittest aws/evidence-verifier/test_handler.py -v`

Expected: PASS。

### Task 3: SAM/IAM 与预算合同

**Files:**
- Create: `aws/evidence-verifier-template.yaml`
- Create: `tests/evidence-verifier-template.test.mjs`

**Interfaces:**
- Produces: Stack `tc-shared-evidence-verifier`、函数名、Invoke Role ARN。

- [ ] **Step 1: 写失败测试**

断言只有 Lambda、7 日 LogGroup、Execution Role、OIDC Invoke Role；非 VPC、128 MB、10 秒、并发 1；OIDC `aud/sub` 精确；Invoke Role 只有精确 `lambda:InvokeFunction` 和精确 Budget read；Execution Role 只有自身日志写；禁止高成本资源和 wildcard 服务权限。

- [ ] **Step 2: 验证 RED**

Run: `node --test tests/evidence-verifier-template.test.mjs`

Expected: FAIL，原因是模板不存在。

- [ ] **Step 3: 最小实现**

使用 `AWS::Serverless::Function` 与显式 IAM Roles；现有 OIDC Provider 作为参数传入，不创建 Provider；输出函数名和 Invoke Role ARN。

- [ ] **Step 4: 验证 GREEN 和 IaC Gate**

Run: `node --test tests/evidence-verifier-template.test.mjs`

Run: `sam validate --lint --template-file aws/evidence-verifier-template.yaml`

Run: `python3 ~/.codex/skills/aws-budget-guard/scripts/check_iac_shared_resource_gate.py aws/evidence-verifier-template.yaml`

Expected: 全部 PASS。

### Task 4: 中央 GitHub Actions 调度器

**Files:**
- Create: `.github/workflows/aws-evidence-verifier.yml`
- Create: `tests/evidence-verifier-workflow.test.mjs`

**Interfaces:**
- Consumes: 固定 manifest、Repository Variables 中的精确 Role ARN/Function Name。
- Produces: 每项目脱敏 JSON Artifact，retention 7 天。

- [ ] **Step 1: 写失败测试**

断言 workflow 只允许 `workflow_dispatch`，permissions 为 `contents: read` 与 `id-token: write`，先跑本地 policy，再检查身份/Budget，再 OIDC，矩阵 `max-parallel: 1`，Lambda payload 由 `jq` 文件生成，Artifact always 上传，禁止任意 workflow input 和长期 Secret。

- [ ] **Step 2: 验证 RED**

Run: `node --test tests/evidence-verifier-workflow.test.mjs`

Expected: FAIL，原因是 workflow 不存在。

- [ ] **Step 3: 最小实现**

加入并发锁、Budget `$34/$40` Gate、精确函数调用、响应 Schema 检查、partial-failure 汇总和 7 日 Artifact。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test tests/evidence-verifier-workflow.test.mjs`

Expected: PASS。

### Task 5: Feature QA 与本地 Evidence

**Files:**
- Create: `docs/evidence/2026-08-29-shared-evidence-verifier-local.md`

**Interfaces:**
- Consumes: Tasks 1-4 的测试与模板。
- Produces: 本地 Gate、成本矩阵、限制和待云验收状态。

- [ ] **Step 1: 跑完整本地 Gate**

Run: `npm test`

Run: `python3 -m unittest discover -s aws/evidence-verifier -p 'test_*.py' -v`

Run: `git diff --check`

- [ ] **Step 2: 做公开内容扫描**

确认无 Token、Cookie、私有路径、账号密码、页面正文或模型数据。

- [ ] **Step 3: 写本地 Evidence**

状态必须为 `verified-local / cloud-pending`，列出新建/复用/禁止资源和测试输出，不写云端完成。

### Task 6: GitHub 与 AWS 云端闭环

**Files:**
- Modify after real run: `docs/evidence/2026-08-29-shared-evidence-verifier-local.md`

**Interfaces:**
- Produces: PR、main SHA、Change Set、Stack、六项目 Request IDs、Run/Artifact、Budget 前后读回。

- [ ] **Step 1: PR 与远端 Gate**

提交、推送、创建 PR；等待 Repository Policy 和测试全绿后合并 `main`。

- [ ] **Step 2: 部署前硬 Gate**

核验 IAM ARN、Budget、现有 OIDC/Foundation；创建 Change Set 并确认只含批准资源。任一不符立即停止。

- [ ] **Step 3: 部署共享 Stack**

使用 `course-platform-admin` 执行精确 Change Set；回读函数、Roles、LogGroup retention 和无 VPC 配置；配置非敏感 Repository Variables。

- [ ] **Step 4: 触发六项目矩阵**

只触发一次中央 workflow，不重复 BabySteps 或 Agent Market AWS；等待每项真实 Request ID 和 Artifact。

- [ ] **Step 5: 云后 Gate**

回读 Budget、日志 retention、Lambda 调用量和 Stack 漂移；更新 Evidence 为精确真实状态。

- [ ] **Step 6: 后续同步**

将每项目结果同步到对应项目 Evidence，再同步 Dashboard；每个仓库独立 PR/Gate，未部署或弱 SHA 绑定必须原样保留。

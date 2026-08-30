# 共享 AWS Evidence Verifier 设计

## 1. 目标

为作品集中的多个项目提供一次可审计、低成本、可复用的 AWS 真实调用证明，而不是为每个项目复制一套云基础设施。

首批接入项目：

- Personal AI Agent
- Showcase Dashboard
- GitHub Profile Studio
- Portfolio Sync
- 性能观测与成本控制
- TC Flow 2.1

本系统只证明“项目的公开交付事实经过 AWS Verifier 验证”，不证明项目业务 Runtime 部署在 AWS。Dashboard 和 Evidence 必须使用 `aws-verifier: verified`，不得改写为 `aws-runtime: verified-production`。

## 2. 第一性约束

- AWS Free 计划保持不变，禁止升级、转换或关闭账号。
- 复用现有 GitHub OIDC Provider 与共享制品设施。
- 禁止新增 VPC、NAT、RDS、ECS、ALB、API Gateway 或长期密钥。
- 所有外部输入均来自受保护的中央仓库 `main` 固定清单，不接受任意 URL 的手工输入。
- 验证失败必须 fail-closed；HTTP 200 不能替代页面语义、提交绑定和 Evidence 真实性。
- 输出必须脱敏，不保存 Cookie、Token、Authorization、页面正文、用户输入或私有地址。
- 初次部署只允许使用 MFA 登录的 `course-platform-admin`；禁止 Root 部署。日常调用只使用 GitHub OIDC。
- 部署和矩阵运行前读取 `My Monthly Cost Budget`：Actual 达到 `$34`（上限 `$40` 的 85%）即停止；Forecast 达到或超过 `$40` 也停止。Forecast 不可用时必须披露，不得伪造成零。

## 3. 选型

采用一个共享深模块：

```text
受保护的中央项目清单
  -> GitHub Actions 固定 workflow
  -> GitHub OIDC 最小 Invoke Role
  -> 非 VPC Lambda Verifier
  -> HTTPS/语义/提交绑定检查
  -> 脱敏 JSON
  -> CloudWatch 7 日日志
  -> GitHub Artifact 7 日副本
  -> 各项目 Evidence 台账
```

不采用以下方案：

- 不复用 BabySteps 性能流水线，因为其 ECS、PostgreSQL、队列与清理合同属于性能观测领域。
- 不为每个项目创建独立 Lambda，因为这会重复 IAM、日志、发布和维护成本。
- 不让浏览器直接调用 AWS，因为浏览器不得持有 AWS 凭据。

## 4. 模块边界

### 4.1 项目清单

清单 Schema 为 `portfolio-aws-verifier/v1`。每个项目声明：

- `projectId`
- `repository`
- `headSha`
- `deliveryStatus`
- `productionUrl`，允许为 `null`
- `evidenceUrl`
- `checks`
- `expectedMarkers`

`productionUrl: null` 表示项目没有独立生产站。Verifier 仍可验证公开仓库提交和 Evidence 页面，但结果必须保留 `production: not-deployed`。

### 4.2 GitHub Actions 调度器

中央 workflow 只读取仓库内固定清单，按项目顺序执行，`max-parallel: 1`。每项操作：

1. 校验清单 Schema 和 SHA 格式。
2. 使用 GitHub OIDC 获取短期 AWS 凭据。
3. 调用精确 Lambda ARN。
4. 校验 Lambda 响应 Schema、项目 ID 和 SHA 回显。
5. 将脱敏结果保存为 7 日 GitHub Artifact。
6. 任一项目失败时保留已完成结果并使整个 Run 失败。

workflow 不接受任意 URL、任意 Lambda ARN、任意 Role ARN 或自由文本 shell 输入。

### 4.3 Lambda Verifier

运行参数：

- Python 3.13
- 128 MB
- 10 秒超时
- 非 VPC
- 不设置函数级保留并发。当前账户 Lambda 总并发为 10，AWS 会拒绝任何会把未保留并发降到 10 以下的配置；串行边界由无公网入口、精确 OIDC 主分支信任和 GitHub Actions `max-parallel: 1` 共同保证
- 无 Function URL

Lambda 接口只接收单个项目合同。验证内容：

- repository 必须属于 `Tiancheng-Xu` 允许列表。
- `headSha` 必须是 40 位十六进制字符串。
- 必须通过 GitHub 公共 API 确认该 SHA 存在于声明仓库，并回显完整 SHA。
- URL 必须为 HTTPS，并属于 `baby2b.online`、其受控子域或 `github.com`。
- 禁止 IP literal、localhost、私网、链路本地地址和非标准端口。
- 禁止自动跟随重定向；非规范 URL 直接失败。
- 限制响应体读取上限；不在日志或结果中保存正文。
- 校验 HTTP 状态、Content-Type、必要的标题或语义 marker。
- 记录响应体 SHA-256、允许列表响应头、耗时和采集时间。
- 若生产页面包含构建 SHA marker，记录 `productionBinding: embedded-sha`；否则只能记录 `productionBinding: repository-and-url`，不得声称生产部署与 SHA 已形成强绑定。

Lambda 返回 `portfolio-aws-verifier-evidence/v1`，不把异常堆栈或页面正文返回给调用方。

## 5. IAM 与信任边界

### 5.1 GitHub OIDC Invoke Role

信任条件：

- Provider 为现有 `token.actions.githubusercontent.com`。
- `aud` 必须为 `sts.amazonaws.com`。
- `sub` 必须精确匹配该 GitHub 组织已启用的不可变 ID 绑定格式：`repo:Tiancheng-Xu@44307608/.github@1328761732:ref:refs/heads/main`。不得退回名称通配或 `repo:*`。

权限只允许：

- 对精确 Verifier Lambda 执行 `lambda:InvokeFunction`。
- 读取精确月度 Budget，用于 `$34/$40` 的运行前硬 Gate。

不允许 IAM 写、CloudFormation 写、S3 列举、日志读取或调用其他 Lambda。

### 5.2 Lambda Execution Role

权限只允许：

- 写入自身精确 CloudWatch Log Group。

Evidence 主副本由 GitHub Artifact 保存，因此 Lambda 不需要读取 Secret、访问数据库或写共享 S3。

## 6. 资源与成本

CloudFormation Stack：`tc-shared-evidence-verifier`

新建资源：

- 1 个 Lambda Function
- 1 个 CloudWatch Log Group，Retention 7 天，删除策略为 Delete
- 1 个 Lambda Execution Role
- 1 个 GitHub OIDC Invoke Role

复用资源：

- 现有 GitHub OIDC Provider
- GitHub Actions Artifact
- 现有 Budget 与告警

增量使用量为 6 次短 Lambda 调用和少量日志。预计接近零并可能落在免费额度内，但 Evidence 只记录真实账单与调用量，不承诺绝对零费用。

初次部署使用 CloudFormation Change Set。执行前必须检查变更只包含本节列出的资源；创建失败时只处理精确 Stack `tc-shared-evidence-verifier`，先读回失败资源，再删除该 Stack 并验证新资源为零。现有 OIDC Provider、共享 Foundation、Budget 和其他项目资源始终受保护。

## 7. 数据合同与 Evidence

每个项目结果至少包含：

- `schemaVersion`
- `projectId`
- `repository`
- `headSha`
- `verificationRunId`
- `awsRequestId`
- `status`
- `production`
- `evidence`
- `checks`
- `capturedAt`
- `provenance: aws-verifier`
- `limitations`
- `productionBinding`
- `budgetActualBefore`

Evidence 必须保存：

- 精确 GitHub Run URL
- workflow head SHA
- Lambda Request ID
- 脱敏 JSON Artifact
- 项目生产 URL 与 Evidence URL
- 失败项、未部署项与限制
- AWS Budget 前后读回

禁止将 Mock、清单静态校验、HTTP 200 或 Lambda 调用成功单独解释为完整项目交付。

## 8. 错误处理

- 清单不合法：调用 AWS 前失败。
- OIDC 失败：不回退到长期密钥或人类 Root 凭据。
- URL 超时、重定向、域名越界、marker 缺失：项目失败。
- Lambda 响应 Schema 不合法：项目失败。
- Artifact 上传失败：Run 失败，不宣称 Evidence 已保存。
- 部分项目成功：保留成功 Artifact，但整体状态为 partial-failure。

Verifier 是共享资源，不随单次项目验证删除。若未来退役，必须先确认无调用方，再由共享平台所有者删除；项目清理不得删除它。

## 9. 测试与 Gate

实现必须按 TDD 完成：

- Schema 正例与缺字段、未知字段、重复项目反例。
- URL allowlist、端口、IP literal、重定向与私网阻断。
- 响应大小、Content-Type、marker 和 SHA-256。
- 敏感字段扫描与日志脱敏。
- IAM trust/permission 精确合同。
- CloudFormation/SAM validate。
- `aws-budget-guard` IaC 扫描。
- workflow 只读输入、OIDC 和固定矩阵合同。
- 本地 Lambda 事件测试与失败路由。

云端验收顺序：

1. 部署共享 Stack。
2. 只读回读资源、IAM 与日志 retention。
3. 从中央 `main` 触发六项目矩阵。
4. 校验每个项目的 Request ID、SHA、URL 语义和 Artifact。
5. 回读 Budget 与 CloudWatch 调用量。
6. 将结果同步到各项目 Evidence 和 Dashboard，保持状态边界。

部署前还必须确认调用身份精确等于 `course-platform-admin`，并保存 Change Set 资源类型、Budget 读回和共享资源保护清单。身份不匹配、Budget 超阈值或 Change Set 出现未批准资源时立即停止。

## 10. 完成标准

- 本地、远端 policy、测试、IaC 与预算 Gate 全绿。
- CloudFormation 只包含批准的四类资源。
- 六个项目各有一次真实 Lambda Request ID。
- 每项结果绑定精确 repo、SHA、URL、Run 与 Artifact。
- 未部署项目明确显示 `not-deployed`。
- Dashboard 仅新增 `AWS Verifier` 事实，不把它改写为 AWS Runtime。
- 无 Secret、Token、Cookie、正文或私有路径进入公开 Evidence。
- AWS Free 计划未升级、转换或取消。

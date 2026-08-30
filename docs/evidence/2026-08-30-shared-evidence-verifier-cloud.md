# Shared Evidence Verifier 云端验证

日期：2026-08-30

## 结论

共享 AWS Evidence Verifier 已完成真实云端闭环。权威 Run 为 [33290528028](https://github.com/Tiancheng-Xu/.github/actions/runs/33290528028)，绑定实现提交 `96d22e92b594efb9d4e8a79c7df60becc74803f9`，结论为 `success`。

该结论只证明 `aws-verifier`：GitHub OIDC 获取短期身份、预算 Gate、Lambda 串行调用、公开页面与 Evidence 语义检查、脱敏 Artifact 保存。它不代表各项目都拥有完整 AWS 业务 Runtime。

## AWS 资源边界

- Stack：`tc-shared-evidence-verifier`
- Region：`us-east-1`
- 状态：`UPDATE_COMPLETE`
- 资源：2 个最小 IAM Role、1 个非 VPC Lambda、1 个 7 日 CloudWatch LogGroup
- 无公网 API、Function URL、VPC、NAT、RDS、ECS、ALB、API Gateway 或新 S3 Bucket
- GitHub OIDC `sub` 使用不可变 owner/repository ID 并精确限制到 `main`
- Workflow 固定清单、`max-parallel: 1`、无任意输入

## 预算读回

- 月度上限：USD 40
- 执行前 Actual：USD 27.345
- 执行后 Actual：USD 27.345
- Forecast：不可用；未解释为 0
- 未升级、转换、取消或关闭 AWS Free 计划

## 项目结果

| 项目 | AWS verifier | 仓库 commit | Production 边界 | Artifact ID |
| --- | --- | --- | --- | --- |
| Showcase Dashboard | verified | verified | repository-and-url | 9725818050 |
| GitHub Profile Studio | verified | verified | not-deployed | 9725820429 |
| 性能观测与成本控制 | verified | verified | not-deployed | 9725825270 |
| Portfolio Sync | verified | verified | repository-and-url | 9725822800 |
| Personal AI Agent | verified-with-limitations | unavailable-private | url-only-private-repository | 9725814289 |
| TC Flow 2.1 | verified-with-limitations | unavailable-private | not-deployed | 9725827903 |

Personal AI Agent 与 TC Flow 2.1 的仓库为私有。系统没有注入长期 GitHub Token 或 App 私钥，因此只验证其公开 Production/Evidence；声明 SHA 保留，但 `headShaVerified=false`，不得描述为外部 commit 已验证。

## 失败与修复留痕

1. 首次 Change Set 因账户 Lambda 总并发为 10，无法设置 `ReservedConcurrentExecutions: 1` 而回滚。精确 Stack 与尝试资源均删除后，改用无公网入口、精确 OIDC 与 Actions 串行矩阵控制并发。
2. 首次矩阵因 GitHub 使用 ID 绑定 OIDC Subject 而无法 AssumeRole。脱敏 Claim Gate 证明真实 `sub` 后，将 Trust Policy 收紧到不可变 owner/repository ID，没有使用通配。
3. 第三次矩阵中 4 个公开仓库通过，2 个私有仓库因匿名 commit API 不可用而失败。最终合同改为明确 `verified-with-limitations`，不再用匿名 API 失败冒充项目故障。

## 保留期限与限制

- 6 份 GitHub Artifact 保留 7 日，到期后应以本文件和机器 JSON 作为索引，并按需重新运行固定矩阵。
- Production 页面未嵌入 commit SHA 时只能标 `repository-and-url`，不能标 `embedded-sha`。
- GitHub Actions 的 Node 运行时弃用提示不影响本次结果，但后续应在官方 action 发布兼容版本后升级。

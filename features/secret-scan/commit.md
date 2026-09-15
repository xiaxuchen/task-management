# 提交记录：文档敏感信息扫描

- feat(secret-scan): 文档敏感信息扫描——对节点（含子树）非空文档做只读凭据扫描，覆盖 PEM 私钥 / AWS / GitHub / Slack / JWT / 显式密钥赋值与 Bearer 提示；高危命中阻塞并输出逐条脱敏证据（原值绝不回显，避免扫描结果自曝凭据），无文档空态保持 ready=null；三入口 1:1（GET /api/nodes/:id/secret-scan · CLI secret scan · MCP secret_scan）+ renderSecretScanMd；补 13 条 UT 覆盖规则、空态、脱敏、scope、纯读、三入口与错误契约；新增 features/secret-scan 三件套并同步 04-api / api.md / 08-testing / 09-decisions / features/README

# 表格式展开树功能提交记录

- feat(web): Vite + Vue3 + Element Plus 项目骨架（vite.config.js、main.js、api.js）
- feat(web): App.vue 壳 + el-menu 导航（任务树/属性定义/设置）
- feat(web): TreeView 表格式展开树（搜索/筛选/建节点/删除）
- feat(web): NodeDrawer 右侧详情抽屉（属性动态表单/状态/文档/commit）
- feat(web): DocPane 文档区（左列文档名 + 右侧 markdown 编辑/预览）
- feat(web): AttrDefsView 属性定义管理页（行内编辑/新增/删除）
- feat(web): SettingsView 配置页（GitLab 地址/Token/端口/连通性测试）
- feat(server): index.mjs 静态托管 web/dist/ + SPA 回退
- chore(server): http.mjs 404 handler 只拦 /api/*，放行非 API 路由
- fix(store): listTree 返回 docCount / childCount（修复表格「文档」「子节点」列空白）
- fix(web): 节点切换时重载抽屉详情（原 onMounted 只跑一次）
- feat(web): 表格「📄 数量」点击直达文档区（docCount → initialTab='docs'）
- chore(web): 删除 TreeView 无用 flattenTree 死代码
- test(store): listTree docCount / childCount 用例
- feat(web): 文档区改用 Vditor（设计 §5 / 决策 #12），替换手写 simpleMd 简易渲染
  - 预览走 Vditor.preview：代码块高亮+行号、表格、任务列表、mermaid、KaTeX、目录
  - 编辑走 Vditor ir 模式：18 项工具栏，blur 即存 + 轮询自动保存（停止输入 1.2s 落库）
  - 资源自托管：新增 scripts/copy-vditor.mjs（postinstall / prebuild / predev 自动同步到 web/public/vditor/dist，cdn='/vditor'）
  - chore(web): NodeDrawer 补布局样式，让 tab 内容撑满抽屉高度（Vditor 需确定高度）
- fix(web): 自动保存改由轮询驱动（Vditor input 回调触发时机不稳定，实测数秒未回调），
  且轮询须在 after 回调启动（构造后 getValue() 不可靠）；修复防抖定时器被轮询不断重置导致永不保存
- fix(tree-table-ui): 修复 SettingsView 提示词模板里未转义的 `{{...}}` 导致 Vite 构建失败（模板参数改由脚本常量传入，文本占位符用 `v-pre`）

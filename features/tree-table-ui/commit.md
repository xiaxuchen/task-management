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
# 功能设计：表格式展开树（Web UI）

## 技术栈

- Vite 8 + Vue 3 + Element Plus（zh-cn）
- 后端静态托管 `web/dist/`，SPA 回退到 `index.html`

## 模块职责

- `web/src/api.js`：REST API 封装
- `web/src/App.vue`：壳 + el-menu 导航（任务树 / 属性定义 / 设置）
- `web/src/views/TreeView.vue`：el-table tree-props 展开树
  - 工具栏：搜索 + 类型/状态筛选 + 新建项目
  - 行点击 → emit('select') → App.vue 打开 NodeDrawer
  - 行操作：+ 添加子节点、+ 添加缺陷、删除（ElMessageBox 确认）
- `web/src/components/NodeDrawer.vue`：el-drawer
  - Tab 1 基本信息：名称编辑、状态切换、属性动态表单
  - Tab 2 文档：引入 DocPane
  - Tab 3 子节点：子节点列表
  - Tab 4 提交：commit 登记表单
- `web/src/components/DocPane.vue`：文档区
  - 左列文档名 el-menu，右列预览/编辑切换
  - 纯文本 textarea 编辑 + simpleMd 简易渲染
- `web/src/views/AttrDefsView.vue`：属性定义管理（行内编辑 + 新增弹窗）
- `web/src/views/SettingsView.vue`：配置页（端口、GitLab 地址/Token、连通性测试）

## 关键规则

- 后端 `createApp()` 不处理非 API 路由，由 `index.mjs` 添加静态托管 + SPA 回退
- Express 5 不支持 `*` 通配符路由，用 `app.use` 中间件判断 `req.path` 前缀
- `npm run build` 构建产物到 `web/dist/`
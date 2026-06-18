# AD 选取助手

Dota2 技能征召(Ability Draft)实时选取助手:只读截屏 + 识别 + 打分 + 透明置顶 overlay。

## 开发

monorepo(npm workspaces):`shared` / `core` / `main` / `renderer` / `app`。

```bash
npm install          # 装齐所有 workspace 依赖
npm run test:ts      # 跑全部 TS 测试(core/main/renderer/app)
npm run compliance   # 合规红线扫描(写 API 越界 / 注入 API / 品牌 cast 越界)
npm run dev          # 启动 Electron overlay
```

数据库驱动为 `node-sqlite3-wasm`(纯 WASM,零编译),Node 与 Electron 共用同一份,无原生模块 ABI 问题。
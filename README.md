# AD 选取助手

Dota2 技能征召(Ability Draft)实时选取助手:只读截屏 + 识别 + 打分 + 透明置顶 overlay。

## 开发

monorepo(npm workspaces):`shared` / `core` / `main` / `renderer` / `app`。

```bash
npm install          # 装齐所有 workspace 依赖
npm run test:ts      # 跑全部 TS 测试(core/main/renderer/app)
npm run compliance   # 合规红线扫描(写 API 越界 / 注入 API / 品牌 cast 越界)
npm run dev          # 启动 Electron overlay(会先自动切原生模块到 Electron ABI)
```

## ⚠️ 原生模块 ABI(better-sqlite3)

`better-sqlite3` 是原生模块,**一份 `.node` 二进制一次只能匹配一个 ABI**:

- **测试**(`npm run test:*`)跑在 **Node** 里 → 需 Node ABI。
- **应用**(`npm run dev`)跑在 **Electron** 里 → 需 Electron ABI(与 Node 不同)。

二者不可兼得。约定:

- 仓库**默认状态 = Node ABI**,这样 `npm run test:ts` 常态可跑。
- `npm run dev` 已在启动前自动执行 `rebuild:electron`,切到 Electron ABI。
- 跑过 `dev` 后想再跑测试,先 `npm run rebuild:node` 切回。

如果测试报 `The module ... was compiled against a different Node.js version`,就是 ABI 串了 —— 跑 `npm run rebuild:node`(测试)或 `npm run rebuild:electron`(应用)切回对应 ABI 即可。

> `sharp` / `koffi` 是预编译多平台包,无需 rebuild;只有 `better-sqlite3` 需要。
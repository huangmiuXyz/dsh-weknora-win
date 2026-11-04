# dsh-weknora-win

把 **WeKnora Lite（Windows x64）** 打进一个 DeepSeek Harness 组合包：安装后自动注入一个工具
`weknora_run`，调用它就在本机拉起知识库服务并返回 Web UI 地址。

> 包名带 `-win` 是因为二进制只覆盖 Windows x64；其他平台需要各自的构建与平台包。

仓库只含源码：WeKnora 二进制与 `web/`、`config/`、`migrations/` 是分发产物，不入库。
完整包（含 exe）见 [Releases](https://github.com/huangmiuXyz/dsh-weknora-win/releases)。

- 二进制与资源**随包分发**，用户不需要单独下载 WeKnora，也不需要 Go / Docker / 前端构建。
- 工具是幂等的：已经在跑就复用，绝不重复启动第二个实例。
- 默认只监听 `127.0.0.1`，数据写在 `$DSH_HOME/weknora`，不碰 `node_modules`。
- 插件卸载 / DSH 退出时停掉服务；别处启动的实例只收养、不杀。

## 安装

从 [Releases](https://github.com/huangmiuXyz/dsh-weknora-win/releases) 下载 `dsh-weknora-win-0.1.0.tgz`：

```sh
dsh plugin --profile <name> add ./dsh-weknora-win-0.1.0.tgz
dsh --profile <name>             # 或重启 DSH
```

或者本地打包：

```sh
pnpm pack                        # 产出 dsh-weknora-win-0.1.0.tgz（约 89 MB）
dsh plugin --profile <name> add ./dsh-weknora-win-0.1.0.tgz
```

安装后工具列表里会出现 `weknora_run`。第一次调用会建库并跑迁移（通常几秒），之后
毫秒级返回。

如果 profile 里已经装了官方的 `@wxg-prc-cpg/dsh-weknora`（检索类工具），两者可以共存：
本包的行 id 是 `weknora-run`，官方的是 `weknora`，互不覆盖。

需要 Node ≥ 22 与 DSH 的 `ctx.tools` / `ctx.subprocess` 能力（桌面版与 web profile 都提供）。

## 工具

```
weknora_run()  →  { running, baseUrl, port, state, host, dataDir, startupMs?, note? }
```

| `state` | 含义 |
| --- | --- |
| `started` | 这次调用启动的；`startupMs` 是等待就绪的时间 |
| `already-running` | 本插件进程里已经在跑 |
| `adopted` | 已有 WeKnora 在应答（可能是上次 DSH 留下的，或用户自己启的），直接复用 |

失败会抛错，消息里带子进程最近 20 行输出（Go 的 panic 一行就能定位）。

首次打开页面需要在 WeKnora 里**注册一个本地账号**，这是它自身的行为；工具只负责把服务拉起来。

## 工具卡片

`weknora_run` 在 Web GUI 里会渲染成一张卡片：

- **未配置 API Key**：显示输入框。这次调用会**挂起等你保存**（最多 5 分钟），保存成功后
  调用立即返回；超时则以 `apiKeyConfigured: false` 返回，卡片上会说明原因。
- **已配置**：显示掩码 `sk-****xxxx` 与「更换」。
- **在浏览器打开**：由 host 侧交给系统默认浏览器（Windows 用 `cmd /c start`），不依赖
  GUI 自己的 `window.open`。

保存时先用 `GET /api/v1/knowledge-bases` 校验这把 Key，再把 `WEKNORA_API_KEY` 与
`WEKNORA_BASE_URL` 写入当前进程和 Windows 用户环境变量（`setx`）；官方检索插件
`@wxg-prc-cpg/dsh-weknora` 下次启动时按环境变量读取。

## 配置

改 profile 的 `cordis.patch.yml` 里 `weknora-run` 这一行（或命令行 `--patch` 覆盖）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `host` | `127.0.0.1` | 监听地址。别改成 `0.0.0.0`：服务没有额外的访问控制 |
| `port` | `18080` | 固定端口便于收藏；被占用时自动退到空闲端口，并在结果 `note` 里说明。`0` = 每次随机 |
| `dataDir` | `''` | 留空即 `$DSH_HOME/weknora`；填绝对路径可把数据放到别的盘 |
| `startupTimeoutMs` | `120000` | 首次建库较慢；之后通常 1 秒内就绪 |
| `stopOnDispose` | `true` | 插件卸载时是否停止服务 |
| `extraEnv` | `{}` | 追加给子进程的环境变量，例如 `OLLAMA_BASE_URL` |

## 运行时目录

```
$DSH_HOME/weknora/
  runtimes/<版本>/config/  migrations/sqlite/   # 从包内复制（约 0.2 MB）
  data/weknora.db  data/files/                  # 数据库与本地上传
  logs/server.log                               # 子进程完整输出
  weknora.env                                   # 自动生成，含随机 SYSTEM_AES_KEY / JWT_SECRET（0600）
  run.json                                      # 供下次启动收养的端口记录
```

二进制和前端 `web/` 留在包里只读使用（`WEKNORA_WEB_DIR` 指过去），所以升级插件即升级服务，
不需要重新解压 285 MB。

## 打包

```sh
node scripts/sync-assets.mjs --source /path/to/WeKnora
```

脚本从 WeKnora 仓库/worktree 复制 `WeKnora-lite(.exe)`、`web/`、`config/`、`migrations/sqlite/`、
`licenses/` 与许可证文件，生成 `assets/manifest.json`（版本、exe 大小与 SHA-256）。
当前只提供 `win32-x64` 资产；其他平台需要各自的构建。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 工具报「二进制与资源缺失」 | 包内 `assets/win32-x64` 不完整，重新执行 `sync-assets` 后打包 |
| 启动超时 | 看 `$DSH_HOME/weknora/logs/server.log`；首次建库慢属正常，可调大 `startupTimeoutMs` |
| 端口不是 18080 | 18080 被占用，结果里的 `note` 会写明实际端口 |
| 页面打不开但工具返回成功 | 确认浏览器访问的是结果里的 `baseUrl`（可能已回退端口） |
| 杀软/SmartScreen 提示 | 分发的 exe 未签名；这是 WeKnora 自身的二进制，不是插件额外下载的 |
| 迁移被中断（`dirty database`） | 只可能发生在首启迁移时强杀；删掉 `$DSH_HOME/weknora/data/weknora.db*` 重新建库 |

## 许可

插件代码 MIT。随包分发的 WeKnora 为 MIT（含第三方组件声明），
见 `assets/win32-x64/LICENSE` 与 `assets/win32-x64/THIRD_PARTY_NOTICES.md`。
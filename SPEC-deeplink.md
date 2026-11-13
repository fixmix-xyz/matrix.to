# 规格：产品分享链接与深链（SPEC-deeplink）

日期：2026-11-13。状态：**第二稿，已按评审修订**；同日按负责人的决定改为只做 Zymi（§12 第四轮）。评审结论是“修改后批准”，原文在 `…/8421319f-…/scratchpad/review-spec-deeplink.md`。逐条答复见文末 §12。

这份规格只定设计，不写代码。所有“现状”都附了 `文件:行`，行号以 2026-11-13 各仓库的工作区为准；zim、im、zymi-services、zymi-ios 的工作区里有别人没提交的改动，行号可能会小幅偏移。

本稿配套的验收数据是 `fixtures/links/vectors.json`，共 122 条，见 §4.5。

---

## 0. 结论先行

### 0.1 默认假设（负责人可推翻）

负责人还没有答复的决定，本稿先按下表的默认值写。任何一条被推翻，只影响表里列出的那些任务。

| # | 决定 | 默认值 | 推翻后受影响的任务 |
|---|---|---|---|
| B1 | 范围 | **负责人已定（11-13）：只做 Zymi（zim 和 zymi-ios）。** 负责人原话：「这个是新的产品 zymi，只要它的」「Matrix用zymi:」。Unseal 和 ZYMIX 不在范围内，它们的旧写法（旧落地页 `dev.unseal.chat/…/to-share/`、`zymix://unseal/…`、`zymixdemo://unseal/…`）不再支持；Matrix 的用户、房间、别名和消息一律用 zymi 写法（`https://<链接域名>/…` 和 `<scheme>://open/{u\|r\|roomid}/…[/e/…]`，不加新语法），`matrix:` URI 不再读。旧链接只认 matrix.to（D3）。Android 和 Windows 先挂起 | A1、W1 |
| B2 | 链接域名 | **全部做成配置项**，代码里不写死。示例值：`to.zymi.app`（prod）、`to-dev.zymi.app`、`to-testing.zymi.app` | P2、P3、Z2、S2、Z4、S4 |
| B3 | 生产环境的 Team ID、Bundle ID 和签名指纹 | **没有默认值，留空** | 被它阻塞：P2（AASA 和 assetlinks 的内容）、Z4、S4、落地页的商店链接、Smart App Banner |
| B3s | scheme | **负责人已定（11-13）：产品的 scheme 一律是 zymi 家族，不再用 zim。** 规则 `zymi[-<发布线>]`：prod 是 `zymi`，dev 是 `zymi-dev`，testing 是 `zymi-testing`；Debug 构建（连本地栈）是 `zymi-debug`。规范形式 `zymi://open/<路径>`。全表见 §5.3。`zim` 退役，不进旧写法（§12 第三轮）。“dev 线用 `zymi-dev` 而不是 `zymi`”是协调者按这条规则定的，负责人可推翻 | Z1、§5.3、§6.1、§6.2、向量 |
| B4 | zim 有几条发布线 | **对外只有 dev 一条**（Release 连 dev 网关）。Debug 构建连本地 E2E 栈，`server_name` 不同（`localhost:8448`），所以它有自己的一份配置：发布线 `local`，scheme `zymi-debug`，host 用 `to-local.zymi.test`（只给 E2E 用）。E2E 靠 `zymi-debug` 定位到被测的那一份 App。每个构建只注册自己那一个 scheme，分享扩展也用它交接（Debug 是 `zymi-debug://share`，Release 是 `zymi-dev://share`；scheme 见 B3s） | Z1、§5.3、§6.2 |
| B5 | 落地页托管 | **用能跑边缘函数的托管**，例如 Cloudflare Workers 或 Pages Functions（只是举例，不是选定） | P1、P3 |
| B8 | 跨账号分享：Zymi 页面的链接能不能发给别人看（Q7，**待定**；L2，负责人 11-13：「需要做universal link，不止是chat im部分，还有其他的页面分享应该也要考虑」） | **默认按读法一：只有本人能打开，用于自己跨设备打开、从邮件或通知跳回 App。** 用现有规则（§4.4、§8.4），不加服务端功能。**读法二：发给别人看。** 要服务端给每个可分享的对象发分享令牌，或者加公开标记（现在只有音乐帖子 `share_url` 有，见 §4.4），§8.3 要重写（令牌放在哪、怎么吊销，永远不经 scheme 转交）。对其余阻塞项的影响：B2 的链接域名上要多出公开页面，或者把公开页面放到另一个域名；B3 不受影响；托管（B5）要从“边缘函数只判断类型”变成“边缘函数要读服务端，做预览”，CSP 的 `connect-src 'none'` 要放开；落地页（§6.5）要多出“访客能看到内容”这一种状态 | 读法二影响：§4.4、§6.5、§8.3、§8.4、P1、P3，以及服务端（不在本规格范围内） |
| B7 | App 内点到的非自家链接，哪些 scheme 交给系统（**待负责人确认**） | **回复正文里的链接只放行 http 和 https。核心卡片的动作按钮另外放行 `mailto:`、`tel:`、`sms:`、`maps:` 四种**，正好是 zymi-core 卡片动作允许的 scheme（`cards/actions.rs` 的 `ALLOWED_SCHEMES`）。别的 scheme 一律不交给系统，并提示「ZIM 不打开这种链接」 | Z1、Z3、§5.2，zymi-ios 的 S3 |

### 0.2 五个关键决定

| # | 决定 | 一句话理由 |
|---|---|---|
| D1 | **规范链接放在 URL 路径里，不放在片段（`#/…`）里。** 挂在专用的链接域名上，每条发布线一个，例如 `https://<LINK_HOST>/roomid/<id>`、`/u/<id>`、`/task/<id>`。自定义 scheme 写成 `<scheme>://open/<同一路径>`，只用来从落地页把链接交给 App。 | API 35 以下的 Android 在 App Links 里**匹配不了片段**（片段匹配要到 API 35 的 `uri-relative-filter-group` 才有）。服务端看得到路径，才能用边缘函数返回 404、做预览卡片。聊天消息里只放行 https 链接，自定义 scheme 会被丢掉（`IMChatMac/Message.swift:396-399`）。 |
| D2 | **语法只有一份，配一份共用的测试向量。** 权威副本是本仓库的 `fixtures/links/vectors.json`。zim 和 zymi-ios 由 **zymi-core** 负责生成和解析链接，做成不依赖登录状态的自由函数。IMKit **不自带语法**，只提供两个注入点：链接生成器和链接打开器。每个 App 只有**一个** `LinkRouter`，所有打开 URL 的地方都先经过它。 | IMKit 和 ZYMIX 都不依赖 zymi-core。“一份向量 + 多份实现”这种做法已有先例：`zymi-services/fixtures/sse-vectors.json` 加 `scripts/sse-parity.sh`。 |
| D3 | **旧链接只认 matrix.to。** 解析器认 `https://matrix.to/#/…`（这个**旧前缀写成配置里的白名单**，别的 host 上出现同样的片段写法也不认），用于 @ 提及的 pill 和已经发出去的链接。旧落地页、`zymix://unseal/…` 和 `matrix:` URI 都不认，判 `not_ours`（B1）。**@ 提及的 pill 继续用 matrix.to 的片段写法。** 推出顺序是先发解析器，后发生成器。 | 两端判断 pill 的代码都不看域名（`MatrixHTML.swift:119-140`，`MatrixHtml.kt:137-157`）。dev 的 homeserver 关了联邦、注册和访客（`homeserver.yaml.tmpl:34-43`），用 matrix.to 写法没有坏处。 |
| D4 | **安全基线。** 落地页不做预览，也不请求任何 homeserver。`client` 和 `web-instance[…]` 两个参数一律忽略。落地页只跳到自己拼出来的地址。会改状态的动作一律先在 App 内确认。服务器名检查只用在**用户 ID、别名和 v12 之前的房间 ID** 上；房间和事件是不是自家的，看链接的 host 属于哪条发布线。没有权限和不存在对外显示同一句话。链接里不放任何令牌，v1 只预留 `/invite/` 路径，不实现。 | matrix.to 会按 `via` 去请求任意服务器拉预览（`src/preview/PreviewViewModel.js:46-59`）。ZYMIX 打开链接就直接加入房间（`../matrix.to/src/open/clients/Zymix.js:17-19`）。v12 的房间 ID 和 v3 之后的事件 ID 都没有服务器部分。 |
| D5 | **各平台做法。** iOS 和 macOS 用 universal links（AASA 按路径匹配）加 scheme；安卓用 App Links（`assetlinks.json` 加 `autoVerify`）加 scheme；Windows 先注册 scheme，用 Electron 的话就是单实例转发；安卓和 Windows 按 B1 挂起。App 里点到自家链接，**由 `LinkRouter` 拦下来**，不交给系统。 | 现在 IMKit 和 zim 一共有十几个地方会把 https 链接直接交给系统（§5.2）。 |

---

## 1. 任务前提和仓库实际情况不一致

- **`zymi-matrix.to`（远端 `fixmix-xyz/matrix.to`）：** 本规格的第一次提交 `5ccc7c5` 的父提交是 `562a5e2`（上游 PR #409），和上游完全一样。代码里没有任何产品字样，也没有部署配置，页面还是 Matrix 的品牌（`index.html:5-13`、`src/RootView.js:36-37`）。
- **真正在用的落地页逻辑在 `../matrix.to`（远端 `unseal-network/matrix.to`）。** 它的三个提交（`7c118c7`、`9b7ac82`、`4cf008c`）加了 Unseal、ZYMIX、ZYMIX Demo 三个客户端，另有 4 个文件改了没提交。
- **旧落地页随 unseal-webapp 一起发布。** `unseal-webapp/scripts/update-to-share.sh:17-18` 会构建 matrix.to，再拷进 `res/to-share/`，这个目录里现在就有 `index.html` 和 `bundle-*.js`。unseal-webapp 里有 `amplify.yml`，推测托管在 AWS Amplify，**待 unseal-webapp 的维护者确认**。客户端里写死的地址是 `https://dev.unseal.chat/AgentMessenger/to-share/`（`zymix-im-ios/MainApp/Sources/Feature/MatrixDemo/MatrixDemoSettings.swift:102`）。
- **负责人说的“四个平台都有客户端”，在工作区里只能对上 Unseal 品牌的安卓客户端和 Electron（Windows）客户端**（§2.9）。没有 Zymi 品牌的安卓或 Windows 客户端。它们在不在范围内，归 B1 决定。

---

## 2. 现状盘点

> **本节只作背景。** 这里记的是 2026-11-13 之前各仓库的现状，其中 Unseal 和 ZYMIX 的部分（落地页的 Unseal、ZYMIX 客户端，zymix-im-ios、zymix-im-android-cloud，Unseal 品牌客户端）不再是要支持的对象：B1 定了只做 Zymi，它们的写法一律判 `not_ours`（§4.2、§7）。

### 2.1 落地页（matrix.to 的两个 fork）

| 项 | 现状 | 证据 |
|---|---|---|
| 链接语法 | 写在片段里：`#/<@user|#alias|!roomid|+group>[/<$event>]?via=…&client=…&web-instance[<id>]=…` | `src/Link.js:20-24, 105-134` |
| `matrix:` URI | 能生成 `matrix:u/…`、`matrix:roomid/…/e/…`、`matrix:r/…`（MSC2312） | `src/Link.js:220-244` |
| AASA | 构建时生成，只匹配片段：`{"#":"/*"}` | `scripts/build.js:62, 126-143` |
| assetlinks.json | **没有** | `scripts/build.js` |
| 预览 | 用户同意以后，按 `via` 和链接里的服务器请求 `/.well-known/matrix/client`、`/profile`、`/summary`、`/publicRooms` 和缩略图 | `src/preview/HomeServer.js:36-116`，`PreviewViewModel.js:46-59` |
| `web-instance[]` | Element 和 SchildiChat 只放行白名单里的实例 | `src/open/clients/Element.js:87-88, 112-115` |
| CSP（本地模拟） | `script-src 'unsafe-inline' 'unsafe-eval'`，`connect-src *` | `scripts/serve-local.js:34` |
| Unseal 客户端 | 网页实例是 `unseal.network`，scheme 是 `unseal://vector/webapp/AgentMessenger#/…`，App ID 是 `U633M9A2Z3.www.topsecret.network` | `../matrix.to/src/open/clients/Unseal.js:20-29, 50-54` |
| ZYMIX 客户端 | 只在链接带 `?client=zymix` 时选它，深链是 `zymix://unseal/{room|user}/<encodeURIComponent(id)>?via=`；事件链接和社群链接退化成房间链接；平台列表里有 Android、Windows、macOS、Linux | `../matrix.to/src/open/clients/Zymix.js:17-21, 38-46, 60-78` |
| ZYMIX Demo | 深链是 `zymixdemo://unseal/` | `ZymixDemo.js:32-37` |
| **缺陷** | 平台列表里有 Android，但 ZYMIX 安卓版不处理 `zymix://unseal/…`；Windows、macOS、Linux 上有没有处理也没核实 | `Zymix.js:38-46`，对照 `Coor.swift:210-216` |

### 2.2 IMKit（`im`，供 iOS 和 macOS 使用）

| 项 | 现状 | 证据 |
|---|---|---|
| 房间链接和消息链接 | SDK 生成 matrix.to 链接，再经 `shareLinks?.rewrite` 改写 | `Sources/IMMatrix/MatrixChatClient.swift:1669`，`MatrixMessageLinks.swift:11-12` |
| 改写规则 | 只改 `https://matrix.to/#/` 开头的链接，改成 `<base>#/<原片段>[&client=<id>]` | `Sources/IMMatrix/MatrixShareLinks.swift:7-37` |
| 注入点 | `MatrixConfiguration.shareLinks`，为 nil 时用 matrix.to。**ZYMIX 在用这个注入点**：`zymix-im-ios/SiuperMatrix/Sources/SiuperMatrix/MatrixDemoRuntime.swift:415-416` | `MatrixConfiguration.swift:21-23` |
| 发出的 pill | 发的是 matrix.to 链接；配了 `shareLinks` 的话改写到落地页（在 `MatrixChatClient.swift:796, 854` 调用） | `MatrixOutgoingHTML.swift:21-31` |
| 收到的 pill | 不看域名，片段是 `#/@user:server` 或 `#/user/@…`，或者是 `matrix:u/…` 就认 | `MatrixHTML.swift:119-140` |
| 空间链接 | 服务端没给的话，自己拼一个 matrix.to 链接 | `Packages/IMChatMac/.../SpaceHome.swift:342-344` |
| 把链接交给系统的地方 | iOS：`MessageRowView.swift:439-448`、`HostMessageHooks.swift:61-69`、`RoomInfoView.swift:869-872`。Mac：`Message.swift:372-374`，以及 `NativeMessageCell.swift:1061-1066` → `NativeDebugMouse.open`（`NativeDebugMouse.swift:28-33`，开了调试开关时只打 `debug-open` 日志，不真的打开） | 同左 |

### 2.3 macOS：zim

| 项 | 现状 | 证据 |
|---|---|---|
| 构建身份 | Debug 和 Release **共用** Bundle ID `ai.pagepeek.zim` 和 `ZIM.entitlements`；Release 连的也是 dev 网关 | `project.yml:121-124, 142, 144` |
| scheme | 11-05 起注册 `zim`，给分享扩展用：`zim://share?inbox=<id>`；11-13 起每个构建注册自己的一个（Release `zim`，Debug `zim-debug`），并接 `<scheme>://open`。**按 B3s 改成 `zymi-dev` 和 `zymi-debug`**（§12 第三轮） | `project.yml:127-134, 162, 171, 199, 206`，`Shared/ShareInbox.swift:4` |
| 处理入口 | **已接好（L2 核对，11-13）**：`.onOpenURL` 先交给 `LinkRouter`，不是我们的才交回 ShareInbox 和文件；`.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` 也交给 `LinkRouter`。`LinkRouter` 能打开 task、goal、agent、artifact、circle 和房间（别名、用户是“打不开”；事件链接只打开房间，不跳到消息） | `Sources/ZIMApp.swift:226-229, 253-255`，`Sources/Links/LinkRouter.swift:342-396` |
| Associated Domains | 没有：只差 entitlements（等 B2、B3） | `ZIM.entitlements` |
| 分享链接 | 聊天：只在 DEBUG 下设了 `ZIM_E2E_SHARE_LINKS_BASE` 时才改写，`ChatLinkBuilder`（I1a）还没有。Zymi 页面：`LinkRouter.shareURL(for:)` 能生成，但**没有调用方**，页面上没有“拷贝链接” | `Sources/AccountModel.swift:447-448`，`Sources/Links/LinkRouter.swift:251` |
| ZymiCore 从哪来 | `../zymi-services-wt/timeline/apple/ZymiCore`，不是 main 分支 | `project.yml:22-26` |
| Zymi 页签里直接调 `NSWorkspace.shared.open` 的地方 | `Sources/Zymi/Timeline/ZymiTimelineHost.swift:102`；`UI/Task/ZymiLiveDesignCards.swift:280, 398, 482, 498, 499, 660, 687, 727, 729, 758`；`UI/Task/ZymiLiveResultCards.swift:255, 500, 512`；`ZymiArtifactsStore.swift:68` | 同左 |
| Zymi 对象的路由 | `ZymiRoute.task(String)` 等 | `Sources/Zymi/UI/Shell/ZymiNavigator.swift:7-27` |
| 断言了 matrix.to 的测试 | `UITests/SpaceSettingsTests.swift:147`，`MessageShareTests.swift:177, 181`，`MentionTests.swift:62` | 同左 |

### 2.4 iOS：zymi-ios（ZYMI）和 zymix-im-ios（ZYMIX，不在 v1 范围内）

| 项 | 现状 | 证据 |
|---|---|---|
| scheme | 每条发布线一个 `callback_scheme`（本地 dev 是 `zymi-dev`），只用来接 OAuth 和钱包的回调 | `App/Info.plist:17-25`，`ZAgentAppCallbacks.swift:4-25` |
| Associated Domains | 构建脚本支持，但正则是 `applinks:[A-Za-z0-9.-]+`，**不接受 `?mode=developer`**；`signing.py` 还会拿它和描述文件逐项比对；本地 dev 配的是 `[]` | `Scripts/environment.py:123-124, 166`，`Scripts/signing.py:29-30` |
| 收到深链的入口 | **没有**：没有 `onOpenURL`、`onContinueUserActivity`、`application(_:open:)` 或 `openURLContexts`。回调 URL 只从 `ASWebAuthenticationSession` 的完成回调进来 | `ZAgentConnectorAuthentication.swift:14`，`ZAgentConnectorStore.swift:216`，`ZAgentWalletStore.swift:113` |
| 聊天分享链接 | 没有设 `shareLinks`，用的是 matrix.to | `ZymiChatMatrix.swift:135` |
| 有没有接 ZymiCore | 当前分支 `feat/zymi-chat-session` 没接；接入工作在 `zymi-ios-zymi-core` 的 `feat/zymi-core-s1` 上（`01ebe8b`，wip） | 两个分支 |
| ZYMIX 的 UL | 域名是 `oia.zymix.io` 等，AASA 给 3 个 App ID 都声明了 `"*"` | `zymix-im-ios/apple-app-site-association`，`Siuper_*.entitlements:13-20` |
| ZYMIX 的 Unseal 路由 | `/unseal/room/:roomId`、`/unseal/user/:userId`，打开房间链接就直接加入 | `Coor.swift:210-216` |

### 2.5 Android：im-android 和 zymix-im-android-cloud（都不在 v1 范围内）

| 项 | 现状 | 证据 |
|---|---|---|
| im-android 的房间链接 | 直接用 `room.matrixToPermalink()`，没有注入点 | `MatrixChatClient.kt:1070` |
| im-android 的 pill | 发出的写死 matrix.to；收到的不看域名 | `MatrixOutgoingHtml.kt:51-52`，`MatrixHtml.kt:137-157` |
| ZYMIX 安卓 | scheme 是 `zymix` 和 `siuper`；`oia-*.zymix.io` 的 App Links（4 条发布线的 host 都在**同一个** Manifest 里）；有 `DeepLinkRouter`，但**没有 Unseal 路由** | `AndroidManifest.xml:200-229`，`DeepLinkRouter.kt:11-40` |
| Zymi 安卓客户端 | 不存在 | `zymi-services/README.md:3-4` |

### 2.6 Windows

- **没有 Zymi 品牌的 Windows 客户端。** 计划是用 C#，绑定靠 `uniffi-bindgen-cs`（`zymi-services/README.md:3-4`，`zim/SPEC-zymi-core-rust.md:9, 90`），或者 Electron 加 zymi-wasm（`zim/SPEC-zymi-web.md:3, 25`）。
- **有 Unseal 品牌的 Electron 客户端，并且能打 Windows 安装包**，见 §2.9。**它在不在范围内，待负责人定（B1）。**
- ZYMIX iOS 有 `PCScanLoginRouteHandler`（`BridgeWiringSetup.swift:432`），说明还有一个 ZYMIX 的 PC 客户端，但不在这个工作区里。

### 2.7 共享内核：zymi-services（zymi-core）

| 项 | 现状 | 证据 |
|---|---|---|
| 定位 | 各平台共用的 Zymi 客户端内核 | `README.md:1-5, 20-27` |
| 和链接有关的代码 | 卡片动作里的 URL 白名单，以及 `artifact.share` 这类动作 | `crates/zymi-core/src/cards/actions.rs:11-12, 22-50`，`cards/mod.rs:116` |
| 链接模块 | **已有（C1，L1 之后）**：`link_parse`、`link_build`、`link_handoff`、`link_legacy_standard`，跑本仓库向量的拷贝 | `crates/zymi-core/src/links.rs`，`docs/links.md` |
| 导出自由函数的先例 | `browser_code_input` 这类不依赖 Client 的函数 | `crates/zymi-ffi/src/browser.rs:245-256` |
| 网关和服务端 | 不在这个仓库 | — |

### 2.8 Matrix 服务端

- `server_name` 是 `zymi.app`，用户 ID 是 `@<account_id(uuid)>:zymi.app`（`zim/SPEC-zymi-matrix-session.md:33, 61`）。
- 本地 E2E 栈：`server_name` 是 `localhost:8448`，带端口；种好的房间是 v12 的 `!owtPMO14G1v6Yl9KlRjjDmlKdVC5NbSUPqbiF2Fru30`，**没有** `:server`（`zim/dev/fake-zymi/state-e2e/e2e.json`）。Synapse 1.162 默认建 v12 房间（`im/dev/matrix/local_matrix.py:47-48`）。**生产环境用哪个房间版本未知**，所以两种写法都要支持。
- dev 模板关掉了联邦、注册、密码登录和访客（`zim/dev/zymi-homeserver/homeserver.yaml.tmpl:34-43`）。资料接口要不要登录才能读，模板里没有设置；**待在生产配置上确认**。
- Matrix 可选模式（T23）：`zim/tasks/todo-core-architecture.md:283`。

### 2.9 Unseal 品牌客户端（新增；在不在范围内归 B1 定）

| 项 | 现状 | 证据 |
|---|---|---|
| Electron（Windows 和 Mac） | `appId` 是 `com.unseal.webapp`，Windows 打 `nsis` 和 `zip` 两种包；已经打好的有 `dist-electron/Unseal Setup 1.1.26.exe` | `unseal-webapp/packages/electron/package.json` 的 `build` 段 |
| Electron 的 scheme | `protocols=[{name: "Unseal OIDC Callback", schemes: ["unseal"]}]`，用 `setAsDefaultProtocolClient` 注册。**按名字看，它是 OIDC 回调用的，不是分享链接** | `package.json`，`packages/electron/protocol.js:146-152` |
| Electron 的单实例转发 | `requestSingleInstanceLock`；`second-instance` 和 `open-url` 两个事件都交给 `dispatchProtocolCallback` | `packages/electron/main.js:243-262` |
| Android 客户端 | `unseal://open`；`app`、`develop`、`staging.unseal.network` 的 App Links（`autoVerify`）；`mobile.unseal.network` 上的 `/unseal/`、`/element/`；`matrix:` scheme；`unseal://` 和 `element://` 的 `user`、`room` | `unseal-android/app/src/main/AndroidManifest.xml:69-140` |
| Android 的变体 | Debug 和 Nightly 用 `applicationIdSuffix` 区分 | `unseal-android/app/build.gradle.kts:122, 162` |
| 有没有 Zymi 的东西 | unseal-webapp 的配置和 unseal-android 的 Manifest 里都搜不到 `zymi` | — |

---

## 3. 产品域名：候选和证据

| 候选 | 证据 | 适合不适合 |
|---|---|---|
| **`zymi.app` 的子域名** | Matrix `server_name`；网关 `dev.zymi.app`；`matrix-dev.zymi.app`（`zim/project.yml:122`）；`api.zymi.app` 和 `testing.zymi.app`（`zymi-core/tests/requests.rs:113`，`tests/auth.rs:757`） | **默认就用它（B2）** |
| `zymix.io` 等 | ZYMIX 的 UL 域名。ZYMIX 的 AASA 给 3 个 App ID 都声明了 `"*"` | 和 ZYMIX 共用一定会抢链接，所以不用 |
| `pagepeek.ai` | Bundle ID 前缀，邮件转发域名 | 是公司域名，不是面向用户的品牌 |
| `unseal.network` / `unseal.chat` | 旧客户端、旧落地页 | 只用来兼容旧链接 |

---

## 4. 链接语法

### 4.1 生成规则（逐字节确定）

1. 规范链接是 `https://<本发布线的第一个 host>/<kind>/<id>[/e/<event>]`，**不带 query，也不带片段**。
2. `kind` 只能是小写的 `u`、`r`、`roomid`、`task`、`goal`、`agent`、`artifact`、`circle`。`invite` 和 `team` 预留，现在不生成。
   - **L2 提议（待定，见 §4.4 和 §11）：** 新增 `expert`（目录条目，Q-A）、`space`（Zymi Space 应用，Q-S），以及两个页面类 kind `settings` 和 `me`（E3）；`agent` 收窄成只表示本账号的主智能体（Q-A）；`circle` 的 id 指 feed 条目（Q-C）。这些定下来之前，生成器不生成它们，解析器照旧判 `unknown_kind`（老版本 App 提示“请更新”）。定下来以后，先加向量，再改 core（先红后绿）。
3. Matrix ID 去掉 sigil 再放进路径（`@`、`#`、`!`、`$`），写法照搬 MSC2312。
4. 编码：把 ID 的 UTF-8 字节逐个处理。`A-Z a-z 0-9 - . _ ~ :` 原样保留，其余字节一律写成 `%XX`（十六进制用大写）。所以 `:` **永远不编码**，`+` 写成 `%2B`，`/` 写成 `%2F`，`@` 写成 `%40`。
   - JS 实现**不能**直接用 `encodeURIComponent`：它会把 `:` 编成 `%3A`，又不会编码 `!'()*`。
5. Zymi 对象的 ID 必须匹配 `[A-Za-z0-9_-]{1,128}`，保留大小写；不匹配就不生成，报 `invalid_id`。由于不含 `.`，生成的路径段不可能是点段。
6. 给不是本发布线 `server_name` 的用户、别名或旧房间 ID 生成链接时，报 `foreign_server`。
7. scheme 写法：`<scheme>://open<和 https 一样的路径>`。scheme 来自发布线配置里按平台列出的那张表（§5.3）。
8. **Matrix ID 的语法**（生成和解析共用；生成时不合法报 `invalid_id`，解析时判 `malformed`）。依据是 Matrix 规范（spec.matrix.org，2026-11-13 对照原文）的 Appendices › Identifier Grammar 和 Room Versions v1、v3、v4。规范对多数 localpart 只排除 `:` 和 NUL；下表凡比规范严的都写明是“收紧”和理由：不开联邦，能链接的 ID 只来自我们自己的服务器（Synapse），它生成的 ID 都在下表范围内。

   | 类型 | 接受 | 依据和说明 |
   |---|---|---|
   | 用户 | `@localpart:server`，localpart 是 `0x21`–`0x7E` 中除 `:` 以外的字节 | 收紧。现行语法是 `[a-z0-9._=/+-]`；规范的 Historical User IDs 要求客户端接受除 `:`、NUL 以外的任何码点，但明说 U+0021–U+007E 以外的是“不合规”的（这个范围也是旧版规范的历史语法）。我们取这个合规范围：旧账号能打开，非 ASCII 和 bidi 控制符进不来。不能以 `@` 开头 |
   | 别名 | `#localpart:server`，localpart 不含控制字符（Cc）、格式字符（Cf，含 U+202E 等 bidi 控制符和零宽字符）、空白 | 规范（Room Aliases）只排除 `:` 和 NUL；这里收紧：这些字符能让显示出来的 ID 和真实 ID 不一样。允许 `/` 和非 ASCII（U9：已对照规范原文，成立）。不能以 `#` 开头 |
   | 房间（v12 之前） | `!opaque:server`，opaque 是 `[A-Za-z0-9._~-]` | 收紧。规范（Room IDs）允许除 `:`、NUL 以外的任何码点，只说生成时 SHOULD 用字母数字；这里取规范 Opaque Identifiers 的字符集，挡住 `/`、`..`、`?` |
   | 房间（v12） | `!opaque`，`[A-Za-z0-9_-]` | 创建事件引用哈希的 URL 安全 base64 |
   | 事件（房间 v3 起） | `$` 加 `[A-Za-z0-9+/=_-]` | 规范：v3 是引用哈希的无填充 base64，“可能含斜杠”（**`+` 和 `/` 是真实数据，不能拒**）；v4 起是 URL 安全的无填充 base64。`=` 多收一个，无害 |
   | 事件（房间 v1、v2） | `$opaque:server`，opaque 同房间 | 收紧。规范只说 opaque 是“locally-unique string”，没有字符集；Synapse 生成的是字母。不检查服务器 |

   - Matrix ID 一律不超过 255 字节（含 sigil 和服务器）。server name 形如 `hostname`、`IPv4` 或 `[IPv6]`，可以带 `:port`。
   - server name **一律转成小写**再生成、再返回（`@x:ZYMI.APP` 返回 `@x:zymi.app`）；事件 ID 原样保留（base64 区分大小写）。
   - 两种事件 ID 都不可能是 `.` 或 `..`（base64 不含 `.`），所以永远不会是点段；但事件 ID 可以含 `/`，用它拼路径的人必须先编码（§5.2）。

### 4.2 解析规则（按顺序执行）

0. **长度上限。**（向量 `x-too-long-ours`、`x-too-long-foreign`、`x-too-long-root`） 输入超过 4096 字节时只读前 4096 字节（退到字符边界），不再完整解析，保证工作量有界。这一截按本节规则判定：判成链接或拒绝的（是我们的）→ 一律 `malformed`，不交回系统；`other_lane` 不变；`not_ours` 不变（长的普通链接照常打开；自家 host 的首页、没有 `#/` 的旧前缀也照旧是 `not_ours`）。合法链接最长也不到 2 KiB（255 字节的 ID 每个字节都编码，再加事件 ID）。
1. **用 WHATWG URL 规范解析整串输入。** 语法定义在**规范化之后**的结果上：点段已经折叠，https 里的 `\` 已经变成 `/`，host 已经转成小写，默认端口已经去掉。Rust 的 `url` crate 和浏览器的 `URL` 都符合这个规范；Foundation 的 `URLComponents` 和 Android 的 `Uri` **不符合**，平台代码**不能自己解析**，必须交给 zymi-core。
2. 按 scheme 和 host 分流：
   - `https` 加本发布线的 host，并且是默认端口 → 按规范路径解析；带用户名或密码判为 `malformed`；路径恰好是 `/` 的，那是网站首页 → `not_ours`。端口不是默认端口的，算另一个 origin，不是我们的 host → `not_ours`。
   - `https` 加别的发布线的 host → `other_lane`，并带上那条发布线的名字。
     别的发布线的链接不论路径（包括首页）、带不带凭据，都是 `other_lane`，都不打开。`https://to.zymi.app@evil.example/` 的 host 是 `evil.example`；形近字 host 转成 punycode 后是别的 host；这些都不是我们的。
   - `https`，默认端口，并且去掉 query 和片段以后**整串等于**某个旧前缀（配置项 `legacy.fragment_bases`）→ 先看片段：没有 `#/` 的话是网站本身 → `not_ours`（带不带凭据都一样，`https://u@matrix.to/` 也是）；有 `#/` 时带用户名或密码判 `malformed`，否则按旧片段解析。旧前缀换了端口是另一个 origin → `not_ours`。
   - 本构建配置里列出的任意一个 scheme，加 host `open`（大小写不敏感）→ 带用户名、密码或端口判 `malformed`；否则按规范路径解析；路径为空（`<scheme>://open`）判为 `malformed`；host 是别的（`share`、`connectors`、`wallet`）或者没有 host（`zymi:open/…`，少了 `//`）→ `not_ours`。scheme 不区分大小写（`ZYMI://` 就是 `zymi://`）。别的发布线的 scheme（配置项 `other_lanes` 里各线的 `schemes`）→ `other_lane`，带上那条线的名字；不管 host 和路径（`open`、`share`、没有 `//` 的都算）、带不带凭据，和别的发布线的 https host 一样，都不打开。哪条线都没列出的 scheme → `not_ours`，哪怕名字像 `zymi-staging`：解析器只按配置认 scheme，不按命名规则猜。
   - `matrix:` URI（MSC2312）、`zymix://`、`zymixdemo://`（包括旧的 `zymix://unseal/…`）都不读，和别的任何 scheme 一样 → `not_ours`（B1，负责人 11-13）。**iOS 和 Mac 都一样：旧的 `zymix://` 和 `matrix:` 链接一律当成 `not_ours`**，按 §5.2 的规则处理，不当成我们的、也不判 `malformed`。
   - 其他任何情况 → `not_ours`。
3. 路径：允许结尾有**一个**斜杠；**先按字面上的 `/` 切段**，出现空段就判 `malformed`（这样 `//evil` 永远不会变成协议相对地址）。
4. 第一段是 kind，**不解码**，按字面大小写敏感、精确匹配，并且在解码任何 ID **之前**判定：`/bogus/x%zz` 是 `unknown_kind`，`/invite/x%zz` 是 `reserved`，`/%74ask/deck` 是 `unknown_kind`。预留的 kind → `reserved`；不认识的 → `unknown_kind`。
5. 其余每段**只解码一次**（`%252F` 解出来是字面的 `%2F`，不会再解一次）。`%` 后面不是两位十六进制、解码结果不是合法的 UTF-8（包括过长编码 `%C0%AF`）、或者含控制字符（Unicode Cc，包括 C1 的 U+0080–U+009F），都判 `malformed`。解码之后的 `/` 是 ID 的一部分（Matrix 的别名允许含 `/`；v3 房间的事件 ID 用的是标准 base64）。
6. 段数：`u` 后面正好 1 段；`r` 和 `roomid` 后面是 1 段，或者 3 段且中间那段是 `e`；Zymi 对象正好 1 段。不对就判 `malformed`。
   - **L2 提议（E3，待定）：** 页面类 kind `settings` 和 `me` 后面正好 1 段，段的值必须在 §4.4 的固定白名单里，**按字面、大小写敏感、不解码**比较（和 kind 一样）；不在白名单里的判 `unknown_kind`，不判 `malformed`，这样以后加页面时，老版本 App 提示的是“请更新”。返回的形状是 `{kind: settings | me, page}`。
7. 按类型校验，语法见 §4.1 第 8 条：
   - 用户 ID 和别名在**第一个** `:` 处切开：前面是 localpart（不能为空，Matrix 不允许 localpart 里有 `:`），后面是 server name。路径里的 ID 不带 sigil，解码后以自己的 sigil 开头（`/u/%40x:…` 即 `@@x`）判 `malformed`。
   - 房间 ID 里有 `:` 的，按旧写法 `<opaque>:<server>` 处理；没有 `:` 的必须是 v12 写法 `[A-Za-z0-9_-]+`。
   - 事件 ID 是 base64 或 `opaque:server` 两种之一，**不检查服务器**；`.`、`..`、`/../`、`?` 都不符合。
   - Zymi 对象 ID 必须匹配 `[A-Za-z0-9_-]{1,128}`。
8. 服务器名检查（§8.2）：用户 ID、别名、旧房间 ID 的 server 部分，按 ASCII 不区分大小写的方式和本发布线的 `server_name` 比较，连端口一起比；不相等就判 `foreign_server`。相等的，返回的 ID 里 server 是小写。
9. 规范链接的 query 和片段全部忽略，包括 `via`、`action`、`client`、`web-instance[]`。旧写法里的 query 也一样。

旧片段写法：片段必须以 `#/` 开头；去掉 `?` 后面的部分；以 `user/` 开头的（`#/user/@…`，IMKit 的 mention pill 也认这种写法，`MatrixHTML.mentionedUser`）去掉 `user/` 后必须正好是一个 `@` 用户 ID；其余的按 `/` 最多切成 2 段（标识符，可选再跟一个 `$事件`），出现空段就判 `malformed`；每段解码一次，再看 sigil：`@` 是用户，`#` 是别名，`!` 是房间，`+` 是社群 → `unknown_kind`。ID 语法和 §4.1 第 8 条一样（`$..` 判 `malformed`）。

### 4.3 解析结果

| 结果 | 含义 | App 的处理 |
|---|---|---|
| `{link, source}` | 是我们的链接，并且合法 | 路由过去（§5、§8） |
| `{reject: malformed / unknown_kind / reserved / foreign_server}` | 是我们的链接，但不合法 | `malformed`、`foreign_server` 提示“链接无效”；`unknown_kind` 提示“打不开这个链接，可能需要更新 App”（`+group`、`/U/` 这类也走这句）；`reserved` 提示“请更新 App”。**都不交给系统** |
| `{other_lane: <名字>}` | 是我们另一条发布线的链接 | 提示“这是 <名字> 环境的链接”，不打开 |
| `{not_ours: true}` | 不是我们的链接 | 按原来的规则处理，比如交给系统浏览器 |

`link` 的类型叫 **`DeepLink`**（不叫 `Link`：SwiftUI 已经有 `Link` 和 `ShareLink`）。向量里的形状：`{kind: user, user_id}`、`{kind: room, room_id | room_alias, event_id?}`、`{kind: task | goal | agent | artifact | circle, id}`；zymi-core、Swift 和 TypeScript 里房间分成两种：`room {room_id, event_id?}` 和 `roomAlias {room_alias, event_id?}`，不会出现两个都有或都没有的值。`source` 取值有 `canonical`、`scheme`、`matrix_to` 三种，用于统计和排查（`matrix_uri` 和 `zymix` 随 B1 删掉）。

生成的结果是 url，或者错误之一：`invalid_id`（ID 不符合 §4.1）、`foreign_server`（§4.1 第 6 条）、`no_scheme`（这个平台没配 scheme，只有 handoff 会报）。

**配置错误不是结果**：配置通不过 §5.3 的校验时，三个函数都直接抛错（Swift `throws`、TS 抛 `ZymiError`，`invalidRequest`），这是要修的编程错误，不按单条链接处理。对任何输入，函数都返回上面的结果之一，不抛错、不崩溃。

### 4.4 实体一览

| 实体 | 规范链接 | 打开时 |
|---|---|---|
| 用户 | `/u/<localpart>:<server>` | 打开资料页；要发私聊得用户再点一次 |
| 房间、群、空间 | `/roomid/<opaque>[:<server>]`、`/r/<alias>` | 已经加入的直接打开；没加入的先确认（§8.2） |
| 消息（包括线程里的） | `/roomid/<…>/e/<event>`、`/r/<alias>/e/<event>` | 跳到这条消息，在线程里的就打开线程 |
| 任务、目标、智能体、产物、圈子 | `/task/<id>` 等 | 只有对象所属的账号能打开（§8.4；跨账号见 B8） |
| 邀请码、团队 | `/invite/…`、`/team/…` **只预留** | 解析为 `reserved`。`team` 指的是组织团队，**不是**专家目录里的团队（Q-T，待定；默认：专家团队用 `expert` 打开，`/team/` 继续预留） |
| 服务端生成的分享链接（比如音乐帖子） | 不归这套语法管 | 音乐帖子的 `share_url` 只在 `visibility == public` 时才有，是工作区里找到的唯一一种公开对象（zymi-ios `ZymiModel/Music/MusicDiscoveryModels.swift:161, 195-197, 299-307`；只有模型，没有界面在用）。它用哪个域名、落地页由谁出：Q-M，待定。默认：不用链接域名，由服务端自己的页面出；**如果**用链接域名，就要在 AASA 里给它的路径一个 kind，或者明确排除 |

**L2 盘点（11-13）。** 盘点的依据是 zymi-ios `feat/zymi-chat-session` 和 zim `main`（zymi-ios 只读）。下表列出现有实体之外、iOS 或 Mac 上有、规格还没有的页面，以及现有实体里和代码对不上的地方。**下表的新 kind 都是提议，待定**；定下来之前照 §4.1 第 2 条处理。

| 页面 | 现状（iOS / Mac） | 提议的链接 | 打开时 |
|---|---|---|---|
| 智能体：主智能体 vs 专家目录条目 | iOS 有两个路由：`ZAgentRoute.agent`（**不带 id**）和 `.expert(UUID)`；zim 收到 `/agent/<目录 id>` 时只打开专家**列表**（`LinkRouter.swift:372-383`） | `/agent/<id>` 只表示本账号的主智能体；新增 `/expert/<id>`，表示目录条目（Q-A） | `agent`：不是本账号的主智能体 → “打不开”。`expert`：本账号的目录里有它就打开**条目**，没有就“打不开”（目录在服务端是不是全局一样：未知） |
| 圈子 | core 里没有圈子 id：每个账号只有一份 feed，只有条目和想法带 id（zymi-services `circles/mod.rs:61-62, 160-161`）；zim 不读 id，只打开圈子页（`LinkRouter.swift:393-396`） | `/circle/<feed 条目 id>`（Q-C） | 打开圈子页，滚到这条；条目过期了或者不是本账号的 → 打开圈子页，再提示“打不开这个链接” |
| Zymi Space 应用 | iOS 有 Space 页签，应用有 `id`、`workspaceId`（`ZymiModel/ZAgentSpaceModels.swift:3-12`），没有分享，也没有公开地址；zim 还没有 Space 界面 | `/space/<workspaceId>`（Q-S） | 只限所属账号 |
| 设置页（E3） | iOS `ZAgentSettingsRoute` 有 9 个（`Settings/ZAgentSettingsComponents.swift:42-44`）；zim `ZymiSettingsPage`（`UI/Settings/ZymiSettingsWindow.swift:6-7`），没有 `computers` 和 `savedBrowser` | `/settings/<page>`，page 的白名单：`wallet`、`connectors`、`computers`、`credentials`、`savedBrowser`、`channels`、`notifications`、`location`、`appearance` | 永远打开**当前账号自己的**页面，不涉及所有权。本平台没有的页面 → 打开设置首页，再提示“这台设备上没有这个页面”（不算链接无效）。**不能**写成 `<scheme>://wallet` 或 `<scheme>://connectors`：这两个 host 是 OAuth 回调（§5.3） |
| 智能体的子页面（E3） | iOS：活动记录嵌在任务里（`Tasks/Activity/*`）；zim：`ZymiAgentPage` 有 `activity`、`scheduled`、`memory`（`UI/Agent/ZymiAgentPagesView.swift:6-7`） | `/me/<page>`，page 的白名单：`activity`、`scheduled`、`memory`（用 `me`，不和 `/agent/<id>` 混在一起；Q-A 一起定） | 当前账号自己的页面 |
| Shop 结账 | iOS `ZAgentShopCheckoutView`；zim `ZymiRoute.checkout`。结账单挂在会话的 checkout id 上（zymi-services `docs/live.md:83`、`docs/cards.md:84`） | **不做链接**：它会触发付款，要从对话里进去 | — |
| 头像工作室的结果 | 两端都没有分享 | 不做链接；如果结果存成了产物，就用 `/artifact` | — |
| 带令牌或秘密的东西：电脑接入的安装说明（带一次性 ticket，iOS `ZAgentCodexSetupView.swift:71-89`）、Vault 配对码（iOS `ZAgentVaultIdentityViews.swift:93-99`） | iOS 用文本分享 | **永远不做链接**（§8.3） | — |

**分享入口的现状**（L2 盘点）：iOS 上非聊天的“分享”发的都是**内容**，不是页面链接：消息发正文（`ZAgentMessageActionsModel.swift:25-26`），产物发本地文件（`ZAgentArtifactPreviewSheet.swift:107-111`），专家发“名字 + 简介”纯文本（`ZAgentExpertProfileView.swift:84`），卡片的 `*.share` 动作发卡片里的 text、url 或 file（`AIProductCardClientActionResolver.swift:226-227, 337-356`）。zim 上 Zymi 页面都没有分享入口（作品页的“分享”按钮只在 fixture 里出现，结果页的“分享”没接动作）。两端的聊天都生成 matrix.to 链接。要加的入口见 §9.4 的 Z5 和 §9.5 的 S5。

### 4.5 测试向量 `fixtures/links/vectors.json`（L1）

- 共 122 条：生成 17 条，解析 105 条。解析的 105 条里，规范写法和 scheme 写法（`p-`）30 条，应当拒绝、判为“不是我们的”或别的发布线的（`x-`）59 条，旧写法（`l-`，只剩 matrix.to）7 条，旧写法里应当拒绝的（`lx-`）9 条。每条都附一句说明。
- 第一版 75 条；C1 安全评审第二轮补了 37 条（把 C1 实现时自己定的规则写回本规格和向量，再加上 ID 语法收紧、长度上限、凭据、`#/user/` 写法），见 §12 第二轮。
- 用了三份**测试用的、按构建划分**的配置，不代表真实部署：`prod`（iOS 和 macOS 的 scheme 是 `zymi`）；`dev`（`server_name` 假定和 prod 一样是 `zymi.app`，未确认，见评审 U6；iOS 和 macOS 的 scheme 都是 `zymi-dev`）；`local`（zim Debug 连本地 E2E 栈，`localhost:8448`，`zymi-debug`）。scheme 按 §5.3 的表。解析器接受配置里列出的每一个 scheme。
- 覆盖到的情况：
  - v12 和旧写法两种房间 ID；带端口的 server name（含端口不一致）；非默认端口；`<scheme>://open` 空路径；别的构建的 scheme；标准 base64 的事件 ID；UTF-8 别名；含 `/` 的别名。
  - 编码过的 `:`；点段和 `%2e%2e`；反斜杠；空段；大写的 kind；结尾斜杠；host 的大小写和默认端口。
  - 跨发布线的链接；凭据；`http`；`share` 和 `connectors` 这两个 host；`#//evil.example/`；陌生 host 上的旧片段；`web-instance` 和 `client` 两个参数。
  - 第二轮：kind 先于解码、kind 段不解码；只解码一次；C1 控制字符和非法 UTF-8；重复 sigil、bidi 控制符、房间 opaque 里的 `/`、事件 ID 的 `/../` 和 `..`；server 名转小写；形近字 host 和 `host@evil`；别的发布线的首页和凭据；超长输入（我们的、别人的、自家首页）；scheme 写法和旧写法上的凭据、端口、空段；`#/user/@…`。（这一轮的 `matrix:` 和 `zymix://unseal` 向量在第四轮删掉。）
  - 第三轮（scheme 改成 zymi 家族）：所有 scheme 向量换成 `zymi`、`zymi-dev`、`zymi-debug`，prod 有了 handoff；新增 `ZYMI://` 大小写、`zymi:open/…`（没有 `//`）、退役的 `zim://open/…`、另一个产品的 `zymix://open/…`；别的发布线的 scheme 判 `other_lane`（`open`、`share`、大小写），没有哪条线列出的 `zymi-staging` 判 `not_ours`。
  - 第四轮（只做 Zymi，B1）：删掉旧落地页、`zymix://unseal/…` 和 `matrix:` URI 的 11 条；它们现在都是 `not_ours`（`x-to-share-retired`、`x-zymix-unseal`、`x-matrix-uri`，`x-zymix-open` 照旧）；zymi 写法补齐用户、房间 ID、别名和消息：别名加消息（`b-alias-event`、`p-alias-event`、`p-scheme-alias-event`），dev 和 debug 线的 `r` 和 `e`（`p-scheme-dev-*`、`p-scheme-debug-*`）。见 §12 第四轮。
- 每个实现的测试都要做两件事：跑完全部向量；把每条生成出来的 url 和 handoff 再解析一遍，结果必须和原来的 link 相同（来回）。
- **现在的参考实现是 zymi-core**（`crates/zymi-core/src/links.rs`，`cargo test -p zymi-core --test links` 跑全部向量、来回和随机输入）；下面这份 node 参考实现只对过最初的 75 条，没有跟着第二轮更新。落地页的 JS 实现以向量为准，向量没写到的情况以本节和 zymi-core 为准。
- 写第一稿时，我在 scratchpad 里用 node 的 WHATWG `URL` 写了一份参考实现（`/private/tmp/claude-501/-Users-jelf-Projects-work-zim/4c7627bd-ec56-49a6-b260-6b8f3ad252d6/scratchpad/links-ref.mjs`，运行 `node links-ref.mjs <vectors.json>`），75 条全部通过。我故意改错其中两条，检查确实失败了。这份参考实现**不提交**，只用来证明向量本身前后一致；scratchpad 会被清理，C1 的测试才是长期的证明。
- **改向量要先改这一份，再同步到 zymi-services**（C1）。
- **L2 要补的向量（第 (2) 步，先在 core 里看红再改绿；这一步不改 `vectors.json`）。** 现有的 Zymi 对象里，https 和 scheme 两种写法只有 task 和 agent 有样例；artifact 只有生成向量 `b-artifact`，没有解析向量；goal 和 circle 两种都没有。要加的是 8 条：解析向量 `p-goal`、`p-goal-scheme`、`p-artifact`、`p-artifact-scheme`、`p-circle`、`p-circle-scheme`，生成向量 `b-goal`、`b-circle`。都用 dev 线：https 写法是 `https://to-dev.zymi.app/<kind>/<id>`，scheme 写法是 `zymi-dev://open/<kind>/<id>`。新 id 已经和 L1 之后的 122 条核对过，没有重复。§4.4 提议的新 kind（`expert`、`space`、`settings`、`me`）等 Q-A、Q-S 和 E3 定下来再补向量。

### 4.6 App 打开期望（`open` 一节，L2）

`link_parse` 和 `link_build` 不知道账号是谁，所以“别的账号的对象”和“没登录”**写不成解析向量**。这两种情况写在这一节，作为 zim 和 zymi-ios 的 **E2E 期望**，不由 core 跑。将来放进 `vectors.json` 的话，单独成一节 `open`，形状如下：

```json
{"id": "o-goal-https-other-account", "lane": "dev",
 "given": {"signed_in": true, "object_owner": "other_account"},
 "input": "https://to-dev.zymi.app/goal/g_other",
 "expect": {"parse": {"link": {"kind": "goal", "id": "g_other"}, "source": "canonical"},
            "app": {"notice": "cannot_open"}}}
```

- `given.signed_in` 是 `false` 时，`expect.app` 写成 `{"held": true, "after_sign_in": {"owner": {"opens": <页面>}, "other_account": {"notice": "cannot_open"}}, "expired": {"dropped": true}}`。
- E2E 里把 lane 换成 `local`：host 用 `to-local.zymi.test`，scheme 用 `zymi-debug`。
- 下表是全部 20 条：5 个实体，每个实体有 https 和 scheme 两种写法，每种写法有“别的账号”和“没登录”两种情况。两种写法的期望相同。

| 实体 | 输入（https / scheme） | 别的账号的对象 | 没登录 |
|---|---|---|---|
| task | `https://to-dev.zymi.app/task/t_other` / `zymi-dev://open/task/t_other` | `cannot_open`（403 和 404 显示同一句，§8.4），不切换账号 | 先存着（§8.4）；以所属账号登录后打开任务；以别的账号登录 → `cannot_open`；存得太久 → 丢掉 |
| goal | `…/goal/g_other` | `cannot_open` | 同上，打开的是目标页并选中这个目标 |
| agent | `…/agent/ag_other` | `cannot_open`：不是本账号的主智能体，本账号的目录里也没有它（Q-A 定了以后，目录条目改走 `expert`） | 同上，打开的是智能体资料 |
| artifact | `…/artifact/a_other` | `cannot_open` | 同上，打开的是作品页并选中这个作品 |
| circle | `…/circle/c_other` | **待定（Q-C）**：现在 core 没有圈子 id；按 Q-C 的默认值，打开圈子页并提示“打不开这个链接” | 同上，打开的是圈子页（zim 现在不读 id） |

---

## 5. 单一来源、路由与配置

### 5.1 谁来实现

1. **zymi-core 新增 `links` 模块。** 对外是不依赖 Client 或 Session 的自由函数：`link_parse(url, lane_config)`、`link_build(link, lane_config)`、`link_handoff(link, lane_config, platform)`，登录前也能调用。通过 zymi-ffi 导出给 Swift，以后也导出给 Kotlin 和 C#；通过 zymi-wasm 导出给 Web 和 Electron。
   - 分支：在 zymi-services 从 main 开 `feat/links` 分支。zim 现在指向 `zymi-services-wt/timeline`，所以 links 要么等 timeline 合进 main、zim 改回指向 main，要么同时合进 timeline 分支。由协调者决定，不阻塞 C1。
2. **IMKit 新增两个注入点：** `ChatLinkBuilder` 负责生成链接，`ChatLinkOpener` 负责打开链接；`MatrixShareLinks` 保留，变成 `ChatLinkBuilder` 的一个内置实现。IMKit 里所有“交给系统打开”的地方都先调 `ChatLinkOpener`，宿主没处理的再按原规则交给系统。**IMKit 不认识这套语法**（原来的 I3 已删除，见 §12）。
3. **落地页用 JS 自己实现**，运行在边缘函数和浏览器两端，跑同一份向量。

### 5.2 每个 App 只有一个 `LinkRouter`

- `LinkRouter.open(url, origin)` 的流程：调 `link_parse`，然后路由到聊天、Zymi 页面或提示。结果是 `not_ours` 时，要看 URL 是从哪来的：
  - **系统送进来的**（`onOpenURL`、`onContinueUserActivity`）：交回原来的处理逻辑（比如 `<scheme>://share?inbox=` 交给 ShareInbox；OAuth 回调只认 `ASWebAuthenticationSession`），没有对应的处理逻辑就丢掉。**绝不交回给系统**，否则 `zymi-dev://share` 这类链接会被系统送回 App 本身，形成循环。
  - **App 内点到的**：按原来的过滤规则（只放行 http 和 https，不能带凭据）交给系统。例外是核心卡片的动作按钮，它另外放行 `mailto:`、`tel:`、`sms:`、`maps:`（B7，待负责人确认）。不放行的不交给系统，提示用户。
- 系统送来的 URL 和用户在 App 内点到的 URL 都只走这一个入口：
  - 系统送来的：`.onOpenURL` 和 `onContinueUserActivity`；
  - App 内点到的：IMKit 的 `ChatLinkOpener`，以及 App 自己所有打开 http(s) 的地方。
- zim 里要改的调用点就是 §2.3 列出的 15 处，以及 IMChatMac 的两处（`Message.swift:372`，以及经 `NativeMessageCell.swift:1061-1066` 走到的 `NativeDebugMouse.open`）。zymi-ios 的调用点在 S3 里盘点。
- 加一条检查：`rg 'NSWorkspace\.shared\.open\(|UIApplication\.shared\.open\(|openURL\('`，命中的地方只允许出现在 `LinkRouter` 和打开本地文件的代码里。
- **用解析出来的 ID 拼路径前必须编码。** `link_parse` 返回的是 ID，不是 URL；ID 合法也可能含 `/`（v3 事件 ID 的 base64、别名）、`+`、`=`、非 ASCII。拿它去拼客户端-服务器 API 的路径（`/rooms/{roomId}/event/{eventId}`）、Web 路由或文件名时，每个 ID 都要作为**一个路径段**做百分号编码（Swift 用只含 unreserved 字符的 `allowedCharacters`，JS 用 `encodeURIComponent`），不能直接插进字符串。
- 调试开关打开时，`LinkRouter` 打日志 `link-route <kind>` 或 `link-system <url>`，E2E 用这些日志判定结果（沿用 `NativeDebugMouse` 打 `debug-open` 日志的做法）。

### 5.3 发布线配置

配置**按构建**给出，不是按发布线共用一份；解析器接受配置里列出的每一个 scheme。zim Debug 和 Release 的配置不同（B4）。

```
lane = {
  name, hosts: [...], server_name,                 // hosts[0] 用来生成；host 可以写成 host:port
  schemes: { ios?, macos?, android?, windows? },   // 生成 handoff 用；解析时接受这里列出的每一个
  legacy: { fragment_bases: ["https://matrix.to/"] },
  other_lanes: [{ name, hosts: [...], schemes: [...] }]   // schemes 可省略（默认空），省略时那条线的 scheme 链接判 not_ours
}
```

- **列表都是必填**，没有默认值：少传一个 `legacy`，所有 `matrix.to` 写法的 mention pill 都会判成 `not_ours` 交给系统浏览器，而且没有任何报错。`legacy` 由 zymi-core 统一提供（`link_legacy_standard()`：只有 `https://matrix.to/`），各端直接取用，不自己抄一份。TS 端的配置对象多了 `.d.ts` 里没有的字段也抛错。
- **配置校验**：每个函数先校验配置，通不过就抛错（§4.3）：
  - `hosts` 不能为空；每个 host 必须是 WHATWG URL 序列化后的写法（小写、punycode、不带默认端口、不带路径和凭据）；同一个 host 不能出现两次，也不能同时属于两条发布线。
  - 别的发布线名字不能为空、不能重复；别的发布线的 scheme 和平台 scheme 的要求一样，不能是本构建的 scheme，也不能同时属于两条线。
  - `server_name` 是小写的合法 server name。
  - 平台 scheme 是 `[a-z][a-z0-9+.-]*`，不能是 `http`、`https`、`matrix`、`javascript`、`data`、`file`、`blob`、`about`、`ws`、`wss`、`ftp`。
  - 旧前缀是序列化后的 `https` URL（带路径，不带凭据、query 和片段），不能在任何发布线的 host 上。

- **scheme 表（负责人已定，11-13，B3s）。** 规则：产品的 scheme 是 `zymi`，非 prod 的发布线加 `-<发布线名>`，Debug 构建（连本地栈，发布线 `local`）用 `zymi-debug`。同一台设备上装多条线时各认各的，不会抢。每个构建**只注册自己那一个**，`schemes` 里每个平台填同一个值。这张表就是各端配置里的一行，代码里不写死 scheme：

  | 发布线 | iOS | macOS | Android | Windows | 现状 |
  |---|---|---|---|---|---|
  | prod | `zymi` | `zymi` | `zymi` | `zymi` | 还没有 prod 构建（Bundle ID 等仍等 B3） |
  | dev | `zymi-dev` | `zymi-dev` | `zymi-dev` | `zymi-dev` | zymi-ios dev 的 `callback_scheme` 已经是 `zymi-dev`（`Configurations/Local/dev.json`，不提交）；zim Release 连 dev 网关，从 `zim` 改成它 |
  | testing | `zymi-testing` | `zymi-testing` | `zymi-testing` | `zymi-testing` | zymi-ios 有 testing 线，`callback_scheme` 还没配 |
  | local（Debug） | — | `zymi-debug` | — | — | zim Debug，从 `zim-debug` 改成它；只给 E2E 用 |

  Android 和 Windows 两列等 B1，接入时照这张表取名。`zymix`、`zymixdemo`、`siuper` 是 ZYMIX 的，`unseal` 是 Unseal 的，都不是本产品的 scheme，也不作为旧写法读：一律 `not_ours`（B1）。
- **一个 scheme，按 host 分用途。** iOS 的 OAuth 回调和深链**共用**这一个 scheme（zymi-ios 的 `callback_scheme` 就是它），macOS 也一样。host 各管各的，互不冲突：

  | host | 用途 | 谁处理 | 依据 |
  |---|---|---|---|
  | `open` | 深链交接：`<scheme>://open/<路径>`，路径同 https 规范链接 | `LinkRouter` → `link_parse` | 本规格 §4 |
  | `share` | 分享扩展交给 App：`<scheme>://share?inbox=<uuid>`（macOS） | ShareInbox，`link_parse` 判 `not_ours` | zim `Shared/ShareInbox.swift` |
  | `connectors` | 连接器 OAuth 回调：`<scheme>://connectors?link_id=…` | 只从 `ASWebAuthenticationSession` 收，`.onOpenURL` 收到的一律不处理 | zymi-ios `ZAgentAppCallbacks.Route`（`ZymiModel/ZAgentAppCallbacks.swift:5`），`docs/extraction/callback-contract.md:10-12`；zymi-core `settings` 规则 16 |
  | `wallet` | 商店钱包回调：`<scheme>://wallet?…` | 同上 | 同上 |

  zymi-ios 现有的回调只有 `connectors` 和 `wallet` 两个 host，路径必须为空或 `/`（`ZAgentAppCallbacks.matches`），和 `open`、`share` 不冲突。以后再加 host 时要先查这张表。OAuth 回调的 scheme 也按这张表取：服务端的 `ZYMI_CONNECTOR_ALLOWED_REDIRECTS` 和 `ZYMI_SHOP_APP_CALLBACK_URI` 按环境登记 `<scheme>://connectors`、`<scheme>://wallet`。zim 现在把回调 scheme 写死在代码里（`Sources/Onboarding/OnboardingModel.swift:50-56`：Debug `zymi-dev`，Release `zymi`），和这张表不一致，要改成取本构建的 scheme（Release `zymi-dev`，Debug `zymi-debug`），同时登记到对应环境的服务端白名单里。
- iPad 上的 Safari 默认用桌面 UA，和 Mac 分不出来。落地页分不清平台时，同时显示 iOS 和 macOS 两个按钮。

---

## 6. 各平台的接法

### 6.1 iOS（zymi-ios）

- **前提：zymi-ios 先接入 ZymiCore（S0）。**
- **Universal links：** 在每条发布线的环境配置里写 `associated_domains`。S1 里同时**放宽** `environment.py:123` 的正则，允许 `?mode=developer` 后缀，并相应调整 `signing.py:29-30` 的比对。
- **AASA**（`application/json`，返回 200，不能重定向；预留的路径一次写全，因为 Apple 的 CDN 会缓存）：

```json
{"applinks":{"details":[{"appIDs":["<B3>"],"components":[
  {"/":"/u/*"},{"/":"/r/*"},{"/":"/roomid/*"},{"/":"/task/*"},{"/":"/goal/*"},
  {"/":"/agent/*"},{"/":"/artifact/*"},{"/":"/circle/*"},{"/":"/invite/*"},{"/":"/team/*"}]}]}}
```

- **L2（E7）：** §4.4 提议的 kind 定下来以后，在**第一次上线 AASA 之前**，把 `{"/":"/expert/*"}`、`{"/":"/space/*"}`、`{"/":"/settings/*"}`、`{"/":"/me/*"}` 一次全部加进去（Q-M 如果决定音乐帖子用链接域名，也把它的路径一起加上）。规则：每加一个 kind，AASA、§6.3 的 `pathPrefix` 和落地页的类型名要在同一次改动里一起加。AASA 只列我们的路径（正面清单），首页和其它路径不列。

- **scheme：** 用本发布线的 `callback_scheme`（§5.3 的表：`zymi`、`zymi-dev`、`zymi-testing`），host 是 `open`。**根上的 `.onOpenURL` 只认 host `open`**。外面送进来的 `<scheme>://connectors` 和 `<scheme>://wallet` 一律什么都不做，绝不能当成 OAuth 完成回调；OAuth 回调仍然只从 `ASWebAuthenticationSession` 进来。
- **入口：** `.onOpenURL` 和 `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` 都交给 `LinkRouter`。登录前收到的链接先存起来，登录后再打开。

### 6.2 macOS（zim）

- **发布线（B4）：** 现在只有 dev。Release 注册 `zymi-dev`，Debug 注册 `zymi-debug`，分享扩展用本构建的那一个交接（`zymi-dev://share`、`zymi-debug://share`）。`zim` 和 `zim-debug` 退役，不再注册，也不进旧写法（§12 第三轮）。以后出 prod 构建时用 `zymi`，要单独的 Bundle ID（B3）。
- **Universal links：** entitlements 里加 `applinks:<host>`（host 来自 B2，appID 来自 B3）。**待在签名构建上确认（Z4）**：macOS 上一般只有 Safari 会走 universal links，所以落地页一定要有“在 ZIM 中打开”按钮；能不能用 Developer ID 分发，取决于描述文件，并入 B3 一起问。
- **入口：** 已经接好：`.onOpenURL` 和 `.onContinueUserActivity` 都先交给 `LinkRouter`（`ZIMApp.swift:226-229, 253-255`，L2 核对）。UL 只差 entitlements（Z4）。
- **生成：** 每个构建都按发布线注入 `ChatLinkBuilder`；Debug 可以用环境变量 `ZIM_E2E_SHARE_LINKS=matrixto` 关掉注入，给 E2E 当对照组用。

### 6.3 Android（B1 挂起，以下是将来的做法）

- 每条发布线一个 `applicationId`（参照 unseal-android 的 `applicationIdSuffix`）；host 用 `manifestPlaceholders` 填。**不要**像 ZYMIX 那样把所有发布线的 host 都塞进同一个包。
- 用 `autoVerify` 的 App Links，按 `pathPrefix` 列出 §6.1 那些路径；另加 `<scheme>://open` 的 intent-filter。
- `assetlinks.json` 里同时列出 Play 应用签名证书和内部构建证书的 SHA-256。
- 平台代码不用 `Uri` 自己解析，全部交给 zymi-core（§4.2 第 1 条）。

### 6.4 Windows（B1 挂起）

- **如果用 Unseal Electron 做基础：** 单实例锁和 `second-instance` / `open-url` 的转发已经有了（`main.js:243-262`）。还要做三件事：注册分享链接用的 scheme（现在注册的 `unseal` 是给 OIDC 回调用的）；在 `dispatchProtocolCallback` 之前按 host 分流；交给 zymi-wasm 的 `link_parse`。
- **如果用原生 C#：** 注册表或 MSIX 的 `windows.protocol`；打包成 MSIX 的话，再加 `uap3:AppUriHandler` 和 `/.well-known/windows-app-web-link`。
- 主要靠落地页上的“在 App 中打开”按钮。**现在给不出 E2E。**

### 6.5 落地页（B5：边缘函数托管）

- **边缘函数：**
  - 凡是规范路径前缀下的请求，都由函数用同一个 JS 解析器判断：合法的返回 200 加页面；`reject` 的返回 **404** 加同一个页面（显示“链接无效”状态）；`other_lane` 的返回 200 加提示。
  - `/.well-known/*` 由配置生成，Content-Type 是 `application/json`，返回 200，不能重定向。
  - 其余路径一律回退到首页（SPA 回退）。
  - **托管必须把原始路径交给函数，不能先解码**，这样 `%2F` 才能保留下来（P3 有专门的检查）。
- **浏览器里：** 旧链接的片段不会发到服务端，只能由页面脚本解析，再用 `location.replace` 换到规范链接；只能用解析结果重新拼地址（向量 `lx-protocol-relative` 证明了这一点）。
- **页面内容：**
  - 品牌标题，加一句“这是一个 ZYMI 的 <类型> 链接”，不显示任何实体详情（§8.3）。
  - **类型名（L2，E8）：** 每个 kind 都要有：用户、房间、消息、任务、目标、智能体、作品、圈子，以及 §4.4 提议的专家、Space 应用、设置页和“我的”子页面（设置页和子页面显示页面名，例如“钱包”）。
  - **Zymi 对象的提示（L2，E8）：** 加一句“只有创建它的账号能打开”，免得别人点开以为链接坏了（B8 读法一）。没登录的访客也看这一页，并多一句“登录后会自动打开”（App 先存着，§8.4）。
  - “在 App 中打开”按钮。**macOS 上必须有**：只有 Safari 会把 universal link 交给 App，Chrome 等浏览器只能靠这个按钮（§6.2）。
  - 按平台显示下载入口，商店 ID 见 Q9。
  - 一句提示：“如果 App 没反应，请更新到最新版本”。老版本 App 虽然注册了 scheme，却不会处理这类链接。
  - Smart App Banner（`apple-itunes-app` 加 `app-argument`），需要 B3 提供 App ID。
- **响应头：** CSP 设为 `script-src 'self'`，`connect-src 'none'`，`frame-ancestors 'none'`；加 HSTS 和 `Referrer-Policy: no-referrer`。
- **待在真机上确认（U4、U5）：** 同一个域名内的跳转和 `location.replace` 不会触发 UL；微信等内置浏览器会拦截 scheme。如果确认属实，要加“在浏览器中打开”的引导。

---

## 7. 旧链接怎么办

| 旧链接 | 在 App 里点到 | 系统级打开 | 在浏览器里打开 |
|---|---|---|---|
| `https://matrix.to/#/…` | `LinkRouter` 认 | 我们没法声明这个域名的归属 | 由 matrix.org 的页面处理，我们管不了 |
| 已经发出去的 pill（matrix.to 写法） | 继续能用 | — | — |

只有 matrix.to 一种旧写法。旧落地页 `https://dev.unseal.chat/AgentMessenger/to-share/#/…`、ZYMIX 的 `zymix://unseal/…`、`zymixdemo://unseal/…` 和 `matrix:` URI 不再读（B1）：iOS 和 Mac 都当成 `not_ours`，按 §5.2 的规则处理（App 内点到的，非 http(s) 不交给系统；系统送进来的，交回原来的处理逻辑或丢掉）。

**推出顺序：**
1. 先上线解析器和 `LinkRouter`：C1、C2、I1a、I2、Z1、Z3、S0、S1、S3。
2. 再上线落地页和 `.well-known`：P1–P3。
3. 然后验证 UL：Z4、S4。
4. 最后才开始生成新链接：Z2、S2。

---

## 8. 安全

### 8.1 开放重定向

- 落地页只会跳到三类地址：用解析结果重新拼出来的地址、写死的商店地址、本 host 下的规范路径。
- `client` 和 `web-instance` 两个参数一律忽略。
- 旧片段只在白名单里的前缀上才解析（向量 `lx-unknown-base`）。

### 8.2 冒充和劫持

- **scheme 谁都能注册。** scheme 链接里不放令牌；加入房间、发起私聊、接受邀请这类会改状态的动作，都要先在 App 内确认。确认页显示的是登录后从自家服务器取来的房间名和成员数，而不是消息里的链接文字。
- **服务器名检查只用在用户 ID、别名和 v12 之前的房间 ID 上**（不开联邦；B1 定了只做 Zymi）。v12 的房间 ID 和房间 v3 起的事件 ID 都没有服务器部分（v1、v2 的 `$opaque:server` 有，但不检查）：规范链接和 scheme 链接里的，归 host 或 scheme 所在的发布线；旧链接里的，按当前发布线去打开，自家服务器说找不到就显示“打不开”。`via` 一律不参与解析。
- **用独立的域名。** 不能和 ZYMIX 共用（理由见 §3）。

### 8.3 没登录的访客能看到什么

- 只能看到实体类型。落地页不请求任何 homeserver 或网关，由 CSP 强制保证。
- 链接里**不放会话令牌或认证令牌**。邀请码、分享令牌这类能力型令牌，等将来有了后端再单独设计，**而且永远不经 scheme 转交**。v1 只预留 `/invite/` 路径。
- 服务器日志里会出现路径上的 ID，这是放弃片段的代价，可以接受。
- **L2（E8）：** 对所有 kind，访客看到的都只有类型，以及页面类 kind 的页面名，见 §6.5。公开对象（比如音乐帖子）要给访客看内容的话，是另一种页面，要等 B8 读法二或 Q-M 定下来再设计，不放进这个落地页。

### 8.4 打开时的规则

- Zymi 对象：网关返回 403 和 404 时，都显示同一句“打不开这个链接”。
- Matrix 可选模式下，聊天链接显示“需要先开启聊天”。
- 多账号时用当前账号打开，不自动切换账号。
- **L2（E9）：**
  - 登录前收到的链接先存着，最多存 10 分钟（Q-H，待定；默认值照 zim `LinkRouter.waits = 600`），退出登录或者换账号就清掉；存的时候又来了一条新链接，就换成新的那条。
  - 登录后，如果登录的不是对象所属的账号 → “打不开这个链接”（`cannot_open`）。
  - 页面类 kind（`settings`、`me`）永远打开当前账号自己的页面。
  - 具体期望见 §4.6。

---

## 9. 改动清单

证明方式优先用 E2E，每项都要留下可以重复跑的产物（`summary.json` 加截图）。对照组一律用“变异对照”：故意把某一条规则写错，对应的检查必须失败。

### 9.0 前置

| ID | 任务 | 状态和证明 |
|---|---|---|
| L0 | 负责人确认或推翻 B2–B5、B7（B1 已定） | 规格头部的默认假设一节随之更新 |
| L1 | `fixtures/links/vectors.json` | **已完成（本稿）**：75 条，参考实现全部通过，变异对照失败 |
| L2 | 全页面的链接：盘点和规格（本稿 §4.4 的 L2 盘点、§4.6、B8、§11 的 Q-A 到 Q-H） | 第 (1) 步规格已写；第 (2) 步补 §4.5 列出的向量，在 core 里先看红再改绿，同时同步 zymi-services `fixtures/links/`；新 kind 等 Q-A、Q-S、E3 定下来再做 |

### 9.1 zymi-services（分支 `feat/links`）

| ID | 任务 | 怎么证明 |
|---|---|---|
| C1 | `links` 模块，实现 §4.1 和 §4.2，做成自由函数；把向量拷到 `fixtures/links/vectors.json`，再加一个脚本，检查这份拷贝和本仓库的那份逐字节一致 | `cargo test` 跑完全部向量和来回测试。变异对照：拿掉白名单校验，`x-zymi-encoded-slash` 必须失败 |
| C2 | 通过 zymi-ffi 和 zymi-wasm 导出，`check-surface.sh` 通过 | 经过 ZymiCore 的 Swift 测试和 wasm 测试跑同一份向量 |

### 9.2 落地页（本仓库）

| ID | 任务 | 怎么证明 |
|---|---|---|
| P1 | 用精简的新页面加边缘函数替换现有页面（§6.5），保留 Apache-2.0 的版权声明 | 用 Playwright 加本地的边缘函数运行环境，跑每一条向量 URL：状态码对、显示的类型对、“打开”按钮的 href 等于各平台 UA 下期望的 handoff；除了同源的静态文件，没有任何别的请求。变异对照：把解析器改成接受空段，`lx-protocol-relative` 必须失败。产物放在 `artifacts/landing/<ts>/` |
| P2 | 按发布线生成 `.well-known`（**被 B3 阻塞**） | 本地检查格式；上线后检查 200、`application/json`、没有重定向；用 Apple CDN 的接口和 Google 的 `statements:list` 接口查到 |
| P3 | 部署和响应头（被 B2、B5 阻塞） | 用 `curl` 存下响应头；检查 `/task/a%2Fb` 返回 404，并且确实到了函数里，没被托管先拦掉；`/r/a%2Fb:zymi.app` 返回 200 |

### 9.3 im（IMKit）

| ID | 任务 | 怎么证明 |
|---|---|---|
| I1a | 加 `ChatLinkBuilder` 和 `ChatLinkOpener` 两个注入点；`MatrixShareLinks` 作为内置实现，**默认行为完全不变**；`SpaceHome.swift:342-344` 改成走 builder | ZYMIX 不用改代码；zim 的 `MessageShareTests` 和 `SpaceSettingsTests` 在不注入的对照下行为照旧 |
| I2 | IMKit 里所有交给系统的地方都先调 `ChatLinkOpener`：iOS 的 `MessageRowView`、`HostMessageHooks`、`RoomInfoView`；Mac 的 `Message.swift` 和 `NativeMessageCell` | 不单独测，由 Z3 和 S3 证明（理由见 §12） |

### 9.4 zim

| ID | 任务 | 怎么证明（XCUITest，用 `scripts/e2e.sh -only-testing:ZIMUITests/DeepLinkTests/...`） |
|---|---|---|
| Z1 | Debug 注册 `zymi-debug`（Release `zymi-dev`）；`.onOpenURL` 加 `open` 分支，交给 `LinkRouter` | 用 `XCUIApplication().open(url)` 打开链接（**这个 API 在 macOS 上能不能用待确认**；不能用就退回 `NSWorkspace.open(_:withApplicationAt:configuration:)`，指定被测的那份 App）。打开 `zymi-debug://open/roomid/<种子 v12 房间>`，中栏显示这个房间；`…/e/<事件>` 跳到消息并高亮；`/task/<id>` 进到任务页；没加入的房间先出确认页；`zymi-debug://open/../x` 显示“打不开这个链接，可能需要更新 App”（`unknown_kind`）；`/u/x:evil.example` 显示“链接无效”。对照：`ShareTests` 照常通过 |
| Z2 | 正式构建注入 `ChatLinkBuilder`，同时改掉断言 matrix.to 的那几个测试（`MentionTests.swift:62` 不用改） | 复制出来的房间链接和消息链接等于 `build` 向量的格式；把复制出来的链接再用 Z1 的方式打开，能回到原处。对照：设 `ZIM_E2E_SHARE_LINKS=matrixto` 时，链接是 matrix.to |
| Z3 | `LinkRouter` 接管 §2.3 列出的 15 处和 IMChatMac 的两处 | 打开调试开关，bob 发一条 `https://<dev host>/task/<id>`，alice 点了以后，日志里出现 `link-route task`，**没有** `debug-open` 或 `link-system`；`https://example.com` 出现 `link-system`。zim 的 `rg` 检查（§5.2）通过 |
| Z4 | entitlements 加 associated domains（`.onContinueUserActivity` 已经接好，见 §6.2；被 B2、B3 阻塞） | 只能在 staging 环境的签名构建上验证，本地跑不了 |
| Z5 | （L2）Zymi 页面加“拷贝链接”和“分享…”：任务、目标、智能体资料、作品，定下来以后再加专家、Space 和设置页。都调 `LinkRouter.shareURL(for:)`，它现在没有调用方。聊天链接仍然走 Z2 | 拷贝出来的链接等于 `build` 向量的格式；用 Z1 的方式再打开一遍，能回到原处；按 §4.6 换成 bob 的账号打开，显示“打不开这个链接” |
| Z6 | （L2，等 Q-A）`/expert/<id>` 打开目录**条目**本身，不是专家列表（现在是 `LinkRouter.swift:378-381`）；`/circle/<条目 id>` 滚到这一条（等 Q-C） | `DeepLinkTests` 里打开种子目录条目，详情页显示它的名字 |

### 9.5 zymi-ios

| ID | 任务 | 怎么证明 |
|---|---|---|
| S0 | 合并 `feat/zymi-core-s1`，让 zymi-ios 接上 ZymiCore（属于 zymi-ios 已有的工作，不是本规格新增的） | 以 zymi-ios 自己的 E2E 为准 |
| S1 | 放宽 `environment.py:123` 和 `signing.py:29-30`；根上加 `onOpenURL`（只认 `open`）和 `onContinueUserActivity`；登录前收到的链接先存起来 | XCUITest 加 `xcrun simctl openurl`：任务链接能打开，登录前收到的链接登录后自动打开。对照：从 Safari 打开 `<scheme>://connectors?link_id=x`，App 什么都不做 |
| S2 | `ZymiChatMatrix.swift:135` 注入 `ChatLinkBuilder` | 复制出来的链接等于向量的格式 |
| S3 | `LinkRouter`；盘点 zymi-ios 里所有打开 URL 的地方 | 同 Z3 |
| S4 | UL 端到端（被 B2、B3 阻塞） | 用 developer 模式加 staging 域名，在真机上测 |
| S5 | （L2）和 Z5 一样，给页面加链接入口（调 `linkBuild`）。现在“分享”发的是内容（正文、文件、专家的纯文本，见 §4.4 的 L2 盘点）：改成“链接 + 内容”，还是只发链接，等 B8 定了再做 | 同 Z5 |

### 9.6 挂起（B1）

| ID | 仓库 | 任务 |
|---|---|---|
| A1 | im-android | 加 `ChatLinkBuilder` 和 `ChatLinkOpener` 注入点。对照组：不注入时，链接以 `https://matrix.to/#/` 开头。`Phase25Test.kt:64` 当不了对照，因为它断言的是 `contains("matrix.to") || contains(roomId)` |
| W1 | Windows | 见 §6.4 |
| B-ops | 运维 | DNS 和 TLS；`zymi.app/.well-known/matrix/client` |

**建议顺序：** L1（已完成）→ C1 → C2 → I1a、I2 → Z1、Z3、S0、S1、S3 → P1–P3 → Z4、S4 → Z2、S2。

---

## 10. 验收

- 每个实现都跑通 `vectors.json` 的全部条目和来回测试，并且有一个变异对照证明测试确实会失败。
- 规格 §7 表格里的每一行，至少有一个 E2E 覆盖。
- 产物里的截图要有人看过。

---

## 11. 要负责人回答的问题

**阻塞实现的：**
- B8（Q7，L2）：选读法一什么都不阻塞；选读法二，Z5、S5 的分享内容，以及 P1、P3、§8.3 都要等服务端的分享令牌或公开标记设计好。排在 B2、B3 和托管之前问。
- B3：Team ID、Bundle ID、签名指纹，以及 zim 的分发方式（Developer ID 还是 Mac App Store）。被它阻塞的是 P2、Z4、S4 和商店入口。scheme 已定（B3s）。
- B2、B4、B5：已经有默认值，负责人确认或推翻即可。B1 已定（11-13，只做 Zymi）。

**不阻塞、按默认值走的：**

| 问题 | 默认值 |
|---|---|
| Q7 跨账号分享 | **待定**，见 B8：读法一（默认）是只有本人跨设备打开，用现有规则；读法二是发给别人看，要服务端分享令牌或公开标记 |
| Q-A（L2）`agent` 是主智能体还是目录条目 | 待定。默认：拆开，`agent` 只表示本账号的主智能体，新增 `expert` 表示目录条目；子页面用 `me` |
| Q-C（L2）`circle` 的 id 指什么 | 待定。默认：feed 条目的 id；条目过期或者不是本账号的，打开圈子页，再提示“打不开这个链接” |
| Q-T（L2）`/team/` 是什么 | 待定。默认：继续预留给组织团队；专家团队用 `expert` 打开 |
| Q-S（L2）Zymi Space 应用要不要有链接 | 待定。默认：要，`/space/<workspaceId>`，只限所属账号 |
| Q-M（L2）音乐帖子 `share_url` 用哪个域名 | 待定。默认：不用链接域名，由服务端自己的页面出 |
| Q-H（L2）登录前收到的链接存多久 | 待定。默认：10 分钟，退出登录或换账号就清掉（照 zim） |
| Q8 Web 回退 | v1 不做 |
| Q9 商店 ID | 先用占位 |
| Q10 pill 写法 | 永远用 matrix.to 写法 |
| Q12 落地页仓库 | 用本仓库 |
| 生产环境的 homeserver | 是否和 dev 模板一样关了联邦和访客、资料接口要不要登录才能读，需要核对 |

**给协调者的：** zim 的 ZymiCore 什么时候改回指向 main（见 §5.1）。

---

## 12. 评审答复

| 编号 | 处理 | 说明 |
|---|---|---|
| F1 | 采纳 | 新增 §2.9；§2.6 改成“在不在范围内由 B1 定”；D1 的理由不再引用 ZYMIX 的 minSdk。补充一点：Unseal Electron 注册的 `unseal` scheme 名字叫 “OIDC Callback”，是给登录回调用的，**不是**分享链接，能复用的只有单实例转发 |
| F2 | 采纳 | 向量里两种房间 ID、带端口的 server name、标准 base64 的事件 ID 都有了；ID 按第一个 `:` 切；§8.2 已重写 |
| F3 | 采纳 | §4.1 逐字节写死了生成规则，并写明不能用 `encodeURIComponent`；§4.2 改成“先切段，再解码，再校验”，以 WHATWG 规范化之后的结果为准，Zymi ID 用白名单；评审列的边界情况都进了向量。我按 Matrix 规范对别名的规定，认为别名的 localpart 允许含 `/`（U9），向量 `p-alias-slash` 依此而写。第二轮已对照规范原文核实：Room Aliases 只排除 `:` 和 NUL，成立 |
| F4 | 采纳 | 新增 B4；Debug 另外注册 `zim-debug`；Z1 改用 `XCUIApplication().open`，并给出不能用时的退路；收到别的发布线的链接时提示 `other_lane` |
| F5 | 采纳 | §5.2 规定每个 App 一个 `LinkRouter`，附上调用点清单和 `rg` 检查；Z3 改用日志判定 |
| F6 | 采纳 | C1 写明在 `feat/links` 分支，做成自由函数；新增 S0 |
| F7 | 采纳 | 放进 S1 |
| F8 | 采纳 | §4.4、§8.3：邀请码只预留路径，能力型令牌永远不经 scheme 转交 |
| F9 | 采纳，选了边缘函数（B5） | §6.5 写了 404、SPA 回退和原始路径的要求；P3 有 `%2F` 的检查 |
| F10 | 采纳 | 拆成 I1a 和 I1b，I1b 归 B6 |
| S1 | 采纳 | Q6、Q11 补了 unseal-webapp 的证据；Q4、Q10 直接定为默认值 |
| S2 | 采纳 | 删掉 I3：pill 写法冻结以后，不会再有 `/u/` 形式的 pill |
| S3 | 采纳 | 并入 I1a |
| S4 | 采纳 | 写进 §6.1，S1 加了对照 |
| S5 | 采纳 | §4.3 规定 `unknown_kind` 和 `reserved` 提示“请更新 App”；落地页加了更新提示 |
| S6 | 采纳 | 对照组全部改成变异对照 |
| S7 | 采纳 | 写进 §6.3 |
| S8 | 采纳 | 写进 X1 |
| S9 | 采纳 | 删掉 `exclude` 那条；预留路径 `/invite/*` 和 `/team/*` 一次写进 AASA |
| S10 | 采纳 | §1 已改 |
| 评审 §二：“I2 没有独立的证明” | **不采纳单独测试** | I2 只是把调用改成先问注入点，用户真正能看到的效果只有在宿主里才看得到。按“只用 E2E”的约定，由 Z3 和 S3 来证明更直接；只给 IMKit 写隔离测试，既重复，也证明不了宿主真的接上了 |
| 本稿自己新增的改动 | — | 配置按构建给出，新增 zim Debug 的 `local` 配置（`zim-debug`）；非默认端口算 `not_ours`；`matrix:` 只认 `u`、`r`、`roomid`；`<scheme>://open` 空路径判 `malformed`；系统送进来的 `not_ours` 不再交回系统（§5.2）；`unknown_kind` 的提示改成通用的一句。旧片段写法只在**白名单前缀**上才认（第一稿写的是任何 host 都认，那样会把陌生网站的链接也拦进 App）；解析结果新增 `not_ours` 和 `other_lane` 两种；向量的权威副本放在本仓库，不再放在 zymi-services |
| U1–U9 | 记录在案 | 都标了待确认，并且放在了会受影响的那一节里：U1 对应 §4.2 第 1 条，U2 对应 B4 和 Z1，U3、U4、U5 对应 §6.2、§6.5 和 Z4、S4，U6 对应 §8.2，U7 对应 B3，U8 对应 B1，U9 对应 F3 那一行（U9 第二轮已核实，见 §4.1 第 8 条） |

### 第二轮：C1 安全评审（Critical 0、High 0、Medium 3、Low 12）

| 编号 | 处理 | 说明 |
|---|---|---|
| M1 | 采纳 | §5.3：列表改成必填，`legacy` 由 zymi-core 的 `link_legacy_standard()` 提供；TS 拒绝未知字段 |
| M2 | 采纳 | C1 自己定的规则（kind 先于解码、scheme 和旧写法拒凭据和端口、事件 ID 拒 `.` 和 `..`、C1 控制字符、别的发布线的首页和凭据）写进 §4.2，并补了向量（§4.5） |
| M3 | 采纳 | §4.1 第 8 条：用户 localpart 用历史语法，拒 Cf 和重复 sigil；房间 opaque 和事件 ID 收紧到规范字符集，v3 事件 ID 的 `+`、`/` 保留；§5.2 写明拼路径前编码 |
| L1 | 采纳 | §4.2 第 0 条：自家 host 上的超长链接判 `malformed`，不交回系统 |
| L2 | 采纳 | §4.2：旧前缀先看 `#/` 再看凭据，`https://u@matrix.to/` 是 `not_ours` |
| L3 | 采纳 | §5.3 配置校验，错误抛出而不是静默 |
| L4 | 采纳 | server name 一律返回小写（§4.1 第 8 条） |
| L5 | 采纳 | 旧片段认 `#/user/@…`（IMKit `MatrixHTML.mentionedUser` 认这种写法） |
| 评审建议的 36 条向量 | 采纳 27 条建议（31 条向量），另加 6 条，共 +37（75 → 112） | 采纳第 1–14、16、18、25、27–35 条和第 36 条的全部四项（超长分成我们的和别人的两条）；另加 3 条生成向量（`$..`、`@@x`、bidi 别名）和别名 bidi、房间 opaque 含 `/`、超长的自家首页（`x-too-long-root`，钉住“超长时按常规规则判前缀”）。**没加**第 15、17、19–24、26 条：它们只是在固定 WHATWG URL 本身的行为（结尾点的 host、反斜杠、全角字母、`%2E`、空 userinfo、`zim:open`、`zim:///`、编码过的 host），和本语法无关；第 15、17、19–21、23 条留在 zymi-core 的测试里 |

### 第三轮：scheme 从 zim 改成 zymi 家族（负责人 11-13）

负责人原话：「深链接要改一下用zymi 而不是zim」。

| 项 | 处理 | 说明 |
|---|---|---|
| 命名规则 | 已定 | `zymi[-<发布线>]`，Debug 用 `zymi-debug`（B3s、§5.3 的表）。dev 线用 `zymi-dev` 而不是 `zymi`：和 zymi-ios 已有的 `callback_scheme` 一致；以后出 prod 的 macOS 构建时不用再改名；同一台机器装多条线时不会抢同一个 scheme。这一点是协调者按规则定的，负责人可推翻，推翻只改 §5.3 那张表和向量的 `lanes` |
| `zim` 进不进旧写法 | **不进，直接删** | 证据见下 |
| 向量 | 112 → 121 | 所有 scheme 向量改用 `zymi`、`zymi-dev`、`zymi-debug`；prod 有了 handoff；新增 9 条：`p-scheme-case`（`ZYMI://`）、`x-scheme-no-slashes`（`zymi:open/…` → `not_ours`）、`x-zim-retired`（`zim://open/…` → `not_ours`）、`x-zymix-open`（`zymix://open/…` → `not_ours`）、`x-debug-on-dev`（dev 构建上的 `zymi-debug://open/…` → `other_lane: local`）、`x-other-lane-scheme`、`x-other-lane-scheme-share`、`x-other-lane-scheme-case`（→ `other_lane`）、`x-unknown-zymi-scheme`（`zymi-staging://…` → `not_ours`）；`x-other-build-scheme` 从 `not_ours` 改成 `other_lane: dev` |
| 别的发布线的 scheme | 判 `other_lane` | zim 那边发现：`other_lanes` 原来只有 host，dev 构建收到 `zymi://open/…` 会判成 `not_ours`。按 `zymi[-<发布线>]` 的约定，这是“我们的、但属于另一条线”，和 https 一样报 `other_lane`。`other_lanes` 每条加 `schemes`，默认空：旧配置照旧能用，只是那条线的 scheme 链接还判 `not_ours`，退化成原来的安全行为（不打开，系统送来的也不交回系统）。没有哪条线列出的 scheme 一律 `not_ours`，不按名字猜，因为 scheme 只在配置表里定义 |

`zim` 为什么不进旧写法（只有已发布的构建发出过或登记过的 scheme 才需要继续解析）：

- **注册时间很短**：zim 从 11-05 起注册 `zim`（`zim` 提交 `ce1e1a9`，分享扩展），当时只用于 `zim://share`，这是同一个 App bundle 里扩展交给 App 的内部交接；11-13 起才加上 `zim://open` 和 Debug 的 `zim-debug`（`a1421a9`）。
- **没有分发渠道**：zim 是 Automatic 签名，用的是开发证书（`project.yml:43-44`）；仓库里没有 Developer ID、公证、TestFlight 或 App Store 的脚本，也没有 tag。
- **装着的那份也只是本机构建**：`/Applications/ZIM.app`（`ai.pagepeek.zim` 1.0 (1)，11-12 构建）由 `Apple Development: Jelf Liang` 签名，`spctl -a` 判 `rejected`，不能拿到别的机器上运行。
- **没有对外发出过 zim 链接**：zymi-core 生成的永远是 https 规范链接；`<scheme>://open` 只由落地页交接，而落地页还没部署（P1）。分享扩展在 App bundle 里面，和 App 一起换 scheme，不存在“旧扩展配新 App”的情况。
- 所以 `zim` 和 `zim-debug` 直接退役：不生成、不解析、不注册；向量 `x-zim-retired` 钉住 `zim://open/…` 是 `not_ours`。本机上那份旧 ZIM.app 在被新构建替换之前仍会认领 `zim://`，但已经没有任何东西会发出这种链接。

各端要跟着改的：zim（`project.yml` 的 `ZIM_LINK_SCHEME`：Release `zymi-dev`、Debug `zymi-debug`，App 和分享扩展都要改；Info.plist 的 `ZimLinkScheme` 和 lane 配置里的 `schemes.macos`；UITests 里的 `zim-debug://`；回调 scheme 改为取本构建的 scheme，见 §5.3）；zymi-ios（`callback_scheme` 照表配置，testing 线 `zymi-testing`，prod `zymi`；`.onOpenURL` 只认 `open`）；Android 和 Windows 将来接入时照 §5.3 的表取名。

### 第四轮：只做 Zymi（负责人 11-13，zim L1）

负责人原话：「这个是新的产品 zymi，只要它的」「Matrix用zymi:」。

| 项 | 处理 | 说明 |
|---|---|---|
| B1 | 已定 | 只做 Zymi。Unseal 和 ZYMIX 的旧写法不再支持；Matrix 实体用现有的 zymi 写法（选项 A：`zymi[-<发布线>]://open/{u\|r\|roomid}/…[/e/…]`，不加新语法） |
| 旧写法 | 只剩 matrix.to | 删掉旧落地页前缀 `https://dev.unseal.chat/AgentMessenger/to-share/` 和 `legacy.schemes`（`zymix`、`zymixdemo` 的 `unseal`）；`link_legacy_standard()` 只剩 `https://matrix.to/`（mention pill 和已经发出去的链接）。配置里的 `legacy.schemes` 这一项整个删掉 |
| `matrix:` URI | 不再读 | 删掉 `matrix:` 的解析和 `source` 的 `matrix_uri`；`zymix` 这个 `source` 也删掉。`matrix` 仍是保留 scheme，配置不能用它当平台 scheme |
| 删掉的 | — | B6、I1b、X1–X3、P4、Q11；§2 里 Unseal 和 ZYMIX 的盘点只作背景；D3 和 §7 只留 matrix.to。前几轮答复里提到它们的地方（F10、S1、S8 等）是历史记录，不再有效 |
| 向量 | 121 → 122 | 删 11 条：`l-to-share`、`l-zymix-room`、`l-zymix-user`、`lx-zymix-credentials`、`l-matrix-uri-user`、`l-matrix-uri-event`、`l-matrix-uri-alias`、`lx-matrix-uri-zymi`、`lx-matrix-uri-dots`、`lx-matrix-uri-authority`、`lx-matrix-uri-arity`。加 12 条：`not_ours` 的 `x-zymix-unseal`（`zymix://unseal/room/…`）、`x-matrix-uri`（`matrix:u/…`）、`x-to-share-retired`（旧落地页），`x-zymix-open` 照旧；别名加消息 `b-alias-event`、`p-alias-event`、`p-scheme-alias-event`；dev 线 `p-scheme-dev-alias`、`p-scheme-dev-event`；debug 线 `p-scheme-debug-user`、`p-scheme-debug-alias`、`p-scheme-debug-event`、`p-scheme-debug-alias-event` |
| 语法 | 不变 | §4.2 第 6 条本来就允许 `r` 后面跟 `/e/<event>`，zymi-core 也已经支持；只是 §4.4 的表和向量之前没写 |

### 第五轮：全页面的链接（负责人 11-13，zim L2 第 (1) 步）

负责人原话：「需要做universal link，不止是chat im部分，还有其他的页面分享应该也要考虑」。这一轮只改规格：`vectors.json` 和 zymi-services 里的 `fixtures/links/` 副本都不动，放到第 (2) 步。zymi-ios 只读。

| 编号 | 改了哪一节 | 内容 |
|---|---|---|
| E1 | §0.1（新增 B8）、§11（Q7） | 跨账号分享改为待定，写明两种读法各自要什么：读法一用现有规则；读法二要服务端分享令牌或公开标记，并列出对 B2、B5（托管）、落地页和 §8.3 的影响 |
| E2 | §4.1 第 2 条、§4.4 的 L2 盘点表 | 提议新增 `expert`、`space`，`agent` 收窄成主智能体，`circle` 的 id 指 feed 条目；定下来之前照旧判 `unknown_kind` |
| E3 | §4.4 的 L2 盘点表 | 提议页面类 kind：`/settings/<page>`（9 个页面的白名单）和 `/me/<page>`（`activity`、`scheduled`、`memory`）；本平台没有的页面怎么处理；Shop 结账、头像结果、带令牌的东西都不做链接；不能用 OAuth 回调的 host |
| E4 | §4.2 第 6 条 | 页面类 kind 的段数和白名单：按字面比较；不在白名单里的判 `unknown_kind` |
| E5 | §4.4（“邀请码、团队”一行） | 写明 `/team/` 指组织团队，不是专家团队（Q-T） |
| E6 | §4.4（“服务端生成的分享链接”一行） | 音乐帖子 `share_url` 只在公开时才有；用哪个域名待定（Q-M），用链接域名时 AASA 怎么处理 |
| E7 | §6.1 | AASA 要在第一次上线之前一次补全新 kind；AASA、`pathPrefix` 和落地页类型名要同步加 |
| E8 | §6.5、§8.3 | 落地页要有每个 kind 的类型名、“只有创建它的账号能打开”这句提示、没登录时的说明；macOS 上必须有“在 App 中打开”按钮；公开对象不放进这个落地页 |
| E9 | §8.4 | 登录前收到的链接存 10 分钟（Q-H）；登录的不是所属账号 → `cannot_open`；页面类 kind 永远打开当前账号自己的页面 |
| E10 | §4.5、新增 §4.6 | 列出第 (2) 步要补的 8 条向量（已经和 L1 之后的 122 条核对过 id）；§4.6 是 `open` 一节：形状，以及 5 个实体 × 2 种写法 × 2 种情况共 20 条 E2E 期望 |
| E11 | §2.3、§2.7、§6.2 | 更新过时的事实：zim 的 `onOpenURL` 和 `onContinueUserActivity` 已经交给 `LinkRouter`，只差 entitlements；`shareURL(for:)` 没有调用方；分享链接改写的行号已经移位；zymi-core 已经有 `links.rs` |
| E12 | §9.0（L2）、§9.4（Z4 改，加 Z5、Z6）、§9.5（加 S5） | 给页面加链接入口；`/expert` 打开目录条目本身，`/circle` 滚到那一条 |

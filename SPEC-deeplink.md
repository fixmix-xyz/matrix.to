# 规格：产品分享链接与深链（SPEC-deeplink）

日期：2026-11-13。状态：**草案，等负责人审**。这份规格只定设计，不写代码。所有“现状”都附了 `文件:行`，行号以 2026-11-13 各仓库的工作区为准；zim、im、zymi-services、zymi-ios 的工作区有别人没提交的改动，行号可能会小幅偏移。

---

## 0. 结论先行

### 0.1 五个关键决定（要负责人点头）

| # | 决定 | 一句话理由 |
|---|---|---|
| D1 | **规范链接放在 URL 路径里，不放在片段（`#/…`）里**，挂在产品自己的专用链接域名上，每条发布线（lane）一个域名，例如 `https://<LINK_HOST>/roomid/<id>`、`/u/<id>`、`/task/<id>`。自定义 scheme `<lane scheme>://open/<同一路径>` 只负责从落地页把链接交给 App。 | 安卓 App Links 在 minSdk 26 上**匹配不了片段**（`zymix-im-android-cloud/gradle/libs.versions.toml:11`；片段匹配要到 API 35 的 `uri-relative-filter-group` 才有）。服务端看得到路径，才能做 404、回退页和预览卡片。各平台的聊天消息里只放行 https 链接，自定义 scheme 会被丢掉。 |
| D2 | **语法只有一份，配一个共用的测试向量文件。** Zymi 的 App（zim、zymi-ios，以后的安卓和 Windows Zymi 客户端）由 **zymi-core** 负责生成和解析链接。IMKit（im、im-android）**不自带语法**，只提供两个注入点：链接生成器和“应用内拦截链接”。落地页的 JS 和 ZYMIX 要接的话，也跑同一份向量。 | IMKit 现在不依赖 zymi-core（`im/Package.swift` 里没有 zymi），ZYMIX 宿主也不依赖。用“向量文件 + 各自实现”这种做法已有先例：`zymi-services/fixtures/sse-vectors.json` 加 `scripts/sse-parity.sh`。 |
| D3 | **旧链接一律还能用。** 所有客户端的解析器都认 `https://matrix.to/#/…`、旧落地页的 `…/to-share/#/…?client=…`、`zymix://unseal/…` 和 `matrix:` URI。**@ 提及的 pill 继续用 matrix.to 的片段写法**。新落地页在浏览器里把旧的片段链接换成规范链接。 | 两端判断 pill 的代码已经不看域名，只看片段（`im/Sources/IMMatrix/MatrixHTML.swift:119-140`，`im-android/.../MatrixHtml.kt:137-157`）。pill 不换写法，就不会出现“发送方已经换了、接收方还没更新”的情况。 |
| D4 | **安全基线：** 落地页不做任何预览，也不请求任何 homeserver。删掉 `client=` 和 `web-instance[…]` 两个参数。落地页只跳到自己拼出来的地址，从不跳到链接里给的地址。加入房间、发起私聊、接受邀请这类会改状态的动作，一律先在 App 内确认。只认自家的 `server_name`。没有权限（403）和不存在（404）对外显示同一句话。 | matrix.to 会按链接里的 `via` 去连任意服务器拉预览（`src/preview/PreviewViewModel.js:46-59`）。ZYMIX 的 `zymix://unseal/room/…` 打开后会直接加入房间（`../matrix.to/src/open/clients/Zymix.js:17-19`）。我们不开联邦（`zim/dev/zymi-homeserver/homeserver.yaml.tmpl:34-35`）。 |
| D5 | **各平台做法：** iOS 和 macOS 用 universal links（AASA 按路径匹配）加 scheme；安卓用 App Links（`assetlinks.json` 加 `autoVerify` 的路径过滤器）加 scheme；Windows 先注册 scheme，打包成 MSIX 的话再加 App URI Handler，**但 Windows 要等客户端选型以后再定**。在 App 里点到自家链接时，**由 App 自己拦下来跳转**，不交给系统。 | 不能指望系统把 App 里点到的自家链接送回 App。IMKit 现在把 https 链接全交给了系统浏览器（`MessageRowView.swift:439-448`、`HostMessageHooks.swift:61-69`、`IMChatMac/Message.swift:372-374`）。 |

### 0.2 需要负责人回答的问题（详见 §11）

Q1 链接属于哪个产品、用哪个域名（ZYMI 用 `zymi.app`？ZYMIX 用 `zymix.io`？还是 `pagepeek.ai`？）。Q2 每条发布线的子域名怎么起。Q3 生产环境的 Bundle ID、Team ID，安卓包名和 Play 签名指纹。Q4 ZYMI 和 ZYMIX 装在同一台设备上时，聊天链接归哪个 App。Q5 Windows 客户端用什么技术、放在哪个仓库。Q6 落地页托管在哪里、DNS 归谁管。Q7 Zymi 对象要不要跨账号分享。Q8 有没有可以回退过去的 Web 客户端。Q9 各应用商店的 ID。Q10 pill 是不是永远用 matrix.to 的写法。Q11 旧落地页 `dev.unseal.chat/AgentMessenger/to-share/` 还保不保留。Q12 落地页用哪个仓库。

---

## 1. 任务前提和仓库实际情况不一致（先读这一节）

- **`zymi-matrix.to`（远端是 `fixmix-xyz/matrix.to`）和上游完全一样，没有改过。** HEAD 是 `562a5e2`（上游 PR #409），没有任何 zymi、zymix、unseal 字样，也没有部署配置。页面还是 Matrix 的品牌（`index.html:5-13`、`src/RootView.js:36-37`）。
- **真正在用的落地页逻辑在另一个仓库：`../matrix.to`（远端 `unseal-network/matrix.to`）。** 它的三个提交（`7c118c7`、`9b7ac82`、`4cf008c`）加了 Unseal、ZYMIX、ZYMIX Demo 三个客户端；另外还有 4 个文件改了没提交（`index.html`、`src/create/CreateLinkView.js`、`src/open/clients/Unseal.js`、`src/policy/LoadServerPolicyViewModel.js`）。它的 `build/` 被 gitignore 了，里面有本地构建出来的 AASA，只认 `U633M9A2Z3.www.topsecret.network`。
- **部署：两个仓库里都没找到部署配置。** `scripts/package.sh` 只是把 `build/` 打成 tar 包。客户端里写死的落地页地址是 `https://dev.unseal.chat/AgentMessenger/to-share/`（`zymix-im-ios/MainApp/Sources/Feature/MatrixDemo/MatrixDemoSettings.swift:102`，以及 `im/Sources/IMMatrix/MatrixShareLinks.swift:8` 的注释），由此推断这个页面部署在 Unseal 的 dev 域名上，但我**没有找到证据**。
- **`zymix-im-ios`、`../matrix.to`、`zymix-im-android-cloud` 不在 Zymi 的主线里，但现在的分享链接靠它们才能跑通。** 本规格把它们列为“相关但要单独决定”的部分。

---

## 2. 现状盘点

### 2.1 落地页（matrix.to 的两个 fork）

| 项 | 现状 | 证据 |
|---|---|---|
| 链接语法 | 写在片段里：`#/<@user|#alias|!roomid|+group>[/<$event>]?via=…&client=…&web-instance[<id>]=…` | `src/Link.js:20-24, 105-134` |
| 片段为什么不用路径 | 不让服务端看到链接内容 | `README.md` 的 “URL Scheme” 一节 |
| `matrix:` URI | 能生成 `matrix:u/…`、`matrix:roomid/…/e/…`、`matrix:r/…`（MSC2312） | `src/Link.js:220-244` |
| AASA | 构建时根据客户端列表生成，只匹配片段：`{"#":"/*"}` | `scripts/build.js:62, 126-143` |
| assetlinks.json | **没有** | `scripts/build.js` 里不生成 |
| 预览 | 用户同意以后，按 `via` 和链接里的服务器去请求 `/.well-known/matrix/client`、`/profile`、`/summary`、`/publicRooms`、缩略图 | `src/preview/HomeServer.js:36-116`，`src/preview/PreviewViewModel.js:46-59` |
| `web-instance[]` | Element 和 SchildiChat 只放行白名单里的实例 | `src/open/clients/Element.js:87-88, 112-115` |
| CSP（本地模拟） | `script-src 'unsafe-inline' 'unsafe-eval'`，`connect-src *` | `scripts/serve-local.js:34` |
| Unseal 客户端（unseal fork） | 网页实例是 `unseal.network`，scheme 是 `unseal://vector/webapp/AgentMessenger#/…`，App ID 是 `U633M9A2Z3.www.topsecret.network` | `../matrix.to/src/open/clients/Unseal.js:20-29, 50-54` |
| ZYMIX 客户端（unseal fork） | 链接带 `?client=zymix` 时才选它，深链是 `zymix://unseal/{room|user}/<id>?via=`；事件链接和社群链接**都退化成房间链接**；平台列表里有 Android、Windows、macOS、Linux | `../matrix.to/src/open/clients/Zymix.js:17-21, 38-46, 60-78` |
| ZYMIX Demo 客户端 | 深链是 `zymixdemo://unseal/`，只有链接点名要它时才显示 | `../matrix.to/src/open/clients/ZymixDemo.js:32-37` |
| **缺陷** | ZYMIX 在列表里声称支持 Android，可 ZYMIX 安卓版并没有处理 `zymix://unseal/…`（见 §2.5）；`Coor.swift` 的注释写着“安卓支持以后才能列出来” | `Zymix.js:38-46` 对比 `zymix-im-ios/Package/Sources/SiuperModel/Coor.swift:210-216` |

### 2.2 IMKit（`im`，供 iOS 和 macOS 使用）

| 项 | 现状 | 证据 |
|---|---|---|
| 房间链接 | 由 SDK 的 `room.matrixToPermalink()` 生成，再经过 `shareLinks?.rewrite` 改写 | `Sources/IMMatrix/MatrixChatClient.swift:1669` |
| 消息链接 | 由 SDK 的 `matrixToEventPermalink(eventId:)` 生成，经过同样的改写 | `Sources/IMMatrix/MatrixMessageLinks.swift:11-12` |
| 改写规则 | 只改写 `https://matrix.to/#/` 开头的链接，改成 `<base>#/<原片段>[&client=<id>]`；base 必须是 https，不能带凭据、query 或片段 | `Sources/IMMatrix/MatrixShareLinks.swift:7-37` |
| 注入点 | `MatrixConfiguration.shareLinks`，为 nil 时用 matrix.to | `Sources/IMMatrix/MatrixConfiguration.swift:21-23` |
| 发出去的 pill | `https://matrix.to/#/@user`；配了落地页时改写成落地页地址 | `Sources/IMMatrix/MatrixOutgoingHTML.swift:21-31`；编辑器 `Packages/IMChatUI/.../RichTextComposer.swift:229-230` |
| 收到的 pill | 不管哪个域名，只要片段是 `#/@user:server` 或 `#/user/@…`，或者是 `matrix:u/…` | `Sources/IMMatrix/MatrixHTML.swift:119-140` |
| 空间链接 | 服务端没给的话，自己拼一个 matrix.to 链接 | `Packages/IMChatMac/.../SpaceHome.swift:342-344` |
| 在 App 里点链接（iOS） | 是 pill 就打开那个人；其他 http(s) 链接用 `.systemAction` 交给系统 | `Packages/IMChatUI/.../MessageRowView.swift:439-448`、`HostMessageHooks.swift:61-69` |
| 在 App 里点链接（Mac） | 只放行 http、https、mailto，**自定义 scheme 一律丢掉** | `Packages/IMChatMac/.../Message.swift:372-374, 396-399` |
| 收到的深链 | IMKit **没有**处理入口，由宿主负责 | — |

### 2.3 macOS：zim

| 项 | 现状 | 证据 |
|---|---|---|
| scheme | 只有 `zim`，而且只给分享扩展用：`zim://share?inbox=<id>` | `project.yml:131-134`，`Info.plist:41-52`，`Shared/ShareInbox.swift:4` |
| 处理入口 | `.onOpenURL` 只处理 ShareInbox 和文件 URL，其他 URL 直接忽略 | `Sources/ZIMApp.swift:191-214` |
| 窗口路由 | 主窗口 `handlesExternalEvents(matching: ["*"])` | `Sources/ZIMApp.swift:20, 40` |
| Associated Domains | **没有**（entitlements 里只有 sandbox、网络、推送、keychain、app group） | `ZIM.entitlements` |
| 分享链接 | 只有 DEBUG 构建下设了 `ZIM_E2E_SHARE_LINKS_BASE` 才改写；正式构建用 matrix.to | `Sources/AccountModel.swift:341-345`，`SPEC-mac-message-share.md:15-16, 84` |
| Bundle ID 和 Team ID | `ai.pagepeek.zim`，Team `VZZQ2Q6734` | `project.yml:47, 142` |
| Zymi 对象的路由 | `ZymiRoute`：`.task(String)`、goals、experts、teams、circles、artifacts、music、agentProfile… | `Sources/Zymi/UI/Shell/ZymiNavigator.swift:7-27` |
| 断言了 matrix.to 的测试 | 改功能时这几处要一起改 | `UITests/SpaceSettingsTests.swift:147`，`UITests/MessageShareTests.swift:177, 181`，`UITests/MentionTests.swift:62` |

### 2.4 iOS：zymi-ios（ZYMI）和 zymix-im-ios（ZYMIX，不在主线里）

| 项 | 现状 | 证据 |
|---|---|---|
| zymi-ios 的 scheme | 每条发布线一个 `callback_scheme`（本地 dev 是 `zymi-dev`），只用作 OAuth 和钱包回调 | `App/Info.plist:17-25`，`Packages/ZymiKit/Sources/ZymiModel/ZAgentAppCallbacks.swift:4-25`（禁止用 `zymix`、`siuper`），`ZAgentConnectorAuthentication.swift:14` |
| zymi-ios 的 Associated Domains | 构建脚本支持 `associated_domains`（格式是 `applinks:host`），但本地 dev 配的是 `[]` | `Scripts/environment.py:123-124, 166`，`Configurations/environment.example.json` |
| zymi-ios 收到的深链 | **App 根上没有 `onOpenURL` 或 `onContinueUserActivity`，也没有 `application(_:open:)` 或 `openURLContexts`**。回调 URL 只经 `ASWebAuthenticationSession` 的完成回调交给 `ZAgentConnectorStore.matches` 和 `ZAgentWalletStore.matches` | 在 `App/`、`Packages/` 里都搜不到这些入口；`ZAgentConnectorAuthentication.swift:14`，`ZAgentConnectorStore.swift:216`，`ZAgentWalletStore.swift:113` |
| zymi-ios 的聊天分享链接 | `MatrixConfiguration` 没有设 `shareLinks`，所以用 matrix.to | `Packages/ZymiKit/Sources/ZymiChatMatrix/ZymiChatMatrix.swift:135` |
| zymi-ios 现有的分享 | 专家资料页只分享文字；音乐帖子的 `shareUrl` 是服务端给的 | `ZAgentExpertProfileView.swift:84`，`ZymiModel/Music/MusicDiscoveryModels.swift:161, 301` |
| ZYMIX 的 universal links | 域名有 `oia.zymix.io`、`oia.zymix.app`、`oia.siuper.app`、`oia-dev.*`；AASA 的 paths 里有 `*`、`/v/*`、`/user/*`、`/group/*`… | `zymix-im-ios/MainApp/Resources/Siuper_*.entitlements:13-20`，`zymix-im-ios/apple-app-site-association` |
| ZYMIX 每条发布线一个分享域名 | `oia.zymix.io`、`oia-stage`、`oia-test`、`oia-dev` | `Package/Sources/SiuperModel/BackendEnvironment.swift:267-286` |
| ZYMIX 的短链 | `oia.zymix.io/s/{code}`（旧的）；`/go/{code}` 放在一个刻意**不注册** UL 的域名上 | `Package/Sources/SiuperInterface/ShortUrlInterface.swift:5-14` |
| ZYMIX 的 Unseal 路由 | `/unseal/room/:roomId`、`/unseal/user/:userId` | `Package/Sources/SiuperModel/Coor.swift:210-216` |
| ZYMIX 的落地页设置 | 默认是 `dev.unseal.chat/AgentMessenger/to-share/`，`clientID` 是 `zymixdemo` | `MainApp/Sources/Feature/MatrixDemo/MatrixDemoSettings.swift:102`，`MatrixDemoHost.swift:184` |

### 2.5 Android：im-android（IMKit 的 Kotlin 版）和 zymix-im-android-cloud（ZYMIX）

| 项 | 现状 | 证据 |
|---|---|---|
| im-android 的房间链接 | 直接用 `room.matrixToPermalink()`，**没有改写的注入点** | `im-matrix/src/main/kotlin/network/unseal/im/matrix/MatrixChatClient.kt:1070` |
| im-android 发出去的 pill | 写死 matrix.to | `im-matrix/.../MatrixOutgoingHtml.kt:51-52` |
| im-android 收到的 pill | 和 iOS 一样不看域名 | `im-matrix/.../MatrixHtml.kt:137-157` |
| im-android 的 intent-filter | 没有（它是库，`sample` 和 `demo` 两个模块也没有） | 在 Manifest 里搜不到 |
| ZYMIX 安卓的 scheme | `zymix`、`siuper` | `app/src/main/AndroidManifest.xml:200-207` |
| ZYMIX 安卓的 App Links | `oia.zymix.io`、`oia-dev`、`oia-test`、`oia-stage`，带 `autoVerify`；`zymix.go.link` 由 Adjust 托管 | `AndroidManifest.xml:209-229, 250-259` |
| ZYMIX 安卓的路由 | `DeepLinkRouter`：按路径匹配，规则和 iOS 的 Coordinator 一致 | `zymix-uikit/src/main/java/com/zymix/uikit/navigation/DeepLinkRouter.kt:11-40` |
| ZYMIX 安卓的 Unseal 路由 | **没有**（搜 `unseal/room`、`matrix.to` 都没结果） | — |
| minSdk | 26 | `zymix-im-android-cloud/gradle/libs.versions.toml:11`，im-android 的 `*/build.gradle.kts` |
| **Zymi 安卓客户端** | **不存在**。zymi-core 计划以后生成 Kotlin 绑定 | `zymi-services/README.md:3-4` |

### 2.6 Windows

**在 `/Users/jelf/Projects/work` 下面没有找到 Windows 客户端仓库。** 我搜了 `*.sln`、`*.csproj`、`Package.appxmanifest`、`tauri.conf.json` 和 `electron-builder*`，只找到 element-web、unseal-webapp 和 builder 演示里的 Electron 配置，都和 Zymi 没关系。现有的线索有三条：

- `zymi-services/README.md:3-4` 和 `zim/SPEC-zymi-core-rust.md:9, 90`：Windows 计划用 C#，绑定靠第三方的 `uniffi-bindgen-cs`。
- `zim/SPEC-zymi-web.md:3, 25`：同一个 wasm 包给浏览器和 Electron 共用；`zymi-services/web/electron/main.cjs` 只是测试用的外壳。
- ZYMIX iOS 有 `PCScanLoginRouteHandler`（`BridgeWiringSetup.swift:432`），说明另有一个 PC 客户端，但不在这个工作区里。

### 2.7 共享内核：zymi-services（zymi-core）

| 项 | 现状 | 证据 |
|---|---|---|
| 定位 | 每个平台都用的 Zymi 客户端内核；聊天走 matrix-rust-sdk，其余业务走 zymi-core | `README.md:1-5, 20-27` |
| 和链接有关的现有代码 | 卡片动作里的 URL 白名单 `http`、`https`、`mailto`、`maps`、`sms`、`tel`；有 `*.share` 一类动作，比如 `artifact.share` | `crates/zymi-core/src/cards/actions.rs:11-12, 22-50, 64-75`，`cards/mod.rs:116`（`Share { url, text }`） |
| 链接或分享模块 | **没有**。核心里没有 share URL、深链、邀请码的概念 | 搜 `share_url`、`permalink`、`deep_link` 只命中卡片字段 |
| 绑定 | Swift 用 UniFFI；浏览器和 Electron 用 wasm（`crates/zymi-wasm`，`scripts/check-surface.sh` 保证接口一致） | `docs/web.md` |
| 网关 | **不在这个仓库里。** 服务端那部分（短链、预览、`.well-known`）在我能读到的仓库里找不到对应的代码 | — |

### 2.8 Matrix 服务端

- `server_name` 是 `zymi.app`，用户 ID 是 `@<account_id(uuid)>:zymi.app`：`zim/SPEC-zymi-matrix-session.md:33, 61, 143`。
- 不开联邦：`zim/dev/zymi-homeserver/homeserver.yaml.tmpl:34-35`。`zymi.app/.well-known/matrix/client` 还没上线：`SPEC-zymi-matrix-session.md:156`。
- 模板里**没有设** `require_auth_for_profile_requests` 和 `limit_profile_requests_to_users_who_share_rooms`，**待确认**：如果按 Synapse 的默认值，资料接口不登录也能读。要在生产配置上核实，我只看了本地模板。
- Matrix 可选模式（`matrix_chat` 开关，T23）：`zim/tasks/todo-core-architecture.md:283`。

---

## 3. 产品域名：候选和证据

| 候选 | 证据 | 适合不适合 |
|---|---|---|
| **`zymi.app`**（及其子域名） | Matrix `server_name`（`SPEC-zymi-matrix-session.md:33`）；网关 `dev.zymi.app`（在 zim、zymi-ios 里出现 177 次）、`matrix-dev.zymi.app`（`zim/project.yml:122`）、`api.zymi.app` 和 `testing.zymi.app`（`zymi-core/tests/requests.rs:113`，`tests/auth.rs:757`） | ZYMI 和 ZIM 最自然的选择。根域名大概率是官网，所以建议用专门的子域名 |
| `zymix.io` / `zymix.app` / `zymix.ai` | ZYMIX 的 UL 域名 `oia.*.zymix.io`；zymi-ios 的条款和隐私页在 `www.zymix.ai`（`environment.example.json`）；`zymix.io` 是 ZYMIX 官网（`Zymix.js:56`） | 是 ZYMIX 的域名。**如果和 ZYMIX 共用 `oia.zymix.io`，两个 App 会抢同一批链接** |
| `pagepeek.ai` | Bundle ID 前缀 `ai.pagepeek.*`（`zim/project.yml:142`）；`zymi.pagepeek.ai` 用作邮件转发（`zim/Resources/Localizable.xcstrings:12580`） | 是公司域名，不是面向用户的品牌 |
| `unseal.network` / `unseal.chat` | 旧 Unseal 客户端（`Unseal.js:21`），旧落地页（`MatrixDemoSettings.swift:102`） | 旧品牌，只做向后兼容 |

**建议**：ZYMI 和 ZIM 的链接放在 `zymi.app` 下面一个专用的子域名上，比如 `to.zymi.app` 或 `link.zymi.app`，每条发布线一个（参照 ZYMIX `oia-{env}` 的做法），例如 `to-dev.zymi.app`、`to-testing.zymi.app`。专用子域名的好处是：AASA、assetlinks、CSP 和官网互不影响，官网改版也不会弄坏链接。**具体用哪个是 Q1、Q2，下文统一写成 `<LINK_HOST>`。**

---

## 4. 链接语法

### 4.1 总规则

- 规范链接是 `https://<LINK_HOST>/<kind>/<seg>[/<kind2>/<seg2>][?<query>]`。
- Matrix 实体的路径**照搬 MSC2312 `matrix:` URI 的写法**：`u/`、`r/`、`roomid/`、`e/`，ID 前面不带 sigil（`@`、`#`、`!`、`$`）。这样转成 `matrix:` URI 只是换个前缀，也不用处理 `#` 的转义问题。
- 每一段都按 RFC 3986 的 pchar 做百分号编码，`/ ? # %` 和空白必须编码。解析器只解码一次，解码后出现 `/`、控制字符，或者长度超过 255 字节（Matrix ID 的上限），就整条拒绝。
- **规范链接不带 `via`**：我们只有一个服务器，又不开联邦。解析器遇到 `via` 时，只认等于自家 `server_name` 的值，其他的忽略。
- `client` 和 `web-instance[…]` 不再生成；收到了也忽略。
- `action=join` 和 `action=chat`（MSC2312 的参数）**只当提示**，不会自动执行（见 §8）。
- 自定义 scheme 的写法是 `<scheme>://open/<和 https 一样的路径>?<和 https 一样的 query>`。主机名固定是 `open`，为别的用途保留：zim 已经用了 `share`（`zim://share?inbox=`），zymi-ios 已经用了 `connectors` 和 `wallet`。**凡是能用 scheme 打开的东西，用 https 都能打开**，scheme 不提供任何额外能力。

### 4.2 可以分享的实体

| 实体 | 规范 https 链接 | scheme 链接 | 谁来打开、打开后是什么 | 来源 |
|---|---|---|---|---|
| 用户（打开资料，可发起私聊） | `/u/<localpart>:<server>`，例如 `/u/0b1f…:zymi.app` | `<scheme>://open/u/…` | 打开资料页；要发私聊得用户再点一次 | `matrix:u/` |
| 房间或群（按 ID） | `/roomid/<id 去掉 !>`（v12 的房间 ID 没有 `:server`） | `<scheme>://open/roomid/…` | 已经加入的直接打开；没加入的先显示加入页（要确认） | `matrix:roomid/` |
| 房间（按别名） | `/r/<alias 去掉 #>`，例如 `/r/team:zymi.app` | 同上 | 同上 | `matrix:r/` |
| 空间 | 和房间一样（空间就是 `m.space` 类型的房间） | 同上 | 打开空间主页 | README 里关于 Spaces 的说明 |
| 消息或事件（线程里的消息也一样） | `/roomid/<id>/e/<event 去掉 $>` | 同上 | 打开房间，跳到这条消息（`SPEC-mac-jump-to-message.md`）；消息在线程里就打开线程 | `matrix:…/e/` |
| 房间邀请 | 就是房间链接。**能不能进由服务端的 join rule 决定**，链接本身不是凭证 | — | 加入页 | — |
| 账号邀请或推荐码 | **先保留** `/invite/<code>`；码由服务端生成，一次性 | `<scheme>://open/invite/<code>` | 要有后端（Q7） | 参照 ZYMIX 的 `oia.zymix.app/invite?code=`（`InviteLinkHandler.swift:32`） |
| Zymi 任务 | `/task/<task_id>` | `<scheme>://open/task/…` | 打开任务页（zim 的 `ZymiRoute.task`） | `ZymiNavigator.swift:19` |
| Zymi 目标 | `/goal/<goal_id>` | 同上 | 打开目标 | `ZymiNavigator.swift:12, 20`；`zymi-core/src/goals` |
| Zymi 专家或智能体 | `/agent/<expert_id>` | 同上 | 打开智能体资料页 | `ZymiNavigator.swift:23-24`；`fixtures` 里的 `expert_id` 是 UUID 或 slug |
| Zymi 产物 | `/artifact/<artifact_id>` | 同上 | 打开产物 | `zymi-core/src/artifacts.rs`；卡片动作 `artifact.share`（`actions.rs:12`） |
| Zymi 圈子 | `/circle/<circle_id>` | 同上 | 打开圈子 | `zymi-core/src/circles` |
| Zymi 团队 | **先保留** `/team/<id>`。现在 `ZymiRoute.teams` 不带 ID，所以先不做 | — | — | `ZymiNavigator.swift:10` |
| 音乐帖子等由服务端生成的链接 | **不归这套语法管**：服务端给什么就分享什么（`MusicDiscoveryModels.swift:161`） | — | — | — |

**Zymi 对象的链接只用来导航**：链接里只有 ID，只有对象所属的账号能打开。现在内核和网关都没有“分享给别的账号”的概念（§2.7），跨账号分享（比如公开一个产物）需要后端提供分享令牌，**放到 Q7，v1 不做**。

### 4.3 解析结果（所有实现对外给出同一个值）

```
Link =
  | User   { user_id }
  | Room   { room: RoomId | Alias, event_id?: EventId }
  | Invite { code }                         // 先保留
  | Zymi   { kind: task|goal|agent|artifact|circle, id }
  | Legacy(Link)                            // 是从旧写法转来的，用于统计和提示，行为和新写法一样
```

解析器能识别的输入：`https://<任何一条发布线的 LINK_HOST>/…`、`<scheme>://open/…`、`https://matrix.to/#/…`、`https://<旧落地页>/#/…`（任何 host，只要片段是 matrix.to 的写法），以及 `matrix:…`、`zymix://unseal/{room|user}/…`。**判断某个 host 是不是自家的，只看本条发布线的配置**，不看链接里写了什么。

### 4.4 各写法的对照（一部分会写进测试向量）

| 输入 | 解析结果 |
|---|---|
| `https://<LINK_HOST>/roomid/abc:zymi.app/e/xyz` | `Room{!abc:zymi.app, $xyz}` |
| `https://matrix.to/#/!abc:zymi.app/$xyz?via=zymi.app` | 同上，标记为 `Legacy` |
| `https://dev.unseal.chat/AgentMessenger/to-share/#/!abc:zymi.app?via=zymi.app&client=zymixdemo` | `Room{!abc:zymi.app}`，标记为 `Legacy`（`client` 被忽略） |
| `zymix://unseal/room/%21abc%3Azymi.app?via=zymi.app` | `Room{!abc:zymi.app}`，标记为 `Legacy` |
| `matrix:u/0b1f:zymi.app?action=chat` | `User{@0b1f:zymi.app}` |
| `https://<LINK_HOST>/u/x:evil.example` | **拒绝**：服务器不是自家的（联邦关闭时） |
| `https://<LINK_HOST>/task/..%2F..` | **拒绝**：解码后含 `/` |

---

## 5. 链接在哪里生成、在哪里解析（单一来源）

**结论：语法写在本规格里，再配一份机器能读的向量文件 `zymi-services/fixtures/links/vectors.json`，里面是输入、期望的解析结果，以及期望各平台生成的链接。实现分三处，都要跑这份向量。**

1. **zymi-core 新增 `links` 模块（Rust）**：`parse(url, lane) -> Option<Link>`，`build(link, lane) -> Url`，`handoff(link, lane) -> Url`（生成 scheme 链接）。通过 UniFFI 暴露给 Swift（以后也给 Kotlin 和 C#），通过 zymi-wasm 暴露给 Web 和 Electron。zim、zymi-ios，以及以后的 Zymi 安卓和 Windows 客户端，**只通过它**生成和解析链接。
   - 赞成放在 zymi-core 的理由：zymi-core 本来就是“每个平台都用、只有一份”的内核（`README.md:1-5`），有 UniFFI、wasm，还有接口一致性检查（`check-surface.sh`）；Zymi 对象的 ID 和路由也都在内核这一侧。
   - 反对全部放进 zymi-core 的理由：IMKit（im 和 im-android）以及 ZYMIX 宿主都**不依赖** zymi-core。为了生成一条链接让 IMKit 依赖整个内核，会把 IMKit 和 Zymi 绑死。
2. **IMKit 不自带语法，只提供注入点**：
   - 把 `MatrixConfiguration.shareLinks`（现在的 `MatrixShareLinks`，只会改写片段）换成一个协议，例如 `ChatLinkBuilder`，提供 `room(id, via) / event(room, event) / user(id) -> URL`。默认实现继续生成 matrix.to 链接，这样现有的使用方不受影响。Zymi 宿主注入 zymi-core 的实现。im-android 也加同样的注入点（现在没有，`MatrixChatClient.kt:1070`）。
   - 新增宿主钩子 `openLink(URL) -> Bool`：在 App 里点到链接时**先问宿主**，宿主说已经处理了就停下，否则再按原来的规则交给系统（改三处：`MessageRowView.swift:439`、`HostMessageHooks.swift:61`、`IMChatMac/Message.swift:372`，im-android 的对应位置也改）。
3. **落地页用 JS 自己实现**，同样跑这份向量。不用 zymi-wasm：wasm 体积大，而页面只需要解析。
4. **ZYMIX（iOS 和 Android）**：要不要接这套语法取决于 Q1 和 Q4。接的话就自己实现，跑同一份向量。（只核实过 ZYMIX 安卓仓库里没有 zymi-core；zymix-im-ios 没有逐项核实，只知道它通过 SiuperMatrix 用 IMKit。）

**scheme 不是一条发布线只有一个**：zim 每个构建都注册 `zim`（`project.yml:131-134`）；zymi-ios 每条发布线一个 `callback_scheme`，生产环境的值我没看到；安卓和 Windows 现在都还没有。所以发布线配置里要有一张表，按“平台 × 发布线”给出 scheme，例如 `{ios: <callback_scheme>, macos: zim, android: <待定>, windows: <待定>}`。`handoff(link, lane, platform)` 按这张表生成链接，测试向量也要带上平台这一维。落地页按 UA 判断平台时，iPad 上的 Safari 默认用桌面 UA，和 Mac 分不出来。所以在分不清的时候，页面要把 iOS 和 macOS 两个按钮都显示出来，不能靠猜。

---

## 6. 各平台的接法

### 6.1 iOS（zymi-ios）

- **Universal links**：在每条发布线的环境配置（`Configurations/Local/<env>.json`）里写 `associated_domains: ["applinks:<LINK_HOST>"]`。构建脚本已经能把它写进 entitlements（`Scripts/environment.py:123-124, 166`），`Scripts/signing.py:30` 会检查。开发构建可以用 `applinks:<host>?mode=developer` 绕过 Apple 的 CDN 缓存。
- **AASA**（放在 `https://<LINK_HOST>/.well-known/apple-app-site-association`，`application/json`，200，不能重定向）：

```json
{"applinks":{"details":[{"appIDs":["<TEAM>.<bundle_id>"],"components":[
  {"/":"/u/*"},{"/":"/r/*"},{"/":"/roomid/*"},{"/":"/invite/*"},
  {"/":"/task/*"},{"/":"/goal/*"},{"/":"/agent/*"},{"/":"/artifact/*"},{"/":"/circle/*"},
  {"/":"/*","exclude":true,"comment":"其余路径（首页、静态资源）留给网页"}]}]}}
```

- **scheme**：沿用每条发布线已有的 `callback_scheme`（已经保证各线互不相同，`environment.py:146` 和 `173`），加一个主机名 `open`。**不新注册 scheme**（这是 iOS 那一格在 scheme 表里的值，生产环境的值见 Q3）。`ZAgentAppCallbacks.matches` 只认 `connectors` 和 `wallet`，不受影响。
- **入口**：App 根上加 `.onOpenURL`（处理 scheme）和 `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)`（处理 UL），然后交给 `zymi-core.links.parse`，再交给路由：聊天实体交给 IMKit，Zymi 实体交给 ZymiKit。链接是在登录前收到的，就先存起来，登录后再打开（ZYMIX 有同样的做法：`MainTabViewController.swift:812`，`Keys.swift:604`）。
- **生成**：`ZymiChatMatrix.swift:135` 注入 `ChatLinkBuilder`。

### 6.2 macOS（zim）

- **Universal links**：在 `ZIM.entitlements` 里加 `com.apple.developer.associated-domains`，值是 `applinks:<LINK_HOST>`；AASA 的 `appIDs` 里加上 `VZZQ2Q6734.ai.pagepeek.zim`（生产环境的 Team ID 待定，见 Q3）。注意（**待在签名构建上确认**）：macOS 上一般只有 Safari 会走 universal links，Chrome 和 Firefox 只会打开网页。所以落地页上必须有一个“在 ZIM 中打开”的按钮，用的是 scheme 链接。
- **scheme**：`zim` 已经注册（`project.yml:131-134`）。加主机名 `open`，`share` 保持原样。
- **入口**：在 `ZIMApp.swift:191` 的 `.onOpenURL` 里，在 ShareInbox 分支之后加 `open` 分支，再加 `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)`。路由到 IMChatMac（打开房间、事件或用户）或 `ZymiRoute`。`handlesExternalEvents(matching: ["*"])`（`ZIMApp.swift:40`）已经能把事件送到主窗口。
- **生成**：`AccountModel.swift:341-345` 现在只在 DEBUG 下设 `shareLinks`，改成**每个构建都**按发布线注入 `ChatLinkBuilder`。DEBUG 下的 `ZIM_E2E_SHARE_LINKS_BASE` 留着给测试用。

### 6.3 Android

- **现在没有 Zymi 安卓 App**（§2.5）。下面写的是 Zymi 安卓 App 将来要怎么接；ZYMIX 安卓要不要接看 Q1 和Q4。
- **App Links**（在 Manifest 的入口 Activity 上；参照 ZYMIX 的 `DeepLinkEntryActivity`，只透传白名单里的字段）：

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="<LINK_HOST>"/>
  <data android:pathPrefix="/u/"/><data android:pathPrefix="/r/"/><data android:pathPrefix="/roomid/"/>
  <data android:pathPrefix="/invite/"/><data android:pathPrefix="/task/"/><data android:pathPrefix="/goal/"/>
  <data android:pathPrefix="/agent/"/><data android:pathPrefix="/artifact/"/><data android:pathPrefix="/circle/"/>
</intent-filter>
<intent-filter>   <!-- 落地页交给 App 时用的 scheme -->
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="<lane scheme>" android:host="open"/>
</intent-filter>
```

- **assetlinks.json**（放在 `https://<LINK_HOST>/.well-known/assetlinks.json`）：`delegate_permission/common.handle_all_urls`，包名，加上 **Play 应用签名证书**的 SHA-256，不是本地 upload key 的（ZYMIX 在 `AndroidManifest.xml:209-212` 的注释里踩过这个坑）。
- **为什么不用片段**：minSdk 是 26，App Links 匹配不了片段，旧的 `#/…` 链接只能先到落地页，再由落地页交给 App（§7）。
- **im-android**：加 `ChatLinkBuilder` 注入点（`MatrixChatClient.kt:1070`）和 `openLink` 宿主钩子。发出去的 pill 维持 matrix.to 的写法（`MatrixOutgoingHtml.kt:52`，D3）。

### 6.4 Windows（要等 Q5）

- **注册 scheme**：
  - 不打包的应用：在 `HKCU\Software\Classes\<scheme>` 下写 `URL Protocol` 和 `shell\open\command`。
  - MSIX：在 manifest 里加 `uap:Extension Category="windows.protocol"`。
  - Electron：`app.setAsDefaultProtocolClient(scheme)`，再用 `requestSingleInstanceLock()` 和 `second-instance` 事件从 argv 里取到 URL。
- **https 链接直接打开 App**：只有打包成 MSIX 才能用 `uap3:AppUriHandler`，还要在 `https://<LINK_HOST>/.well-known/windows-app-web-link` 放一个 JSON；浏览器那边支持得也不全。所以在 Windows 上，**落地页加“在 App 中打开”按钮是主要路径**。
- 收到链接后照样交给 `zymi-core.links.parse`：C# 通过 `uniffi-bindgen-cs`，Electron 通过 zymi-wasm。
- **这一节现在没法给出能跑的 E2E**，等 Q5 定了再补。

### 6.5 网页回退（落地页）

- **每个规范路径都由落地页接住**：App 没装、系统没把链接交给 App，或者在桌面浏览器上打开时，都会落到这里。
- 页面内容按顺序是：
  1. 品牌标题，加一句“这是一个 ZYMI 的 <实体类型> 链接”。**不显示实体详情**（§8.3）。
  2. 主按钮“在 App 中打开”，指向 `handoff(link, lane, platform)` 生成的 scheme 链接（scheme 表见 §5 末尾）。分不清平台时，同时显示几个平台的按钮。
  3. 按 UA 显示的下载入口：App Store、Mac App Store、Play、Windows 下载页，具体 ID 见 Q9。
  4. 如果有 Web 客户端，再加“在网页中继续”（Q8）。
- 落地页接到旧的片段链接（`/#/…`）时，在浏览器里解析，用 `location.replace` 换成规范路径，再走上面的流程。解析失败就显示“链接无效”，**不跳转**。
- `.well-known/` 下面放 `apple-app-site-association`、`assetlinks.json`，以后可能还有 `windows-app-web-link`。都由每条发布线的配置生成，Content-Type 是 `application/json`，不能重定向。
- 响应头：严格的 CSP（`script-src 'self'`，没有 `unsafe-inline` 和 `unsafe-eval`，`connect-src 'none'`，`frame-ancestors 'none'`）、HSTS、`Referrer-Policy: no-referrer`。
- 预览卡片（OG）：只用统一的品牌图和文字，不按实体生成。按实体生成要后端来做，而且要过 §8.3 的规则。

---

## 7. 旧链接怎么办

| 旧链接 | 在 App 里点到 | 系统级打开 | 在浏览器里打开 |
|---|---|---|---|
| `https://matrix.to/#/…` | 解析器认，直接在 App 里打开 | matrix.to 是 matrix-org 的域名，我们没法声明归属 | 还是由 matrix.org 的页面处理，我们管不了。上游的客户端列表里没有 ZYMI；新消息里的 pill 也还是这个写法，但 pill 在 App 内点击，见 D3 |
| `https://dev.unseal.chat/AgentMessenger/to-share/#/…?client=…` | 解析器认 | 现在 AASA 只认 `U633M9A2Z3.www.topsecret.network`，以后也不会加 | **Q11**：如果这个页面继续留着，给它加一小段脚本，把片段转成 `https://<LINK_HOST>/…` 再跳过去；如果撤掉，这些链接就失效了 |
| `zymix://unseal/{room|user}/…` | ZYMIX 继续处理；Zymi 客户端的解析器也认 | — | — |
| `matrix:` URI | 解析器认 | 不注册 `matrix` scheme：Element 等别的客户端也会抢 | — |
| 消息里已经发出去的 pill | 两端判断 pill 的代码不看域名（§2.2、§2.5），继续能用 | — | — |

**推出顺序（不能乱）**：
1. 所有客户端的解析器先发版，包括 `openLink` 钩子。
2. 落地页和 `.well-known` 上线，并检查通过。
3. 客户端才开始**生成**新链接。

如果反过来，先生成了新链接，旧版本的客户端点到会被交给浏览器，只能靠落地页兜底。

---

## 8. 安全

### 8.1 开放重定向

- 落地页只会跳到三类地址：自己拼出来的 scheme 链接（只用解析出来的类型和 ID 重新编码）、写死的商店地址、本域名下的规范路径。**链接里的任何地址都不会被当成跳转目标**。删掉 `web-instance[…]` 和 `client`。
- ID 必须通过 §4.1 的检查（字符集、长度、不能含 `/`）。不通过就显示“链接无效”，HTTP 状态码 404，**不跳转**。
- App 内也一样：`openLink` 只处理解析成功的链接，其他链接按原规则交给系统（只放行 http 和 https，不能带凭据，现有的规则保持不变）。

### 8.2 冒充和劫持

- **自定义 scheme 谁都能注册**：iOS、Android、Windows 上都没法保证 scheme 归谁。所以 scheme 链接里不放任何凭据或令牌；**会改状态的动作**（加入房间、发起私聊、接受邀请）都要在 App 内确认。确认页显示解析出来的房间名、服务器和成员数，这些信息要登录后从自家服务器取。
- **自动加入**：`Zymix.js:17-19` 和 `Coor.swift:211` 写的是“打开就加入”，这一点要改成“先确认”（ZYMIX 那边的改动见 §9）。
- **只认自家服务器**：联邦关闭，所以用户、房间、别名的服务器不是本条发布线的 `server_name` 时，直接拒绝，并提示“不是 ZYMI 的链接”；`via` 一律不参与解析。
- **长得像的链接**：在 App 里点链接时，打开前的确认页显示的是真实目标，而不是消息里的链接文字。宿主钩子拿到的是真实的 URL，不是锚文本。
- **两个 App 抢同一个域名**：ZYMI 和 ZYMIX 不能出现在同一个域名的 AASA 和 assetlinks 里（Q4），否则系统会随便选一个。

### 8.3 没登录的访客在回退页上能看到什么

- **v1：只能看到实体类型**，比如“一个群聊”“一个任务”。看不到名字、头像、成员数、消息内容，也看不到 ID 对应的人。原因有三：
  - matrix.to 的预览会向任意 `via` 服务器发请求，暴露访客的 IP，内容也可能被伪造（`PreviewViewModel.js:46-59`）；
  - homeserver 的模板没有限制谁能读资料（§2.8），把落地页做成资料查询接口，就等于对外开了一个查询口；
  - 公开的房间和资料要另外设计，见 Q7。
- 落地页**不向任何 homeserver 或网关发请求**（CSP 的 `connect-src 'none'` 强制保证）。
- 服务器日志里会出现路径上的 ID，这是放弃片段的代价。由于 homeserver 和落地页都是我们自己的，这是可以接受的；日志的保留时间按现有策略执行。链接里**永远**不放令牌。

### 8.4 打开时的规则

- Zymi 对象只有所属账号能打开。网关返回 403 或 404 时，App 都显示“打不开这个链接”，**不暴露对象是否存在**。
- **Matrix 可选模式**（`matrix_chat` 关闭，T23）：聊天链接显示“需要先开启聊天”，不报错也不登出；Zymi 对象的链接照常能用。
- **多个账号**：用当前账号打开；打不开的话就是上面那句“打不开这个链接”。v1 不自动切换账号。

---

## 9. 各仓库的改动清单

每一项都是一个小任务。证明手段按 `~/.claude/CLAUDE.md` 的要求，优先用 E2E，**每项都要留下可以重复跑的产物**（`artifacts/…/summary.json` 加截图），检查项都配了对照组（对照组故意弄错一处，必须失败）。对纯解析器这类只能单独测的部分，按规矩**先列出所有可能失败的情况（也就是测试向量），再写代码**。

### 9.0 先决定（不改代码）

| ID | 内容 | 什么算完成 |
|---|---|---|
| L0 | 负责人回答 Q1–Q4、Q6、Q9、Q11 | 本规格的状态改成“已批准”，`<LINK_HOST>` 换成实际的值 |
| L1 | 定下测试向量：`zymi-services/fixtures/links/vectors.json`，至少覆盖 §4.4 的全部行，加上各类非法输入（坏的编码、过长、`/`、外部服务器、`javascript:`、`client=` 和 `web-instance[]`） | 向量本身经过评审。**它就是失败清单** |

### 9.1 zymi-services（zymi-core）

| ID | 任务 | 怎么证明 |
|---|---|---|
| C1 | `crates/zymi-core/src/links.rs`：`parse`、`build`、`handoff`，带发布线配置（host 列表、scheme、server_name） | `cargo test` 跑完全部向量。**对照组**：把向量里的一项期望值改掉，测试必须失败 |
| C2 | 通过 zymi-ffi 和 zymi-wasm 暴露出去；`check-surface.sh` 通过 | `apple/ZymiCore` 的 Swift 测试，和 `scripts/test-web.sh` 里的 wasm 测试，跑同一份向量 |

### 9.2 落地页（`zymi-matrix.to`；用哪个仓库见 Q12）

| ID | 任务 | 怎么证明 |
|---|---|---|
| P1 | 换成精简的新页面：只做路由（规范路径加旧片段）、换品牌、“在 App 中打开”和商店入口；删掉预览、客户端列表、`client` 和 `web-instance`。保留 Apache-2.0 的版权声明 | 用 Playwright 对本地构建跑每一条向量 URL：页面显示的实体类型对，“打开”按钮的 href 等于向量里该平台期望的 scheme 链接（用 Playwright 模拟各平台的 UA）；恶意输入不跳转。除了同源的静态文件，不发任何网络请求（Playwright 记录所有请求，非同源请求数必须为 0）。产物：`artifacts/landing/<ts>/summary.json` 和截图。**对照组**：同样的测试拿去跑上游 matrix.to 的构建，必须失败（有预览请求，`client` 参数会生效） |
| P2 | 按发布线生成 `.well-known/apple-app-site-association` 和 `assetlinks.json` | 本地：生成的 JSON 符合 §6.1 和 §6.3 的格式，`appIDs` 和包名等于发布线配置。部署后：`curl -sI` 返回 200，`application/json`，没有重定向；`https://app-site-association.cdn-apple.com/a/v1/<LINK_HOST>` 能拿到；`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<LINK_HOST>&relation=delegate_permission/common.handle_all_urls` 能列出这个包。结果写进 `summary.json` |
| P3 | 部署（托管和 DNS 见 Q6），加上 CSP 和 HSTS 等响应头 | 用 `curl` 抓响应头存下来；用 Playwright 打开线上页面，确认控制台没有 CSP 报错 |
| P4 | 如果 Q11 决定留着旧落地页：给 `dev.unseal.chat/…/to-share/` 加跳转脚本，在 `../matrix.to` 里改 | 用 Playwright 打开旧链接，最后的 URL 等于规范链接。**对照组**：无效的旧片段停在“链接无效”页 |

### 9.3 im（IMKit Swift）

| ID | 任务 | 怎么证明 |
|---|---|---|
| I1 | 新增 `ChatLinkBuilder` 协议；`MatrixShareLinks` **保留**，改成这个协议的一个内置实现，因为 ZYMIX 在 `zymix-im-ios/SiuperMatrix/Sources/SiuperMatrix/MatrixDemoRuntime.swift:415-416` 里直接构造它；默认实现还是 matrix.to。同时**去掉 pill 的改写**（`MatrixOutgoingHTML.swift:21-31`），让 pill 始终是 matrix.to 写法（D3）；这会改变 ZYMIX 发出去的 pill（见 X2） | zim 的 `MessageShareTests` 和 `SpaceSettingsTests`：DEBUG 环境变量 `ZIM_E2E_SHARE_LINKS=matrixto` 让 zim 不注入（作为对照），这时还是 matrix.to；默认注入时等于向量。`MentionTests.swift:62` 在注入状态下仍然断言 matrix.to 的 pill |
| I2 | 宿主钩子 `openLink(URL) -> Bool`，在 iOS 的 `MessageRowView.swift:439`、`HostMessageHooks.swift:61` 和 Mac 的 `Message.swift:372` 这三个地方先问宿主 | 见 Z3 和 S3 |
| I3 | 判断收到的 pill 时，也认规范的 `/u/` 路径写法（`MatrixHTML.swift:119-140`）；**发出去的写法不变** | 给 `MatrixHTML` 已有的集成测试加 `/u/` 路径写法的 pill。对照组：外部 host 加上非 `@` 开头的路径，不能被当成 pill |

### 9.4 zim（macOS）

| ID | 任务 | 怎么证明（XCUITest，用 `scripts/e2e.sh -only-testing:ZIMUITests/DeepLinkTests/...` 跑） |
|---|---|---|
| Z1 | 在 `ZIMApp.swift` 里加 `zim://open/…` 的入口，调用 `zymi-core.links.parse`，再路由到 IMChatMac 或 `ZymiRoute` | 测试用 `NSWorkspace.open` 打开 `zim://open/roomid/<种子房间>` 后，中栏是这个房间；打开 `…/e/<事件>` 后，跳到那条消息并高亮；打开 `zim://open/task/<id>` 后进到任务页；没加入的房间先出确认页；外部服务器、以及 `zim://open/../x` 这类输入不跳转，并给出提示。截图放在 `artifacts/e2e/<ts>/`。**对照组**：`zim://share?inbox=` 的分享流程不受影响（`ShareTests` 照样通过） |
| Z2 | 正式构建按发布线注入 `ChatLinkBuilder`，同时改掉断言 matrix.to 的几个测试（`SpaceSettingsTests.swift:147`、`MessageShareTests.swift:177, 181`；`MentionTests.swift:62` 保持不变，因为 pill 的写法不变） | 复制房间链接和消息链接，结果等于向量。**来回测试**：把复制出来的链接再用 Z1 的方式打开，要回到同一个房间、同一条消息 |
| Z3 | 实现 `openLink` 钩子：在消息里点到自家链接时，在 App 内跳转 | bob 发一条带 `https://<LINK_HOST>/roomid/…` 的消息，alice 点了以后在 App 内打开，**没有拉起浏览器**（断言 Safari 进程没有变化）。对照组：`https://example.com` 照样交给系统 |
| Z4 | entitlements 加 associated domains，加 `.onContinueUserActivity` | **只能在签好名、域名已经上线的 staging 环境验证**：用 Safari 打开 https 链接，应该进到 ZIM。本地 E2E 跑不了，要写明这一点 |

### 9.5 zymi-ios

| ID | 任务 | 怎么证明 |
|---|---|---|
| S1 | 在环境配置里加 `associated_domains`；App 根上加 `.onOpenURL` 处理 `<scheme>://open/…`，加 `.onContinueUserActivity` 处理 UL；登录前收到的链接先存起来 | 在模拟器上用 XCUITest：`xcrun simctl openurl booted '<scheme>://open/task/<id>'` 打开任务；在登录页收到的链接，登录后自动打开。截图加 `summary.json`。**对照组**：`<scheme>://connectors` 这条回调不受影响 |
| S2 | `ZymiChatMatrix.swift:135` 注入 `ChatLinkBuilder` | 在 App 内复制房间链接，结果等于向量 |
| S3 | 实现 `openLink` 钩子 | 同 Z3，iOS 版 |
| S4 | Universal link 端到端 | 用 `?mode=developer` 的开发构建，加上 staging 域名，在真机或模拟器上从 Safari 打开 https 链接，应该进到 App |

### 9.6 im-android

| ID | 任务 | 怎么证明 |
|---|---|---|
| A1 | `ChatLinkBuilder` 注入点（`MatrixChatClient.kt:1070`），`openLink` 钩子，pill 也认 `/u/` 写法 | `sample` 模块的 androidTest：注入后房间信息里的链接等于向量（`Phase25Test.kt:64` 现在断言的是 matrix.to，作为对照）；在消息里点到自家链接时调用了钩子 |

### 9.7 范围外但相关（要单独决定）

| ID | 仓库 | 任务 |
|---|---|---|
| X1 | `../matrix.to`（unseal fork） | **马上可以修的缺陷**：在 ZYMIX 安卓支持 `zymix://unseal/…` 之前，把 Android 从 `Zymix.js:38-46` 的平台列表里拿掉。要不要修由负责人决定 |
| X2 | zymix-im-ios | 把 `zymix://unseal/room` 改成“先确认再加入”（§8.2）；I1 发布后，确认 `MatrixShareLinks(base:clientID:)` 照常能用，并接受 pill 不再改写到 `dev.unseal.chat`；如果 Q1 和 Q4 决定共用语法，再接 §4 的写法 |
| X3 | zymix-im-android-cloud | 在 `DeepLinkRouter` 里加 `/unseal/room/{id}` 和 `/unseal/user/{id}`，或者按 Q1 接 §4 的写法 |
| W1 | Windows（仓库还没有） | Q5 定了以后：注册 scheme、单实例转发，MSIX 的话再加 AppUriHandler；E2E 用 `start <scheme>://open/…` 打开，检查窗口里显示的内容 |
| B1 | 运维（仓库未知） | 每条发布线的 `<LINK_HOST>` 的 DNS 和 TLS；`zymi.app/.well-known/matrix/client`（`SPEC-zymi-matrix-session.md:156`） |
| B2 | 网关（仓库未知） | 以后要做的：分享令牌和公开预览接口（Q7） |

**建议顺序**：L0 → L1 → C1 → C2 → I1、I2、I3 → Z1、Z3、S1、S3、A1（只做解析，不生成） → P1、P2、P3 → Z4、S4 → Z2、S2（开始生成新链接） → P4、X1–X3 → W1。

---

## 10. 验收

- 所有客户端和落地页都跑通同一份向量：Rust、Swift（经过 ZymiCore）、wasm、JS 四份结果一样。
- 链接能来回：每个平台生成的房间、消息、用户、任务链接，再从这个平台打开，回到同一个对象（Z2、S2）。
- 旧链接：§7 表格里的每一行都至少有一个 E2E 覆盖。
- 安全：P1 的恶意输入全部不跳转、不发网络请求；Z1、S1 遇到外部服务器一律拒绝；加入房间一定要先确认。
- 产物：每一项都有 `summary.json` 和截图，截图要人看过（zim 的 `CLAUDE.md` 要求：“断言通过不等于界面没问题”）。

---

## 11. 要负责人回答的问题

| # | 问题 | 为什么要问 | 建议 |
|---|---|---|---|
| Q1 | 分享链接属于哪个产品：ZYMI（zim、zymi-ios，域名 `zymi.app`）、ZYMIX（`zymix.io`，已有 `oia.*` 这套 UL），还是两个都要？ | 代码里有四组域名（§3），都可以说是“我们的产品域名” | ZYMI 用 `zymi.app` 的子域名；ZYMIX 保留自己的 `oia.zymix.io` |
| Q2 | 具体 host 叫什么，每条发布线怎么命名？（`to.zymi.app`、`link.zymi.app`？加 `-dev`、`-testing` 后缀？） | AASA、assetlinks、entitlements 都要写死这个值 | 用专用子域名，每条发布线一个 |
| Q3 | 生产环境的 Bundle ID 和 Team ID：zymi-ios 只有本地的 `local.zymi.dev`；zim 的 `VZZQ2Q6734` 在 `Unseal.js` 的注释里被称为开发团队。安卓的包名和 Play 签名 SHA-256 是什么？zymi-ios 生产环境的 `callback_scheme` 是什么，安卓和 Windows 用什么 scheme（scheme 表，§5）？ | AASA 和 assetlinks 要用 | — |
| Q4 | 一台设备上同时装了 ZYMI 和 ZYMIX，聊天链接应该由哪个打开？ | 两个 App 不能在同一个域名上抢链接（§8.2） | 用不同的域名，各开各的 |
| Q5 | Windows 客户端：C#（uniffi-bindgen-cs）还是 Electron（zymi-wasm）？打不打包成 MSIX？仓库在哪？ | 决定 §6.4 用哪种做法、W1 怎么测；`PCScanLoginRouteHandler` 说明可能已经有一个 PC 客户端 | — |
| Q6 | 落地页托管在哪里（`dev.unseal.chat` 那个页面是怎么部署的？），DNS 归谁管？ | 两个仓库里都没有部署配置 | — |
| Q7 | Zymi 对象（产物、目标、任务）要不要支持跨账号分享或公开？要的话需要后端提供分享令牌和公开预览 | 内核和网关都没有这个概念 | v1 只做本账号内的导航链接 |
| Q8 | 有没有可以回退过去的 Web 客户端（`SPEC-zymi-web.md` 里提到了，但还没有 App）？ | 决定落地页上要不要“在网页中继续” | v1 不做 |
| Q9 | 各商店的 ID：ZYMI 的 App Store 和 Mac App Store、Play、Windows 下载页 | 落地页的下载入口要用 | — |
| Q10 | 发出去的 pill 是不是永远用 `https://matrix.to/#/@…`？ | 能和 Element 等客户端互通；我们的接收方本来就不看域名 | 是 |
| Q11 | 旧落地页 `dev.unseal.chat/AgentMessenger/to-share/` 留不留？域名归谁？ | 决定已经发出去的旧链接会不会失效 | 留着，加一个跳转 |
| Q12 | 新落地页放在哪个仓库：`zymi-matrix.to`（现在和上游一样，没改过），还是把 `unseal-network/matrix.to` 的改动搬过来，或者另开一个仓库？ | 新页面需要的东西和 matrix.to 差别很大 | 就在 `zymi-matrix.to` 里重写成精简版，保留许可证 |

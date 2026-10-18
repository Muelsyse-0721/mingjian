# GitHub Desktop 公开发布指南（新手一步一步版）

> 适用场景：你已经在 GitHub Desktop 里打开了一个仓库，想把代码**公开发布（Public）**到 GitHub，让任何人都能看到。
> 本指南以 Mac 版 GitHub Desktop 为例，Windows 只是菜单名位置略有差异，名称完全一致。

---

## 0. 先搞清楚：你打开的是哪个仓库？

看你截图里的 **Current Repository** 显示的是 `desktop-tutorial`。

- `desktop-tutorial` 是 GitHub 官方给新手练习用的**教程仓库**，不是你的项目。
- 如果你只是想把教程走通一遍，直接按本文「路线 A」操作即可（发布一个空的练习仓库也没问题）。
- 如果你真正想发布的是**自己的项目**，例如本地文件夹 `/Users/wangxiaoli/WorkBuddy/workbuddy-键政游戏`，请按「路线 B」先把本地仓库加进来，再执行后面的发布步骤。

### 路线 A：就用当前的 `desktop-tutorial`
不用做任何切换，直接看第 2 节。

### 路线 B：换成自己的本地项目
1. 顶部菜单 `File`（文件）→ `Add Local Repository…`（添加本地仓库）。
   - 也可以点左上角 **Current Repository** 下拉框 → `Add`（添加）→ `Add Local Repository…`。
2. 在弹出的窗口点 `Choose…`（选择），选中你的项目文件夹（例如 `workbuddy-键政游戏`），再点 `Add Repository`。
3. 如果提示 **"This directory does not appear to be a Git repository. Would you like to create a repository here instead?"**（这个目录不是 Git 仓库，是否要在这里创建仓库？）
   - 说明该文件夹还没初始化过 Git，点 **`create a repository`**（创建仓库）按向导走完即可。
   - 或者打开终端，在该文件夹执行 `git init`，再回来 `Add Local Repository`。
4. 添加成功后，左上角 **Current Repository** 会变成你的项目名，**Current Branch** 一般是 `main`。

> 小提示：如果左侧显示 "0 changed files"、底部有 `Commit to main` 按钮，说明仓库已就绪，可以发布。

---

## 1. 发布前自查（务必先做，公网无法撤回）

**公开发布 = 全世界都能看到、能被搜索引擎抓取、能被爬虫批量下载。** 发布前请确认下面几件事：

1. 点左侧 **Changes**（更改）标签，逐个看一遍将要上传的文件列表。
2. 确认**没有**把下面这些内容提交上去：
   - `.env`、`.env.local` 等环境变量文件（里面常有 API Key、数据库密码）
   - 任何密钥文件：`*.pem`、`*.key`、`id_rsa`、`credentials.json`
   - 数据库文件：`*.sqlite`、`*.db`、导出的 `*.sql` 备份
   - 内部资料：`app/sql/`、`app/test/`、`app/tools/` 这类内部脚本/测试数据
   - 个人隐私：手机号、身份证、真实姓名、内部聊天记录截图
3. 在仓库**根目录**放一个 `.gitignore`，把不该进仓库的东西排除掉。本项目已有 `.gitignore`，内容可参考：

   ```gitignore
   # 本地工作区数据（项目记忆/应用标记），不进仓库
   .workbuddy/

   # 发布应用标识文件
   *.genie

   # 依赖与系统垃圾
   node_modules/
   .DS_Store
   Thumbs.db

   # 日志与临时文件
   *.log
   *.tmp
   nohup.out

   # 环境变量与密钥（强烈建议加上）
   .env
   .env.*
   *.pem
   *.key
   ```

4. 如果某个文件已经被提交过，光加 `.gitignore` 是**不会**把它从历史里删掉的，需要单独处理（`git rm --cached 文件名` 后再提交）。不确定时，先不要发布，找懂的人确认。

> 一句话原则：**不确定要不要公开的文件，就当它不能公开。**

---

## 2. 打开「发布仓库」窗口

两种方式，任选其一：

- **方式一（推荐）**：顶部菜单栏 `Repository`（仓库）→ `Publish repository…`（发布仓库…）。
- **方式二**：点右侧 **Get started** 清单里的第 5 步 **`Publish to GitHub`**（发布到 GitHub）。

如果这两处都点不动或找不到 `Publish`，说明当前仓库**已经发布过了**（只是可能还是私有），跳到第 6 节看怎么改可见性。

---

## 3. 弹窗里的关键设置（这一步最容易出错）

弹出窗口里有 4 个地方要填：

| 字段 | 说明 | 怎么填 |
| --- | --- | --- |
| **Name** | 仓库名，会出现在网址里 | 例如 `mingjian`、`workbuddy-game`。只能用英文、数字、`-`、`_`，建议全小写 |
| **Description** | 仓库简介，可留空 | 一句话说明项目是什么，例如「键政模拟游戏 · 联机版」 |
| **Keep this code private** | **私有/公开开关（最重要）** | **要公开发布 → 必须取消勾选** |
| **Organization** | 归属账户 | 一般选你的**个人账号**（就是你头像旁边那个名字）；只有想放到某个组织名下才换 |

### 重点解释 `Keep this code private`

- **勾选** = Private（私有）：只有你自己（和被邀请的协作者）能看到。
- **取消勾选** = Public（公开）：所有人都能看到。

⚠️ GitHub Desktop 某些版本**会默认勾选**这一项。发布前请**盯着这个勾选框确认它是空的**，不要凭印象点下一步。

勾选状态确认无误后：

---

## 4. 点 `Publish repository` 按钮

1. 点窗口右下角的 **`Publish repository`**（发布仓库）。
2. 等待进度条走完（项目大或网速慢时，几十秒到几分钟都正常）。
3. 完成后窗口会自动关闭，顶部出现 **`Push origin`** 区域，说明本地已和线上仓库连上了。

---

## 5. 验证是否真的公开了（必做）

发布成功后 GitHub Desktop 一般会给出一个 **`View on GitHub`**（在 GitHub 上查看）链接，点它；或者手动打开浏览器：

```
https://github.com/你的用户名/仓库名
```

例如用户名是 `wangxiaoli`、仓库名是 `mingjian`，就访问 `https://github.com/wangxiaoli/mingjian`。

检查三处：

1. 仓库标题**右边**有灰色的 **`Public`** 标签 → 说明是公开的。
   （如果显示 `Private`，说明还是私有，见第 6 节。）
2. 页面上方能看到 `Code` / `Issues` / `Pull requests` / `Actions` 等菜单 → 说明仓库正常创建。
3. **换个浏览器或开无痕窗口**访问同一个地址，不登录也能看到内容 → 这才是「真的公开」。

---

## 6. 已经发布成私有，想改成公开

不用重新发布，直接在网页上改：

1. 打开 `https://github.com/你的用户名/仓库名`。
2. 点顶部导航的 **`Settings`**（设置）。如果看不到 Settings，说明当前登录的不是仓库所有者。
3. 左侧栏选 **`General`**（常规），一直拉到页面**最底部**的 **`Danger Zone`**（危险区域）。
4. 找到 **`Change repository visibility`**（更改仓库可见性），点右边的 **`Change visibility`** → 选 **`Change to public`**（改为公开）。
5. 弹窗会要求你**手动输入仓库全名**（如 `wangxiaoli/mingjian`）确认，输入后点确认按钮。
6. 回到仓库首页，看到 `Public` 标签即成功。

> 反向操作（公开改私有）路径完全一样，选 `Change to private` 即可。

---

## 7. 发布之后：以后怎么更新代码

发布只是第一次「把本地推上去」。之后每次改完代码：

1. 左侧 **Changes**（更改）里会列出改动文件，**先扫一眼有没有敏感信息**。
2. 左下角 **Summary**（摘要）填一句说明，例如 `fix: 修复下注结算`。
3. 点 **`Commit to main`**（提交到 main 分支）。
4. 点顶部的 **`Push origin`**（推送到远端）。
5. 刷新网页即可看到更新。

---

## 8. 常见问题（照着排查）

**Q1：顶部没有登录 / Publish 后报权限错误**
- Mac：屏幕左上角 `GitHub Desktop` 菜单 → `Settings…`（设置）→ `Accounts`（账户）→ 确认已用 GitHub 账号登录，没有就 `Sign in`。
- Windows：`File` → `Options` → `Accounts`。
- 如果 GitHub Desktop 客户端登录了但网页没登录，两者是独立的，需要分别登录。

**Q2：弹窗里没有 `Organization` 选项**
正常，说明你只属于个人账户，默认发到自己名下即可。

**Q3：`Repository → Publish repository…` 是灰色的点不了**
- 当前仓库已经发布过了（去网页确认可见性）；
- 或者当前没有选中任何仓库（看左上角 Current Repository 是否为空）。

**Q4：发布时提示仓库名已存在**
说明你的账号下已经有同名仓库。改个 `Name`（例如加后缀 `-game`），或去把旧仓库改名/删除。

**Q5：发布成功后网页 404**
1. 确认网址里的用户名、仓库名拼写正确（区分大小写建议全小写）；
2. 私有仓库在未登录状态下访问就是 404，这恰恰说明它还是私有的；
3. 刚发布完等 10–30 秒再刷新。

**Q6：仓库建错了 / 想删掉这个公开仓库**
网页 → 该仓库 → `Settings` → 拉到最底 `Danger Zone` → **`Delete this repository`**（删除此仓库）→ 按提示输入仓库全名确认。
⚠️ 删除不可恢复，本地文件夹不受影响，但线上历史、Issue、Star 都会消失。

**Q7：不小心把密钥推上去了怎么办**
1. 立刻去对应平台**吊销/重置**那个密钥（改密码、重新生成 Token）——这是第一步，比删文件重要；
2. 再考虑清理 Git 历史（需要 `git filter-repo` 等工具，属于进阶操作）；
3. 公开仓库的历史是可能已被爬虫抓取的，**默认按「已泄露」处理**。

---

## 9. 一页速查（发布流程浓缩版）

1. 确认当前仓库是自己的项目（不是的话 `File → Add Local Repository…`）。
2. 看 **Changes** 面板，确认没有 `.env`、密钥、内部文件。
3. 顶部 `Repository` → `Publish repository…`。
4. 填 `Name`、`Description`，选个人账号。
5. **取消勾选 `Keep this code private`**（= 公开）。
6. 点 `Publish repository`，等进度完成。
7. 打开 `https://github.com/用户名/仓库名`，确认有 **`Public`** 标签。
8. 用无痕窗口再访问一次，确认未登录可见。
9. 以后更新：`Commit to main` → `Push origin`。

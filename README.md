# 小卡日记 iPhone个人安装

此目录是手机端构建源码，不是已签名安装包。目标设备为用户的iPhone 13、iOS 26.3.1。后端仍是原固定电脑，地址为 https://desktop-7nla9nf.taila5d3f3.ts.net 。网页与安装版使用原账号登录后同步同一份日记。

## 云端编译

1. 将此目录的**内容**放到用户已确认的GitHub仓库 https://github.com/javaPengh/xiaoka-ios 根目录，包括`.github`目录。用户选择保留公开；此包仅含手机端源码及已确认的服务器地址。ZIP不能原样作为一个文件上传；也不要上传完整开发项目或服务器目录。
2. 当前公开仓库使用标准GitHub Mac构建机，适用GitHub公开仓库免费规则；上传代码不会自动执行本流程，不启用付费大型构建机。
3. 仓库页面选择Actions → Build iPhone IPA (unsigned) → Run workflow。流程只读取源码，使用标准macOS构建机，不使用Apple账号或签名证书。
4. 构建完成后，从该次运行的Artifacts下载`xiaoka-diary-unsigned-编号`，解压取得`xiaoka-diary-unsigned.ipa`。失败时查看同一产物中的`xcodebuild-release.log`。

工作流用锁定依赖构建网页、同步Capacitor、检查原生入口，再用Xcode 26以上编译arm64手机程序。仅手动触发，单次最长45分钟，云端产物保留7天。未签名IPA还不能直接安装；`build-info.json`记录实际编译版本及签名状态。

## Windows签名与安装

使用个人安装工具（如Sideloadly官方 https://sideloadly.io/ ）给本项目自建IPA签名并安装。Apple账号密码及验证码由用户在安装工具中输入，不放进代码、GitHub Secrets或聊天。

首次通过USB连接iPhone，解锁并信任电脑。工具所需的Apple驱动、开发者模式和设备信任按实际安装提示设置。普通Apple账号的个人签名有效期通常为7天，需要续签。自动续签是否稳定，要以这台Windows电脑与手机实际配对、同网连接和连续使用结果为准。

安装后用原小卡账号登录。验证：原有日记同步；断网新增记录并重开仍在，恢复网络后只同步一次；拍照/相册选择；后台返回及重新启动后的登录保持。全部在真机通过后才算完成iPhone交付。

## 构建输入

上传包仅含客户端、共享数据结构、iOS工程、所需构建脚本及锁文件。没有服务器源码、个人日记、照片、数据库、模型、`.env`、证书或Apple凭据。手机端构建变量只有服务器地址和账号模式。

开发电脑可先执行`npm ci`、`npm run build`、`npx cap sync ios`、`npm run ios:prepare`及`node scripts/check-ios-project.mjs`，但Windows上的结构检查不等于Xcode编译或真机验证。

参考：[GitHub Actions计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[Capacitor 8](https://capacitorjs.com/docs/updating/8-0)、[Apple个人设备测试](https://developer.apple.com/help/account/basics/about-your-developer-account)。

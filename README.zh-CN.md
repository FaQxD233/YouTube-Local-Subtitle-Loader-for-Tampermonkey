# YouTube Local Sub幕

[English README](./README.md)

Greasy Fork：

https://greasyfork.org/zh-CN/scripts/547019-youtube-local-subtitle-loader

在YouTube中加载你的本地字幕，并且可以注入到CC字幕选择器中

可以在cc字幕选择器中切换视频本来有的字幕和本地字幕

自动在英语和中文中选择，由浏览器语言决定

脚本可能会触发 YouTube 的反广告拦截系统，因此视频前可能会有6秒的广告

如果不修改 playerResponse/ytInitialPlayerResponse，又不能注入字幕到 CC 字幕选择器中，所以我现在是没招了。

v1.1 试着跳过这 6 秒的假广告

---

基于Tampermonkey的YouTube字幕插件，可以将本地.srt字幕加载到播放器内

greasyfork链接：

https://greasyfork.org/zh-CN/scripts/547019-youtube-local-subtitle-loader

让gemini花了5分钟写出来的代码，可能有bug，但我不会写这个，只能说能跑就行（

理论上打开youtube就会有个加载字幕按钮在播放器下面那行最右边

起因是想在没有自动cc字幕的视频里加载字幕，但是不知道怎么调用cc字幕，就直接另外单独渲染了

用opencode和gpt5.5又优化了一下，现在最新版可以直接注入到CC字幕选择器中，可以在cc字幕选择器中切换视频本来有的字幕和本地字幕，自动在英语和中文中选择，由浏览器语言决定

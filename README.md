基于Tampermonkey的YouTube字幕插件，可以将本地.srt字幕加载到播放器内

greasyfork链接：

https://greasyfork.org/zh-CN/scripts/547019-youtube-local-subtitle-loader

让gemini花了5分钟写出来的代码，可能有bug，但我不会写这个，只能说能跑就行（

理论上打开youtube就会有个加载字幕按钮在播放器下面那行最右边

起因是想在没有自动cc字幕的视频里加载字幕，但是不知道怎么调用cc字幕，就直接另外单独渲染了

用opencode和gpt5.5又优化了一下，现在最新版可以直接注入到CC字幕选择器中，可以在cc字幕选择器中切换视频本来有的字幕和本地字幕，自动在英语和中文中选择，由浏览器语言决定

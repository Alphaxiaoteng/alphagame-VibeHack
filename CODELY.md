

## Codely Structured Memories

### User

### Feedback
- [2026-10-31 08:12:18] 《查房》项目工作纪律（用户 2026-10-31 要求）：每完成一个可验收节点，当次随手同步 IMPLEMENTATION_STATUS.md 与 README.md 的对应数字与记录（文档即真相源，规则已写入 AGENTS.md §5 进度同步纪律）；同时严守 AGENTS.md §2 防上下文污染（按需切片读取、终端输出限流）。
### Project
- [2026-10-31 09:05:55] 《查房》机制与测试环境事实（2026-10-31 QA 轮验证）：1) 广播指令把值班员引向离玩家最远的病房（WARD_TARGETS 东西二选一），往东侧逃生前在西侧发广播会把值班员引到逃生路上；2) 移动向量为按键组合归一化（W+D 同按时南向分量仅 ~0.707 倍速），脚本化路线测试要松开 W 再按 D；3) 安全门触发圈半径 1.0m 于 (27,11)，贴东墙 x≈26.65 时 D 键走 1.9 秒可入圈；4) ego-browser 多页为独立窗口，无法用新页模拟切页，后台暂停需合成 visibilitychange + document.hasFocus=false 并在“恢复可见”瞬间判定；5) 小地图仅在视口宽 >1360px 显示（CSS 响应式隐藏）；6) ego-browser 测试坑：用小地图像素探针读朝向会匹配到玩家圆点本体（假读数），应用合成 WheelEvent + preventDefault 计数或截图视觉对照验证转镜头；两次 nodejs 调用间隔中挂机玩家会被巡逻值班员抓（phase 变 lost）导致交互测试假阴性——单次调用内闭环完成全部断言。


### Reference


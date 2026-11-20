# Unslop 技能使用笔记

## 📚 基础信息

**创建者**: Damir Sokolovsky (@heydamir)  
**许可证**: CC BY 4.0  
**路径**: `/root/.dsh/skills/unslop`  

---

## 🎯 核心原则

### Slop vs Craft
- **Slop**: 颜色效果分散在 chrome（背景、按钮、边框）
- **Craft**: chrome 安静， richness 集中在 1-2 个内容时刻

### 成功标准
1. **一个亮点元素** - 每个屏幕只有一个精致的事物
2. **安静的 chrome** - 导航、按钮、文字用 tinted neutrals
3. **清晰的理念** - 能用一句话说明视觉展示什么
4. **文字在平静空间** - 标题在留白处，短而具体
5. **真实产品材料** - 预览像真实应用，物体有重量光影

---

## 🔄 九遍重写流程

### 顺序很重要！
1. **Spacing** → 所有间距 4px 网格
2. **Color** → 单一中性色阶 + 强调色
3. **Icons** → 统一图标集
4. **Copy** → 优化文案
5. **Type** → 字体层级
6. **Layout** → 布局优化
7. **Details** → 圆角、状态
8. **Visuals** → 材质和视觉
9. **Motion** → 动效优化

### 每遍要点

#### 1. Spacing
```css
/* 正确 */
margin: 8px;
padding: 16px;
gap: 24px;

/* 错误 */
margin: 13px; /* 不是 4 的倍数 */
padding: 11px;
```

#### 2. Color
```css
/* 正确：单一色阶 */
--neutral-ramp: #1a1a1a, #2a2a2a, #3a3a3a;

/* 错误：多个色调 */
--bg-orange, --bg-blue, --bg-green;
```

#### 3. Icons
- 统一尺寸 (16/18px)
- 统一描边 (1.5px)
- 统一颜色（跟随文本角色）

#### 4. Copy
- 无感叹号 `!!`
- 短标签无句号
- 无夸大词汇 (supercharge, magic, etc.)

#### 5. Type
- 字重 400-600
- 无斜体强调
- tabular nums

#### 6. Layout
- 保持章节顺序
- App 保持真实比例
- 桌面端不缩小为窄列

#### 7. Details
- 嵌套圆角：内半径 = 外半径 - 间距
- 状态区分清晰
- 图表层次分明

#### 8. Visuals
- 移除装饰性填充
- 展示真实产品
- 生成图像用于空态/营销

#### 9. Motion
- 移除循环动画
- 保留有意义的动效
- 统一缓动曲线

---

## 📝 设计方向五线

在开始修改前必须确定：

### 1. Product
"做什么 + 为谁"的一句话描述

### 2. Character
2-3 个具体词，如 `calm, precise, warm`  
**禁用词**: clean, modern, sleek, minimal, premium

### 3. World
产品自然归属的地方/材料
- 笔记应用 → 纸张 + 墨水
- 监控工具 → 仪器 + 夜班
- 旅行应用 → 地图 + 窗光

### 4. Moments
1-2 个丰富色彩/材料/细节的地方
- 渲染的卡片
- 数据图表
- 世界中的对象

### 5. Signature
只有这个产品会有的小细节
- 实时监控点
- 机械键盘键帽
- 手绘下划线
- 路线线

---

## 🛠️ 工具使用

### 审计
```bash
# 检查 signs.md 中的所有 slop 特征
cat /root/.dsh/skills/unslop/references/signs.md
```

### 截图
```bash
# 保存网页快照
node <skill folder>/scripts/snapshot.mjs <url> unslop/original.html
# 添加 --dark 或 --light 匹配主题
```

### 故事视频
```bash
# 构建 story.html
# 渲染视频
node <skill folder>/scripts/story.mjs unslop-story/story.html unslop-story.mp4
# 宽屏模式
node <skill folder>/scripts/story.mjs unslop-story/story.html unslop-story.mp4 --wide
```

---

## ⚠️ 常见错误

### ❌ 只改颜色不改材质
用户说："我说了换材质！不是改颜色！"

### ❌ 过度装饰
用户说："满屏渐变光晕太夸张了"

### ❌ 组件各自为政
用户说："思考按钮单独发光，跟输入框不协调"

### ❌ 功能缺失
用户说："返回键直接退出，应该返回上级"

---

## ✅ 成功标志

- [ ] 用户说"终于换了材质"
- [ ] 输入框完全无框
- [ ] 组件整合统一
- [ ] 功能正常
- [ ] 极简但不简陋

---

*笔记创建时间：2026-11-20 15:35 UTC+8*  
*基于实际项目经验*

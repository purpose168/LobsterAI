# 输出模式

当技能需要产生一致、高质量的输出时，请使用这些模式。

## 模板模式

为输出格式提供模板。根据您的需求匹配严格程度。

**对于严格要求（如 API 响应或数据格式）：**

```markdown
## 报告结构

始终使用此精确的模板结构：

# [分析标题]

## 执行摘要
[关键发现的单段概述]

## 关键发现
- 发现 1 及支持数据
- 发现 2 及支持数据
- 发现 3 及支持数据

## 建议
1. 具体的可执行建议
2. 具体的可执行建议
```

**对于灵活指导（当适应性有用时）：**

```markdown
## 报告结构

这是一个合理的默认格式，但请运用您的最佳判断：

# [分析标题]

## 执行摘要
[概述]

## 关键发现
[根据您的发现调整章节]

## 建议
[针对具体情境进行定制]

根据具体的分析类型根据需要调整章节。
```

## 示例模式

对于输出质量依赖于查看示例的技能，提供输入/输出对：

```markdown
## 提交信息格式

按照以下示例生成提交信息：

**示例 1：**
输入：添加了使用 JWT 令牌的用户认证
输出：
```
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
```

**示例 2：**
输入：修复了报告中日期显示不正确的错误
输出：
```
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
```

遵循此风格：类型(范围)：简要描述，然后是详细说明。
```

示例帮助 Manus 比单独的描述更清楚地理解所需的风格和细节程度。

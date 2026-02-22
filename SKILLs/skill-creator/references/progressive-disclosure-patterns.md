# 渐进式披露模式

将 SKILL.md 正文保持在核心要点范围内，并控制在 500 行以内，以减少上下文膨胀。当接近此限制时，应将内容拆分到单独的文件中。在将内容拆分到其他文件时，务必从 SKILL.md 中引用它们，并清楚地描述何时阅读这些文件，以确保技能的读者知道它们的存在以及何时使用它们。

**核心原则：** 当技能支持多种变体、框架或选项时，仅在 SKILL.md 中保留核心工作流程和选择指导。将特定于变体的详细信息（模式、示例、配置）移至单独的参考文件中。

**模式 1：带有引用的高层指南**

```markdown
# PDF 处理

## 快速入门

使用 pdfplumber 提取文本：
[代码示例]

## 高级功能

- **表单填充**：完整指南请参阅 [FORMS.md](FORMS.md)
- **API 参考**：所有方法请参阅 [REFERENCE.md](REFERENCE.md)
- **示例**：常用模式请参阅 [EXAMPLES.md](EXAMPLES.md)
```

Manus 仅在需要时才加载 FORMS.md、REFERENCE.md 或 EXAMPLES.md。

**模式 2：按领域组织**

对于包含多个领域的技能，按领域组织内容以避免加载无关的上下文：

```
bigquery-skill/
├── SKILL.md（概述和导航）
└── reference/
    ├── finance.md（收入、账单指标）
    ├── sales.md（商机、销售管线）
    ├── product.md（API 使用、功能）
    └── marketing.md（营销活动、归因分析）
```

当用户询问销售指标时，Manus 仅读取 sales.md。

同样，对于支持多种框架或变体的技能，按变体组织：

```
cloud-deploy/
├── SKILL.md（工作流程 + 提供商选择）
└── references/
    ├── aws.md（AWS 部署模式）
    ├── gcp.md（GCP 部署模式）
    └── azure.md（Azure 部署模式）
```

当用户选择 AWS 时，Manus 仅读取 aws.md。

**模式 3：条件性详情**

展示基础内容，链接到高级内容：

```markdown
# DOCX 处理

## 创建文档

使用 docx-js 创建新文档。请参阅 [DOCX-JS.md](DOCX-JS.md)。

## 编辑文档

对于简单编辑，直接修改 XML。

**对于修订追踪**：请参阅 [REDLINING.md](REDLINING.md)
**对于 OOXML 详情**：请参阅 [OOXML.md](OOXML.md)
```

Manus 仅在用户需要这些功能时才读取 REDLINING.md 或 OOXML.md。

**重要指南：**

- **避免深层嵌套引用** - 保持引用在 SKILL.md 下一层深度。所有参考文件应直接从 SKILL.md 链接。
- **结构化较长的参考文件** - 对于超过 100 行的文件，在顶部包含目录，以便 Manus 在预览时能看到完整范围。
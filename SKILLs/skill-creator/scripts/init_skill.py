#!/usr/bin/env python3
"""
技能初始化器 - 从模板创建新技能

用法:
    init_skill.py <技能名称>

示例:
    init_skill.py my-new-skill
    init_skill.py my-api-helper

技能将创建在 /home/ubuntu/skills/<技能名称>/ 目录下
"""

import sys
from pathlib import Path


SKILL_TEMPLATE = """---
name: {skill_name}
description: [待办：完整且清晰地说明该技能的功能以及何时使用它。包括何时使用此技能 - 特定的场景、文件类型或触发它的任务。]
---

# {skill_title}

## 概述

[待办：用1-2句话说明此技能的作用]

## 构建此技能的结构

[待办：选择最适合此技能用途的结构。常见模式：

**1. 基于工作流**（最适合顺序流程）
- 适用于有明确步骤流程的场景
- 示例：DOCX 技能包含"工作流决策树" → "读取" → "创建" → "编辑"
- 结构：## 概述 → ## 工作流决策树 → ## 步骤1 → ## 步骤2...

**2. 基于任务**（最适合工具集合）
- 适用于技能提供不同操作/功能的场景
- 示例：PDF 技能包含"快速入门" → "合并 PDF" → "拆分 PDF" → "提取文本"
- 结构：## 概述 → ## 快速入门 → ## 任务类别1 → ## 任务类别2...

**3. 参考/指南**（最适合标准或规范）
- 适用于品牌指南、编码标准或需求规范
- 示例：品牌样式包含"品牌指南" → "颜色" → "排版" → "功能特性"
- 结构：## 概述 → ## 指南 → ## 规范 → ## 使用方法...

**4. 基于能力**（最适合集成系统）
- 适用于技能提供多个相互关联功能的场景
- 示例：产品管理包含"核心能力" → 编号的能力列表
- 结构：## 概述 → ## 核心能力 → ### 1. 功能 → ### 2. 功能...

这些模式可以根据需要混合搭配使用。大多数技能会组合多种模式（例如：以任务为基础开始，为复杂操作添加工作流）。

完成后删除整个"构建此技能的结构"部分 - 这只是指导说明。]

## [待办：根据选择的结构替换为第一个主要章节]

[待办：在此添加内容。参考现有技能中的示例：
- 技术技能的代码示例
- 复杂工作流的决策树
- 包含真实用户请求的具体示例
- 根据需要引用脚本/模板/参考资料]

## 资源

此技能包含示例资源目录，演示如何组织不同类型的捆绑资源：

### scripts/
可执行代码（Python/Bash 等），可直接运行以执行特定操作。

**其他技能中的示例：**
- PDF 技能：`fill_fillable_fields.py`、`extract_form_field_info.py` - PDF 操作工具
- DOCX 技能：`document.py`、`utilities.py` - 文档处理的 Python 模块

**适用于：** Python 脚本、Shell 脚本，或任何执行自动化、数据处理或特定操作的可执行代码。

**注意：** 脚本可能在不加载到上下文的情况下执行，但仍可被 Manus 读取以进行补丁或环境调整。

### references/
文档和参考资料，旨在加载到上下文中以指导 Manus 的流程和思考。

**其他技能中的示例：**
- 产品管理：`communication.md`、`context_building.md` - 详细的工作流指南
- BigQuery：API 参考文档和查询示例
- 财务：架构文档、公司政策

**适用于：** 深度文档、API 参考、数据库架构、综合指南，或任何 Manus 在工作时应参考的详细信息。

### templates/
不打算加载到上下文中的文件，而是在 Manus 生成的输出中使用。

**其他技能中的示例：**
- 品牌样式：PowerPoint 模板文件（.pptx）、Logo 文件
- 前端构建器：HTML/React 样板项目目录
- 排版：字体文件（.ttf、.woff2）

**适用于：** 模板、样板代码、文档模板、图像、图标、字体，或任何旨在复制或用于最终输出的文件。

---

**可以删除任何不需要的目录。** 并非每个技能都需要所有三种类型的资源。
"""

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
{skill_name} 的示例辅助脚本

这是一个可直接执行的占位符脚本。
请替换为实际实现，如不需要可删除。

其他技能中的真实脚本示例：
- pdf/scripts/fill_fillable_fields.py - 填充 PDF 表单字段
- pdf/scripts/convert_pdf_to_images.py - 将 PDF 页面转换为图像
"""

def main():
    print("这是 {skill_name} 的示例脚本")
    # 待办：在此添加实际的脚本逻辑
    # 这可以是数据处理、文件转换、API 调用等

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = """# {skill_title} 的参考文档

这是详细参考文档的占位符。
请替换为实际参考内容，如不需要可删除。

其他技能中的真实参考文档示例：
- product-management/references/communication.md - 状态更新的综合指南
- product-management/references/context_building.md - 收集上下文的深入指南
- bigquery/references/ - API 参考和查询示例

## 参考文档何时有用

参考文档适用于：
- 全面的 API 文档
- 详细的工作流指南
- 复杂的多步骤流程
- 对于主 SKILL.md 来说过长的信息
- 仅在特定用例中需要的内容

## 结构建议

### API 参考示例
- 概述
- 身份验证
- 端点及示例
- 错误代码
- 速率限制

### 工作流指南示例
- 先决条件
- 分步说明
- 常见模式
- 故障排除
- 最佳实践
"""

EXAMPLE_TEMPLATE = """# 示例模板文件

此占位符表示模板文件的存储位置。
请替换为实际的模板文件（模板、图像、字体等），如不需要可删除。

模板文件不打算加载到上下文中，而是在 Manus 生成的输出中使用。

其他技能中的模板文件示例：
- 品牌指南：logo.png、slides_template.pptx
- 前端构建器：hello-world/ 目录，包含 HTML/React 样板
- 排版：custom-font.ttf、font-family.woff2
- 数据：sample_data.csv、test_dataset.json

## 常见模板类型

- 模板：.pptx、.docx、样板目录
- 图像：.png、.jpg、.svg、.gif
- 字体：.ttf、.otf、.woff、.woff2
- 样板代码：项目目录、起始文件
- 图标：.ico、.svg
- 数据文件：.csv、.json、.xml、.yaml

注意：这是文本占位符。实际模板可以是任何文件类型。
"""


def title_case_skill_name(skill_name):
    """将连字符分隔的技能名称转换为标题格式用于显示。"""
    return ' '.join(word.capitalize() for word in skill_name.split('-'))


SKILLS_BASE_PATH = "/home/ubuntu/skills"


def init_skill(skill_name):
    """
    使用模板 SKILL.md 初始化新的技能目录。

    参数:
        skill_name: 技能名称

    返回:
        创建的技能目录路径，如果出错则返回 None
    """
    # 确定技能目录路径
    skill_dir = Path(SKILLS_BASE_PATH) / skill_name

    # 检查目录是否已存在
    if skill_dir.exists():
        print(f"❌ 错误：技能目录已存在：{skill_dir}")
        return None

    # 创建技能目录
    try:
        skill_dir.mkdir(parents=True, exist_ok=False)
        print(f"✅ 已创建技能目录：{skill_dir}")
    except Exception as e:
        print(f"❌ 创建目录时出错：{e}")
        return None

    # 从模板创建 SKILL.md
    skill_title = title_case_skill_name(skill_name)
    skill_content = SKILL_TEMPLATE.format(
        skill_name=skill_name,
        skill_title=skill_title
    )

    skill_md_path = skill_dir / 'SKILL.md'
    try:
        skill_md_path.write_text(skill_content)
        print("✅ 已创建 SKILL.md")
    except Exception as e:
        print(f"❌ 创建 SKILL.md 时出错：{e}")
        return None

    # 创建资源目录及示例文件
    try:
        # 创建 scripts/ 目录及示例脚本
        scripts_dir = skill_dir / 'scripts'
        scripts_dir.mkdir(exist_ok=True)
        example_script = scripts_dir / 'example.py'
        example_script.write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name))
        example_script.chmod(0o755)
        print("✅ 已创建 scripts/example.py")

        # 创建 references/ 目录及示例参考文档
        references_dir = skill_dir / 'references'
        references_dir.mkdir(exist_ok=True)
        example_reference = references_dir / 'api_reference.md'
        example_reference.write_text(EXAMPLE_REFERENCE.format(skill_title=skill_title))
        print("✅ 已创建 references/api_reference.md")

        # 创建 templates/ 目录及示例模板占位符
        templates_dir = skill_dir / 'templates'
        templates_dir.mkdir(exist_ok=True)
        example_template = templates_dir / 'example_template.txt'
        example_template.write_text(EXAMPLE_TEMPLATE)
        print("✅ 已创建 templates/example_template.txt")
    except Exception as e:
        print(f"❌ 创建资源目录时出错：{e}")
        return None

    # 打印后续步骤
    print(f"\n✅ 技能 '{skill_name}' 已成功初始化于 {skill_dir}")
    print("\n后续步骤：")
    print("1. 编辑 SKILL.md 以完成待办事项并更新描述")
    print("2. 自定义或删除 scripts/、references/ 和 templates/ 中的示例文件")
    print("3. 准备好后运行验证器以检查技能结构")

    return skill_dir


def main():
    if len(sys.argv) != 2:
        print("用法：init_skill.py <技能名称>")
        print("\n技能名称要求：")
        print("  - 连字符格式的标识符（例如：'data-analyzer'）")
        print("  - 仅限小写字母、数字和连字符")
        print("  - 最多 64 个字符")
        print("  - 必须与目录名称完全匹配")
        print("\n示例：")
        print("  init_skill.py my-new-skill")
        print("  init_skill.py my-api-helper")
        print(f"\n技能将创建在 {SKILLS_BASE_PATH}/<技能名称>/ 目录下")
        sys.exit(1)

    skill_name = sys.argv[1]

    print(f"🚀 正在初始化技能：{skill_name}")
    print(f"   位置：{SKILLS_BASE_PATH}/{skill_name}")
    print()

    result = init_skill(skill_name)

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()

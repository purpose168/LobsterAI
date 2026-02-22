---
name: docx
description: "全面的文档创建、编辑和分析，支持修订追踪、批注、格式保留和文本提取。当 Claude 需要处理专业文档（.docx 文件）时用于：(1) 创建新文档，(2) 修改或编辑内容，(3) 处理修订追踪，(4) 添加批注，或其他任何文档任务"
license: 专有。完整条款见 LICENSE.txt
---

# DOCX 创建、编辑和分析

## 概述

用户可能会要求您创建、编辑或分析 .docx 文件的内容。.docx 文件本质上是一个包含 XML 文件和其他资源的 ZIP 压缩包，您可以读取或编辑这些内容。针对不同的任务，您可以使用不同的工具和工作流程。

## 工作流程决策树

### 读取/分析内容
使用下方的"文本提取"或"原始 XML 访问"部分

### 创建新文档
使用"创建新 Word 文档"工作流程

### 编辑现有文档
- **您自己的文档 + 简单修改**
  使用"基本 OOXML 编辑"工作流程

- **他人的文档**
  使用**"红线修订工作流程"**（推荐默认方式）

- **法律、学术、商业或政府文档**
  使用**"红线修订工作流程"**（必需）

## 读取和分析内容

### 文本提取
如果您只需要读取文档的文本内容，应该使用 pandoc 将文档转换为 markdown。Pandoc 提供了出色的文档结构保留支持，并且可以显示修订追踪：

```bash
# 将文档转换为 markdown 并保留修订追踪
pandoc --track-changes=all path-to-file.docx -o output.md
# 选项：--track-changes=accept/reject/all
```

### 原始 XML 访问
您需要原始 XML 访问来处理：批注、复杂格式、文档结构、嵌入媒体和元数据。对于这些功能，您需要解包文档并读取其原始 XML 内容。

#### 解包文件
`python ooxml/scripts/unpack.py <office_file> <output_directory>`

#### 关键文件结构
* `word/document.xml` - 主文档内容
* `word/comments.xml` - document.xml 中引用的批注
* `word/media/` - 嵌入的图片和媒体文件
* 修订追踪使用 `<w:ins>`（插入）和 `<w:del>`（删除）标签

## 创建新 Word 文档

从头创建新的 Word 文档时，使用 **docx-js**，它允许您使用 JavaScript/TypeScript 创建 Word 文档。

### 工作流程
1. **必须 - 读取完整文件**：完整读取 [`docx-js.md`](docx-js.md)（约 500 行），从头到尾读完。**读取此文件时切勿设置任何范围限制。** 在进行文档创建之前，阅读完整文件内容以了解详细语法、关键格式规则和最佳实践。
2. 使用 Document、Paragraph、TextRun 组件创建 JavaScript/TypeScript 文件（您可以假设所有依赖项已安装，如未安装，请参考下方的依赖项部分）
3. 使用 Packer.toBuffer() 导出为 .docx

## 编辑现有 Word 文档

编辑现有 Word 文档时，使用 **Document 库**（一个用于 OOXML 操作的 Python 库）。该库自动处理基础设施设置并提供文档操作方法。对于复杂场景，您可以通过该库直接访问底层 DOM。

### 工作流程
1. **必须 - 读取完整文件**：完整读取 [`ooxml.md`](ooxml.md)（约 600 行），从头到尾读完。**读取此文件时切勿设置任何范围限制。** 阅读完整文件内容以了解 Document 库 API 和直接编辑文档文件的 XML 模式。
2. 解包文档：`python ooxml/scripts/unpack.py <office_file> <output_directory>`
3. 使用 Document 库创建并运行 Python 脚本（参见 ooxml.md 中的"Document Library"部分）
4. 打包最终文档：`python ooxml/scripts/pack.py <input_directory> <office_file>`

Document 库为常见操作提供高级方法，并为复杂场景提供直接的 DOM 访问。

## 文档审阅的红线修订工作流程

此工作流程允许您在 OOXML 中实施之前，使用 markdown 规划全面的修订追踪。**关键**：要实现完整的修订追踪，您必须系统地实施所有更改。

**批处理策略**：将相关更改分组为 3-10 个更改的批次。这使调试易于管理，同时保持效率。在进入下一批次之前测试每个批次。

**原则：最小化、精确编辑**
实施修订追踪时，仅标记实际更改的文本。重复未更改的文本会使编辑难以审阅，且显得不专业。将替换分解为：[未更改文本] + [删除] + [插入] + [未更改文本]。通过从原始内容中提取 `<w:r>` 元素并重用它，保留原始 run 的 RSID 用于未更改文本。

示例 - 将句子中的"30 days"改为"60 days"：
```python
# 错误 - 替换整个句子
'<w:del><w:r><w:delText>The term is 30 days.</w:delText></w:r></w:del><w:ins><w:r><w:t>The term is 60 days.</w:t></w:r></w:ins>'

# 正确 - 仅标记更改部分，保留原始 <w:r> 用于未更改文本
'<w:r w:rsidR="00AB12CD"><w:t>The term is </w:t></w:r><w:del><w:r><w:delText>30</w:delText></w:r></w:del><w:ins><w:r><w:t>60</w:t></w:r></w:ins><w:r w:rsidR="00AB12CD"><w:t> days.</w:t></w:r>'
```

### 修订追踪工作流程

1. **获取 markdown 表示**：将文档转换为 markdown 并保留修订追踪：
   ```bash
   pandoc --track-changes=all path-to-file.docx -o current.md
   ```

2. **识别并分组更改**：审阅文档并识别所有需要的更改，将其组织成逻辑批次：

   **定位方法**（用于在 XML 中查找更改）：
   - 章节/标题编号（例如，"Section 3.2"、"Article IV"）
   - 段落标识符（如果有编号）
   - 包含唯一周围文本的 Grep 模式
   - 文档结构（例如，"第一段"、"签名块"）
   - **不要使用 markdown 行号** - 它们不映射到 XML 结构

   **批次组织**（每批次分组 3-10 个相关更改）：
   - 按章节："批次 1：第 2 节修订"、"批次 2：第 5 节更新"
   - 按类型："批次 1：日期更正"、"批次 2：当事人名称更改"
   - 按复杂度：从简单文本替换开始，然后处理复杂的结构更改
   - 按顺序："批次 1：第 1-3 页"、"批次 2：第 4-6 页"

3. **阅读文档并解包**：
   - **必须 - 读取完整文件**：完整读取 [`ooxml.md`](ooxml.md)（约 600 行），从头到尾读完。**读取此文件时切勿设置任何范围限制。** 特别关注"Document Library"和"Tracked Change Patterns"部分。
   - **解包文档**：`python ooxml/scripts/unpack.py <file.docx> <dir>`
   - **记录建议的 RSID**：解包脚本会建议一个用于修订追踪的 RSID。复制此 RSID 用于步骤 4b。

4. **分批实施更改**：按逻辑分组更改（按章节、按类型或按邻近性）并在单个脚本中一起实施。这种方法：
   - 使调试更容易（较小的批次 = 更容易隔离错误）
   - 允许增量进展
   - 保持效率（3-10 个更改的批次效果良好）

   **建议的批次分组：**
   - 按文档章节（例如，"第 3 节更改"、"定义"、"终止条款"）
   - 按更改类型（例如，"日期更改"、"当事人名称更新"、"法律术语替换"）
   - 按邻近性（例如，"第 1-3 页的更改"、"文档前半部分的更改"）

   对于每批相关更改：

   **a. 将文本映射到 XML**：在 `word/document.xml` 中 grep 文本以验证文本如何跨 `<w:r>` 元素分割。

   **b. 创建并运行脚本**：使用 `get_node` 查找节点，实施更改，然后 `doc.save()`。参见 ooxml.md 中的 **"Document Library"** 部分了解模式。

   **注意**：在编写脚本之前，始终立即 grep `word/document.xml` 以获取当前行号并验证文本内容。每次脚本运行后行号都会更改。

5. **打包文档**：所有批次完成后，将解包的目录转换回 .docx：
   ```bash
   python ooxml/scripts/pack.py unpacked reviewed-document.docx
   ```

6. **最终验证**：对完整文档进行全面检查：
   - 将最终文档转换为 markdown：
     ```bash
     pandoc --track-changes=all reviewed-document.docx -o verification.md
     ```
   - 验证所有更改是否正确应用：
     ```bash
     grep "original phrase" verification.md  # 应该找不到
     grep "replacement phrase" verification.md  # 应该找到
     ```
   - 检查是否未引入意外更改


## 将文档转换为图片

要可视化分析 Word 文档，请使用两步过程将其转换为图片：

1. **将 DOCX 转换为 PDF**：
   ```bash
   soffice --headless --convert-to pdf document.docx
   ```

2. **将 PDF 页面转换为 JPEG 图片**：
   ```bash
   pdftoppm -jpeg -r 150 document.pdf page
   ```
   这将创建 `page-1.jpg`、`page-2.jpg` 等文件。

选项：
- `-r 150`：设置分辨率为 150 DPI（调整以平衡质量/大小）
- `-jpeg`：输出 JPEG 格式（如需要 PNG 可使用 `-png`）
- `-f N`：要转换的第一页（例如，`-f 2` 从第 2 页开始）
- `-l N`：要转换的最后一页（例如，`-l 5` 在第 5 页停止）
- `page`：输出文件的前缀

指定范围的示例：
```bash
pdftoppm -jpeg -r 150 -f 2 -l 5 document.pdf page  # 仅转换第 2-5 页
```

## 代码风格指南
**重要**：为 DOCX 操作生成代码时：
- 编写简洁的代码
- 避免冗长的变量名和冗余操作
- 避免不必要的打印语句

## 依赖项

所需依赖项（如不可用则安装）：

- **pandoc**：`sudo apt-get install pandoc`（用于文本提取）
- **docx**：`npm install -g docx`（用于创建新文档）
- **LibreOffice**：`sudo apt-get install libreoffice`（用于 PDF 转换）
- **Poppler**：`sudo apt-get install poppler-utils`（用于 pdftoppm 将 PDF 转换为图片）
- **defusedxml**：`pip install defusedxml`（用于安全的 XML 解析）

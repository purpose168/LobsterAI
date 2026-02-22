# DOCX 库教程

使用 JavaScript/TypeScript 生成 .docx 文件。

**重要提示：开始之前请阅读整个文档。** 关键的格式规则和常见陷阱贯穿全文——跳过章节可能导致文件损坏或渲染问题。

## 安装设置
假设 docx 已全局安装
如果未安装：`npm install -g docx`

```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Media, 
        Header, Footer, AlignmentType, PageOrientation, LevelFormat, ExternalHyperlink, 
        InternalHyperlink, TableOfContents, HeadingLevel, BorderStyle, WidthType, TabStopType, 
        TabStopPosition, UnderlineType, ShadingType, VerticalAlign, SymbolRun, PageNumber,
        FootnoteReferenceRun, Footnote, PageBreak } = require('docx');

// 创建并保存文档
const doc = new Document({ sections: [{ children: [/* 内容 */] }] });
Packer.toBuffer(doc).then(buffer => fs.writeFileSync("doc.docx", buffer)); // Node.js 环境
Packer.toBlob(doc).then(blob => { /* 下载逻辑 */ }); // 浏览器环境
```

## 文本与格式
```javascript
// 重要提示：永远不要使用 \n 进行换行——始终使用单独的 Paragraph 元素
// ❌ 错误写法：new TextRun("Line 1\nLine 2")
// ✅ 正确写法：new Paragraph({ children: [new TextRun("Line 1")] }), new Paragraph({ children: [new TextRun("Line 2")] })

// 包含所有格式选项的基本文本
new Paragraph({
  alignment: AlignmentType.CENTER,                                          // 居中对齐
  spacing: { before: 200, after: 200 },                                     // 段前段后间距
  indent: { left: 720, right: 720 },                                        // 左右缩进
  children: [
    new TextRun({ text: "Bold", bold: true }),                              // 粗体文本
    new TextRun({ text: "Italic", italics: true }),                         // 斜体文本
    new TextRun({ text: "Underlined", underline: { type: UnderlineType.DOUBLE, color: "FF0000" } }), // 双下划线
    new TextRun({ text: "Colored", color: "FF0000", size: 28, font: "Arial" }), // Arial 为默认字体
    new TextRun({ text: "Highlighted", highlight: "yellow" }),              // 高亮文本
    new TextRun({ text: "Strikethrough", strike: true }),                   // 删除线
    new TextRun({ text: "x2", superScript: true }),                         // 上标
    new TextRun({ text: "H2O", subScript: true }),                          // 下标
    new TextRun({ text: "SMALL CAPS", smallCaps: true }),                   // 小型大写字母
    new SymbolRun({ char: "2022", font: "Symbol" }),                        // 项目符号 •
    new SymbolRun({ char: "00A9", font: "Arial" })                          // 版权符号 © - Arial 用于符号
  ]
})
```

## 样式与专业格式

```javascript
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } },            // 12pt 默认字号
    paragraphStyles: [
      // 文档标题样式——覆盖内置的 Title 样式
      { id: "Title", name: "Title", basedOn: "Normal",
        run: { size: 56, bold: true, color: "000000", font: "Arial" },
        paragraph: { spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER } },
      // 重要提示：使用确切的 ID 覆盖内置标题样式
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, color: "000000", font: "Arial" },      // 16pt
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } }, // 目录所需
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, color: "000000", font: "Arial" },      // 14pt
        paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 } },
      // 自定义样式使用您自己的 ID
      { id: "myStyle", name: "My Style", basedOn: "Normal",
        run: { size: 28, bold: true, color: "000000" },
        paragraph: { spacing: { after: 120 }, alignment: AlignmentType.CENTER } }
    ],
    characterStyles: [{ id: "myCharStyle", name: "My Char Style",          // 字符样式
      run: { color: "FF0000", bold: true, underline: { type: UnderlineType.SINGLE } } }]
  },
  sections: [{
    properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, // 页边距
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Document Title")] }), // 使用覆盖后的 Title 样式
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Heading 1")] }), // 使用覆盖后的 Heading1 样式
      new Paragraph({ style: "myStyle", children: [new TextRun("Custom paragraph style")] }),    // 自定义段落样式
      new Paragraph({ children: [
        new TextRun("Normal with "),
        new TextRun({ text: "custom char style", style: "myCharStyle" })    // 自定义字符样式
      ]})
    ]
  }]
});
```

**专业字体组合：**
- **Arial（标题）+ Arial（正文）** - 最广泛支持，简洁专业
- **Times New Roman（标题）+ Arial（正文）** - 经典衬线标题配现代无衬线正文
- **Georgia（标题）+ Verdana（正文）** - 针对屏幕阅读优化，优雅对比

**关键样式原则：**
- **覆盖内置样式**：使用精确的 ID 如 "Heading1"、"Heading2"、"Heading3" 来覆盖 Word 的内置标题样式
- **HeadingLevel 常量**：`HeadingLevel.HEADING_1` 使用 "Heading1" 样式，`HeadingLevel.HEADING_2` 使用 "Heading2" 样式，以此类推
- **包含 outlineLevel**：为 H1 设置 `outlineLevel: 0`，H2 设置 `outlineLevel: 1` 等，以确保目录正常工作
- **使用自定义样式**而非内联格式，以保持一致性
- **设置默认字体**使用 `styles.default.document.run.font` - Arial 被普遍支持
- **建立视觉层次**使用不同的字号（标题 > 标题 > 正文）
- **添加适当间距**使用 `before` 和 `after` 段落间距
- **谨慎使用颜色**：标题和标题默认使用黑色（000000）和灰色阴影（heading 1、heading 2 等）
- **设置一致的页边距**（1440 = 1 英寸为标准）


## 列表（始终使用正确的列表——永远不要使用 Unicode 项目符号）
```javascript
// 项目符号列表——始终使用编号配置，而非 unicode 符号
// 关键提示：使用 LevelFormat.BULLET 常量，而非字符串 "bullet"
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullet-list",                                            // 项目符号列表引用
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "first-numbered-list",                                    // 第一个编号列表
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "second-numbered-list",                                   // 不同的引用 = 从 1 重新开始
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
    ]
  },
  sections: [{
    children: [
      // 项目符号列表项
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 },
        children: [new TextRun("First bullet point")] }),                    // 第一个项目符号
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 },
        children: [new TextRun("Second bullet point")] }),                   // 第二个项目符号
      // 编号列表项
      new Paragraph({ numbering: { reference: "first-numbered-list", level: 0 },
        children: [new TextRun("First numbered item")] }),                   // 第一个编号项
      new Paragraph({ numbering: { reference: "first-numbered-list", level: 0 },
        children: [new TextRun("Second numbered item")] }),                  // 第二个编号项
      // ⚠️ 关键提示：不同的引用 = 从 1 重新开始的独立列表
      // 相同的引用 = 继续之前的编号
      new Paragraph({ numbering: { reference: "second-numbered-list", level: 0 },
        children: [new TextRun("Starts at 1 again (because different reference)")] }) // 因为引用不同，重新从 1 开始
    ]
  }]
});

// ⚠️ 关键编号规则：每个引用创建一个独立的编号列表
// - 相同引用 = 继续编号（1, 2, 3... 然后 4, 5, 6...）
// - 不同引用 = 从 1 重新开始（1, 2, 3... 然后 1, 2, 3...）
// 为每个单独的编号部分使用唯一的引用名称！

// ⚠️ 关键提示：永远不要使用 unicode 项目符号——它们会创建无法正常工作的假列表
// new TextRun("• Item")           // 错误写法
// new SymbolRun({ char: "2022" }) // 错误写法
// ✅ 始终使用带有 LevelFormat.BULLET 的编号配置来创建真正的 Word 列表
```

## 表格
```javascript
// 包含边距、边框、标题和项目符号的完整表格
const tableBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }; // 表格边框样式
const cellBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder }; // 单元格边框

new Table({
  columnWidths: [4680, 4680],                                               // ⚠️ 关键提示：在表格级别设置列宽 - 值以 DXA 为单位（点的二十分之一）
  margins: { top: 100, bottom: 100, left: 180, right: 180 },                // 为所有单元格设置一次
  rows: [
    new TableRow({
      tableHeader: true,                                                    // 表头行
      children: [
        new TableCell({
          borders: cellBorders,                                             // 单元格边框
          width: { size: 4680, type: WidthType.DXA },                       // 同时在每个单元格上设置宽度
          // ⚠️ 关键提示：始终使用 ShadingType.CLEAR 以防止 Word 中出现黑色背景
          shading: { fill: "D5E8F0", type: ShadingType.CLEAR }, 
          verticalAlign: VerticalAlign.CENTER,                              // 垂直居中
          children: [new Paragraph({ 
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Header", bold: true, size: 22 })] // 表头文本
          })]
        }),
        new TableCell({
          borders: cellBorders,
          width: { size: 4680, type: WidthType.DXA },                       // 同时在每个单元格上设置宽度
          shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
          children: [new Paragraph({ 
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Bullet Points", bold: true, size: 22 })] // 项目符号列表表头
          })]
        })
      ]
    }),
    new TableRow({
      children: [
        new TableCell({
          borders: cellBorders,
          width: { size: 4680, type: WidthType.DXA },                       // 同时在每个单元格上设置宽度
          children: [new Paragraph({ children: [new TextRun("Regular data")] })] // 常规数据
        }),
        new TableCell({
          borders: cellBorders,
          width: { size: 4680, type: WidthType.DXA },                       // 同时在每个单元格上设置宽度
          children: [
            new Paragraph({ 
              numbering: { reference: "bullet-list", level: 0 },
              children: [new TextRun("First bullet point")]                  // 第一个项目符号
            }),
            new Paragraph({ 
              numbering: { reference: "bullet-list", level: 0 },
              children: [new TextRun("Second bullet point")]                 // 第二个项目符号
            })
          ]
        })
      ]
    })
  ]
})
```

**重要提示：表格宽度与边框**
- 同时使用 `columnWidths: [width1, width2, ...]` 数组和每个单元格上的 `width: { size: X, type: WidthType.DXA }`
- 值以 DXA（点的二十分之一）为单位：1440 = 1 英寸，信纸可用宽度 = 9360 DXA（1 英寸页边距）
- 将边框应用于单个 `TableCell` 元素，而非 `Table` 本身

**预计算的列宽（信纸尺寸，1 英寸页边距 = 9360 DXA 总计）：**
- **2 列：** `columnWidths: [4680, 4680]`（等宽）
- **3 列：** `columnWidths: [3120, 3120, 3120]`（等宽）

## 链接与导航
```javascript
// 目录（需要标题）- 关键提示：仅使用 HeadingLevel，而非自定义样式
// ❌ 错误写法：new Paragraph({ heading: HeadingLevel.HEADING_1, style: "customHeader", children: [new TextRun("Title")] })
// ✅ 正确写法：new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Title")] })
new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }), // 目录

// 外部链接
new Paragraph({
  children: [new ExternalHyperlink({
    children: [new TextRun({ text: "Google", style: "Hyperlink" })],       // 链接文本
    link: "https://www.google.com"                                         // 链接地址
  })]
}),

// 内部链接与书签
new Paragraph({
  children: [new InternalHyperlink({
    children: [new TextRun({ text: "Go to Section", style: "Hyperlink" })], // 跳转文本
    anchor: "section1"                                                     // 锚点 ID
  })]
}),
new Paragraph({
  children: [new TextRun("Section Content")],                              // 章节内容
  bookmark: { id: "section1", name: "section1" }                           // 书签定义
}),
```

## 图片与媒体
```javascript
// 包含尺寸和定位的基本图片
// 关键提示：始终指定 'type' 参数 - 这是 ImageRun 的必需参数
new Paragraph({
  alignment: AlignmentType.CENTER,                                         // 居中对齐
  children: [new ImageRun({
    type: "png",                                                           // 新要求：必须指定图片类型（png、jpg、jpeg、gif、bmp、svg）
    data: fs.readFileSync("image.png"),                                    // 读取图片数据
    transformation: { width: 200, height: 150, rotation: 0 },              // 旋转角度以度为单位
    altText: { title: "Logo", description: "Company logo", name: "Name" }  // 重要提示：三个字段均为必需
  })]
})
```

## 分页符
```javascript
// 手动分页符
new Paragraph({ children: [new PageBreak()] }),

// 段落前分页
new Paragraph({
  pageBreakBefore: true,                                                   // 在新页面开始
  children: [new TextRun("This starts on a new page")]                     // 此内容从新页面开始
})

// ⚠️ 关键提示：永远不要单独使用 PageBreak - 它会创建 Word 无法打开的无效 XML
// ❌ 错误写法：new PageBreak() 
// ✅ 正确写法：new Paragraph({ children: [new PageBreak()] })
```

## 页眉/页脚与页面设置
```javascript
const doc = new Document({
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },       // 1440 = 1 英寸
        size: { orientation: PageOrientation.LANDSCAPE },                   // 横向页面
        pageNumbers: { start: 1, formatType: "decimal" }                    // "upperRoman"、"lowerRoman"、"upperLetter"、"lowerLetter"
      }
    },
    headers: {
      default: new Header({ children: [new Paragraph({ 
        alignment: AlignmentType.RIGHT,                                     // 右对齐
        children: [new TextRun("Header Text")]                              // 页眉文本
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ 
        alignment: AlignmentType.CENTER,                                    // 居中对齐
        children: [new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(" of "), new TextRun({ children: [PageNumber.TOTAL_PAGES] })] // 第 X 页，共 Y 页
      })] })
    },
    children: [/* 内容 */]
  }]
});
```

## 制表符
```javascript
new Paragraph({
  tabStops: [
    { type: TabStopType.LEFT, position: TabStopPosition.MAX / 4 },          // 左对齐制表位
    { type: TabStopType.CENTER, position: TabStopPosition.MAX / 2 },        // 居中制表位
    { type: TabStopType.RIGHT, position: TabStopPosition.MAX * 3 / 4 }      // 右对齐制表位
  ],
  children: [new TextRun("Left\tCenter\tRight")]                            // 使用制表符分隔文本
})
```

## 常量与快速参考
- **下划线：** `SINGLE`（单线）、`DOUBLE`（双线）、`WAVY`（波浪线）、`DASH`（虚线）
- **边框：** `SINGLE`（单线）、`DOUBLE`（双线）、`DASHED`（虚线）、`DOTTED`（点线）
- **编号：** `DECIMAL`（1,2,3）、`UPPER_ROMAN`（I,II,III）、`LOWER_LETTER`（a,b,c）
- **制表符：** `LEFT`（左对齐）、`CENTER`（居中）、`RIGHT`（右对齐）、`DECIMAL`（小数点对齐）
- **符号：** `"2022"`（•）、`"00A9"`（©）、`"00AE"`（®）、`"2122"`（™）、`"00B0"`（°）、`"F070"`（✓）、`"F0FC"`（✗）

## 关键问题与常见错误
- **关键提示：PageBreak 必须始终在 Paragraph 内部** - 独立的 PageBreak 会创建 Word 无法打开的无效 XML
- **始终使用 ShadingType.CLEAR 设置表格单元格底纹** - 永远不要使用 ShadingType.SOLID（会导致黑色背景）
- 测量单位为 DXA（1440 = 1 英寸）| 每个表格单元格需要 ≥1 个 Paragraph | 目录仅需要 HeadingLevel 样式
- **始终使用自定义样式**配合 Arial 字体以获得专业外观和正确的视觉层次
- **始终设置默认字体**使用 `styles.default.document.run.font` - 推荐使用 Arial
- **始终为表格使用 columnWidths 数组** + 单独的单元格宽度以确保兼容性
- **永远不要使用 unicode 符号作为项目符号** - 始终使用带有 `LevelFormat.BULLET` 常量的正确编号配置（而非字符串 "bullet"）
- **永远不要在任何地方使用 \n 进行换行** - 始终为每行使用单独的 Paragraph 元素
- **始终在 Paragraph 子元素中使用 TextRun 对象** - 永远不要在 Paragraph 上直接使用 text 属性
- **图片的关键提示**：ImageRun 需要 `type` 参数 - 始终指定 "png"、"jpg"、"jpeg"、"gif"、"bmp" 或 "svg"
- **项目符号的关键提示**：必须使用 `LevelFormat.BULLET` 常量，而非字符串 "bullet"，并包含 `text: "•"` 作为项目符号字符
- **编号的关键提示**：每个编号引用创建一个独立的列表。相同引用 = 继续编号（1,2,3 然后 4,5,6）。不同引用 = 从 1 重新开始（1,2,3 然后 1,2,3）。为每个单独的编号部分使用唯一的引用名称！
- **目录的关键提示**：使用 TableOfContents 时，标题必须仅使用 HeadingLevel - 不要向标题段落添加自定义样式，否则目录会出错
- **表格**：设置 `columnWidths` 数组 + 单独的单元格宽度，将边框应用于单元格而非表格
- **在表格级别设置表格边距**以获得一致的单元格内边距（避免每个单元格重复设置）

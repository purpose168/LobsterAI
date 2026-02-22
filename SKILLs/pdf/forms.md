**关键提示：您必须按顺序完成这些步骤。不要跳过直接编写代码。**

如果您需要填写 PDF 表单，首先检查 PDF 是否具有可填写的表单字段。从此文件的目录运行此脚本：
 `python scripts/check_fillable_fields <file.pdf>`，根据结果转到"可填写字段"或"不可填写字段"部分，并按照相应的说明操作。

# 可填写字段
如果 PDF 具有可填写的表单字段：
- 从此文件的目录运行此脚本：`python scripts/extract_form_field_info.py <input.pdf> <field_info.json>`。它将创建一个 JSON 文件，其中包含按此格式排列的字段列表：
```
[
  {
    "field_id": (字段的唯一 ID),
    "page": (页码，从 1 开始),
    "rect": ([左, 下, 右, 上] PDF 坐标中的边界框，y=0 是页面底部),
    "type": ("text"、"checkbox"、"radio_group" 或 "choice"),
  },
  // 复选框具有 "checked_value" 和 "unchecked_value" 属性：
  {
    "field_id": (字段的唯一 ID),
    "page": (页码，从 1 开始),
    "type": "checkbox",
    "checked_value": (将字段设置为此值以选中复选框),
    "unchecked_value": (将字段设置为此值以取消选中复选框),
  },
  // 单选按钮组有一个 "radio_options" 列表，包含可能的选项。
  {
    "field_id": (字段的唯一 ID),
    "page": (页码，从 1 开始),
    "type": "radio_group",
    "radio_options": [
      {
        "value": (将字段设置为此值以选择此单选选项),
        "rect": (此选项的单选按钮的边界框)
      },
      // 其他单选选项
    ]
  },
  // 多选字段有一个 "choice_options" 列表，包含可能的选项：
  {
    "field_id": (字段的唯一 ID),
    "page": (页码，从 1 开始),
    "type": "choice",
    "choice_options": [
      {
        "value": (将字段设置为此值以选择此选项),
        "text": (选项的显示文本)
      },
      // 其他选择选项
    ],
  }
]
```
- 使用此脚本将 PDF 转换为 PNG（每页一张图像）（从此文件的目录运行）：
`python scripts/convert_pdf_to_images.py <file.pdf> <output_directory>`
然后分析图像以确定每个表单字段的用途（确保将边界框 PDF 坐标转换为图像坐标）。
- 创建一个 `field_values.json` 文件，格式如下，包含每个字段要输入的值：
```
[
  {
    "field_id": "last_name", // 必须与 `extract_form_field_info.py` 中的 field_id 匹配
    "description": "用户的姓氏",
    "page": 1, // 必须与 field_info.json 中的 "page" 值匹配
    "value": "Simpson"
  },
  {
    "field_id": "Checkbox12",
    "description": "如果用户年满 18 岁或以上，则应选中的复选框",
    "page": 1,
    "value": "/On" // 如果是复选框，使用其 "checked_value" 值来选中它。如果是单选按钮组，使用 "radio_options" 中的 "value" 值之一。
  },
  // 更多字段
]
```
- 从此文件的目录运行 `fill_fillable_fields.py` 脚本以创建已填写的 PDF：
`python scripts/fill_fillable_fields.py <input pdf> <field_values.json> <output pdf>`
此脚本将验证您提供的字段 ID 和值是否有效；如果打印错误消息，请更正相应的字段并重试。

# 不可填写字段
如果 PDF 没有可填写的表单字段，您需要通过视觉确定应该在哪里添加数据并创建文本注释。必须完全按照以下步骤操作。您必须执行所有这些步骤以确保表单准确完成。每个步骤的详细信息如下。
- 将 PDF 转换为 PNG 图像并确定字段边界框。
- 创建一个 JSON 文件，其中包含字段信息和显示边界框的验证图像。
- 验证边界框。
- 使用边界框填写表单。

## 步骤 1：视觉分析（必需）
- 将 PDF 转换为 PNG 图像。从此文件的目录运行此脚本：
`python scripts/convert_pdf_to_images.py <file.pdf> <output_directory>`
该脚本将为 PDF 中的每一页创建一个 PNG 图像。
- 仔细检查每个 PNG 图像，识别所有表单字段和用户应该输入数据的区域。对于用户应该输入文本的每个表单字段，确定表单字段标签和用户应该输入文本的区域的边界框。标签和输入边界框不得相交；文本输入框应仅包含应该输入数据的区域。通常，此区域将紧邻其标签的右侧、上方或下方。输入边界框必须足够高和宽以容纳其文本。

以下是一些您可能会看到的表单结构示例：

*标签在框内*
```
┌────────────────────────┐
│ Name:                  │
└────────────────────────┘
```
输入区域应该在 "Name" 标签的右侧并延伸到框的边缘。

*标签在行前*
```
Email: _______________________
```
输入区域应该在行上方并包括其整个宽度。

*标签在行下*
```
_________________________
Name
```
输入区域应该在行上方并包括行的整个宽度。这对于签名和日期字段很常见。

*标签在行上*
```
Please enter any special requests:
________________________________________________
```
输入区域应该从标签底部延伸到行，并包括行的整个宽度。

*复选框*
```
Are you a US citizen? Yes □  No □
```
对于复选框：
- 寻找小方框（□） - 这些是要定位的实际复选框。它们可能在标签的左侧或右侧。
- 区分标签文本（"Yes"、"No"）和可点击的复选框方框。
- 输入边界框应该仅覆盖小方框，而不是文本标签。

### 步骤 2：创建 fields.json 和验证图像（必需）
- 创建一个名为 `fields.json` 的文件，其中包含表单字段和边界框的信息，格式如下：
```
{
  "pages": [
    {
      "page_number": 1,
      "image_width": (第一页图像宽度，以像素为单位),
      "image_height": (第一页图像高度，以像素为单位),
    },
    {
      "page_number": 2,
      "image_width": (第二页图像宽度，以像素为单位),
      "image_height": (第二页图像高度，以像素为单位),
    }
    // 其他页面
  ],
  "form_fields": [
    // 文本字段的示例。
    {
      "page_number": 1,
      "description": "用户的姓氏应该在这里输入",
      // 边界框为 [左, 上, 右, 下]。标签和文本输入的边界框不应重叠。
      "field_label": "Last name",
      "label_bounding_box": [30, 125, 95, 142],
      "entry_bounding_box": [100, 125, 280, 142],
      "entry_text": {
        "text": "Johnson", // 此文本将作为注释添加在 entry_bounding_box 位置
        "font_size": 14, // 可选，默认为 14
        "font_color": "000000", // 可选，RRGGBB 格式，默认为 000000（黑色）
      }
    },
    // 复选框的示例。输入边界框定位方框，而不是文本
    {
      "page_number": 2,
      "description": "如果用户超过 18 岁，则应选中的复选框",
      "entry_bounding_box": [140, 525, 155, 540],  // 复选框方框上的小框
      "field_label": "Yes",
      "label_bounding_box": [100, 525, 132, 540],  // 包含 "Yes" 文本的框
      // 使用 "X" 来选中复选框。
      "entry_text": {
        "text": "X",
      }
    }
    // 其他表单字段条目
  ]
}
```

通过从此文件的目录为每一页运行此脚本来创建验证图像：
`python scripts/create_validation_image.py <page_number> <path_to_fields.json> <input_image_path> <output_image_path>

验证图像将在应该输入文本的位置显示红色矩形，在标签文本上显示蓝色矩形。

### 步骤 3：验证边界框（必需）
#### 自动相交检查
- 通过使用 `check_bounding_boxes.py` 脚本检查 fields.json 文件（从此文件的目录运行），验证边界框不相交且输入边界框足够高：
`python scripts/check_bounding_boxes.py <JSON file>`

如果有错误，请重新分析相关字段，调整边界框，并迭代直到没有剩余错误。记住：标签（蓝色）边界框应该包含文本标签，输入（红色）框不应该。

#### 手动图像检查
**关键提示：在没有视觉检查验证图像的情况下不要继续**
- 红色矩形必须仅覆盖输入区域
- 红色矩形不得包含任何文本
- 蓝色矩形应该包含标签文本
- 对于复选框：
  - 红色矩形必须以复选框方框为中心
  - 蓝色矩形应该覆盖复选框的文本标签

- 如果任何矩形看起来不正确，请修复 fields.json，重新生成验证图像，然后再次验证。重复此过程，直到边界框完全准确。


### 步骤 4：向 PDF 添加注释
从此文件的目录运行此脚本，使用 fields.json 中的信息创建已填写的 PDF：
`python scripts/fill_pdf_form_with_annotations.py <input_pdf_path> <path_to_fields.json> <output_pdf_path>

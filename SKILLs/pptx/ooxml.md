# Office Open XML PowerPoint 技术参考

**重要提示：开始之前请阅读整个文档。** 文档中涵盖了关键的 XML 架构规则和格式要求。错误的实现可能会创建 PowerPoint 无法打开的无效 PPTX 文件。

## 技术指南

### 架构合规性
- **`<p:txBody>` 中的元素顺序**：`<a:bodyPr>`、`<a:lstStyle>`、`<a:p>`
- **空白字符**：对于包含前导/尾随空格的 `<a:t>` 元素，添加 `xml:space='preserve'`
- **Unicode**：在 ASCII 内容中转义字符：`"` 变为 `&#8220;`
- **图片**：添加到 `ppt/media/`，在幻灯片 XML 中引用，设置尺寸以适应幻灯片边界
- **关系**：更新 `ppt/slides/_rels/slideN.xml.rels` 以记录每张幻灯片的资源
- **dirty 属性**：在 `<a:rPr>` 和 `<a:endParaRPr>` 元素中添加 `dirty="0"` 以表示干净状态

## 演示文稿结构

### 基本幻灯片结构
```xml
<!-- ppt/slides/slide1.xml -->
<p:sld>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>...</p:nvGrpSpPr>
      <p:grpSpPr>...</p:grpSpPr>
      <!-- 形状放置在此处 -->
    </p:spTree>
  </p:cSld>
</p:sld>
```

### 文本框 / 带文本的形状
```xml
<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="2" name="Title"/>                        <!-- 非可视属性：ID 和名称 -->
    <p:cNvSpPr>
      <a:spLocks noGrp="1"/>                              <!-- 锁定：禁止分组 -->
    </p:cNvSpPr>
    <p:nvPr>
      <p:ph type="ctrTitle"/>                             <!-- 占位符类型：居中标题 -->
    </p:nvPr>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="838200" y="365125"/>                      <!-- 偏移位置（EMU 单位） -->
      <a:ext cx="7772400" cy="1470025"/>                  <!-- 尺寸：宽度和高度 -->
    </a:xfrm>
  </p:spPr>
  <p:txBody>
    <a:bodyPr/>                                           <!-- 文本主体属性 -->
    <a:lstStyle/>                                         <!-- 列表样式 -->
    <a:p>
      <a:r>
        <a:t>幻灯片标题</a:t>                              <!-- 文本内容 -->
      </a:r>
    </a:p>
  </p:txBody>
</p:sp>
```

### 文本格式
```xml
<!-- 粗体 -->
<a:r>
  <a:rPr b="1"/>                                          <!-- b="1" 表示粗体 -->
  <a:t>粗体文本</a:t>
</a:r>

<!-- 斜体 -->
<a:r>
  <a:rPr i="1"/>                                          <!-- i="1" 表示斜体 -->
  <a:t>斜体文本</a:t>
</a:r>

<!-- 下划线 -->
<a:r>
  <a:rPr u="sng"/>                                        <!-- u="sng" 表示单下划线 -->
  <a:t>下划线文本</a:t>
</a:r>

<!-- 高亮 -->
<a:r>
  <a:rPr>
    <a:highlight>
      <a:srgbClr val="FFFF00"/>                           <!-- 高亮颜色：黄色 -->
    </a:highlight>
  </a:rPr>
  <a:t>高亮文本</a:t>
</a:r>

<!-- 字体和字号 -->
<a:r>
  <a:rPr sz="2400" typeface="Arial">                      <!-- sz="2400" 表示 24pt（单位：百分之一磅） -->
    <a:solidFill>
      <a:srgbClr val="FF0000"/>                           <!-- 字体颜色：红色 -->
    </a:solidFill>
  </a:rPr>
  <a:t>红色 Arial 24pt</a:t>
</a:r>

<!-- 完整格式示例 -->
<a:r>
  <a:rPr lang="en-US" sz="1400" b="1" dirty="0">          <!-- 语言、字号、粗体、干净状态 -->
    <a:solidFill>
      <a:srgbClr val="FAFAFA"/>                           <!-- 字体颜色 -->
    </a:solidFill>
  </a:rPr>
  <a:t>格式化文本</a:t>
</a:r>
```

### 列表
```xml
<!-- 项目符号列表 -->
<a:p>
  <a:pPr lvl="0">                                         <!-- 级别 0（顶级） -->
    <a:buChar char="•"/>                                  <!-- 项目符号字符 -->
  </a:pPr>
  <a:r>
    <a:t>第一个项目符号</a:t>
  </a:r>
</a:p>

<!-- 编号列表 -->
<a:p>
  <a:pPr lvl="0">
    <a:buAutoNum type="arabicPeriod"/>                    <!-- 阿拉伯数字加点 -->
  </a:pPr>
  <a:r>
    <a:t>第一个编号项</a:t>
  </a:r>
</a:p>

<!-- 二级缩进 -->
<a:p>
  <a:pPr lvl="1">                                         <!-- 级别 1（缩进一级） -->
    <a:buChar char="•"/>
  </a:pPr>
  <a:r>
    <a:t>缩进的项目符号</a:t>
  </a:r>
</a:p>
```

### 形状
```xml
<!-- 矩形 -->
<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="3" name="Rectangle"/>                    <!-- 形状 ID 和名称 -->
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="1000000" y="1000000"/>                    <!-- 位置 -->
      <a:ext cx="3000000" cy="2000000"/>                  <!-- 尺寸 -->
    </a:xfrm>
    <a:prstGeom prst="rect">                              <!-- 预设几何形状：矩形 -->
      <a:avLst/>
    </a:prstGeom>
    <a:solidFill>
      <a:srgbClr val="FF0000"/>                           <!-- 填充颜色：红色 -->
    </a:solidFill>
    <a:ln w="25400">                                      <!-- 边框宽度 -->
      <a:solidFill>
        <a:srgbClr val="000000"/>                         <!-- 边框颜色：黑色 -->
      </a:solidFill>
    </a:ln>
  </p:spPr>
</p:sp>

<!-- 圆角矩形 -->
<p:sp>
  <p:spPr>
    <a:prstGeom prst="roundRect">                         <!-- 预设几何形状：圆角矩形 -->
      <a:avLst/>
    </a:prstGeom>
  </p:spPr>
</p:sp>

<!-- 圆形/椭圆 -->
<p:sp>
  <p:spPr>
    <a:prstGeom prst="ellipse">                           <!-- 预设几何形状：椭圆 -->
      <a:avLst/>
    </a:prstGeom>
  </p:spPr>
</p:sp>
```

### 图片
```xml
<p:pic>
  <p:nvPicPr>
    <p:cNvPr id="4" name="Picture">                       <!-- 图片 ID 和名称 -->
      <a:hlinkClick r:id="" action="ppaction://media"/>   <!-- 超链接动作 -->
    </p:cNvPr>
    <p:cNvPicPr>
      <a:picLocks noChangeAspect="1"/>                    <!-- 锁定：禁止更改宽高比 -->
    </p:cNvPicPr>
    <p:nvPr/>
  </p:nvPicPr>
  <p:blipFill>
    <a:blip r:embed="rId2"/>                              <!-- 图片引用（通过关系 ID） -->
    <a:stretch>
      <a:fillRect/>                                       <!-- 拉伸填充 -->
    </a:stretch>
  </p:blipFill>
  <p:spPr>
    <a:xfrm>
      <a:off x="1000000" y="1000000"/>                    <!-- 位置 -->
      <a:ext cx="3000000" cy="2000000"/>                  <!-- 尺寸 -->
    </a:xfrm>
    <a:prstGeom prst="rect">
      <a:avLst/>
    </a:prstGeom>
  </p:spPr>
</p:pic>
```

### 表格
```xml
<p:graphicFrame>
  <p:nvGraphicFramePr>
    <p:cNvPr id="5" name="Table"/>                        <!-- 表格 ID 和名称 -->
    <p:cNvGraphicFramePr>
      <a:graphicFrameLocks noGrp="1"/>                    <!-- 锁定：禁止分组 -->
    </p:cNvGraphicFramePr>
    <p:nvPr/>
  </p:nvGraphicFramePr>
  <p:xfrm>
    <a:off x="1000000" y="1000000"/>                      <!-- 位置 -->
    <a:ext cx="6000000" cy="2000000"/>                    <!-- 尺寸 -->
  </p:xfrm>
  <a:graphic>
    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
      <a:tbl>
        <a:tblGrid>                                       <!-- 表格列定义 -->
          <a:gridCol w="3000000"/>                        <!-- 第一列宽度 -->
          <a:gridCol w="3000000"/>                        <!-- 第二列宽度 -->
        </a:tblGrid>
        <a:tr h="500000">                                 <!-- 表格行，高度 -->
          <a:tc>                                          <!-- 表格单元格 -->
            <a:txBody>
              <a:bodyPr/>
              <a:lstStyle/>
              <a:p>
                <a:r>
                  <a:t>单元格 1</a:t>
                </a:r>
              </a:p>
            </a:txBody>
          </a:tc>
          <a:tc>                                          <!-- 第二个单元格 -->
            <a:txBody>
              <a:bodyPr/>
              <a:lstStyle/>
              <a:p>
                <a:r>
                  <a:t>单元格 2</a:t>
                </a:r>
              </a:p>
            </a:txBody>
          </a:tc>
        </a:tr>
      </a:tbl>
    </a:graphicData>
  </a:graphic>
</p:graphicFrame>
```

### 幻灯片布局

```xml
<!-- 标题幻灯片布局 -->
<p:sp>
  <p:nvSpPr>
    <p:nvPr>
      <p:ph type="ctrTitle"/>                             <!-- 占位符类型：居中标题 -->
    </p:nvPr>
  </p:nvSpPr>
  <!-- 标题内容 -->
</p:sp>

<p:sp>
  <p:nvSpPr>
    <p:nvPr>
      <p:ph type="subTitle" idx="1"/>                     <!-- 占位符类型：副标题 -->
    </p:nvPr>
  </p:nvSpPr>
  <!-- 副标题内容 -->
</p:sp>

<!-- 内容幻灯片布局 -->
<p:sp>
  <p:nvSpPr>
    <p:nvPr>
      <p:ph type="title"/>                                <!-- 占位符类型：标题 -->
    </p:nvPr>
  </p:nvSpPr>
  <!-- 幻灯片标题 -->
</p:sp>

<p:sp>
  <p:nvSpPr>
    <p:nvPr>
      <p:ph type="body" idx="1"/>                         <!-- 占位符类型：正文 -->
    </p:nvPr>
  </p:nvSpPr>
  <!-- 内容正文 -->
</p:sp>
```

## 文件更新

添加内容时，需要更新以下文件：

**`ppt/_rels/presentation.xml.rels`：**
```xml
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
```

**`ppt/slides/_rels/slide1.xml.rels`：**
```xml
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
```

**`[Content_Types].xml`：**
```xml
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
```

**`ppt/presentation.xml`：**
```xml
<p:sldIdLst>
  <p:sldId id="256" r:id="rId1"/>
  <p:sldId id="257" r:id="rId2"/>
</p:sldIdLst>
```

**`docProps/app.xml`：** 更新幻灯片计数和统计信息
```xml
<Slides>2</Slides>
<Paragraphs>10</Paragraphs>
<Words>50</Words>
```

## 幻灯片操作

### 添加新幻灯片
在演示文稿末尾添加幻灯片时：

1. **创建幻灯片文件**（`ppt/slides/slideN.xml`）
2. **更新 `[Content_Types].xml`**：为新幻灯片添加 Override
3. **更新 `ppt/_rels/presentation.xml.rels`**：为新幻灯片添加关系
4. **更新 `ppt/presentation.xml`**：将幻灯片 ID 添加到 `<p:sldIdLst>`
5. **创建幻灯片关系**（`ppt/slides/_rels/slideN.xml.rels`）（如需要）
6. **更新 `docProps/app.xml`**：增加幻灯片计数并更新统计信息（如存在）

### 复制幻灯片
1. 复制源幻灯片 XML 文件并重命名
2. 更新新幻灯片中的所有 ID 使其唯一
3. 按照上述"添加新幻灯片"步骤操作
4. **关键**：删除或更新 `_rels` 文件中的任何备注幻灯片引用
5. 删除对未使用媒体文件的引用

### 重新排序幻灯片
1. **更新 `ppt/presentation.xml`**：重新排列 `<p:sldIdLst>` 中的 `<p:sldId>` 元素
2. `<p:sldId>` 元素的顺序决定幻灯片顺序
3. 保持幻灯片 ID 和关系 ID 不变

示例：
```xml
<!-- 原始顺序 -->
<p:sldIdLst>
  <p:sldId id="256" r:id="rId2"/>
  <p:sldId id="257" r:id="rId3"/>
  <p:sldId id="258" r:id="rId4"/>
</p:sldIdLst>

<!-- 将幻灯片 3 移动到位置 2 后 -->
<p:sldIdLst>
  <p:sldId id="256" r:id="rId2"/>
  <p:sldId id="258" r:id="rId4"/>
  <p:sldId id="257" r:id="rId3"/>
</p:sldIdLst>
```

### 删除幻灯片
1. **从 `ppt/presentation.xml` 中移除**：删除 `<p:sldId>` 条目
2. **从 `ppt/_rels/presentation.xml.rels` 中移除**：删除关系
3. **从 `[Content_Types].xml` 中移除**：删除 Override 条目
4. **删除文件**：移除 `ppt/slides/slideN.xml` 和 `ppt/slides/_rels/slideN.xml.rels`
5. **更新 `docProps/app.xml`**：减少幻灯片计数并更新统计信息
6. **清理未使用的媒体**：从 `ppt/media/` 中移除孤立的图片

注意：不要重新编号剩余的幻灯片——保留其原始 ID 和文件名。


## 常见错误及避免方法

- **编码**：在 ASCII 内容中转义 Unicode 字符：`"` 变为 `&#8220;`
- **图片**：添加到 `ppt/media/` 并更新关系文件
- **列表**：列表标题中省略项目符号
- **ID**：使用有效的十六进制值作为 UUID
- **主题**：检查 `theme` 目录中的所有主题以获取颜色

## 基于模板的演示文稿验证清单

### 打包前，务必：
- **清理未使用的资源**：移除未引用的媒体、字体和备注目录
- **修复 Content_Types.xml**：声明包中存在的所有幻灯片、布局和主题
- **修复关系 ID**：
   - 如果不使用嵌入字体，移除字体嵌入引用
- **移除损坏的引用**：检查所有 `_rels` 文件中对已删除资源的引用

### 常见的模板复制陷阱：
- 复制后多张幻灯片引用同一备注幻灯片
- 模板幻灯片中不再存在的图片/媒体引用
- 未包含字体时的字体嵌入引用
- 缺少布局 12-25 的 slideLayout 声明
- docProps 目录可能无法解包——这是可选的

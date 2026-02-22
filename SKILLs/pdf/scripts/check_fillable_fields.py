import sys
from pypdf import PdfReader


# 供 Claude 运行的脚本，用于确定 PDF 是否具有可填充的表单字段。参见 forms.md。


reader = PdfReader(sys.argv[1])
if (reader.get_fields()):
    print("此 PDF 具有可填充的表单字段")
else:
    print("此 PDF 不具有可填充的表单字段；您需要以视觉方式确定数据输入位置")

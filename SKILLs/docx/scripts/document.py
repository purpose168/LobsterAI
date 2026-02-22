#!/usr/bin/env python3
"""
用于处理 Word 文档的库：批注、修订追踪和编辑。

用法:
    from skills.docx.scripts.document import Document

    # 初始化
    doc = Document('workspace/unpacked')
    doc = Document('workspace/unpacked', author="John Doe", initials="JD")

    # 查找节点
    node = doc["word/document.xml"].get_node(tag="w:del", attrs={"w:id": "1"})
    node = doc["word/document.xml"].get_node(tag="w:p", line_number=10)

    # 添加批注
    doc.add_comment(start=node, end=node, text="批注文本")
    doc.reply_to_comment(parent_comment_id=0, text="回复文本")

    # 建议修订
    doc["word/document.xml"].suggest_deletion(node)  # 删除内容
    doc["word/document.xml"].revert_insertion(ins_node)  # 拒绝插入
    doc["word/document.xml"].revert_deletion(del_node)  # 拒绝删除

    # 保存
    doc.save()
"""

import html
import random
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from defusedxml import minidom
from ooxml.scripts.pack import pack_document
from ooxml.scripts.validation.docx import DOCXSchemaValidator
from ooxml.scripts.validation.redlining import RedliningValidator

from .utilities import XMLEditor

# 模板文件路径
TEMPLATE_DIR = Path(__file__).parent / "templates"


class DocxXMLEditor(XMLEditor):
    """自动将 RSID、作者和日期应用到新元素的 XMLEditor。

    在插入新内容时自动为支持属性的元素添加属性：
    - w:rsidR, w:rsidRDefault, w:rsidP（用于 w:p 和 w:r 元素）
    - w:author 和 w:date（用于 w:ins, w:del, w:comment 元素）
    - w:id（用于 w:ins 和 w:del 元素）

    属性:
        dom (defusedxml.minidom.Document): 用于直接操作的 DOM 文档
    """

    def __init__(
        self, xml_path, rsid: str, author: str = "Claude", initials: str = "C"
    ):
        """使用必需的 RSID 和可选的作者信息初始化。

        参数:
            xml_path: 要编辑的 XML 文件路径
            rsid: 自动应用到新元素的 RSID
            author: 修订追踪和批注的作者名称（默认值："Claude"）
            initials: 作者姓名首字母缩写（默认值："C"）
        """
        super().__init__(xml_path)
        self.rsid = rsid
        self.author = author
        self.initials = initials

    def _get_next_change_id(self):
        """通过检查所有修订元素获取下一个可用的变更 ID。"""
        max_id = -1
        for tag in ("w:ins", "w:del"):
            elements = self.dom.getElementsByTagName(tag)
            for elem in elements:
                change_id = elem.getAttribute("w:id")
                if change_id:
                    try:
                        max_id = max(max_id, int(change_id))
                    except ValueError:
                        pass
        return max_id + 1

    def _ensure_w16du_namespace(self):
        """确保根元素上声明了 w16du 命名空间。"""
        root = self.dom.documentElement
        if not root.hasAttribute("xmlns:w16du"):  # type: ignore
            root.setAttribute(  # type: ignore
                "xmlns:w16du",
                "http://schemas.microsoft.com/office/word/2023/wordml/word16du",
            )

    def _ensure_w16cex_namespace(self):
        """确保根元素上声明了 w16cex 命名空间。"""
        root = self.dom.documentElement
        if not root.hasAttribute("xmlns:w16cex"):  # type: ignore
            root.setAttribute(  # type: ignore
                "xmlns:w16cex",
                "http://schemas.microsoft.com/office/word/2018/wordml/cex",
            )

    def _ensure_w14_namespace(self):
        """确保根元素上声明了 w14 命名空间。"""
        root = self.dom.documentElement
        if not root.hasAttribute("xmlns:w14"):  # type: ignore
            root.setAttribute(  # type: ignore
                "xmlns:w14",
                "http://schemas.microsoft.com/office/word/2010/wordml",
            )

    def _inject_attributes_to_nodes(self, nodes):
        """将 RSID、作者和日期属性注入到适用的 DOM 节点中。

        为支持属性的元素添加属性：
        - w:r: 获取 w:rsidR（如果在 w:del 内部则获取 w:rsidDel）
        - w:p: 获取 w:rsidR, w:rsidRDefault, w:rsidP, w14:paraId, w14:textId
        - w:t: 如果文本有前导/尾随空格则获取 xml:space="preserve"
        - w:ins, w:del: 获取 w:id, w:author, w:date, w16du:dateUtc
        - w:comment: 获取 w:author, w:date, w:initials
        - w16cex:commentExtensible: 获取 w16cex:dateUtc

        参数:
            nodes: 要处理的 DOM 节点列表
        """
        from datetime import datetime, timezone

        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        def is_inside_deletion(elem):
            """检查元素是否在 w:del 元素内部。"""
            parent = elem.parentNode
            while parent:
                if parent.nodeType == parent.ELEMENT_NODE and parent.tagName == "w:del":
                    return True
                parent = parent.parentNode
            return False

        def add_rsid_to_p(elem):
            if not elem.hasAttribute("w:rsidR"):
                elem.setAttribute("w:rsidR", self.rsid)
            if not elem.hasAttribute("w:rsidRDefault"):
                elem.setAttribute("w:rsidRDefault", self.rsid)
            if not elem.hasAttribute("w:rsidP"):
                elem.setAttribute("w:rsidP", self.rsid)
            # 如果不存在则添加 w14:paraId 和 w14:textId
            if not elem.hasAttribute("w14:paraId"):
                self._ensure_w14_namespace()
                elem.setAttribute("w14:paraId", _generate_hex_id())
            if not elem.hasAttribute("w14:textId"):
                self._ensure_w14_namespace()
                elem.setAttribute("w14:textId", _generate_hex_id())

        def add_rsid_to_r(elem):
            # 对于 <w:del> 内部的 <w:r> 使用 w:rsidDel，否则使用 w:rsidR
            if is_inside_deletion(elem):
                if not elem.hasAttribute("w:rsidDel"):
                    elem.setAttribute("w:rsidDel", self.rsid)
            else:
                if not elem.hasAttribute("w:rsidR"):
                    elem.setAttribute("w:rsidR", self.rsid)

        def add_tracked_change_attrs(elem):
            # 如果不存在则自动分配 w:id
            if not elem.hasAttribute("w:id"):
                elem.setAttribute("w:id", str(self._get_next_change_id()))
            if not elem.hasAttribute("w:author"):
                elem.setAttribute("w:author", self.author)
            if not elem.hasAttribute("w:date"):
                elem.setAttribute("w:date", timestamp)
            # 为修订添加 w16du:dateUtc（与我们生成的 UTC 时间戳相同）
            if elem.tagName in ("w:ins", "w:del") and not elem.hasAttribute(
                "w16du:dateUtc"
            ):
                self._ensure_w16du_namespace()
                elem.setAttribute("w16du:dateUtc", timestamp)

        def add_comment_attrs(elem):
            if not elem.hasAttribute("w:author"):
                elem.setAttribute("w:author", self.author)
            if not elem.hasAttribute("w:date"):
                elem.setAttribute("w:date", timestamp)
            if not elem.hasAttribute("w:initials"):
                elem.setAttribute("w:initials", self.initials)

        def add_comment_extensible_date(elem):
            # 为批注可扩展元素添加 w16cex:dateUtc
            if not elem.hasAttribute("w16cex:dateUtc"):
                self._ensure_w16cex_namespace()
                elem.setAttribute("w16cex:dateUtc", timestamp)

        def add_xml_space_to_t(elem):
            # 如果文本有前导/尾随空格，则为 w:t 添加 xml:space="preserve"
            if (
                elem.firstChild
                and elem.firstChild.nodeType == elem.firstChild.TEXT_NODE
            ):
                text = elem.firstChild.data
                if text and (text[0].isspace() or text[-1].isspace()):
                    if not elem.hasAttribute("xml:space"):
                        elem.setAttribute("xml:space", "preserve")

        for node in nodes:
            if node.nodeType != node.ELEMENT_NODE:
                continue

            # 处理节点本身
            if node.tagName == "w:p":
                add_rsid_to_p(node)
            elif node.tagName == "w:r":
                add_rsid_to_r(node)
            elif node.tagName == "w:t":
                add_xml_space_to_t(node)
            elif node.tagName in ("w:ins", "w:del"):
                add_tracked_change_attrs(node)
            elif node.tagName == "w:comment":
                add_comment_attrs(node)
            elif node.tagName == "w16cex:commentExtensible":
                add_comment_extensible_date(node)

            # 处理后代元素（getElementsByTagName 不会返回元素本身）
            for elem in node.getElementsByTagName("w:p"):
                add_rsid_to_p(elem)
            for elem in node.getElementsByTagName("w:r"):
                add_rsid_to_r(elem)
            for elem in node.getElementsByTagName("w:t"):
                add_xml_space_to_t(elem)
            for tag in ("w:ins", "w:del"):
                for elem in node.getElementsByTagName(tag):
                    add_tracked_change_attrs(elem)
            for elem in node.getElementsByTagName("w:comment"):
                add_comment_attrs(elem)
            for elem in node.getElementsByTagName("w16cex:commentExtensible"):
                add_comment_extensible_date(elem)

    def replace_node(self, elem, new_content):
        """替换节点并自动注入属性。"""
        nodes = super().replace_node(elem, new_content)
        self._inject_attributes_to_nodes(nodes)
        return nodes

    def insert_after(self, elem, xml_content):
        """在元素之后插入并自动注入属性。"""
        nodes = super().insert_after(elem, xml_content)
        self._inject_attributes_to_nodes(nodes)
        return nodes

    def insert_before(self, elem, xml_content):
        """在元素之前插入并自动注入属性。"""
        nodes = super().insert_before(elem, xml_content)
        self._inject_attributes_to_nodes(nodes)
        return nodes

    def append_to(self, elem, xml_content):
        """追加到元素并自动注入属性。"""
        nodes = super().append_to(elem, xml_content)
        self._inject_attributes_to_nodes(nodes)
        return nodes

    def revert_insertion(self, elem):
        """通过将内容包装在删除中来拒绝插入。

        将 w:ins 内的所有运行包装在 w:del 中，将 w:t 转换为 w:delText。
        可以处理单个 w:ins 元素或包含多个 w:ins 的容器元素。

        参数:
            elem: 要处理的元素（w:ins, w:p, w:body 等）

        返回:
            list: 包含已处理元素的列表

        抛出:
            ValueError: 如果元素不包含任何 w:ins 元素

        示例:
            # 拒绝单个插入
            ins = doc["word/document.xml"].get_node(tag="w:ins", attrs={"w:id": "5"})
            doc["word/document.xml"].revert_insertion(ins)

            # 拒绝段落中的所有插入
            para = doc["word/document.xml"].get_node(tag="w:p", line_number=42)
            doc["word/document.xml"].revert_insertion(para)
        """
        # 收集插入元素
        ins_elements = []
        if elem.tagName == "w:ins":
            ins_elements.append(elem)
        else:
            ins_elements.extend(elem.getElementsByTagName("w:ins"))

        # 验证是否有要拒绝的插入元素
        if not ins_elements:
            raise ValueError(
                f"revert_insertion requires w:ins elements. "
                f"The provided element <{elem.tagName}> contains no insertions. "
            )

        # 处理所有插入元素 - 将所有子元素包装在 w:del 中
        for ins_elem in ins_elements:
            runs = list(ins_elem.getElementsByTagName("w:r"))
            if not runs:
                continue

            # 创建删除包装器
            del_wrapper = self.dom.createElement("w:del")

            # 处理每个运行
            for run in runs:
                # 转换 w:t → w:delText 和 w:rsidR → w:rsidDel
                if run.hasAttribute("w:rsidR"):
                    run.setAttribute("w:rsidDel", run.getAttribute("w:rsidR"))
                    run.removeAttribute("w:rsidR")
                elif not run.hasAttribute("w:rsidDel"):
                    run.setAttribute("w:rsidDel", self.rsid)

                for t_elem in list(run.getElementsByTagName("w:t")):
                    del_text = self.dom.createElement("w:delText")
                    # 复制所有子节点（不仅仅是 firstChild）以处理实体
                    while t_elem.firstChild:
                        del_text.appendChild(t_elem.firstChild)
                    for i in range(t_elem.attributes.length):
                        attr = t_elem.attributes.item(i)
                        del_text.setAttribute(attr.name, attr.value)
                    t_elem.parentNode.replaceChild(del_text, t_elem)

            # 将所有子元素从 ins 移动到 del 包装器
            while ins_elem.firstChild:
                del_wrapper.appendChild(ins_elem.firstChild)

            # 将 del 包装器添加回 ins
            ins_elem.appendChild(del_wrapper)

            # 向删除包装器注入属性
            self._inject_attributes_to_nodes([del_wrapper])

        return [elem]

    def revert_deletion(self, elem):
        """通过重新插入已删除的内容来拒绝删除。

        在每个 w:del 之后创建 w:ins 元素，复制已删除的内容并将
        w:delText 转换回 w:t。
        可以处理单个 w:del 元素或包含多个 w:del 的容器元素。

        参数:
            elem: 要处理的元素（w:del, w:p, w:body 等）

        返回:
            list: 如果 elem 是 w:del，返回 [elem, new_ins]。否则返回 [elem]。

        抛出:
            ValueError: 如果元素不包含任何 w:del 元素

        示例:
            # 拒绝单个删除 - 返回 [w:del, w:ins]
            del_elem = doc["word/document.xml"].get_node(tag="w:del", attrs={"w:id": "3"})
            nodes = doc["word/document.xml"].revert_deletion(del_elem)

            # 拒绝段落中的所有删除 - 返回 [para]
            para = doc["word/document.xml"].get_node(tag="w:p", line_number=42)
            nodes = doc["word/document.xml"].revert_deletion(para)
        """
        # 首先收集删除元素 - 在修改 DOM 之前
        del_elements = []
        is_single_del = elem.tagName == "w:del"

        if is_single_del:
            del_elements.append(elem)
        else:
            del_elements.extend(elem.getElementsByTagName("w:del"))

        # 验证是否有要拒绝的删除元素
        if not del_elements:
            raise ValueError(
                f"revert_deletion requires w:del elements. "
                f"The provided element <{elem.tagName}> contains no deletions. "
            )

        # 跟踪创建的插入元素（仅当 elem 是单个 w:del 时相关）
        created_insertion = None

        # 处理所有删除元素 - 创建复制已删除内容的插入元素
        for del_elem in del_elements:
            # 克隆已删除的运行并将它们转换为插入元素
            runs = list(del_elem.getElementsByTagName("w:r"))
            if not runs:
                continue

            # 创建插入包装器
            ins_elem = self.dom.createElement("w:ins")

            for run in runs:
                # 克隆运行
                new_run = run.cloneNode(True)

                # 转换 w:delText → w:t
                for del_text in list(new_run.getElementsByTagName("w:delText")):
                    t_elem = self.dom.createElement("w:t")
                    # 复制所有子节点（不仅仅是 firstChild）以处理实体
                    while del_text.firstChild:
                        t_elem.appendChild(del_text.firstChild)
                    for i in range(del_text.attributes.length):
                        attr = del_text.attributes.item(i)
                        t_elem.setAttribute(attr.name, attr.value)
                    del_text.parentNode.replaceChild(t_elem, del_text)

                # 更新运行属性：w:rsidDel → w:rsidR
                if new_run.hasAttribute("w:rsidDel"):
                    new_run.setAttribute("w:rsidR", new_run.getAttribute("w:rsidDel"))
                    new_run.removeAttribute("w:rsidDel")
                elif not new_run.hasAttribute("w:rsidR"):
                    new_run.setAttribute("w:rsidR", self.rsid)

                ins_elem.appendChild(new_run)

            # 在删除之后插入新的插入元素
            nodes = self.insert_after(del_elem, ins_elem.toxml())

            # 如果处理单个 w:del，跟踪创建的插入元素
            if is_single_del and nodes:
                created_insertion = nodes[0]

        # 根据输入类型返回
        if is_single_del and created_insertion:
            return [elem, created_insertion]
        else:
            return [elem]

    @staticmethod
    def suggest_paragraph(xml_content: str) -> str:
        """转换段落 XML 以添加插入的修订包装。

        将运行包装在 <w:ins> 中，并为编号列表在 w:pPr 的 w:rPr 中添加 <w:ins/>。

        参数:
            xml_content: 包含 <w:p> 元素的 XML 字符串

        返回:
            str: 带有修订包装的转换后 XML
        """
        wrapper = f'<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">{xml_content}</root>'
        doc = minidom.parseString(wrapper)
        para = doc.getElementsByTagName("w:p")[0]

        # 确保 w:pPr 存在
        pPr_list = para.getElementsByTagName("w:pPr")
        if not pPr_list:
            pPr = doc.createElement("w:pPr")
            para.insertBefore(
                pPr, para.firstChild
            ) if para.firstChild else para.appendChild(pPr)
        else:
            pPr = pPr_list[0]

        # 确保 w:rPr 存在于 w:pPr 中
        rPr_list = pPr.getElementsByTagName("w:rPr")
        if not rPr_list:
            rPr = doc.createElement("w:rPr")
            pPr.appendChild(rPr)
        else:
            rPr = rPr_list[0]

        # 将 <w:ins/> 添加到 w:rPr
        ins_marker = doc.createElement("w:ins")
        rPr.insertBefore(
            ins_marker, rPr.firstChild
        ) if rPr.firstChild else rPr.appendChild(ins_marker)

        # Wrap all non-pPr children in <w:ins>
        ins_wrapper = doc.createElement("w:ins")
        for child in [c for c in para.childNodes if c.nodeName != "w:pPr"]:
            para.removeChild(child)
            ins_wrapper.appendChild(child)
        para.appendChild(ins_wrapper)

        return para.toxml()

    def suggest_deletion(self, elem):
        """Mark a w:r or w:p element as deleted with tracked changes (in-place DOM manipulation).

        For w:r: wraps in <w:del>, converts <w:t> to <w:delText>, preserves w:rPr
        For w:p (regular): wraps content in <w:del>, converts <w:t> to <w:delText>
        For w:p (numbered list): adds <w:del/> to w:rPr in w:pPr, wraps content in <w:del>

        Args:
            elem: A w:r or w:p DOM element without existing tracked changes

        Returns:
            Element: The modified element

        Raises:
            ValueError: If element has existing tracked changes or invalid structure
        """
        if elem.nodeName == "w:r":
            # Check for existing w:delText
            if elem.getElementsByTagName("w:delText"):
                raise ValueError("w:r element already contains w:delText")

            # Convert w:t → w:delText
            for t_elem in list(elem.getElementsByTagName("w:t")):
                del_text = self.dom.createElement("w:delText")
                # Copy ALL child nodes (not just firstChild) to handle entities
                while t_elem.firstChild:
                    del_text.appendChild(t_elem.firstChild)
                # Preserve attributes like xml:space
                for i in range(t_elem.attributes.length):
                    attr = t_elem.attributes.item(i)
                    del_text.setAttribute(attr.name, attr.value)
                t_elem.parentNode.replaceChild(del_text, t_elem)

            # Update run attributes: w:rsidR → w:rsidDel
            if elem.hasAttribute("w:rsidR"):
                elem.setAttribute("w:rsidDel", elem.getAttribute("w:rsidR"))
                elem.removeAttribute("w:rsidR")
            elif not elem.hasAttribute("w:rsidDel"):
                elem.setAttribute("w:rsidDel", self.rsid)

            # Wrap in w:del
            del_wrapper = self.dom.createElement("w:del")
            parent = elem.parentNode
            parent.insertBefore(del_wrapper, elem)
            parent.removeChild(elem)
            del_wrapper.appendChild(elem)

            # Inject attributes to the deletion wrapper
            self._inject_attributes_to_nodes([del_wrapper])

            return del_wrapper

        elif elem.nodeName == "w:p":
            # Check for existing tracked changes
            if elem.getElementsByTagName("w:ins") or elem.getElementsByTagName("w:del"):
                raise ValueError("w:p element already contains tracked changes")

            # Check if it's a numbered list item
            pPr_list = elem.getElementsByTagName("w:pPr")
            is_numbered = pPr_list and pPr_list[0].getElementsByTagName("w:numPr")

            if is_numbered:
                # Add <w:del/> to w:rPr in w:pPr
                pPr = pPr_list[0]
                rPr_list = pPr.getElementsByTagName("w:rPr")

                if not rPr_list:
                    rPr = self.dom.createElement("w:rPr")
                    pPr.appendChild(rPr)
                else:
                    rPr = rPr_list[0]

                # Add <w:del/> marker
                del_marker = self.dom.createElement("w:del")
                rPr.insertBefore(
                    del_marker, rPr.firstChild
                ) if rPr.firstChild else rPr.appendChild(del_marker)

            # Convert w:t → w:delText in all runs
            for t_elem in list(elem.getElementsByTagName("w:t")):
                del_text = self.dom.createElement("w:delText")
                # Copy ALL child nodes (not just firstChild) to handle entities
                while t_elem.firstChild:
                    del_text.appendChild(t_elem.firstChild)
                # Preserve attributes like xml:space
                for i in range(t_elem.attributes.length):
                    attr = t_elem.attributes.item(i)
                    del_text.setAttribute(attr.name, attr.value)
                t_elem.parentNode.replaceChild(del_text, t_elem)

            # Update run attributes: w:rsidR → w:rsidDel
            for run in elem.getElementsByTagName("w:r"):
                if run.hasAttribute("w:rsidR"):
                    run.setAttribute("w:rsidDel", run.getAttribute("w:rsidR"))
                    run.removeAttribute("w:rsidR")
                elif not run.hasAttribute("w:rsidDel"):
                    run.setAttribute("w:rsidDel", self.rsid)

            # Wrap all non-pPr children in <w:del>
            del_wrapper = self.dom.createElement("w:del")
            for child in [c for c in elem.childNodes if c.nodeName != "w:pPr"]:
                elem.removeChild(child)
                del_wrapper.appendChild(child)
            elem.appendChild(del_wrapper)

            # Inject attributes to the deletion wrapper
            self._inject_attributes_to_nodes([del_wrapper])

            return elem

        else:
            raise ValueError(f"Element must be w:r or w:p, got {elem.nodeName}")


def _generate_hex_id() -> str:
    """Generate random 8-character hex ID for para/durable IDs.

    Values are constrained to be less than 0x7FFFFFFF per OOXML spec:
    - paraId must be < 0x80000000
    - durableId must be < 0x7FFFFFFF
    We use the stricter constraint (0x7FFFFFFF) for both.
    """
    return f"{random.randint(1, 0x7FFFFFFE):08X}"


def _generate_rsid() -> str:
    """Generate random 8-character hex RSID."""
    return "".join(random.choices("0123456789ABCDEF", k=8))


class Document:
    """Manages comments in unpacked Word documents."""

    def __init__(
        self,
        unpacked_dir,
        rsid=None,
        track_revisions=False,
        author="Claude",
        initials="C",
    ):
        """
        Initialize with path to unpacked Word document directory.
        Automatically sets up comment infrastructure (people.xml, RSIDs).

        Args:
            unpacked_dir: Path to unpacked DOCX directory (must contain word/ subdirectory)
            rsid: Optional RSID to use for all comment elements. If not provided, one will be generated.
            track_revisions: If True, enables track revisions in settings.xml (default: False)
            author: Default author name for comments (default: "Claude")
            initials: Default author initials for comments (default: "C")
        """
        self.original_path = Path(unpacked_dir)

        if not self.original_path.exists() or not self.original_path.is_dir():
            raise ValueError(f"Directory not found: {unpacked_dir}")

        # Create temporary directory with subdirectories for unpacked content and baseline
        self.temp_dir = tempfile.mkdtemp(prefix="docx_")
        self.unpacked_path = Path(self.temp_dir) / "unpacked"
        shutil.copytree(self.original_path, self.unpacked_path)

        # Pack original directory into temporary .docx for validation baseline (outside unpacked dir)
        self.original_docx = Path(self.temp_dir) / "original.docx"
        pack_document(self.original_path, self.original_docx, validate=False)

        self.word_path = self.unpacked_path / "word"

        # Generate RSID if not provided
        self.rsid = rsid if rsid else _generate_rsid()
        print(f"Using RSID: {self.rsid}")

        # Set default author and initials
        self.author = author
        self.initials = initials

        # Cache for lazy-loaded editors
        self._editors = {}

        # Comment file paths
        self.comments_path = self.word_path / "comments.xml"
        self.comments_extended_path = self.word_path / "commentsExtended.xml"
        self.comments_ids_path = self.word_path / "commentsIds.xml"
        self.comments_extensible_path = self.word_path / "commentsExtensible.xml"

        # Load existing comments and determine next ID (before setup modifies files)
        self.existing_comments = self._load_existing_comments()
        self.next_comment_id = self._get_next_comment_id()

        # Convenient access to document.xml editor (semi-private)
        self._document = self["word/document.xml"]

        # Setup tracked changes infrastructure
        self._setup_tracking(track_revisions=track_revisions)

        # Add author to people.xml
        self._add_author_to_people(author)

    def __getitem__(self, xml_path: str) -> DocxXMLEditor:
        """
        Get or create a DocxXMLEditor for the specified XML file.

        Enables lazy-loaded editors with bracket notation:
            node = doc["word/document.xml"].get_node(tag="w:p", line_number=42)

        Args:
            xml_path: Relative path to XML file (e.g., "word/document.xml", "word/comments.xml")

        Returns:
            DocxXMLEditor instance for the specified file

        Raises:
            ValueError: If the file does not exist

        Example:
            # Get node from document.xml
            node = doc["word/document.xml"].get_node(tag="w:del", attrs={"w:id": "1"})

            # Get node from comments.xml
            comment = doc["word/comments.xml"].get_node(tag="w:comment", attrs={"w:id": "0"})
        """
        if xml_path not in self._editors:
            file_path = self.unpacked_path / xml_path
            if not file_path.exists():
                raise ValueError(f"XML file not found: {xml_path}")
            # Use DocxXMLEditor with RSID, author, and initials for all editors
            self._editors[xml_path] = DocxXMLEditor(
                file_path, rsid=self.rsid, author=self.author, initials=self.initials
            )
        return self._editors[xml_path]

    def add_comment(self, start, end, text: str) -> int:
        """
        Add a comment spanning from one element to another.

        Args:
            start: DOM element for the starting point
            end: DOM element for the ending point
            text: Comment content

        Returns:
            The comment ID that was created

        Example:
            start_node = cm.get_document_node(tag="w:del", id="1")
            end_node = cm.get_document_node(tag="w:ins", id="2")
            cm.add_comment(start=start_node, end=end_node, text="Explanation")
        """
        comment_id = self.next_comment_id
        para_id = _generate_hex_id()
        durable_id = _generate_hex_id()
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Add comment ranges to document.xml immediately
        self._document.insert_before(start, self._comment_range_start_xml(comment_id))

        # If end node is a paragraph, append comment markup inside it
        # Otherwise insert after it (for run-level anchors)
        if end.tagName == "w:p":
            self._document.append_to(end, self._comment_range_end_xml(comment_id))
        else:
            self._document.insert_after(end, self._comment_range_end_xml(comment_id))

        # Add to comments.xml immediately
        self._add_to_comments_xml(
            comment_id, para_id, text, self.author, self.initials, timestamp
        )

        # Add to commentsExtended.xml immediately
        self._add_to_comments_extended_xml(para_id, parent_para_id=None)

        # Add to commentsIds.xml immediately
        self._add_to_comments_ids_xml(para_id, durable_id)

        # Add to commentsExtensible.xml immediately
        self._add_to_comments_extensible_xml(durable_id)

        # Update existing_comments so replies work
        self.existing_comments[comment_id] = {"para_id": para_id}

        self.next_comment_id += 1
        return comment_id

    def reply_to_comment(
        self,
        parent_comment_id: int,
        text: str,
    ) -> int:
        """
        Add a reply to an existing comment.

        Args:
            parent_comment_id: The w:id of the parent comment to reply to
            text: Reply text

        Returns:
            The comment ID that was created for the reply

        Example:
            cm.reply_to_comment(parent_comment_id=0, text="I agree with this change")
        """
        if parent_comment_id not in self.existing_comments:
            raise ValueError(f"Parent comment with id={parent_comment_id} not found")

        parent_info = self.existing_comments[parent_comment_id]
        comment_id = self.next_comment_id
        para_id = _generate_hex_id()
        durable_id = _generate_hex_id()
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Add comment ranges to document.xml immediately
        parent_start_elem = self._document.get_node(
            tag="w:commentRangeStart", attrs={"w:id": str(parent_comment_id)}
        )
        parent_ref_elem = self._document.get_node(
            tag="w:commentReference", attrs={"w:id": str(parent_comment_id)}
        )

        self._document.insert_after(
            parent_start_elem, self._comment_range_start_xml(comment_id)
        )
        parent_ref_run = parent_ref_elem.parentNode
        self._document.insert_after(
            parent_ref_run, f'<w:commentRangeEnd w:id="{comment_id}"/>'
        )
        self._document.insert_after(
            parent_ref_run, self._comment_ref_run_xml(comment_id)
        )

        # Add to comments.xml immediately
        self._add_to_comments_xml(
            comment_id, para_id, text, self.author, self.initials, timestamp
        )

        # Add to commentsExtended.xml immediately (with parent)
        self._add_to_comments_extended_xml(
            para_id, parent_para_id=parent_info["para_id"]
        )

        # Add to commentsIds.xml immediately
        self._add_to_comments_ids_xml(para_id, durable_id)

        # Add to commentsExtensible.xml immediately
        self._add_to_comments_extensible_xml(durable_id)

        # Update existing_comments so replies work
        self.existing_comments[comment_id] = {"para_id": para_id}

        self.next_comment_id += 1
        return comment_id

    def __del__(self):
        """Clean up temporary directory on deletion."""
        if hasattr(self, "temp_dir") and Path(self.temp_dir).exists():
            shutil.rmtree(self.temp_dir)

    def validate(self) -> None:
        """
        Validate the document against XSD schema and redlining rules.

        Raises:
            ValueError: If validation fails.
        """
        # Create validators with current state
        schema_validator = DOCXSchemaValidator(
            self.unpacked_path, self.original_docx, verbose=False
        )
        redlining_validator = RedliningValidator(
            self.unpacked_path, self.original_docx, verbose=False
        )

        # Run validations
        if not schema_validator.validate():
            raise ValueError("Schema validation failed")
        if not redlining_validator.validate():
            raise ValueError("Redlining validation failed")

    def save(self, destination=None, validate=True) -> None:
        """
        Save all modified XML files to disk and copy to destination directory.

        This persists all changes made via add_comment() and reply_to_comment().

        Args:
            destination: Optional path to save to. If None, saves back to original directory.
            validate: If True, validates document before saving (default: True).
        """
        # Only ensure comment relationships and content types if comment files exist
        if self.comments_path.exists():
            self._ensure_comment_relationships()
            self._ensure_comment_content_types()

        # Save all modified XML files in temp directory
        for editor in self._editors.values():
            editor.save()

        # Validate by default
        if validate:
            self.validate()

        # Copy contents from temp directory to destination (or original directory)
        target_path = Path(destination) if destination else self.original_path
        shutil.copytree(self.unpacked_path, target_path, dirs_exist_ok=True)

    # ==================== Private: Initialization ====================

    def _get_next_comment_id(self):
        """Get the next available comment ID."""
        if not self.comments_path.exists():
            return 0

        editor = self["word/comments.xml"]
        max_id = -1
        for comment_elem in editor.dom.getElementsByTagName("w:comment"):
            comment_id = comment_elem.getAttribute("w:id")
            if comment_id:
                try:
                    max_id = max(max_id, int(comment_id))
                except ValueError:
                    pass
        return max_id + 1

    def _load_existing_comments(self):
        """Load existing comments from files to enable replies."""
        if not self.comments_path.exists():
            return {}

        editor = self["word/comments.xml"]
        existing = {}

        for comment_elem in editor.dom.getElementsByTagName("w:comment"):
            comment_id = comment_elem.getAttribute("w:id")
            if not comment_id:
                continue

            # Find para_id from the w:p element within the comment
            para_id = None
            for p_elem in comment_elem.getElementsByTagName("w:p"):
                para_id = p_elem.getAttribute("w14:paraId")
                if para_id:
                    break

            if not para_id:
                continue

            existing[int(comment_id)] = {"para_id": para_id}

        return existing

    # ==================== Private: Setup Methods ====================

    def _setup_tracking(self, track_revisions=False):
        """Set up comment infrastructure in unpacked directory.

        Args:
            track_revisions: If True, enables track revisions in settings.xml
        """
        # Create or update word/people.xml
        people_file = self.word_path / "people.xml"
        self._update_people_xml(people_file)

        # Update XML files
        self._add_content_type_for_people(self.unpacked_path / "[Content_Types].xml")
        self._add_relationship_for_people(
            self.word_path / "_rels" / "document.xml.rels"
        )

        # Always add RSID to settings.xml, optionally enable trackRevisions
        self._update_settings(
            self.word_path / "settings.xml", track_revisions=track_revisions
        )

    def _update_people_xml(self, path):
        """Create people.xml if it doesn't exist."""
        if not path.exists():
            # Copy from template
            shutil.copy(TEMPLATE_DIR / "people.xml", path)

    def _add_content_type_for_people(self, path):
        """Add people.xml content type to [Content_Types].xml if not already present."""
        editor = self["[Content_Types].xml"]

        if self._has_override(editor, "/word/people.xml"):
            return

        # Add Override element
        root = editor.dom.documentElement
        override_xml = '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/>'
        editor.append_to(root, override_xml)

    def _add_relationship_for_people(self, path):
        """Add people.xml relationship to document.xml.rels if not already present."""
        editor = self["word/_rels/document.xml.rels"]

        if self._has_relationship(editor, "people.xml"):
            return

        root = editor.dom.documentElement
        root_tag = root.tagName  # type: ignore
        prefix = root_tag.split(":")[0] + ":" if ":" in root_tag else ""
        next_rid = editor.get_next_rid()

        # Create the relationship entry
        rel_xml = f'<{prefix}Relationship Id="{next_rid}" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/>'
        editor.append_to(root, rel_xml)

    def _update_settings(self, path, track_revisions=False):
        """Add RSID and optionally enable track revisions in settings.xml.

        Args:
            path: Path to settings.xml
            track_revisions: If True, adds trackRevisions element

        Places elements per OOXML schema order:
        - trackRevisions: early (before defaultTabStop)
        - rsids: late (after compat)
        """
        editor = self["word/settings.xml"]
        root = editor.get_node(tag="w:settings")
        prefix = root.tagName.split(":")[0] if ":" in root.tagName else "w"

        # Conditionally add trackRevisions if requested
        if track_revisions:
            track_revisions_exists = any(
                elem.tagName == f"{prefix}:trackRevisions"
                for elem in editor.dom.getElementsByTagName(f"{prefix}:trackRevisions")
            )

            if not track_revisions_exists:
                track_rev_xml = f"<{prefix}:trackRevisions/>"
                # Try to insert before documentProtection, defaultTabStop, or at start
                inserted = False
                for tag in [f"{prefix}:documentProtection", f"{prefix}:defaultTabStop"]:
                    elements = editor.dom.getElementsByTagName(tag)
                    if elements:
                        editor.insert_before(elements[0], track_rev_xml)
                        inserted = True
                        break
                if not inserted:
                    # Insert as first child of settings
                    if root.firstChild:
                        editor.insert_before(root.firstChild, track_rev_xml)
                    else:
                        editor.append_to(root, track_rev_xml)

        # Always check if rsids section exists
        rsids_elements = editor.dom.getElementsByTagName(f"{prefix}:rsids")

        if not rsids_elements:
            # Add new rsids section
            rsids_xml = f'''<{prefix}:rsids>
  <{prefix}:rsidRoot {prefix}:val="{self.rsid}"/>
  <{prefix}:rsid {prefix}:val="{self.rsid}"/>
</{prefix}:rsids>'''

            # Try to insert after compat, before clrSchemeMapping, or before closing tag
            inserted = False
            compat_elements = editor.dom.getElementsByTagName(f"{prefix}:compat")
            if compat_elements:
                editor.insert_after(compat_elements[0], rsids_xml)
                inserted = True

            if not inserted:
                clr_elements = editor.dom.getElementsByTagName(
                    f"{prefix}:clrSchemeMapping"
                )
                if clr_elements:
                    editor.insert_before(clr_elements[0], rsids_xml)
                    inserted = True

            if not inserted:
                editor.append_to(root, rsids_xml)
        else:
            # Check if this rsid already exists
            rsids_elem = rsids_elements[0]
            rsid_exists = any(
                elem.getAttribute(f"{prefix}:val") == self.rsid
                for elem in rsids_elem.getElementsByTagName(f"{prefix}:rsid")
            )

            if not rsid_exists:
                rsid_xml = f'<{prefix}:rsid {prefix}:val="{self.rsid}"/>'
                editor.append_to(rsids_elem, rsid_xml)

    # ==================== Private: XML File Creation ====================

    def _add_to_comments_xml(
        self, comment_id, para_id, text, author, initials, timestamp
    ):
        """Add a single comment to comments.xml."""
        if not self.comments_path.exists():
            shutil.copy(TEMPLATE_DIR / "comments.xml", self.comments_path)

        editor = self["word/comments.xml"]
        root = editor.get_node(tag="w:comments")

        escaped_text = (
            text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )
        # Note: w:rsidR, w:rsidRDefault, w:rsidP on w:p, w:rsidR on w:r,
        # and w:author, w:date, w:initials on w:comment are automatically added by DocxXMLEditor
        comment_xml = f'''<w:comment w:id="{comment_id}">
  <w:p w14:paraId="{para_id}" w14:textId="77777777">
    <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>
    <w:r><w:rPr><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>{escaped_text}</w:t></w:r>
  </w:p>
</w:comment>'''
        editor.append_to(root, comment_xml)

    def _add_to_comments_extended_xml(self, para_id, parent_para_id):
        """Add a single comment to commentsExtended.xml."""
        if not self.comments_extended_path.exists():
            shutil.copy(
                TEMPLATE_DIR / "commentsExtended.xml", self.comments_extended_path
            )

        editor = self["word/commentsExtended.xml"]
        root = editor.get_node(tag="w15:commentsEx")

        if parent_para_id:
            xml = f'<w15:commentEx w15:paraId="{para_id}" w15:paraIdParent="{parent_para_id}" w15:done="0"/>'
        else:
            xml = f'<w15:commentEx w15:paraId="{para_id}" w15:done="0"/>'
        editor.append_to(root, xml)

    def _add_to_comments_ids_xml(self, para_id, durable_id):
        """Add a single comment to commentsIds.xml."""
        if not self.comments_ids_path.exists():
            shutil.copy(TEMPLATE_DIR / "commentsIds.xml", self.comments_ids_path)

        editor = self["word/commentsIds.xml"]
        root = editor.get_node(tag="w16cid:commentsIds")

        xml = f'<w16cid:commentId w16cid:paraId="{para_id}" w16cid:durableId="{durable_id}"/>'
        editor.append_to(root, xml)

    def _add_to_comments_extensible_xml(self, durable_id):
        """Add a single comment to commentsExtensible.xml."""
        if not self.comments_extensible_path.exists():
            shutil.copy(
                TEMPLATE_DIR / "commentsExtensible.xml", self.comments_extensible_path
            )

        editor = self["word/commentsExtensible.xml"]
        root = editor.get_node(tag="w16cex:commentsExtensible")

        xml = f'<w16cex:commentExtensible w16cex:durableId="{durable_id}"/>'
        editor.append_to(root, xml)

    # ==================== Private: XML Fragments ====================

    def _comment_range_start_xml(self, comment_id):
        """Generate XML for comment range start."""
        return f'<w:commentRangeStart w:id="{comment_id}"/>'

    def _comment_range_end_xml(self, comment_id):
        """Generate XML for comment range end with reference run.

        Note: w:rsidR is automatically added by DocxXMLEditor.
        """
        return f'''<w:commentRangeEnd w:id="{comment_id}"/>
<w:r>
  <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
  <w:commentReference w:id="{comment_id}"/>
</w:r>'''

    def _comment_ref_run_xml(self, comment_id):
        """Generate XML for comment reference run.

        Note: w:rsidR is automatically added by DocxXMLEditor.
        """
        return f'''<w:r>
  <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
  <w:commentReference w:id="{comment_id}"/>
</w:r>'''

    # ==================== Private: Metadata Updates ====================

    def _has_relationship(self, editor, target):
        """Check if a relationship with given target exists."""
        for rel_elem in editor.dom.getElementsByTagName("Relationship"):
            if rel_elem.getAttribute("Target") == target:
                return True
        return False

    def _has_override(self, editor, part_name):
        """Check if an override with given part name exists."""
        for override_elem in editor.dom.getElementsByTagName("Override"):
            if override_elem.getAttribute("PartName") == part_name:
                return True
        return False

    def _has_author(self, editor, author):
        """Check if an author already exists in people.xml."""
        for person_elem in editor.dom.getElementsByTagName("w15:person"):
            if person_elem.getAttribute("w15:author") == author:
                return True
        return False

    def _add_author_to_people(self, author):
        """Add author to people.xml (called during initialization)."""
        people_path = self.word_path / "people.xml"

        # people.xml should already exist from _setup_tracking
        if not people_path.exists():
            raise ValueError("people.xml should exist after _setup_tracking")

        editor = self["word/people.xml"]
        root = editor.get_node(tag="w15:people")

        # Check if author already exists
        if self._has_author(editor, author):
            return

        # Add author with proper XML escaping to prevent injection
        escaped_author = html.escape(author, quote=True)
        person_xml = f'''<w15:person w15:author="{escaped_author}">
  <w15:presenceInfo w15:providerId="None" w15:userId="{escaped_author}"/>
</w15:person>'''
        editor.append_to(root, person_xml)

    def _ensure_comment_relationships(self):
        """Ensure word/_rels/document.xml.rels has comment relationships."""
        editor = self["word/_rels/document.xml.rels"]

        if self._has_relationship(editor, "comments.xml"):
            return

        root = editor.dom.documentElement
        root_tag = root.tagName  # type: ignore
        prefix = root_tag.split(":")[0] + ":" if ":" in root_tag else ""
        next_rid_num = int(editor.get_next_rid()[3:])

        # Add relationship elements
        rels = [
            (
                next_rid_num,
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
                "comments.xml",
            ),
            (
                next_rid_num + 1,
                "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
                "commentsExtended.xml",
            ),
            (
                next_rid_num + 2,
                "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds",
                "commentsIds.xml",
            ),
            (
                next_rid_num + 3,
                "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible",
                "commentsExtensible.xml",
            ),
        ]

        for rel_id, rel_type, target in rels:
            rel_xml = f'<{prefix}Relationship Id="rId{rel_id}" Type="{rel_type}" Target="{target}"/>'
            editor.append_to(root, rel_xml)

    def _ensure_comment_content_types(self):
        """Ensure [Content_Types].xml has comment content types."""
        editor = self["[Content_Types].xml"]

        if self._has_override(editor, "/word/comments.xml"):
            return

        root = editor.dom.documentElement

        # Add Override elements
        overrides = [
            (
                "/word/comments.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
            ),
            (
                "/word/commentsExtended.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml",
            ),
            (
                "/word/commentsIds.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml",
            ),
            (
                "/word/commentsExtensible.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml",
            ),
        ]

        for part_name, content_type in overrides:
            override_xml = (
                f'<Override PartName="{part_name}" ContentType="{content_type}"/>'
            )
            editor.append_to(root, override_xml)

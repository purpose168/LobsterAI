#!/usr/bin/env python3
"""
从 PowerPoint 演示文稿幻灯片创建缩略图网格。

创建可配置列数的幻灯片缩略图网格布局（最多 6 列）。
每个网格最多包含 cols×(cols+1) 张图片。对于幻灯片较多的演示文稿，
会自动创建多个带编号的网格文件。

程序会输出所有创建的文件名称。

输出：
- 单个网格：{prefix}.jpg（如果幻灯片可以放入一个网格）
- 多个网格：{prefix}-1.jpg, {prefix}-2.jpg 等

按列数的网格限制：
- 3 列：每个网格最多 12 张幻灯片（3×4）
- 4 列：每个网格最多 20 张幻灯片（4×5）
- 5 列：每个网格最多 30 张幻灯片（5×6）[默认]
- 6 列：每个网格最多 42 张幻灯片（6×7）

用法：
    python thumbnail.py input.pptx [output_prefix] [--cols N] [--outline-placeholders]

示例：
    python thumbnail.py presentation.pptx
    # 创建：thumbnails.jpg（使用默认前缀）
    # 输出：
    #   Created 1 grid(s):
    #     - thumbnails.jpg

    python thumbnail.py large-deck.pptx grid --cols 4
    # 创建：grid-1.jpg, grid-2.jpg, grid-3.jpg
    # 输出：
    #   Created 3 grid(s):
    #     - grid-1.jpg
    #     - grid-2.jpg
    #     - grid-3.jpg

    python thumbnail.py template.pptx analysis --outline-placeholders
    # 创建带有红色文本占位符轮廓的缩略图网格
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from inventory import extract_text_inventory
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation

# 常量
THUMBNAIL_WIDTH = 300  # 固定缩略图宽度（像素）
CONVERSION_DPI = 100  # PDF 转图片的 DPI
MAX_COLS = 6  # 最大列数
DEFAULT_COLS = 5  # 默认列数
JPEG_QUALITY = 95  # JPEG 压缩质量

# 网格布局常量
GRID_PADDING = 20  # 缩略图之间的间距
BORDER_WIDTH = 2  # 缩略图边框宽度
FONT_SIZE_RATIO = 0.12  # 字体大小占缩略图宽度的比例
LABEL_PADDING_RATIO = 0.4  # 标签内边距占字体大小的比例


def main():
    parser = argparse.ArgumentParser(
        description="从 PowerPoint 幻灯片创建缩略图网格。"
    )
    parser.add_argument("input", help="输入 PowerPoint 文件（.pptx）")
    parser.add_argument(
        "output_prefix",
        nargs="?",
        default="thumbnails",
        help="图片文件的输出前缀（默认：thumbnails，将创建 prefix.jpg 或 prefix-N.jpg）",
    )
    parser.add_argument(
        "--cols",
        type=int,
        default=DEFAULT_COLS,
        help=f"列数（默认：{DEFAULT_COLS}，最大：{MAX_COLS}）",
    )
    parser.add_argument(
        "--outline-placeholders",
        action="store_true",
        help="用彩色边框勾勒文本占位符",
    )

    args = parser.parse_args()

    # 验证列数
    cols = min(args.cols, MAX_COLS)
    if args.cols > MAX_COLS:
        print(f"警告：列数已限制为 {MAX_COLS}（请求的 {args.cols}）")

    # 验证输入
    input_path = Path(args.input)
    if not input_path.exists() or input_path.suffix.lower() != ".pptx":
        print(f"错误：无效的 PowerPoint 文件：{args.input}")
        sys.exit(1)

    # 构建输出路径（始终为 JPG）
    output_path = Path(f"{args.output_prefix}.jpg")

    print(f"正在处理：{args.input}")

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            # 如果启用了轮廓勾勒，获取占位符区域
            placeholder_regions = None
            slide_dimensions = None
            if args.outline_placeholders:
                print("正在提取占位符区域...")
                placeholder_regions, slide_dimensions = get_placeholder_regions(
                    input_path
                )
                if placeholder_regions:
                    print(f"在 {len(placeholder_regions)} 张幻灯片上发现占位符")

            # 将幻灯片转换为图片
            slide_images = convert_to_images(input_path, Path(temp_dir), CONVERSION_DPI)
            if not slide_images:
                print("错误：未找到幻灯片")
                sys.exit(1)

            print(f"发现 {len(slide_images)} 张幻灯片")

            # 创建网格（每个网格最多 cols×(cols+1) 张图片）
            grid_files = create_grids(
                slide_images,
                cols,
                THUMBNAIL_WIDTH,
                output_path,
                placeholder_regions,
                slide_dimensions,
            )

            # 打印保存的文件
            print(f"已创建 {len(grid_files)} 个网格：")
            for grid_file in grid_files:
                print(f"  - {grid_file}")

    except Exception as e:
        print(f"错误：{e}")
        sys.exit(1)


def create_hidden_slide_placeholder(size):
    """为隐藏幻灯片创建占位符图片。"""
    img = Image.new("RGB", size, color="#F0F0F0")
    draw = ImageDraw.Draw(img)
    line_width = max(5, min(size) // 100)
    draw.line([(0, 0), size], fill="#CCCCCC", width=line_width)
    draw.line([(size[0], 0), (0, size[1])], fill="#CCCCCC", width=line_width)
    return img


def get_placeholder_regions(pptx_path):
    """从演示文稿中提取所有文本区域。

    返回一个元组 (placeholder_regions, slide_dimensions)。
    text_regions 是一个字典，将幻灯片索引映射到文本区域列表。
    每个区域是一个包含 'left'、'top'、'width'、'height' 的字典，单位为英寸。
    slide_dimensions 是一个元组 (width_inches, height_inches)。
    """
    prs = Presentation(str(pptx_path))
    inventory = extract_text_inventory(pptx_path, prs)
    placeholder_regions = {}

    # 获取实际的幻灯片尺寸（以英寸为单位，EMU 转英寸）
    slide_width_inches = (prs.slide_width or 9144000) / 914400.0
    slide_height_inches = (prs.slide_height or 5143500) / 914400.0

    for slide_key, shapes in inventory.items():
        # 从 "slide-N" 格式中提取幻灯片索引
        slide_idx = int(slide_key.split("-")[1])
        regions = []

        for shape_key, shape_data in shapes.items():
            # 清单只包含带有文本的形状，因此所有形状都应该被高亮显示
            regions.append(
                {
                    "left": shape_data.left,
                    "top": shape_data.top,
                    "width": shape_data.width,
                    "height": shape_data.height,
                }
            )

        if regions:
            placeholder_regions[slide_idx] = regions

    return placeholder_regions, (slide_width_inches, slide_height_inches)


def convert_to_images(pptx_path, temp_dir, dpi):
    """通过 PDF 将 PowerPoint 转换为图片，处理隐藏幻灯片。"""
    # 检测隐藏幻灯片
    print("正在分析演示文稿...")
    prs = Presentation(str(pptx_path))
    total_slides = len(prs.slides)

    # 查找隐藏幻灯片（使用 1 为起始索引用于显示）
    hidden_slides = {
        idx + 1
        for idx, slide in enumerate(prs.slides)
        if slide.element.get("show") == "0"
    }

    print(f"幻灯片总数：{total_slides}")
    if hidden_slides:
        print(f"隐藏幻灯片：{sorted(hidden_slides)}")

    pdf_path = temp_dir / f"{pptx_path.stem}.pdf"

    # 转换为 PDF
    print("正在转换为 PDF...")
    result = subprocess.run(
        [
            "soffice",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(temp_dir),
            str(pptx_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not pdf_path.exists():
        raise RuntimeError("PDF 转换失败")

    # 将 PDF 转换为图片
    print(f"正在转换为图片（{dpi} DPI）...")
    result = subprocess.run(
        ["pdftoppm", "-jpeg", "-r", str(dpi), str(pdf_path), str(temp_dir / "slide")],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError("图片转换失败")

    visible_images = sorted(temp_dir.glob("slide-*.jpg"))

    # 创建包含隐藏幻灯片占位符的完整列表
    all_images = []
    visible_idx = 0

    # 从第一张可见幻灯片获取占位符尺寸
    if visible_images:
        with Image.open(visible_images[0]) as img:
            placeholder_size = img.size
    else:
        placeholder_size = (1920, 1080)

    for slide_num in range(1, total_slides + 1):
        if slide_num in hidden_slides:
            # 为隐藏幻灯片创建占位符图片
            placeholder_path = temp_dir / f"hidden-{slide_num:03d}.jpg"
            placeholder_img = create_hidden_slide_placeholder(placeholder_size)
            placeholder_img.save(placeholder_path, "JPEG")
            all_images.append(placeholder_path)
        else:
            # 使用实际的可见幻灯片图片
            if visible_idx < len(visible_images):
                all_images.append(visible_images[visible_idx])
                visible_idx += 1

    return all_images


def create_grids(
    image_paths,
    cols,
    width,
    output_path,
    placeholder_regions=None,
    slide_dimensions=None,
):
    """从幻灯片图片创建多个缩略图网格，每个网格最多 cols×(cols+1) 张图片。"""
    # 每个网格的最大图片数为 cols × (cols + 1)，以获得更好的比例
    max_images_per_grid = cols * (cols + 1)
    grid_files = []

    print(
        f"正在创建 {cols} 列的网格（每个网格最多 {max_images_per_grid} 张图片）"
    )

    # 将图片分割成块
    for chunk_idx, start_idx in enumerate(
        range(0, len(image_paths), max_images_per_grid)
    ):
        end_idx = min(start_idx + max_images_per_grid, len(image_paths))
        chunk_images = image_paths[start_idx:end_idx]

        # 为此块创建网格
        grid = create_grid(
            chunk_images, cols, width, start_idx, placeholder_regions, slide_dimensions
        )

        # 生成输出文件名
        if len(image_paths) <= max_images_per_grid:
            # 单个网格 - 使用不带后缀的基本文件名
            grid_filename = output_path
        else:
            # 多个网格 - 在扩展名前插入带短横线的索引
            stem = output_path.stem
            suffix = output_path.suffix
            grid_filename = output_path.parent / f"{stem}-{chunk_idx + 1}{suffix}"

        # 保存网格
        grid_filename.parent.mkdir(parents=True, exist_ok=True)
        grid.save(str(grid_filename), quality=JPEG_QUALITY)
        grid_files.append(str(grid_filename))

    return grid_files


def create_grid(
    image_paths,
    cols,
    width,
    start_slide_num=0,
    placeholder_regions=None,
    slide_dimensions=None,
):
    """从幻灯片图片创建缩略图网格，可选择勾勒占位符轮廓。"""
    font_size = int(width * FONT_SIZE_RATIO)
    label_padding = int(font_size * LABEL_PADDING_RATIO)

    # 获取尺寸
    with Image.open(image_paths[0]) as img:
        aspect = img.height / img.width
    height = int(width * aspect)

    # 计算网格大小
    rows = (len(image_paths) + cols - 1) // cols
    grid_w = cols * width + (cols + 1) * GRID_PADDING
    grid_h = rows * (height + font_size + label_padding * 2) + (rows + 1) * GRID_PADDING

    # 创建网格
    grid = Image.new("RGB", (grid_w, grid_h), "white")
    draw = ImageDraw.Draw(grid)

    # 加载字体，大小基于缩略图宽度
    try:
        # 使用 Pillow 的默认字体并指定大小
        font = ImageFont.load_default(size=font_size)
    except Exception:
        # 如果不支持 size 参数，则回退到基本默认字体
        font = ImageFont.load_default()

    # 放置缩略图
    for i, img_path in enumerate(image_paths):
        row, col = i // cols, i % cols
        x = col * width + (col + 1) * GRID_PADDING
        y_base = (
            row * (height + font_size + label_padding * 2) + (row + 1) * GRID_PADDING
        )

        # 添加带有实际幻灯片编号的标签
        label = f"{start_slide_num + i}"
        bbox = draw.textbbox((0, 0), label, font=font)
        text_w = bbox[2] - bbox[0]
        draw.text(
            (x + (width - text_w) // 2, y_base + label_padding),
            label,
            fill="black",
            font=font,
        )

        # 在标签下方添加缩略图，使用等比例间距
        y_thumbnail = y_base + label_padding + font_size + label_padding

        with Image.open(img_path) as img:
            # 在创建缩略图之前获取原始尺寸
            orig_w, orig_h = img.size

            # 如果启用了占位符轮廓，则应用
            if placeholder_regions and (start_slide_num + i) in placeholder_regions:
                # 转换为 RGBA 以支持透明度
                if img.mode != "RGBA":
                    img = img.convert("RGBA")

                # 获取此幻灯片的区域
                regions = placeholder_regions[start_slide_num + i]

                # 使用实际幻灯片尺寸计算缩放因子
                if slide_dimensions:
                    slide_width_inches, slide_height_inches = slide_dimensions
                else:
                    # 回退：根据 CONVERSION_DPI 下的图片尺寸估算
                    slide_width_inches = orig_w / CONVERSION_DPI
                    slide_height_inches = orig_h / CONVERSION_DPI

                x_scale = orig_w / slide_width_inches
                y_scale = orig_h / slide_height_inches

                # 创建高亮叠加层
                overlay = Image.new("RGBA", img.size, (255, 255, 255, 0))
                overlay_draw = ImageDraw.Draw(overlay)

                # 高亮每个占位符区域
                for region in regions:
                    # 从英寸转换为原始图片中的像素
                    px_left = int(region["left"] * x_scale)
                    px_top = int(region["top"] * y_scale)
                    px_width = int(region["width"] * x_scale)
                    px_height = int(region["height"] * y_scale)

                    # 使用红色和粗线条绘制高亮轮廓
                    # 使用明亮的红色轮廓而不是填充
                    stroke_width = max(
                        5, min(orig_w, orig_h) // 150
                    )  # 更粗的比例线条宽度
                    overlay_draw.rectangle(
                        [(px_left, px_top), (px_left + px_width, px_top + px_height)],
                        outline=(255, 0, 0, 255),  # 明亮的红色，完全不透明
                        width=stroke_width,
                    )

                # 使用 alpha 混合将叠加层合成到图片上
                img = Image.alpha_composite(img, overlay)
                # 转换回 RGB 以便保存为 JPEG
                img = img.convert("RGB")

            img.thumbnail((width, height), Image.Resampling.LANCZOS)
            w, h = img.size
            tx = x + (width - w) // 2
            ty = y_thumbnail + (height - h) // 2
            grid.paste(img, (tx, ty))

            # 添加边框
            if BORDER_WIDTH > 0:
                draw.rectangle(
                    [
                        (tx - BORDER_WIDTH, ty - BORDER_WIDTH),
                        (tx + w + BORDER_WIDTH - 1, ty + h + BORDER_WIDTH - 1),
                    ],
                    outline="gray",
                    width=BORDER_WIDTH,
                )

    return grid


if __name__ == "__main__":
    main()

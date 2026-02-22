#!/usr/bin/env python3
"""
技能快速验证脚本 - 精简版本

用法:
    quick_validate.py <技能名称>
    quick_validate.py <技能的绝对路径>

示例:
    quick_validate.py my-skill
    quick_validate.py /home/ubuntu/skills/my-skill

技能文件应位于 /home/ubuntu/skills/<skill-name>/
"""

import sys
import re
import yaml
from pathlib import Path

SKILLS_BASE_PATH = Path("/home/ubuntu/skills")


def resolve_skill_path(skill_path_or_name):
    """
    将技能路径解析为绝对路径。
    
    如果给定的是绝对路径，则直接使用。
    如果给定的是技能名称或相对路径，则在 SKILLS_BASE_PATH 下进行解析。
    """
    path = Path(skill_path_or_name)
    
    # 如果是绝对路径，直接使用
    if path.is_absolute():
        return path
    
    # 否则，将其视为技能名称，在 SKILLS_BASE_PATH 中查找
    return SKILLS_BASE_PATH / skill_path_or_name


def validate_skill(skill_path_or_name):
    """对技能进行基本验证"""
    skill_path = resolve_skill_path(skill_path_or_name)

    # 检查 SKILL.md 是否存在
    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        return False, "未找到 SKILL.md 文件"

    # 读取并验证前置元数据
    content = skill_md.read_text()
    if not content.startswith('---'):
        return False, "未找到 YAML 前置元数据"

    # 提取前置元数据
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return False, "前置元数据格式无效"

    frontmatter_text = match.group(1)

    # 解析 YAML 前置元数据
    try:
        frontmatter = yaml.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return False, "前置元数据必须是 YAML 字典格式"
    except yaml.YAMLError as e:
        return False, f"前置元数据中的 YAML 无效: {e}"

    # 定义允许的属性
    ALLOWED_PROPERTIES = {'name', 'description', 'license', 'allowed-tools', 'metadata'}

    # 检查是否存在意外的属性（不包括 metadata 下的嵌套键）
    unexpected_keys = set(frontmatter.keys()) - ALLOWED_PROPERTIES
    if unexpected_keys:
        return False, (
            f"SKILL.md 前置元数据中存在意外的键: {', '.join(sorted(unexpected_keys))}。 "
            f"允许的属性包括: {', '.join(sorted(ALLOWED_PROPERTIES))}"
        )

    # 检查必需字段
    if 'name' not in frontmatter:
        return False, "前置元数据中缺少 'name' 字段"
    if 'description' not in frontmatter:
        return False, "前置元数据中缺少 'description' 字段"

    # 提取名称进行验证
    name = frontmatter.get('name', '')
    if not isinstance(name, str):
        return False, f"名称必须是字符串类型，当前为 {type(name).__name__}"
    name = name.strip()
    if name:
        # 检查命名规范（短横线命名法：小写字母、数字和短横线）
        if not re.match(r'^[a-z0-9-]+$', name):
            return False, f"名称 '{name}' 应使用短横线命名法（仅包含小写字母、数字和短横线）"
        if name.startswith('-') or name.endswith('-') or '--' in name:
            return False, f"名称 '{name}' 不能以短横线开头或结尾，也不能包含连续的短横线"
        # 检查名称长度（根据规范最多 64 个字符）
        if len(name) > 64:
            return False, f"名称过长（{len(name)} 个字符）。最多允许 64 个字符。"

    # 提取并验证描述
    description = frontmatter.get('description', '')
    if not isinstance(description, str):
        return False, f"描述必须是字符串类型，当前为 {type(description).__name__}"
    description = description.strip()
    if description:
        # 检查是否包含尖括号
        if '<' in description or '>' in description:
            return False, "描述不能包含尖括号（< 或 >）"
        # 检查描述长度（根据规范最多 1024 个字符）
        if len(description) > 1024:
            return False, f"描述过长（{len(description)} 个字符）。最多允许 1024 个字符。"

    return True, "技能验证通过！"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("用法: quick_validate.py <技能名称>")
        print("      quick_validate.py <技能的绝对路径>")
        print("\n示例:")
        print("  quick_validate.py my-skill")
        print("  quick_validate.py /home/ubuntu/skills/my-skill")
        print(f"\n技能文件应位于 {SKILLS_BASE_PATH}/<skill-name>/")
        sys.exit(1)
    
    skill_input = sys.argv[1]
    resolved_path = resolve_skill_path(skill_input)
    
    print(f"🔍 正在验证技能: {resolved_path}")
    
    valid, message = validate_skill(skill_input)
    print(message)
    sys.exit(0 if valid else 1)
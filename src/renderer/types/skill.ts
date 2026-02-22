// 技能类型定义
export interface Skill {
  id: string;               // 技能唯一标识符
  name: string;             // 技能名称
  description: string;      // 技能描述信息
  enabled: boolean;        // 是否在弹出窗口中可见
  isOfficial: boolean;      // 是否显示"官方"徽章
  isBuiltIn: boolean;        // 是否与应用捆绑，不可删除
  updatedAt: number;        // 更新时间戳
  prompt: string;           // 系统提示词内容
  skillPath: string;        // SKILL.md 文件的绝对路径
}

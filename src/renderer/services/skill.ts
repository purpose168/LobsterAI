import { Skill } from '../types/skill';

/**
 * 邮件连接性检查结果
 */
type EmailConnectivityCheck = {
  code: 'imap_connection' | 'smtp_connection'; // 检查代码：IMAP连接或SMTP连接
  level: 'pass' | 'fail'; // 检查结果级别：通过或失败
  message: string; // 检查消息
  durationMs: number; // 检查耗时（毫秒）
};

/**
 * 邮件连接性测试结果
 */
type EmailConnectivityTestResult = {
  testedAt: number; // 测试时间戳
  verdict: 'pass' | 'fail'; // 总体判定：通过或失败
  checks: EmailConnectivityCheck[]; // 各项检查结果列表
};

/**
 * 技能服务类
 * 负责管理技能的加载、启用/禁用、删除、下载等操作
 */
class SkillService {
  private skills: Skill[] = []; // 技能列表
  private initialized = false; // 初始化标志

  /**
   * 初始化技能服务
   * @returns Promise<void>
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadSkills();
    this.initialized = true;
  }

  /**
   * 加载技能列表
   * @returns Promise<Skill[]> 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    try {
      const result = await window.electron.skills.list();
      if (result.success && result.skills) {
        this.skills = result.skills;
      } else {
        this.skills = [];
      }
      return this.skills;
    } catch (error) {
      console.error('加载技能失败:', error);
      this.skills = [];
      return this.skills;
    }
  }

  /**
   * 设置技能的启用状态
   * @param id 技能ID
   * @param enabled 是否启用
   * @returns Promise<Skill[]> 更新后的技能列表
   */
  async setSkillEnabled(id: string, enabled: boolean): Promise<Skill[]> {
    try {
      const result = await window.electron.skills.setEnabled({ id, enabled });
      if (result.success && result.skills) {
        this.skills = result.skills;
        return this.skills;
      }
      throw new Error(result.error || '更新技能失败');
    } catch (error) {
      console.error('更新技能失败:', error);
      throw error;
    }
  }

  /**
   * 删除技能
   * @param id 技能ID
   * @returns Promise<{ success: boolean; skills?: Skill[]; error?: string }> 删除结果
   */
  async deleteSkill(id: string): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.delete(id);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除技能失败';
      console.error('删除技能失败:', error);
      return { success: false, error: message };
    }
  }

  /**
   * 下载技能
   * @param source 技能来源地址
   * @returns Promise<{ success: boolean; skills?: Skill[]; error?: string }> 下载结果
   */
  async downloadSkill(source: string): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.download(source);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载技能失败';
      console.error('下载技能失败:', error);
      return { success: false, error: message };
    }
  }

  /**
   * 获取技能根目录路径
   * @returns Promise<string | null> 技能根目录路径，失败时返回null
   */
  async getSkillsRoot(): Promise<string | null> {
    try {
      const result = await window.electron.skills.getRoot();
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('获取技能根目录失败:', error);
      return null;
    }
  }

  /**
   * 注册技能变更回调函数
   * @param callback 技能变更时的回调函数
   * @returns () => void 取消注册的函数
   */
  onSkillsChanged(callback: () => void): () => void {
    return window.electron.skills.onChanged(callback);
  }

  /**
   * 获取所有技能列表
   * @returns Skill[] 技能列表
   */
  getSkills(): Skill[] {
    return this.skills;
  }

  /**
   * 获取已启用的技能列表
   * @returns Skill[] 已启用的技能列表
   */
  getEnabledSkills(): Skill[] {
    return this.skills.filter(s => s.enabled);
  }

  /**
   * 根据ID获取技能
   * @param id 技能ID
   * @returns Skill | undefined 技能对象，未找到时返回undefined
   */
  getSkillById(id: string): Skill | undefined {
    return this.skills.find(s => s.id === id);
  }

  /**
   * 获取技能配置
   * @param skillId 技能ID
   * @returns Promise<Record<string, string>> 技能配置对象
   */
  async getSkillConfig(skillId: string): Promise<Record<string, string>> {
    try {
      const result = await window.electron.skills.getConfig(skillId);
      if (result.success && result.config) {
        return result.config;
      }
      return {};
    } catch (error) {
      console.error('获取技能配置失败:', error);
      return {};
    }
  }

  /**
   * 设置技能配置
   * @param skillId 技能ID
   * @param config 配置对象
   * @returns Promise<boolean> 设置是否成功
   */
  async setSkillConfig(skillId: string, config: Record<string, string>): Promise<boolean> {
    try {
      const result = await window.electron.skills.setConfig(skillId, config);
      return result.success;
    } catch (error) {
      console.error('设置技能配置失败:', error);
      return false;
    }
  }

  /**
   * 测试邮件连接性
   * @param skillId 技能ID
   * @param config 配置对象
   * @returns Promise<EmailConnectivityTestResult | null> 测试结果，失败时返回null
   */
  async testEmailConnectivity(
    skillId: string,
    config: Record<string, string>
  ): Promise<EmailConnectivityTestResult | null> {
    try {
      const result = await window.electron.skills.testEmailConnectivity(skillId, config);
      if (result.success && result.result) {
        return result.result;
      }
      return null;
    } catch (error) {
      console.error('测试邮件连接性失败:', error);
      return null;
    }
  }

  /**
   * 获取自动路由提示
   * @returns Promise<string | null> 自动路由提示内容，失败时返回null
   */
  async getAutoRoutingPrompt(): Promise<string | null> {
    try {
      const result = await window.electron.skills.autoRoutingPrompt();
      return result.success ? (result.prompt || null) : null;
    } catch (error) {
      console.error('获取自动路由提示失败:', error);
      return null;
    }
  }
}

export const skillService = new SkillService();

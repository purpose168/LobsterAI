# Web Search Skill 部署指南

## 问题陈述

在 Cowork 会话中使用 web-search skill 时，Claude 需要调用 bash 脚本，例如：

```bash
bash SKILLs/web-search/scripts/search.sh "query" 10
```

然而，这种相对路径方式存在两个关键问题：

1. **开发模式**：当工作目录为项目根目录时可以正常工作
2. **生产模式**：打包后，`SKILLs` 目录会被打包，而用户的工作目录不是应用程序安装目录

## 解决方案：环境变量注入

### 概述

我们注入一个 `SKILLS_ROOT` 环境变量，在开发模式和生产模式下都指向正确的 SKILLs 目录。

### 实现

#### 1. 修改 `electron/libs/coworkUtil.ts`

添加一个 `getSkillsRoot()` 函数，返回正确的路径：

```typescript
function getSkillsRoot(): string {
  const appPath = app.getAppPath();

  // 开发环境中
  if (appPath.includes('node_modules') || !app.isPackaged) {
    const projectRoot = join(appPath, '../..');
    return join(projectRoot, 'SKILLs');
  }

  // 生产环境中，SKILLs 被复制到 userData
  return join(app.getPath('userData'), 'SKILLs');
}
```

并将其注入到环境中：

```typescript
export async function getEnhancedEnv(): Promise<Record<string, string | undefined>> {
  // ... 现有代码 ...

  // 为 skill 脚本注入 SKILLs 目录路径
  const skillsRoot = getSkillsRoot();
  env.SKILLS_ROOT = skillsRoot;
  env.LOBSTERAI_SKILLS_ROOT = skillsRoot; // 备用名称，更加清晰

  // ... 其余代码 ...
}
```

#### 2. 更新 `SKILLs/web-search/SKILL.md`

将所有脚本调用从：

```bash
bash SKILLs/web-search/scripts/search.sh "query" 10
```

改为：

```bash
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "query" 10
```

### 工作原理

1. **开发模式**：
   - `SKILLS_ROOT` → `/path/to/project/SKILLs`
   - 脚本从项目目录执行
   - 所有相对路径正常工作

2. **生产模式**：
   - `SKILLS_ROOT` → `~/Library/Application Support/lobsterai/SKILLs` (macOS)
   - Skills 在首次启动时被复制到 userData
   - 脚本从打包位置执行

3. **用户工作目录**：
   - 可以是用户选择的任何目录
   - 不再需要是项目根目录
   - Skills 始终可通过 `$SKILLS_ROOT` 访问

### 测试

```bash
# 手动设置环境变量进行测试
export SKILLS_ROOT="/xxx/SKILLs"

# 测试搜索
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "test query" 5
```

### 打包注意事项

打包应用程序时：

1. **将 SKILLs 复制到资源目录**：确保 `SKILLs` 目录被复制到 `extraResources` 或 `userData`
2. **验证路径**：测试 `getSkillsRoot()` 在打包后的应用程序中返回正确的路径
3. **脚本权限**：确保 bash 脚本在复制后具有执行权限

### 优势

✅ **跨平台**：在 macOS、Windows、Linux 上均可工作
✅ **开发友好**：本地开发无需更改
✅ **生产就绪**：正确处理打包后的应用程序
✅ **用户友好**：用户可以设置任意工作目录
✅ **易于维护**：SKILLs 位置的唯一真实来源

### 其他 Skills 的迁移指南

如果您创建需要调用脚本的新 skills，请始终使用：

```bash
bash "$SKILLS_ROOT/your-skill/scripts/your-script.sh"
```

切勿使用：

```bash
bash SKILLs/your-skill/scripts/your-script.sh  # ❌ 在生产环境中无法工作
```

### 故障排除

**问题**：`SKILLS_ROOT not found`

**解决方案**：确保在修改 `coworkUtil.ts` 后重新编译 Electron 应用程序

```bash
npm run build
npm run electron:dev
```

**问题**：生产环境中找不到脚本

**解决方案**：验证 SKILLs 已包含在打包中：

- 检查 `electron-builder.yml` 或打包配置
- 确保 `extraResources` 包含 `SKILLs/**/*`
- 验证 bash 脚本的文件权限

**问题**：运行脚本时权限被拒绝

**解决方案**：设置执行权限：

```bash
chmod +x "$SKILLS_ROOT/web-search/scripts/*.sh"
```

### 相关文件

- `electron/libs/coworkUtil.ts` - 环境变量注入
- `electron/libs/coworkRunner.ts` - Cowork 执行引擎
- `SKILLs/web-search/SKILL.md` - 更新后的 skill 文档
- `electron/skillManager.ts` - Skill 目录管理
- `electron/skillServices.ts` - 后台服务管理

### 未来改进

1. **首次启动时自动复制**：在应用程序首次启动时自动将打包的 SKILLs 复制到 userData
2. **版本管理**：跟踪 skill 版本并实现自动更新机制
3. **Skill 注册表**：已安装 skills 的中央注册表，包含元数据
4. **路径验证**：添加启动检查以验证 `SKILLS_ROOT` 是否可访问

---

最后更新：2026-02-08

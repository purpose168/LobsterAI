#!/bin/bash
# 本地日历工具 - 纯脚本实现
# 支持 macOS（Intel 和 Apple Silicon）和 Windows（通过 Outlook）
# 作者：purpose168@outlook.com
# 创建日期：2026-02-22

# 设置脚本在遇到错误时立即退出
set -e

# 输出颜色定义
RED='\033[0;31m'      # 红色：用于错误信息
GREEN='\033[0;32m'    # 绿色：用于成功信息
YELLOW='\033[1;33m'   # 黄色：用于警告信息
BLUE='\033[0;34m'     # 蓝色：用于提示信息
NC='\033[0m'          # 无颜色：重置颜色

# 检测操作系统平台
# uname -s 命令返回系统名称，通过 case 语句统一平台标识
PLATFORM="$(uname -s)"
case "${PLATFORM}" in
    Linux*)     PLATFORM=Linux;;      # Linux 系统
    Darwin*)    PLATFORM=Mac;;        # macOS 系统
    CYGWIN*)    PLATFORM=Windows;;    # Cygwin 环境（Windows）
    MINGW*)     PLATFORM=Windows;;    # MinGW 环境（Windows）
    MSYS*)      PLATFORM=Windows;;    # MSYS 环境（Windows）
    *)          PLATFORM="UNKNOWN:${PLATFORM}"  # 未知平台
esac

# 显示使用说明
# 当用户输入错误或使用 --help 时显示此信息
usage() {
    cat << EOF
使用方法: $(basename "$0") <操作> [选项]

操作命令:
  list                列出日历事件
  create              创建新事件
  update              更新现有事件
  delete              删除事件
  search              搜索事件

'list' 操作选项:
  --start <datetime>    开始时间（ISO 8601 格式，默认：当前时间）
  --end <datetime>      结束时间（ISO 8601 格式，默认：当前时间后7天）
  --calendar <name>     日历名称（默认：第一个可用日历）

'create' 操作选项:
  --title <string>      事件标题（必填）
  --start <datetime>    开始时间（ISO 8601 格式，必填）
  --end <datetime>      结束时间（ISO 8601 格式，必填）
  --calendar <name>     日历名称（默认：第一个可用日历）
  --location <string>   地点
  --notes <string>      备注/描述

'update' 操作选项:
  --id <string>         事件ID（必填）
  --title <string>      新标题
  --start <datetime>    新开始时间
  --end <datetime>      新结束时间
  --location <string>   新地点
  --notes <string>      新备注
  --calendar <name>     日历名称（默认：第一个可用日历）

'delete' 操作选项:
  --id <string>         事件ID（必填）
  --calendar <name>     日历名称（默认：第一个可用日历）

'search' 操作选项:
  --query <string>      搜索关键词（必填）
  --calendar <name>     日历名称（默认：搜索所有日历）

使用示例:
  # 列出未来7天的事件
  $(basename "$0") list

  # 创建新事件
  $(basename "$0") create --title "团队会议" --start "2026-02-13T14:00:00" --end "2026-02-13T15:00:00"

  # 搜索事件
  $(basename "$0") search --query "会议"

当前平台: ${PLATFORM}
EOF
    exit 1
}

# 解析命令行参数
# 将参数值赋给全局变量供后续函数使用
parse_args() {
    # 初始化所有参数变量
    OPERATION=""       # 操作类型（list/create/update/delete/search）
    TITLE=""           # 事件标题
    START_TIME=""      # 开始时间
    END_TIME=""        # 结束时间
    EVENT_ID=""        # 事件ID
    CALENDAR=""        # 日历名称
    LOCATION=""        # 地点
    NOTES=""           # 备注
    QUERY=""           # 搜索关键词

    # 第一个参数是操作类型
    OPERATION="$1"
    shift  # 移除第一个参数，保留选项参数

    # 循环处理所有选项参数
    # $# 表示剩余参数数量，-gt 表示大于
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --title)
                TITLE="$2"      # 获取标题值
                shift 2         # 移除选项名和值两个参数
                ;;
            --start)
                START_TIME="$2" # 获取开始时间
                shift 2
                ;;
            --end)
                END_TIME="$2"   # 获取结束时间
                shift 2
                ;;
            --id)
                EVENT_ID="$2"   # 获取事件ID
                shift 2
                ;;
            --calendar)
                CALENDAR="$2"   # 获取日历名称
                shift 2
                ;;
            --location)
                LOCATION="$2"   # 获取地点
                shift 2
                ;;
            --notes)
                NOTES="$2"      # 获取备注
                shift 2
                ;;
            --query)
                QUERY="$2"      # 获取搜索关键词
                shift 2
                ;;
            *)
                shift           # 跳过未知参数
                ;;
        esac
    done
}

# ==================== macOS 实现 ====================

# 转义字符串以用于 JXA (JavaScript for Automation)
# 处理特殊字符：反斜杠、双引号、单引号
# 参数：$1 - 需要转义的字符串
escape_jxa() {
    # sed 命令进行三次替换：
    # 1. 将 \ 替换为 \\（转义反斜杠）
    # 2. 将 " 替换为 \"（转义双引号）
    # 3. 将 ' 替换为 \'（转义单引号）
    echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/'"'"'/\\'"'"'/g'
}

# macOS: 列出日历事件
# 使用 JXA (JavaScript for Automation) 访问 macOS 日历应用
macos_list_events() {
    # 设置默认时间范围：当前时间到7天后
    # ${变量:-默认值} 语法：如果变量未设置或为空，使用默认值
    local start_time="${START_TIME:-$(date +%Y-%m-%dT%H:%M:%S)}"
    # macOS 的 date 命令使用 -v 选项进行日期计算
    # -v+7d 表示加7天，如果失败则使用 GNU date 格式（Linux 兼容）
    local end_time="${END_TIME:-$(date -v+7d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '+7 days' +%Y-%m-%dT%H:%M:%S)}"
    local calendar="${CALENDAR:-}"

    # JXA 脚本：使用 JavaScript 访问 macOS 日历
    local script="
        const Calendar = Application('Calendar');

        try {
            // 获取日历 - 使用指定名称或第一个可用日历
            let targetCal;
            const calName = '$(escape_jxa "$calendar")';
            if (calName && calName !== '') {
                targetCal = Calendar.calendars.byName(calName);
            } else {
                const cals = Calendar.calendars();
                if (cals.length === 0) {
                    throw new Error('未找到日历');
                }
                targetCal = cals[0];
            }

            // 解析日期字符串
            const startStr = '$start_time';
            const endStr = '$end_time';

            // 获取所有事件并手动过滤（比 whose 方法更兼容）
            const allEvents = targetCal.events();
            const result = [];

            // 遍历所有事件
            for (let i = 0; i < allEvents.length; i++) {
                try {
                    const event = allEvents[i];
                    const eventStart = event.startDate();
                    const eventEnd = event.endDate();

                    // 格式化日期用于比较（YYYY-MM-DDTHH:mm:ss）
                    const formatDate = (d) => {
                        return d.getFullYear() + '-' +
                               String(d.getMonth() + 1).padStart(2, '0') + '-' +
                               String(d.getDate()).padStart(2, '0') + 'T' +
                               String(d.getHours()).padStart(2, '0') + ':' +
                               String(d.getMinutes()).padStart(2, '0') + ':' +
                               String(d.getSeconds()).padStart(2, '0');
                    };

                    const eventStartStr = formatDate(eventStart);
                    const eventEndStr = formatDate(eventEnd);

                    // 检查事件是否与查询范围重叠（标准区间重叠算法）
                    // 重叠条件：事件开始时间 < 查询结束时间 AND 事件结束时间 > 查询开始时间
                    if (eventStartStr < endStr && eventEndStr > startStr) {
                        // 从时间组件推断全天事件状态（避免 JXA allday() 方法的问题）
                        // 如果开始和结束时间的小时和分钟都为0，则认为是全天事件
                        const isAllDay = (eventStart.getHours() === 0 && eventStart.getMinutes() === 0 &&
                                        eventEnd.getHours() === 0 && eventEnd.getMinutes() === 0);

                        result.push({
                            eventId: event.id(),
                            title: event.summary(),
                            startTime: eventStart.toISOString(),
                            endTime: eventEnd.toISOString(),
                            location: event.location() || '',
                            notes: event.description() || '',
                            calendar: targetCal.name(),
                            allDay: isAllDay
                        });
                    }
                } catch (eventError) {
                    // 跳过无法访问的事件
                }
            }

            JSON.stringify({ success: true, data: { events: result, count: result.length } });
        } catch (e) {
            JSON.stringify({ success: false, error: { code: 'CALENDAR_ACCESS_ERROR', message: e.message, recoverable: true } });
        }
    "

    # 执行 JXA 脚本
    # -l JavaScript 指定使用 JavaScript 语言
    # -e 执行后面的脚本字符串
    osascript -l JavaScript -e "$script" 2>&1
}

# macOS: 创建日历事件
macos_create_event() {
    # 验证必填参数：标题、开始时间、结束时间
    # [[ -z "$VAR" ]] 测试变量是否为空
    if [[ -z "$TITLE" || -z "$START_TIME" || -z "$END_TIME" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"标题、开始时间和结束时间为必填项","recoverable":false}}'
        exit 1
    fi

    local calendar="${CALENDAR:-}"

    # JXA 脚本：创建新事件
    local script="
        const Calendar = Application('Calendar');
        
        try {
            // 获取日历 - 使用指定名称或第一个可用日历
            let targetCal;
            const calName = '$(escape_jxa "$calendar")';
            if (calName && calName !== '') {
                targetCal = Calendar.calendars.byName(calName);
            } else {
                const cals = Calendar.calendars();
                if (cals.length === 0) {
                    throw new Error('未找到日历');
                }
                targetCal = cals[0];
            }

            // 创建事件对象
            const event = Calendar.Event({
                summary: '$(escape_jxa "$TITLE")',           // 事件标题
                startDate: new Date('$START_TIME'),          // 开始时间
                endDate: new Date('$END_TIME'),              // 结束时间
                location: '$(escape_jxa "$LOCATION")',       // 地点
                description: '$(escape_jxa "$NOTES")'        // 描述/备注
            });

            // 将事件添加到日历
            targetCal.events.push(event);

            JSON.stringify({
                success: true,
                data: {
                    eventId: event.id(),
                    message: '事件创建成功'
                }
            });
        } catch (e) {
            JSON.stringify({ success: false, error: { code: 'CALENDAR_ACCESS_ERROR', message: e.message, recoverable: true } });
        }
    "

    osascript -l JavaScript -e "$script" 2>&1
}

# macOS: 更新日历事件
macos_update_event() {
    # 验证必填参数：事件ID
    if [[ -z "$EVENT_ID" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"事件ID为必填项","recoverable":false}}'
        exit 1
    fi

    local calendar="${CALENDAR:-}"
    local updates=""

    # 构建更新语句：只为提供的参数生成更新代码
    # [[ -n "$VAR" ]] 测试变量是否非空
    [[ -n "$TITLE" ]] && updates="${updates}event.summary = '$(escape_jxa "$TITLE")';"
    [[ -n "$START_TIME" ]] && updates="${updates}event.startDate = new Date('$START_TIME');"
    [[ -n "$END_TIME" ]] && updates="${updates}event.endDate = new Date('$END_TIME');"
    [[ -n "$LOCATION" ]] && updates="${updates}event.location = '$(escape_jxa "$LOCATION")';"
    [[ -n "$NOTES" ]] && updates="${updates}event.description = '$(escape_jxa "$NOTES")';"

    # JXA 脚本：更新现有事件
    local script="
        const Calendar = Application('Calendar');
        
        try {
            // 获取日历
            let targetCal;
            const calName = '$(escape_jxa "$calendar")';
            if (calName && calName !== '') {
                targetCal = Calendar.calendars.byName(calName);
            } else {
                const cals = Calendar.calendars();
                if (cals.length === 0) {
                    throw new Error('未找到日历');
                }
                targetCal = cals[0];
            }

            // 通过ID查找事件
            const event = targetCal.events.byId('$EVENT_ID');
            // 执行更新操作
            $updates

            JSON.stringify({
                success: true,
                data: {
                    eventId: event.id(),
                    message: '事件更新成功'
                }
            });
        } catch (e) {
            JSON.stringify({ success: false, error: { code: 'CALENDAR_ACCESS_ERROR', message: e.message, recoverable: true } });
        }
    "

    osascript -l JavaScript -e "$script" 2>&1
}

# macOS: 删除日历事件
macos_delete_event() {
    # 验证必填参数：事件ID
    if [[ -z "$EVENT_ID" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"事件ID为必填项","recoverable":false}}'
        exit 1
    fi

    local calendar="${CALENDAR:-}"

    # JXA 脚本：删除事件
    local script="
        const Calendar = Application('Calendar');
        
        try {
            // 获取日历
            let targetCal;
            const calName = '$(escape_jxa "$calendar")';
            if (calName && calName !== '') {
                targetCal = Calendar.calendars.byName(calName);
            } else {
                const cals = Calendar.calendars();
                if (cals.length === 0) {
                    throw new Error('未找到日历');
                }
                targetCal = cals[0];
            }

            // 通过ID查找并删除事件
            const event = targetCal.events.byId('$EVENT_ID');
            event.delete();

            JSON.stringify({
                success: true,
                data: {
                    message: '事件删除成功'
                }
            });
        } catch (e) {
            JSON.stringify({ success: false, error: { code: 'CALENDAR_ACCESS_ERROR', message: e.message, recoverable: true } });
        }
    "

    osascript -l JavaScript -e "$script" 2>&1
}

# macOS: 搜索日历事件
macos_search_events() {
    # 验证必填参数：搜索关键词
    if [[ -z "$QUERY" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"搜索关键词为必填项","recoverable":false}}'
        exit 1
    fi

    local calendar="${CALENDAR:-}"

    # JXA 脚本：搜索事件
    local script="
        const Calendar = Application('Calendar');
        const query = '$(escape_jxa "$QUERY")'.toLowerCase();
        
        try {
            const calName = '$(escape_jxa "$calendar")';
            const allCalendars = Calendar.calendars();
            
            if (allCalendars.length === 0) {
                throw new Error('未找到日历');
            }
            
            // 确定要搜索的日历范围
            let calendarsToSearch = [];
            if (calName && calName !== '') {
                // 搜索指定日历
                calendarsToSearch = [Calendar.calendars.byName(calName)];
            } else {
                // 搜索所有日历
                calendarsToSearch = allCalendars;
            }
            
            // 在所有选定的日历中搜索
            let allResults = [];
            for (let i = 0; i < calendarsToSearch.length; i++) {
                try {
                    const cal = calendarsToSearch[i];
                    // 使用 whose 方法进行过滤
                    // _or 表示或条件，搜索标题、描述或地点中包含关键词的事件
                    const events = cal.events.whose({
                        _or: [
                            {summary: {_contains: query}},        // 标题包含关键词
                            {description: {_contains: query}},    // 描述包含关键词
                            {location: {_contains: query}}        // 地点包含关键词
                        ]
                    })();
                    
                    // 转换事件格式
                    const calResults = events.map(event => ({
                        eventId: event.id(),
                        title: event.summary(),
                        startTime: event.startDate().toISOString(),
                        endTime: event.endDate().toISOString(),
                        location: event.location() || '',
                        notes: event.description() || '',
                        calendar: cal.name()
                    }));
                    
                    // 合并结果
                    allResults = allResults.concat(calResults);
                } catch (calError) {
                    // 跳过无法访问的日历
                    console.log('跳过日历，原因：' + calError.message);
                }
            }

            JSON.stringify({ success: true, data: { events: allResults, count: allResults.length } });
        } catch (e) {
            JSON.stringify({ success: false, error: { code: 'CALENDAR_ACCESS_ERROR', message: e.message, recoverable: true } });
        }
    "

    osascript -l JavaScript -e "$script" 2>&1
}

# ==================== Windows 实现 ====================

# 获取脚本所在目录
# BASH_SOURCE[0] 是脚本的路径，dirname 获取目录名，cd 进入目录，pwd 获取绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# PowerShell 脚本路径
PS_SCRIPT="$SCRIPT_DIR/calendar.ps1"

# Windows: 执行 PowerShell 脚本
# 将 Bash 参数转换为 PowerShell 参数格式
windows_execute() {
    local op="$1"
    local args=""

    # 构建参数字符串
    # [[ -n "$VAR" ]] 测试变量非空，&& 表示条件执行
    [[ -n "$TITLE" ]] && args="$args -Title '$TITLE'"
    [[ -n "$START_TIME" ]] && args="$args -Start '$START_TIME'"
    [[ -n "$END_TIME" ]] && args="$args -End '$END_TIME'"
    [[ -n "$EVENT_ID" ]] && args="$args -Id '$EVENT_ID'"
    [[ -n "$CALENDAR" ]] && args="$args -Calendar '$CALENDAR'"
    [[ -n "$LOCATION" ]] && args="$args -Location '$LOCATION'"
    [[ -n "$NOTES" ]] && args="$args -Notes '$NOTES'"
    [[ -n "$QUERY" ]] && args="$args -Query '$QUERY'"

    # 为 PowerShell 转义单引号：将单引号替换为两个单引号
    args=$(echo "$args" | sed "s/'/''/g")

    # 执行 PowerShell 脚本
    # -ExecutionPolicy Bypass 绕过执行策略限制
    # shellcheck disable=SC2086 禁用 shellcheck 对变量不加引号的警告（此处需要单词分割）
    powershell -ExecutionPolicy Bypass -File "$PS_SCRIPT" -Operation "$op" $args 2>&1
}

# Windows: 通过 Outlook 列出事件
windows_list_events() {
    windows_execute "list"
}

# Windows: 通过 Outlook 创建事件
windows_create_event() {
    # 验证必填参数
    if [[ -z "$TITLE" || -z "$START_TIME" || -z "$END_TIME" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"标题、开始时间和结束时间为必填项","recoverable":false}}'
        exit 1
    fi
    windows_execute "create"
}

# Windows: 通过 Outlook 更新事件
windows_update_event() {
    # 验证必填参数
    if [[ -z "$EVENT_ID" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"事件ID为必填项","recoverable":false}}'
        exit 1
    fi
    windows_execute "update"
}

# Windows: 通过 Outlook 删除事件
windows_delete_event() {
    # 验证必填参数
    if [[ -z "$EVENT_ID" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"事件ID为必填项","recoverable":false}}'
        exit 1
    fi
    windows_execute "delete"
}

# Windows: 通过 Outlook 搜索事件
windows_search_events() {
    # 验证必填参数
    if [[ -z "$QUERY" ]]; then
        echo '{"success":false,"error":{"code":"INVALID_INPUT","message":"搜索关键词为必填项","recoverable":false}}'
        exit 1
    fi
    windows_execute "search"
}

# ==================== 权限辅助函数 ====================

# 检查错误是否与权限相关
# 参数：$1 - 错误消息
# 返回：0 表示是权限错误，1 表示不是
is_permission_error() {
    local error_msg="$1"
    # 检查错误消息中是否包含权限相关的关键词
    # || 表示或条件，任意一个匹配即返回真
    [[ "$error_msg" == *"不能获取对象"* ]] || \
    [[ "$error_msg" == *"not authorized"* ]] || \
    [[ "$error_msg" == *"Permission denied"* ]] || \
    [[ "$error_msg" == *"Access denied"* ]] || \
    [[ "$error_msg" == *"CALENDAR_ACCESS_ERROR"* ]]
}

# 尝试在 macOS 上触发权限对话框（开发辅助功能）
# 通过访问日历应用来触发系统的权限请求对话框
try_trigger_permission() {
    if [[ "$PLATFORM" == "Mac" ]]; then
        # 尝试访问日历以触发系统权限对话框
        # 2>/dev/null 将错误输出重定向到空设备，|| true 确保命令不会因错误而退出
        osascript -l JavaScript -e 'Application("Calendar").name()' 2>/dev/null || true
    fi
}

# ==================== 主函数 ====================

# 主函数：处理命令行参数并执行相应操作
main() {
    # 检查参数数量，如果没有参数则显示使用说明
    if [[ $# -lt 1 ]]; then
        usage
    fi

    # 解析命令行参数
    parse_args "$@"

    local result=""
    local exit_code=0

    # 根据平台和操作类型执行相应函数
    case "$PLATFORM" in
        Mac)
            # macOS 平台处理
            case "$OPERATION" in
                list)   result=$(macos_list_events) ;;      # 列出事件
                create) result=$(macos_create_event) ;;     # 创建事件
                update) result=$(macos_update_event) ;;     # 更新事件
                delete) result=$(macos_delete_event) ;;     # 删除事件
                search) result=$(macos_search_events) ;;    # 搜索事件
                *)      usage ;;                            # 未知操作
            esac
            ;;
        Windows)
            # Windows 平台处理
            case "$OPERATION" in
                list)   result=$(windows_list_events) ;;
                create) result=$(windows_create_event) ;;
                update) result=$(windows_update_event) ;;
                delete) result=$(windows_delete_event) ;;
                search) result=$(windows_search_events) ;;
                *)      usage ;;
            esac
            ;;
        *)
            # 不支持的平台
            echo "{\"success\":false,\"error\":{\"code\":\"PLATFORM_NOT_SUPPORTED\",\"message\":\"不支持的平台：$PLATFORM\",\"recoverable\":false}}"
            exit 1
            ;;
    esac

    # 检查结果是否表示权限错误
    if is_permission_error "$result"; then
        # 尝试触发权限对话框（非阻塞）
        try_trigger_permission
        
        # 返回增强的错误消息
        echo "{\"success\":false,\"error\":{\"code\":\"CALENDAR_ACCESS_ERROR\",\"message\":\"需要日历访问权限。请在系统设置 > 隐私与安全性 > 日历中授予权限，然后重试。\",\"recoverable\":true,\"permissionRequired\":true}}"
        exit 1
    fi

    # 输出结果
    echo "$result"
}

# 执行主函数，传递所有命令行参数
# "$@" 表示所有参数，保持参数中的引号和空格
main "$@"

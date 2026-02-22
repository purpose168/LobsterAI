# 本地日历工具 - Windows PowerShell 实现
# 支持 Microsoft Outlook COM API

param(
    [Parameter(Position=0, Mandatory=$true)]
    [ValidateSet('list', 'create', 'update', 'delete', 'search')]
    [string]$Operation,

    [string]$Title,
    [string]$Start,
    [string]$End,
    [string]$Id,
    [string]$Calendar = 'Calendar',
    [string]$Location,
    [string]$Notes,
    [string]$Query
)

$ErrorActionPreference = 'Stop'

# 输出 JSON 结果
function Output-Result($success, $data, $error) {
    $result = @{ success = $success }
    if ($data) { $result.data = $data }
    if ($error) { $result.error = $error }
    $result | ConvertTo-Json -Depth 10 -Compress
}

# 检查 Outlook 可用性
function Test-OutlookAvailable {
    try {
        $Outlook = New-Object -ComObject Outlook.Application
        $null = $Outlook.Version
        return $true
    } catch {
        return $false
    }
}

# 列出事件
function Get-CalendarEvents {
    param($StartTime, $EndTime, $CalendarName)

    try {
        $StartTime = if ($StartTime) { [DateTime]::Parse($StartTime) } else { Get-Date }
        $EndTime = if ($EndTime) { [DateTime]::Parse($EndTime) } else { (Get-Date).AddDays(7) }

        $Outlook = New-Object -ComObject Outlook.Application
        $Namespace = $Outlook.GetNamespace('MAPI')
        $CalendarFolder = $Namespace.GetDefaultFolder(9) # olFolderCalendar

        $Items = $CalendarFolder.Items
        $Items.IncludeRecurrences = $true
        $Items.Sort('[Start]')

        # 使用标准的时间区间重叠逻辑，而非严格的包含关系
        # 这确保我们能捕获跨越多天或跨越午夜的事件
        # 过滤条件：如果事件在时间范围结束前开始，且在时间范围开始后结束，则事件与范围重叠
        $Filter = "[Start] < '$($EndTime.ToString('g'))' AND [End] > '$($StartTime.ToString('g'))'"
        $FilteredItems = $Items.Restrict($Filter)

        $Events = @()
        foreach ($Item in $FilteredItems) {
            $Events += @{
                eventId = $Item.EntryID
                title = $Item.Subject
                startTime = $Item.Start.ToUniversalTime().ToString('o')
                endTime = $Item.End.ToUniversalTime().ToString('o')
                location = $Item.Location
                notes = $Item.Body
                calendar = $CalendarName
                allDay = $Item.AllDayEvent
            }
        }

        Output-Result -success $true -data @{ events = $Events; count = $Events.Count }
    } catch {
        Output-Result -success $false -error @{ code = 'CALENDAR_ACCESS_ERROR'; message = $_.Exception.Message; recoverable = $true }
    }
}

# 创建事件
function New-CalendarEvent {
    param($Title, $StartTime, $EndTime, $Location, $Notes, $CalendarName)

    if (-not $Title -or -not $StartTime -or -not $EndTime) {
        Output-Result -success $false -error @{ code = 'INVALID_INPUT'; message = '标题、开始时间和结束时间为必填项'; recoverable = $false }
        return
    }

    try {
        $Outlook = New-Object -ComObject Outlook.Application
        $Appointment = $Outlook.CreateItem(1) # olAppointmentItem

        $Appointment.Subject = $Title
        $Appointment.Start = [DateTime]::Parse($StartTime)
        $Appointment.End = [DateTime]::Parse($EndTime)
        if ($Location) { $Appointment.Location = $Location }
        if ($Notes) { $Appointment.Body = $Notes }

        $Appointment.Save()

        Output-Result -success $true -data @{ eventId = $Appointment.EntryID; message = '事件创建成功' }
    } catch {
        Output-Result -success $false -error @{ code = 'CALENDAR_ACCESS_ERROR'; message = $_.Exception.Message; recoverable = $true }
    }
}

# 更新事件
function Set-CalendarEvent {
    param($Id, $Title, $StartTime, $EndTime, $Location, $Notes)

    if (-not $Id) {
        Output-Result -success $false -error @{ code = 'INVALID_INPUT'; message = 'ID 为必填项'; recoverable = $false }
        return
    }

    try {
        $Outlook = New-Object -ComObject Outlook.Application
        $Namespace = $Outlook.GetNamespace('MAPI')
        $Appointment = $Namespace.GetItemFromID($Id)

        if ($Title) { $Appointment.Subject = $Title }
        if ($StartTime) { $Appointment.Start = [DateTime]::Parse($StartTime) }
        if ($EndTime) { $Appointment.End = [DateTime]::Parse($EndTime) }
        if ($Location) { $Appointment.Location = $Location }
        if ($Notes) { $Appointment.Body = $Notes }

        $Appointment.Save()

        Output-Result -success $true -data @{ eventId = $Appointment.EntryID; message = '事件更新成功' }
    } catch {
        Output-Result -success $false -error @{ code = 'CALENDAR_ACCESS_ERROR'; message = $_.Exception.Message; recoverable = $true }
    }
}

# 删除事件
function Remove-CalendarEvent {
    param($Id)

    if (-not $Id) {
        Output-Result -success $false -error @{ code = 'INVALID_INPUT'; message = 'ID 为必填项'; recoverable = $false }
        return
    }

    try {
        $Outlook = New-Object -ComObject Outlook.Application
        $Namespace = $Outlook.GetNamespace('MAPI')
        $Appointment = $Namespace.GetItemFromID($Id)

        $Appointment.Delete()

        Output-Result -success $true -data @{ message = '事件删除成功' }
    } catch {
        Output-Result -success $false -error @{ code = 'CALENDAR_ACCESS_ERROR'; message = $_.Exception.Message; recoverable = $true }
    }
}

# 在单个文件夹中搜索事件
function Search-CalendarFolder {
    param($Folder, $Query, $FolderName)
    
    $Items = $Folder.Items
    $Items.Sort('[Start]')
    
    $SearchQuery = $Query.ToLower()
    $Results = @()
    
    foreach ($Item in $Items) {
        try {
            $MatchSubject = $Item.Subject -and $Item.Subject.ToLower().Contains($SearchQuery)
            $MatchBody = $Item.Body -and $Item.Body.ToLower().Contains($SearchQuery)
            $MatchLocation = $Item.Location -and $Item.Location.ToLower().Contains($SearchQuery)
            
            if ($MatchSubject -or $MatchBody -or $MatchLocation) {
                $Results += @{
                    eventId = $Item.EntryID
                    title = $Item.Subject
                    startTime = $Item.Start.ToUniversalTime().ToString('o')
                    endTime = $Item.End.ToUniversalTime().ToString('o')
                    location = $Item.Location
                    notes = $Item.Body
                    calendar = $FolderName
                }
            }
        } catch {
            # 跳过无法访问的项目
        }
    }
    
    return $Results
}

# 在所有日历中搜索事件
function Find-CalendarEvents {
    param($Query, $CalendarName)

    if (-not $Query) {
        Output-Result -success $false -error @{ code = 'INVALID_INPUT'; message = '查询内容为必填项'; recoverable = $false }
        return
    }

    try {
        $Outlook = New-Object -ComObject Outlook.Application
        $Namespace = $Outlook.GetNamespace('MAPI')
        
        $AllEvents = @()
        
        if ($CalendarName) {
            # 搜索指定日历
            $CalendarFolder = $Namespace.GetDefaultFolder(9) # olFolderCalendar
            $Results = Search-CalendarFolder -Folder $CalendarFolder -Query $Query -FolderName $CalendarFolder.Name
            $AllEvents += $Results
        } else {
            # 搜索所有日历文件夹
            # 从默认日历开始
            try {
                $DefaultCalendar = $Namespace.GetDefaultFolder(9)
                $Results = Search-CalendarFolder -Folder $DefaultCalendar -Query $Query -FolderName $DefaultCalendar.Name
                $AllEvents += $Results
            } catch {
                Write-Host "警告：无法访问默认日历：$($_.Exception.Message)"
            }
            
            # 在邮箱中搜索其他日历文件夹
            try {
                $RootFolder = $Namespace.Folders
                foreach ($Folder in $RootFolder) {
                    try {
                        # 尝试从每个根文件夹获取日历文件夹
                        $CalendarFolders = @()
                        
                        # 检查此文件夹是否有日历子文件夹
                        foreach ($SubFolder in $Folder.Folders) {
                            if ($SubFolder.DefaultItemType -eq 1 -or $SubFolder.Name -like '*Calendar*') {
                                # 1 = olAppointmentItem
                                $CalendarFolders += $SubFolder
                            }
                        }
                        
                        foreach ($CalFolder in $CalendarFolders) {
                            try {
                                $Results = Search-CalendarFolder -Folder $CalFolder -Query $Query -FolderName $CalFolder.Name
                                $AllEvents += $Results
                            } catch {
                                # 跳过无法访问的文件夹
                            }
                        }
                    } catch {
                        # 跳过无法访问的文件夹
                    }
                }
            } catch {
                Write-Host "警告：无法枚举所有日历：$($_.Exception.Message)"
            }
        }

        Output-Result -success $true -data @{ events = $AllEvents; count = $AllEvents.Count }
    } catch {
        Output-Result -success $false -error @{ code = 'CALENDAR_ACCESS_ERROR'; message = $_.Exception.Message; recoverable = $true }
    }
}

# 主程序
if (-not (Test-OutlookAvailable)) {
    Output-Result -success $false -error @{ code = 'OUTLOOK_NOT_AVAILABLE'; message = 'Microsoft Outlook 未安装或无法访问'; recoverable = $true }
    exit 1
}

switch ($Operation) {
    'list' { Get-CalendarEvents -StartTime $Start -EndTime $End -CalendarName $Calendar }
    'create' { New-CalendarEvent -Title $Title -StartTime $Start -EndTime $End -Location $Location -Notes $Notes -CalendarName $Calendar }
    'update' { Set-CalendarEvent -Id $Id -Title $Title -StartTime $Start -EndTime $End -Location $Location -Notes $Notes }
    'delete' { Remove-CalendarEvent -Id $Id }
    'search' { Find-CalendarEvents -Query $Query -CalendarName $Calendar }
    default {
        Output-Result -success $false -error @{ code = 'INVALID_OPERATION'; message = "未知操作：$Operation"; recoverable = $false }
    }
}

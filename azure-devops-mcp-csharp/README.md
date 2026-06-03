# Azure DevOps MCP Server (C#)

Azure DevOps MCP (Model Context Protocol) Server - 用 C# 实现，让 Claude 和支持 MCP 的客户端能够访问 Azure DevOps 的测试计划数据。

该版本使用标准输入/输出运行，适合注册为本地 MCP Server，并已补齐标准 MCP 客户端常见的初始化握手流程。

## 功能特性

- 🔍 **查询测试计划** - 列出项目中的所有测试计划
- 🗂️ **查询测试套件** - 列出测试计划下的 suite 结构并定位 suiteId
- 📋 **获取测试用例** - 检索特定测试计划中的测试用例
- 🏃 **查看测试结果** - 获取测试运行结果和历史记录
- 🔗 **智能搜索** - 按名称、状态、优先级过滤测试数据
- 📝 **使用 C#** - 易于理解的 C# 代码

## 快速开始

### 前置要求

- .NET 8 SDK 或更高版本
- Azure DevOps 账户和 PAT Token

### 1. 克隆或复制项目

项目位置：`C:\Users\<username>\.claude\azure-devops-mcp-csharp`

### 2. 配置环境变量

在项目根目录创建或编辑 `.env` 文件：
```env
AZURE_DEVOPS_ORG=https://dev.azure.com/yourorganization
AZURE_DEVOPS_PROJECT=YourProject
AZURE_DEVOPS_TOKEN=your-personal-access-token
```

**获取 PAT Token：**
1. 访问 https://dev.azure.com/yourorg
2. 点击头像 → User settings
3. Personal access tokens → New Token
4. 勾选 "Test management (read)"
5. 复制 Token

### 3. 构建和运行

```powershell
# 恢复依赖
dotnet restore

# 构建项目
dotnet build

# 运行服务
dotnet run
```

或简化版：
```powershell
dotnet run
```

程序启动时会先读取系统环境变量；如果当前目录或程序目录存在 `.env` 文件，也会自动加载其中的配置。

## 在 Copilot CLI 中配置

### 方式 1: 自动配置

```bash
copilot /mcp --add
# 按提示选择本地服务器
# 命令: dotnet
# 参数: run --project C:\Users\<username>\.claude\azure-devops-mcp-csharp\AzureDevOpsMcp.csproj
```

### 方式 2: 手动配置

编辑 `~/.copilot/config.json`：
```json
{
  "mcpServers": {
    "azure-devops-mcp-csharp": {
      "command": "dotnet",
      "args": ["run", "--project", "C:\\path\\to\\azure-devops-mcp-csharp\\AzureDevOpsMcp.csproj"],
      "env": {
        "AZURE_DEVOPS_ORG": "https://dev.azure.com/yourorg",
        "AZURE_DEVOPS_PROJECT": "YourProject",
        "AZURE_DEVOPS_TOKEN": "your-pat-token"
      }
    }
  }
}
```

## 使用示例

在支持 MCP 的客户端中：

```bash
copilot

# 获取所有测试计划
> 获取 MyProject 项目的所有测试计划

# 获取特定计划中的测试用例
> 给我看 plan ID 为 123 的所有测试用例

# 查看某个计划下有哪些 suite
> 列出 plan 123 下的所有测试套件

# 按 suite 获取测试用例
> 获取 plan 123 中 suite 456 的测试用例

# 搜索特定的测试
> 搜索计划 123 中名称包含 "login" 的测试

# 获取测试结果
> 显示最近的测试运行结果
```

## 项目结构

```
azure-devops-mcp-csharp/
├── Program.cs                    # 程序入口 + MCP Server 实现
├── AzureDevOpsClient.cs          # Azure DevOps API 客户端
├── Models.cs                     # 数据模型（测试计划、用例等）
├── McpProtocol.cs                # MCP 协议模型
├── AzureDevOpsMcp.csproj         # 项目配置文件
└── README.md                     # 本文件
```

## 代码说明

### Models.cs - 数据模型
定义了以下数据模型：
- `TestPlan` - 测试计划
- `TestCase` - 测试用例
- `TestResult` - 测试结果
- `TestRun` - 测试运行

### AzureDevOpsClient.cs - API 客户端
实现了以下方法：
- `GetTestPlansAsync()` - 获取所有测试计划
- `GetTestCasesAsync()` - 获取测试用例
- `GetTestSuitesAsync()` - 获取测试套件
- `GetTestResultsAsync()` - 获取测试结果
- `GetTestRunsAsync()` - 获取测试运行
- `GetTestPlanDetailsAsync()` - 获取计划详情
- `CreateTestRunAsync()` - 创建测试运行

### McpProtocol.cs - MCP 协议
定义了 MCP 协议的请求和响应模型：
- `McpRequest` - MCP 请求
- `McpResponse` - MCP 响应
- `ToolDefinition` - Tool 定义

### Program.cs - Server 实现
实现了 MCP Server：
- `McpServer` 类处理 MCP 通信
- 6 个 Tool 实现：
  - `get-test-plans`
  - `get-test-suites`
  - `get-test-cases`
  - `get-test-results`
  - `get-test-plan-details`
  - `get-test-runs`

## 可用的 Tools

| Tool 名称 | 功能 | 必需参数 | 可选参数 |
|-----------|------|---------|---------|
| `get-test-plans` | 获取所有测试计划 | 无 | limit |
| `get-test-suites` | 获取计划下的测试套件 | planId | search, limit |
| `get-test-cases` | 获取计划的测试用例 | planId | suiteId, search, limit |
| `get-test-results` | 获取测试结果 | 无 | runId, state, limit |
| `get-test-plan-details` | 获取计划详情 | planId | 无 |
| `get-test-runs` | 获取所有测试运行 | 无 | limit |

## 环境变量

| 变量 | 必需 | 说明 | 示例 |
|------|------|------|------|
| `AZURE_DEVOPS_ORG` | ✓ | Azure DevOps 组织 URL | `https://dev.azure.com/myorg` |
| `AZURE_DEVOPS_PROJECT` | ✓ | 项目名称 | `MyProject` |
| `AZURE_DEVOPS_TOKEN` | ✓ | PAT Token | `xyz...abc` |

## 常见问题

### Q: token 配在哪里？

优先级如下：

1. MCP 客户端配置里的 `env`
2. 当前系统或终端环境变量
3. 项目目录下的 `.env` 文件

如果是给 AI 客户端长期使用，优先把 `AZURE_DEVOPS_TOKEN` 写到客户端 MCP 配置的 `env` 中，不要提交到仓库。

### Q: 如何在 .NET 中设置环境变量？

**Windows PowerShell:**
```powershell
$env:AZURE_DEVOPS_ORG="https://dev.azure.com/yourorg"
$env:AZURE_DEVOPS_PROJECT="YourProject"
$env:AZURE_DEVOPS_TOKEN="your-token"

dotnet run
```

**Windows CMD:**
```cmd
set AZURE_DEVOPS_ORG=https://dev.azure.com/yourorg
set AZURE_DEVOPS_PROJECT=YourProject
set AZURE_DEVOPS_TOKEN=your-token

dotnet run
```

**Linux/Mac:**
```bash
export AZURE_DEVOPS_ORG=https://dev.azure.com/yourorg
export AZURE_DEVOPS_PROJECT=YourProject
export AZURE_DEVOPS_TOKEN=your-token

dotnet run
```

### Q: "Unauthorized" 错误？

- 检查 PAT Token 是否正确复制（没有空格）
- 确保 Token 没有过期
- 验证 Token 具有 "Test Management (Read)" 权限

### Q: "Project not found" 错误？

- 检查项目名称拼写
- 确保有权访问该项目

### Q: 如何调试？

在 `Program.cs` 中添加日志：
```csharp
Console.Error.WriteLine($"Calling tool: {toolName}");
```

错误信息会输出到标准错误（stderr）。

## 扩展功能

### 添加新的 Tool

1. 在 `AzureDevOpsClient.cs` 中添加新方法：
```csharp
public async Task<List<MyData>> GetMyDataAsync()
{
    var url = "path/to/api?api-version=7.0";
    var response = await _httpClient.GetAsync(url);
    response.EnsureSuccessStatusCode();
    
    var json = await response.Content.ReadAsStringAsync();
    return JsonSerializer.Deserialize<ApiResponse<MyData>>(json, _jsonOptions)?.Value ?? new();
}
```

2. 在 `Program.cs` 中的 `HandleToolsListAsync()` 中添加 Tool 定义

3. 在 `HandleToolCallAsync()` 的 switch 中添加处理逻辑

4. 添加对应的 `CallMyNewToolAsync()` 方法

## Skill

如果你在同一个 `.claude` 工作区里使用这个 MCP，可以配合本地 skill 文件 `skills/ado-testcase-extractor/SKILL.md`。这份 skill 约束了推荐流程：先查计划，再查 suite，最后拉 test case。

## 许可证

MIT

## 相关资源

- [MCP 官方文档](https://modelcontextprotocol.io)
- [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops)
- [Copilot CLI 文档](https://docs.github.com/en/copilot)

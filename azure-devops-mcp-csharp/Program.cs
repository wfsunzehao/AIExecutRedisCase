using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AzureDevOpsMcp;

/// <summary>
/// MCP Server 主程序
/// 实现 Model Context Protocol 标准
/// 为 Copilot CLI 和 Claude 提供 Tool 调用接口
/// </summary>
class McpServer
{
    private readonly AzureDevOpsClient _azureClient;
    private readonly JsonSerializerOptions _jsonOptions;

    public McpServer(AzureDevOpsClient azureClient)
    {
        _azureClient = azureClient;
        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false
        };
    }

    /// <summary>
    /// 启动 MCP Server
    /// 在标准输入上读取请求，通过标准输出返回响应
    /// </summary>
    public async Task RunAsync()
    {
        Console.Error.WriteLine("Azure DevOps MCP Server started");

        var reader = Console.In;
        JsonElement? requestId = null;

        try
        {
            string? line;
            while ((line = await reader.ReadLineAsync()) != null)
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;

                try
                {
                    var request = JsonSerializer.Deserialize<McpRequest>(line, _jsonOptions);
                    if (request == null)
                        continue;

                    requestId = request.Id;

                    if (string.Equals(request.Method, "notifications/initialized", StringComparison.Ordinal))
                        continue;

                    // 处理不同的方法调用
                    object? result = request.Method switch
                    {
                        "initialize" => HandleInitialize(request.Params),
                        "ping" => new { },
                        "tools/list" => await HandleToolsListAsync(),
                        "tools/call" => await HandleToolCallAsync(request),
                        _ => throw new Exception($"Unknown method: {request.Method}")
                    };

                    // 发送成功响应
                    SendResponse(requestId, result);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Error processing request: {ex.Message}");
                    SendErrorResponse(requestId, ex.Message);
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Fatal error: {ex}");
            Environment.Exit(1);
        }
    }

    /// <summary>
    /// 处理 tools/list 请求
    /// 返回所有可用的 Tool 列表
    /// </summary>
    private Task<object> HandleToolsListAsync()
    {
        var tools = new List<ToolDefinition>
        {
            new()
            {
                Name = "get-test-plans",
                Description = "获取 Azure DevOps 项目中的所有测试计划，返回计划 ID、名称、状态等信息",
                InputSchema = CreateInputSchema(
                    new Dictionary<string, object>
                    {
                        ["limit"] = CreateNumberProperty("返回结果的最大数量，默认为 50")
                    })
            },
            new()
            {
                Name = "get-test-suites",
                Description = "获取特定测试计划下的所有测试套件，可按名称过滤，用于确定 suite 结构和 suiteId",
                InputSchema = CreateInputSchema(
                    new Dictionary<string, object>
                    {
                        ["planId"] = CreateNumberProperty("测试计划 ID（必需）"),
                        ["search"] = CreateStringProperty("测试套件名称关键词（可选）"),
                        ["limit"] = CreateNumberProperty("返回结果数量（可选）")
                    },
                    "planId")
            },
            new()
            {
                Name = "get-test-cases",
                Description = "获取特定测试计划中的测试用例；不传 suiteId 时会从根 suite 递归查询整个计划",
                InputSchema = CreateInputSchema(
                    new Dictionary<string, object>
                    {
                        ["planId"] = CreateNumberProperty("测试计划 ID（必需）"),
                        ["suiteId"] = CreateNumberProperty("测试套件 ID（可选）"),
                        ["search"] = CreateStringProperty("搜索关键词（可选）"),
                        ["limit"] = CreateNumberProperty("返回结果数量（可选）")
                    },
                    "planId")
            },
            new()
            {
                Name = "get-test-results",
                Description = "获取测试运行的结果，可按运行 ID 或状态过滤",
                InputSchema = CreateInputSchema(
                    new Dictionary<string, object>
                    {
                        ["runId"] = CreateNumberProperty("测试运行 ID（可选）"),
                        ["state"] = CreateStringProperty("结果状态：Passed/Failed/InProgress（可选）"),
                        ["limit"] = CreateNumberProperty("返回结果数量（可选）")
                    })
            },
            new()
            {
                Name = "get-test-plan-details",
                Description = "获取特定测试计划的详细信息",
                InputSchema = CreateInputSchema(
                    new Dictionary<string, object>
                    {
                        ["planId"] = CreateNumberProperty("测试计划 ID（必需）")
                    },
                    "planId")
            },
            new()
            {
                Name = "get-test-runs",
                Description = "获取所有或最近的测试运行列表",
                InputSchema = CreateInputSchema(
                    new Dictionary<string, object>
                    {
                        ["limit"] = CreateNumberProperty("返回结果数量，默认 50")
                    })
            }
        };

        return Task.FromResult<object>(new ToolsListResponse { Tools = tools });
    }

    private object HandleInitialize(McpParams? rawParams)
    {
        var initializeParams = rawParams == null
            ? null
            : new InitializeParams
            {
                ProtocolVersion = rawParams.ProtocolVersion,
                Capabilities = rawParams.Capabilities,
                ClientInfo = rawParams.ClientInfo,
            };

        if (!string.IsNullOrEmpty(initializeParams?.ClientInfo?.Name))
        {
            Console.Error.WriteLine($"Connected MCP client: {initializeParams.ClientInfo.Name} {initializeParams.ClientInfo.Version}");
        }

        return new InitializeResult();
    }

    /// <summary>
    /// 处理 tools/call 请求
    /// 调用对应的 Tool 方法
    /// </summary>
    private async Task<object> HandleToolCallAsync(McpRequest request)
    {
        var toolName = request.Params?.Name
            ?? throw new Exception("Missing tool name");

        var args = request.Params?.Arguments;

        var result = toolName switch
        {
            "get-test-plans" => await CallGetTestPlansAsync(args),
            "get-test-suites" => await CallGetTestSuitesAsync(args),
            "get-test-cases" => await CallGetTestCasesAsync(args),
            "get-test-results" => await CallGetTestResultsAsync(args),
            "get-test-plan-details" => await CallGetTestPlanDetailsAsync(args),
            "get-test-runs" => await CallGetTestRunsAsync(args),
            _ => throw new Exception($"Unknown tool: {toolName}")
        };

        return new ToolResponse
        {
            Content = new List<ContentBlock>
            {
                new()
                {
                    Type = "text",
                    Text = JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true })
                }
            }
        };
    }

    // ==================== Tool 实现 ====================

    private async Task<object> CallGetTestPlansAsync(JsonElement? args)
    {
        var limit = ExtractIntArg(args, "limit", 50) ?? 50;
        var plans = await _azureClient.GetTestPlansAsync();
        return plans.Take(limit).ToList();
    }

    private async Task<object> CallGetTestCasesAsync(JsonElement? args)
    {
        var planId = ExtractIntArg(args, "planId", 0) ?? 0;
        if (planId == 0)
            throw new Exception("planId is required");

        var suiteId = ExtractIntArg(args, "suiteId", null);
        var search = ExtractStringArg(args, "search");
        var limit = ExtractIntArg(args, "limit", 50) ?? 50;

        var testCases = await _azureClient.GetTestCasesAsync(planId, suiteId, search);
        return testCases.Take(limit).ToList();
    }

    private async Task<object> CallGetTestSuitesAsync(JsonElement? args)
    {
        var planId = ExtractIntArg(args, "planId", 0) ?? 0;
        if (planId == 0)
            throw new Exception("planId is required");

        var search = ExtractStringArg(args, "search");
        var limit = ExtractIntArg(args, "limit", 200) ?? 200;

        var suites = await _azureClient.GetTestSuitesAsync(planId, search);
        return suites.Take(limit).ToList();
    }

    private async Task<object> CallGetTestResultsAsync(JsonElement? args)
    {
        var runId = ExtractIntArg(args, "runId", null);
        var state = ExtractStringArg(args, "state");
        var limit = ExtractIntArg(args, "limit", 50) ?? 50;

        var results = await _azureClient.GetTestResultsAsync(runId, state, limit);
        return results;
    }

    private async Task<object> CallGetTestPlanDetailsAsync(JsonElement? args)
    {
        var planId = ExtractIntArg(args, "planId", 0) ?? 0;
        if (planId == 0)
            throw new Exception("planId is required");

        var plan = await _azureClient.GetTestPlanDetailsAsync(planId);
        if (plan == null)
        {
            return new { error = "Plan not found" };
        }

        return plan;
    }

    private async Task<object> CallGetTestRunsAsync(JsonElement? args)
    {
        var limit = ExtractIntArg(args, "limit", 50) ?? 50;
        var runs = await _azureClient.GetTestRunsAsync(limit);
        return runs;
    }

    // ==================== 辅助方法 ====================

    /// <summary>
    /// 从 JSON 参数中提取整数值
    /// </summary>
    private int? ExtractIntArg(JsonElement? args, string argName, int? defaultValue)
    {
        if (args?.TryGetProperty(argName, out var value) == true)
        {
            if (value.ValueKind == System.Text.Json.JsonValueKind.Number)
                return value.GetInt32();
        }
        return defaultValue;
    }

    /// <summary>
    /// 从 JSON 参数中提取字符串值
    /// </summary>
    private string? ExtractStringArg(JsonElement? args, string argName)
    {
        if (args?.TryGetProperty(argName, out var value) == true)
        {
            if (value.ValueKind == System.Text.Json.JsonValueKind.String)
                return value.GetString();
        }
        return null;
    }

    /// <summary>
    /// 创建 Tool 的输入 Schema
    /// </summary>
    private JsonElement CreateInputSchema(Dictionary<string, object> properties, params string[] required)
    {
        var schema = new
        {
            type = "object",
            properties = properties,
            required
        };

        var json = JsonSerializer.Serialize(schema);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private object CreateNumberProperty(string description)
    {
        return new
        {
            type = "number",
            description
        };
    }

    private object CreateStringProperty(string description)
    {
        return new
        {
            type = "string",
            description
        };
    }

    /// <summary>
    /// 发送成功响应
    /// </summary>
    private void SendResponse(JsonElement? id, object? result)
    {
        var response = new McpResponse
        {
            Id = id,
            Result = result
        };

        var json = JsonSerializer.Serialize(response, _jsonOptions);
        Console.WriteLine(json);
    }

    /// <summary>
    /// 发送错误响应
    /// </summary>
    private void SendErrorResponse(JsonElement? id, string message)
    {
        var response = new McpResponse
        {
            Id = id,
            Error = new McpError
            {
                Code = -1,
                Message = message
            }
        };

        var json = JsonSerializer.Serialize(response, _jsonOptions);
        Console.WriteLine(json);
    }
}

/// <summary>
/// 程序入口点
/// </summary>
class Program
{
    static async Task Main(string[] args)
    {
        LoadEnvironmentFile();

        // 检查环境变量
        var org = Environment.GetEnvironmentVariable("AZURE_DEVOPS_ORG");
        var project = Environment.GetEnvironmentVariable("AZURE_DEVOPS_PROJECT");
        var token = Environment.GetEnvironmentVariable("AZURE_DEVOPS_TOKEN");

        if (string.IsNullOrEmpty(org) || string.IsNullOrEmpty(project) || string.IsNullOrEmpty(token))
        {
            Console.Error.WriteLine("Missing required environment variables:");
            Console.Error.WriteLine($"  AZURE_DEVOPS_ORG: {(string.IsNullOrEmpty(org) ? "✗" : "✓")}");
            Console.Error.WriteLine($"  AZURE_DEVOPS_PROJECT: {(string.IsNullOrEmpty(project) ? "✗" : "✓")}");
            Console.Error.WriteLine($"  AZURE_DEVOPS_TOKEN: {(string.IsNullOrEmpty(token) ? "✗" : "✓")}");
            Environment.Exit(1);
        }

        // 创建 Azure DevOps 客户端
        var azureClient = new AzureDevOpsClient(org, project, token);

        // 启动 MCP Server
        var mcpServer = new McpServer(azureClient);
        await mcpServer.RunAsync();
    }

    static void LoadEnvironmentFile()
    {
        var envPath = Path.Combine(AppContext.BaseDirectory, ".env");

        if (!File.Exists(envPath))
        {
            var projectEnvPath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
            if (!File.Exists(projectEnvPath))
                return;

            envPath = projectEnvPath;
        }

        foreach (var rawLine in File.ReadLines(envPath))
        {
            var line = rawLine.Trim();
            if (string.IsNullOrEmpty(line) || line.StartsWith("#", StringComparison.Ordinal))
                continue;

            var separatorIndex = line.IndexOf('=');
            if (separatorIndex <= 0)
                continue;

            var key = line[..separatorIndex].Trim();
            var value = line[(separatorIndex + 1)..].Trim();

            if (value.Length >= 2 && value.StartsWith('"') && value.EndsWith('"'))
            {
                value = value[1..^1];
            }

            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }
    }
}

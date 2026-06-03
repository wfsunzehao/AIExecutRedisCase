using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AzureDevOpsMcp;

/// <summary>
/// 测试计划数据模型
/// </summary>
public class TestPlan
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("state")]
    public string State { get; set; } = "";

    [JsonPropertyName("rootSuite")]
    public TestSuiteReference? RootSuite { get; set; }

    [JsonIgnore]
    public int RootSuiteId => RootSuite?.Id ?? 0;

    [JsonPropertyName("iteration")]
    public string Iteration { get; set; } = "";

    [JsonPropertyName("owner")]
    public Owner? Owner { get; set; }
}

public class TestSuiteReference
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
}

public class TestPlanReference
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
}

public class TestSuite
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("suiteType")]
    public string SuiteType { get; set; } = "";

    [JsonPropertyName("hasChildren")]
    public bool HasChildren { get; set; }

    [JsonPropertyName("parentSuite")]
    public TestSuiteReference? ParentSuite { get; set; }

    [JsonPropertyName("plan")]
    public TestPlanReference? Plan { get; set; }

    [JsonPropertyName("inheritDefaultConfigurations")]
    public bool? InheritDefaultConfigurations { get; set; }
}

public class Owner
{
    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = "";

    [JsonPropertyName("uniqueName")]
    public string UniqueName { get; set; } = "";
}

/// <summary>
/// 测试用例数据模型
/// </summary>
public class TestCase
{
    [JsonIgnore]
    public int Id => WorkItem?.Id ?? 0;

    [JsonPropertyName("testPlan")]
    public TestPlanReference? TestPlan { get; set; }

    [JsonPropertyName("testSuite")]
    public TestSuiteReference? TestSuite { get; set; }

    [JsonPropertyName("workItem")]
    public WorkItem WorkItem { get; set; } = new();

    [JsonPropertyName("testMethod")]
    public string? TestMethod { get; set; }

    [JsonPropertyName("priority")]
    public int? Priority => GetIntField("Microsoft.VSTS.Common.Priority");

    [JsonPropertyName("state")]
    public string? State => GetStringField("System.State");

    [JsonPropertyName("automationStatus")]
    public string? AutomationStatus => GetStringField("Microsoft.VSTS.TCM.AutomationStatus");

    private int? GetIntField(string fieldName)
    {
        foreach (var field in WorkItem.WorkItemFields)
        {
            if (field.TryGetValue(fieldName, out var value) && value.ValueKind == JsonValueKind.Number)
                return value.GetInt32();
        }

        return null;
    }

    private string? GetStringField(string fieldName)
    {
        foreach (var field in WorkItem.WorkItemFields)
        {
            if (field.TryGetValue(fieldName, out var value))
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }

        return null;
    }
}

public class WorkItem
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("workItemFields")]
    public List<Dictionary<string, JsonElement>> WorkItemFields { get; set; } = new();
}

/// <summary>
/// 测试结果数据模型
/// </summary>
public class TestResult
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("testCase")]
    public TestCaseRef TestCase { get; set; } = new();

    [JsonPropertyName("state")]
    public string State { get; set; } = "";

    [JsonPropertyName("outcome")]
    public string Outcome { get; set; } = "";

    [JsonPropertyName("duration")]
    public long Duration { get; set; }

    [JsonPropertyName("startedDate")]
    public string StartedDate { get; set; } = "";

    [JsonPropertyName("completedDate")]
    public string CompletedDate { get; set; } = "";
}

public class TestCaseRef
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
}

/// <summary>
/// 测试运行数据模型
/// </summary>
public class TestRun
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("state")]
    public string State { get; set; } = "";

    [JsonPropertyName("createdDate")]
    public string CreatedDate { get; set; } = "";
}

/// <summary>
/// API 响应包装器
/// </summary>
public class ApiResponse<T>
{
    [JsonPropertyName("value")]
    public List<T> Value { get; set; } = new();

    [JsonPropertyName("count")]
    public int Count { get; set; }
}

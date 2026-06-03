"use strict";

const session = require("./browser-session");
const { queryOrCreateVNet } = require("../create-cache");

function stringProperty(description) {
  return { type: "string", description };
}

function booleanProperty(description) {
  return { type: "boolean", description };
}

function numberProperty(description) {
  return { type: "number", description };
}

function arrayProperty(description, itemType = "string") {
  return { type: "array", description, items: { type: itemType } };
}

function schema(properties, required = []) {
  return {
    type: "object",
    properties: {
      cdpEndpoint: stringProperty("Optional CDP endpoint. Defaults to CDP_ENDPOINT or http://127.0.0.1:9222."),
      pageUrlContains: stringProperty("Optional substring used to choose a specific open browser tab."),
      ...properties,
    },
    required,
  };
}

const tools = [
  {
    name: "cache_portal_status",
    description: "List CDP-connected browser pages and identify Azure Portal tabs.",
    inputSchema: schema({}),
  },
  {
    name: "cache_navigate_create_form",
    description: "Open or reuse an Azure Portal page and navigate to the Azure Cache for Redis create form.",
    inputSchema: schema({
      createUrl: stringProperty("Optional full create URL. Overrides the default Redis create form URL."),
      vnetFeatureFlag: booleanProperty("When true, loads the portal with feature.vnetInjectedCacheCreation=true before opening the create blade."),
    }),
  },
  {
    name: "cache_visible_dropdowns",
    description: "Return visible Azure Portal dropdown controls with their visible index and displayed text.",
    inputSchema: schema({}),
  },
  {
    name: "cache_select_dropdown",
    description: "Select a value from a visible Azure Portal dropdown using the existing robust dropdown helpers.",
    inputSchema: schema({
      dropdown: {
        description: "Dropdown name or visible index. Names: subscription, resourceGroup, region, cacheType, cacheSize.",
        anyOf: [{ type: "string" }, { type: "number" }],
      },
      text: stringProperty("Visible option text to select, such as Central US EUAP, Test-MaJunRu, Premium, or P1."),
      label: stringProperty("Optional label used in server logs."),
      noType: booleanProperty("Force non-filterable dropdown behavior. Automatically true for cacheSize."),
    }, ["dropdown", "text"]),
  },
  {
    name: "cache_choose_public_endpoint",
    description: "Select and verify the Public endpoint networking option on the Redis create form.",
    inputSchema: schema({}),
  },
  {
    name: "cache_select_zones",
    description: "Select Availability Zones from the current Redis create form combobox.",
    inputSchema: schema({
      zones: arrayProperty("Target zone numbers, for example [\"1\", \"2\"]."),
    }, ["zones"]),
  },
  {
    name: "cache_set_toggle",
    description: "Set an Azure Portal toggle by exact aria-label and verify the target aria-checked state.",
    inputSchema: schema({
      ariaLabel: stringProperty("Exact toggle aria-label, for example Non-TLS port Enable."),
      wantEnabled: booleanProperty("Desired toggle state."),
    }, ["ariaLabel", "wantEnabled"]),
  },
  {
    name: "cache_set_number_by_field_label",
    description: "Set a Portal slider/input by nearby visible field label, such as Shard count or Replica count.",
    inputSchema: schema({
      fieldLabel: stringProperty("Exact visible field label, for example Shard count or Replica count."),
      value: numberProperty("Desired numeric value to commit."),
    }, ["fieldLabel", "value"]),
  },
  {
    name: "cache_go_next",
    description: "Move to the next Redis create form tab by clicking a Next button or fallback tab.",
    inputSchema: schema({
      buttonText: stringProperty("Button text, for example Next: Networking >."),
      tabText: stringProperty("Fallback tab text, for example Networking."),
    }, ["buttonText", "tabText"]),
  },
  {
    name: "cache_fill_cache_name",
    description: "Fill the Redis cache DNS/name input on the Basics tab and verify the entered value.",
    inputSchema: schema({
      cacheName: stringProperty("Concrete Redis cache DNS name to type."),
    }, ["cacheName"]),
  },
  {
    name: "cache_read_page_text",
    description: "Read visible page text from the current Azure Portal page for review, validation, or deployment checks.",
    inputSchema: schema({
      maxChars: numberProperty("Maximum number of characters to return. Defaults to 6000."),
    }),
  },
  {
    name: "cache_capture_screenshot",
    description: "Capture a screenshot of the current Azure Portal page to a caller-provided path.",
    inputSchema: schema({
      path: stringProperty("Screenshot output path."),
      fullPage: booleanProperty("When true, capture the full page instead of the viewport."),
    }, ["path"]),
  },
  {
    name: "cache_click_create",
    description: "Click the enabled Create button on the Review + create tab.",
    inputSchema: schema({
      timeoutMs: numberProperty("Maximum wait time for the Create button. Defaults to 30000."),
    }),
  },
  {
    name: "cache_click_go_to_resource",
    description: "Find and click Go to resource across the deployment page and child frames.",
    inputSchema: schema({
      timeoutMs: numberProperty("Maximum wait time for the Go to resource control. Defaults to 60000."),
    }),
  },
  {
    name: "cache_query_or_create_vnet",
    description: "Use Azure CLI to find an existing VNet or create one for VNet-injected cache creation.",
    inputSchema: {
      type: "object",
      properties: {
        resourceGroup: stringProperty("Resource group name."),
        location: stringProperty("Azure location, for example centraluseuap."),
        vnetName: stringProperty("Virtual network name."),
        subnetName: stringProperty("Subnet name. Defaults to default."),
      },
      required: ["resourceGroup", "location", "vnetName"],
    },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "cache_portal_status":
      return { pages: await session.listPages(args) };
    case "cache_navigate_create_form":
      return await session.navigateToCreateForm(args);
    case "cache_visible_dropdowns":
      return { dropdowns: await session.summarizeVisibleDropdowns(args) };
    case "cache_select_dropdown":
      return await session.selectDropdown(args);
    case "cache_choose_public_endpoint":
      return await session.choosePublic(args);
    case "cache_select_zones":
      return await session.chooseZones(args);
    case "cache_set_toggle":
      return await session.updateToggle(args);
    case "cache_set_number_by_field_label":
      return await session.setNumberField(args);
    case "cache_go_next":
      return await session.next(args);
    case "cache_fill_cache_name":
      return await session.fillCacheName(args);
    case "cache_read_page_text":
      return await session.readPageText(args);
    case "cache_capture_screenshot":
      return await session.captureScreenshot(args);
    case "cache_click_create":
      return await session.clickCreate(args);
    case "cache_click_go_to_resource":
      return await session.clickGoToResource(args);
    case "cache_query_or_create_vnet":
      return queryOrCreateVNet(args.resourceGroup, args.location, args.vnetName, args.subnetName);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { tools, callTool };